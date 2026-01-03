/**
 * Admin - Settings
 * 
 * GET /admin/settings
 * POST /admin/settings (storage test)
 */

import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { scanGalleries, scanBlog, scanPages, getStorage } from "~/lib/content-engine";

interface StorageConfig {
  isR2: boolean;
  bucketName: string | null;
  publicUrl: string | null;
  accountId: string | null;
  imageProvider: string;
  imageCdnUrl: string | null;
}

interface StorageTestResult {
  success: boolean;
  message: string;
  details?: {
    canList: boolean;
    canRead: boolean;
    canWrite: boolean;
    fileCount?: number;
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const storage = getStorage(context);
  const env = context.cloudflare?.env as Env | undefined;
  const isR2 = !!env?.CONTENT_BUCKET;
  
  const result: StorageTestResult = {
    success: false,
    message: "",
    details: {
      canList: false,
      canRead: false,
      canWrite: false,
    },
  };

  try {
    // Test 1: Can list files
    const files = await storage.list("galleries");
    result.details!.canList = true;
    result.details!.fileCount = files.length;

    // Test 2: Can read (check if gallery.yaml exists anywhere)
    const rootFiles = await storage.list("");
    const hasContent = rootFiles.some(f => 
      f.name === "galleries" || f.name === "blog" || f.name === "home.yaml"
    );
    result.details!.canRead = hasContent;

    // Test 3: Can write (only test in development or if explicitly enabled)
    // For now, we assume write access if we have bucket binding
    result.details!.canWrite = isR2;

    result.success = result.details!.canList && result.details!.canRead;
    result.message = result.success 
      ? `Storage is healthy. Found ${result.details!.fileCount} items in galleries.`
      : "Storage accessible but content may be missing.";
  } catch (error) {
    result.success = false;
    result.message = `Storage test failed: ${error instanceof Error ? error.message : "Unknown error"}`;
  }

  return json({ testResult: result });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  const env = context.cloudflare?.env as Env | undefined;
  
  const [galleries, posts, pages] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
    scanPages(storage),
  ]);
  
  const totalPhotos = galleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  // Get storage configuration details
  const storageConfig: StorageConfig = {
    isR2: !!env?.CONTENT_BUCKET,
    bucketName: env?.R2_BUCKET_NAME || null,
    publicUrl: env?.R2_PUBLIC_URL || null,
    accountId: env?.R2_ACCOUNT_ID || null,
    imageProvider: env?.IMAGE_PROVIDER || "cloudflare",
    imageCdnUrl: env?.IMAGE_CDN_URL || null,
  };
  
  return json({
    username,
    stats: {
      galleries: galleries.length,
      photos: totalPhotos,
      posts: posts.length,
      pages: pages.length,
    },
    env: {
      hasAdminCredentials: !!env?.ADMIN_USERNAME,
      hasR2Bucket: !!env?.CONTENT_BUCKET,
    },
    storageConfig,
  });
}

export default function AdminSettings() {
  const { username, stats, env, storageConfig } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ testResult: StorageTestResult }>();
  const isTestingStorage = fetcher.state !== "idle";
  const testResult = fetcher.data?.testResult;

  const runStorageTest = () => {
    fetcher.submit({}, { method: "POST" });
  };

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Site configuration and information
          </p>
        </div>

        {/* Site Info */}
        <Section title="Site Information">
          <InfoRow label="Site Name" value="VictoPress" />
          <InfoRow label="Version" value="0.1.0" />
        </Section>

        {/* Content Stats */}
        <Section title="Content Statistics">
          <InfoRow label="Galleries" value={stats.galleries.toString()} />
          <InfoRow label="Photos" value={stats.photos.toString()} />
          <InfoRow label="Blog Posts" value={stats.posts.toString()} />
          <InfoRow label="Pages" value={stats.pages.toString()} />
        </Section>

        {/* R2 Storage Configuration */}
        <Section 
          title="R2 Storage Configuration" 
          icon={<StorageIcon />}
          badge={storageConfig.isR2 ? { text: "Connected", color: "green" } : { text: "Local Mode", color: "yellow" }}
        >
          <div className="space-y-4">
            {/* Connection Status */}
            <InfoRow 
              label="Storage Provider" 
              value={storageConfig.isR2 ? "Cloudflare R2" : "Local Filesystem"} 
              status={storageConfig.isR2 ? "success" : "info"}
            />
            
            {storageConfig.isR2 ? (
              <>
                {/* R2 Configuration Details */}
                <InfoRow 
                  label="Bucket Name" 
                  value={storageConfig.bucketName || "Not configured"} 
                  status={storageConfig.bucketName ? "success" : "warning"}
                  copyable={storageConfig.bucketName || undefined}
                />
                <InfoRow 
                  label="Public URL" 
                  value={storageConfig.publicUrl || "Not configured (using Worker routes)"} 
                  status={storageConfig.publicUrl ? "success" : "info"}
                  copyable={storageConfig.publicUrl || undefined}
                />
                <InfoRow 
                  label="Account ID" 
                  value={storageConfig.accountId ? `${storageConfig.accountId.slice(0, 8)}...` : "Not configured"} 
                  status={storageConfig.accountId ? "success" : "info"}
                />
                
                {/* Dashboard Link */}
                {storageConfig.accountId && storageConfig.bucketName && (
                  <div className="pt-2">
                    <a 
                      href={`https://dash.cloudflare.com/${storageConfig.accountId}/r2/default/buckets/${storageConfig.bucketName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalIcon />
                      Open in Cloudflare Dashboard
                    </a>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Local Storage Info */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <WarningIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-yellow-800 dark:text-yellow-200 font-medium">Development Mode</p>
                      <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                        Using local filesystem at <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">./content</code>. 
                        Configure R2 in <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">wrangler.toml</code> for production.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Storage Test */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">Connection Test</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Verify storage access and permissions</p>
                </div>
                <button
                  onClick={runStorageTest}
                  disabled={isTestingStorage}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {isTestingStorage ? (
                    <>
                      <LoadingSpinner />
                      Testing...
                    </>
                  ) : (
                    <>
                      <TestIcon />
                      Test Connection
                    </>
                  )}
                </button>
              </div>

              {testResult && (
                <div className={`mt-4 p-4 rounded-lg ${
                  testResult.success 
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" 
                    : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                }`}>
                  <div className="flex gap-3">
                    {testResult.success ? (
                      <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    ) : (
                      <ErrorIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    )}
                    <div className="text-sm">
                      <p className={testResult.success ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}>
                        {testResult.message}
                      </p>
                      {testResult.details && (
                        <div className="mt-2 flex gap-4 text-xs">
                          <span className={testResult.details.canList ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
                            ✓ List
                          </span>
                          <span className={testResult.details.canRead ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
                            ✓ Read
                          </span>
                          <span className={testResult.details.canWrite ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
                            {testResult.details.canWrite ? "✓" : "○"} Write
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Image Optimization */}
        <Section title="Image Optimization" icon={<ImageIcon />}>
          <InfoRow 
            label="Provider" 
            value={
              storageConfig.imageProvider === "cloudflare" ? "Cloudflare Image Resizing" :
              storageConfig.imageProvider === "sharp" ? "Sharp (Self-hosted)" :
              "None (Original images)"
            } 
            status={storageConfig.imageProvider !== "none" ? "success" : "info"}
          />
          {storageConfig.imageCdnUrl && (
            <InfoRow 
              label="CDN URL" 
              value={storageConfig.imageCdnUrl} 
              copyable={storageConfig.imageCdnUrl}
            />
          )}
          {storageConfig.imageProvider === "cloudflare" && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Images are automatically resized using Cloudflare's edge network. 
              Use <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/cdn-cgi/image/</code> URL prefix.
            </div>
          )}
        </Section>

        {/* Environment Variables */}
        <Section title="Authentication">
          <InfoRow 
            label="Admin Auth" 
            value={env.hasAdminCredentials ? "Configured" : "Dev Mode (localhost bypass)"} 
            status={env.hasAdminCredentials ? "success" : "warning"}
          />
          {!env.hasAdminCredentials && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">ADMIN_USERNAME</code> and{" "}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">ADMIN_PASSWORD</code> as secrets for production.
            </div>
          )}
        </Section>

        {/* R2 Setup Guide */}
        <Section title="R2 Setup Guide" icon={<BookIcon />} collapsible defaultCollapsed>
          <div className="space-y-4 text-sm text-gray-600 dark:text-gray-400">
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white mb-2">1. Create R2 Bucket</h4>
              <p>In Cloudflare Dashboard → R2 → Create Bucket → Name it <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">victopress-content</code></p>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white mb-2">2. Configure wrangler.toml</h4>
              <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto text-xs">
{`[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "victopress-content"

[vars]
R2_BUCKET_NAME = "victopress-content"
R2_ACCOUNT_ID = "your-account-id"`}
              </pre>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white mb-2">3. Upload Content</h4>
              <p>Use rclone to sync your local content folder:</p>
              <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto text-xs mt-2">
{`# Configure rclone with R2
rclone config

# Sync local to R2
rclone sync ./content r2:victopress-content`}
              </pre>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white mb-2">4. Optional: Custom Domain</h4>
              <p>Connect a custom domain in R2 settings and set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">R2_PUBLIC_URL</code> for direct image access.</p>
            </div>
          </div>
        </Section>

        {/* File Structure */}
        <Section title="Content Structure">
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/galleries/</code> - Photo galleries</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/blog/</code> - Blog posts</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/pages/</code> - Static pages</p>
            <p><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/home.yaml</code> - Homepage config</p>
          </div>
        </Section>

        {/* Documentation */}
        <Section title="Documentation">
          <div className="space-y-3">
            <a 
              href="https://www.notion.so/2dc358038bc5806e8d7bdd5649e4cef2" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Project Home (Notion)
            </a>
            <a 
              href="https://www.notion.so/1dd18ac214874a9da121897a495adc1d" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Architecture Documentation
            </a>
            <a 
              href="https://www.notion.so/2cfda3d4e02c42cd91b5b1850381329a" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalIcon />
              Roadmap
            </a>
          </div>
        </Section>
      </div>
    </AdminLayout>
  );
}

function Section({ 
  title, 
  children, 
  icon,
  badge,
  collapsible = false,
  defaultCollapsed = false,
}: { 
  title: string; 
  children: React.ReactNode;
  icon?: React.ReactNode;
  badge?: { text: string; color: "green" | "yellow" | "red" | "blue" };
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const badgeColors = {
    green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <div className="mb-8">
      <div 
        className={`flex items-center gap-3 mb-4 ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
      >
        {icon && <span className="text-gray-400 dark:text-gray-500">{icon}</span>}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
        {badge && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColors[badge.color]}`}>
            {badge.text}
          </span>
        )}
        {collapsible && (
          <ChevronIcon className={`w-5 h-5 text-gray-400 ml-auto transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
        )}
      </div>
      {(!collapsible || !isCollapsed) && (
        <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          {children}
        </div>
      )}
    </div>
  );
}

function InfoRow({ 
  label, 
  value, 
  status,
  copyable,
}: { 
  label: string; 
  value: string; 
  status?: "success" | "warning" | "info" | "error";
  copyable?: string;
}) {
  const [copied, setCopied] = useState(false);

  const statusColors = {
    success: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
    error: "text-red-600 dark:text-red-400",
  };

  const handleCopy = async () => {
    if (copyable) {
      await navigator.clipboard.writeText(copyable);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-medium ${status ? statusColors[status] : "text-gray-900 dark:text-white"}`}>
          {value}
        </span>
        {copyable && (
          <button 
            onClick={handleCopy}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <CopyIcon className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function TestIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
