/**
 * Admin - Settings
 * 
 * GET /admin/settings
 * POST /admin/settings (storage test, R2 configuration)
 */

import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { scanGalleries, scanBlog, scanPages, getStorage, isDemoMode, getStorageMode, isDevelopment } from "~/lib/content-engine";

type StorageAdapterType = "local" | "r2" | "demo";

interface StorageConfig {
  adapterType: StorageAdapterType;
  isR2: boolean;
  isDevelopment: boolean;
  localPath: string | null;
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
  const demoMode = isDemoMode(context);
  const storageMode = getStorageMode(context);
  const isDevMode = isDevelopment();
  
  const [galleries, posts, pages] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
    scanPages(storage),
  ]);
  
  const totalPhotos = galleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  // Get storage configuration details
  const storageConfig: StorageConfig = {
    adapterType: storageMode,
    isR2: !!env?.CONTENT_BUCKET,
    isDevelopment: isDevMode,
    localPath: isDevMode ? "./content" : null,
    bucketName: env?.R2_BUCKET_NAME || null,
    publicUrl: env?.R2_PUBLIC_URL || null,
    accountId: env?.R2_ACCOUNT_ID || null,
    imageProvider: env?.IMAGE_PROVIDER || "cloudflare",
    imageCdnUrl: env?.IMAGE_CDN_URL || null,
  };
  
  return json({
    username,
    isDemoMode: demoMode,
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
  const { username, isDemoMode: demoMode, stats, env, storageConfig } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ testResult: StorageTestResult }>();
  const isTestingStorage = fetcher.state !== "idle";
  const testResult = fetcher.data?.testResult;

  // R2 config modal state
  const [showR2Config, setShowR2Config] = useState(false);

  // Seeding state
  const [seedingStatus, setSeedingStatus] = useState<{
    isSeeding: boolean;
    progress?: { uploaded: number; skipped: number; failed: number; total: number };
    error?: string;
    success?: boolean;
    message?: string;
  }>({ isSeeding: false });

  const runStorageTest = () => {
    fetcher.submit({}, { method: "POST" });
  };

  const seedContent = async () => {
    setSeedingStatus({ isSeeding: true });
    
    let startIndex = 0;
    let totalUploaded = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalFiles = 0;
    
    try {
      // Process files in batches
      while (true) {
        const response = await fetch("/api/admin/seed", {
          method: "POST",
          body: new URLSearchParams({
            action: "seed",
            skipExisting: "true",
            startIndex: startIndex.toString(),
          }),
          credentials: "include",
        });
        
        const result = await response.json() as {
          success?: boolean;
          error?: string;
          message?: string;
          results?: { 
            uploaded: number; 
            skipped: number; 
            failed: number; 
            total: number;
            processed: number;
            hasMore: boolean;
            nextIndex: number;
          };
        };
        
        if (!result.success) {
          setSeedingStatus({
            isSeeding: false,
            success: false,
            error: result.error || "Seeding failed",
            progress: { uploaded: totalUploaded, skipped: totalSkipped, failed: totalFailed, total: totalFiles },
          });
          return;
        }
        
        // Accumulate results
        if (result.results) {
          totalUploaded += result.results.uploaded;
          totalSkipped += result.results.skipped;
          totalFailed += result.results.failed;
          totalFiles = result.results.total;
          
          // Update progress
          setSeedingStatus({
            isSeeding: true,
            progress: { 
              uploaded: totalUploaded, 
              skipped: totalSkipped, 
              failed: totalFailed, 
              total: totalFiles 
            },
          });
          
          // Check if there are more files to process
          if (!result.results.hasMore) {
            break;
          }
          
          startIndex = result.results.nextIndex;
        } else {
          break;
        }
      }
      
      setSeedingStatus({
        isSeeding: false,
        success: true,
        message: `Seeded ${totalUploaded} files to R2 (${totalSkipped} skipped, ${totalFailed} failed)`,
        progress: { uploaded: totalUploaded, skipped: totalSkipped, failed: totalFailed, total: totalFiles },
      });
    } catch (error) {
      setSeedingStatus({
        isSeeding: false,
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      });
    }
  };

  return (
    <AdminLayout username={username || undefined} isDemoMode={demoMode}>
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

        {/* Storage Configuration */}
        <Section 
          title="Storage Configuration" 
          icon={<StorageIcon />}
          badge={
            storageConfig.adapterType === "r2" 
              ? { text: "R2 Connected", color: "green" } 
              : storageConfig.adapterType === "local"
              ? { text: "Local Storage", color: "blue" }
              : { text: "Demo Mode", color: "yellow" }
          }
        >
          <div className="space-y-4">
            {/* Current Adapter Info */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className={`p-3 rounded-xl ${
                storageConfig.adapterType === "r2" 
                  ? "bg-orange-100 dark:bg-orange-900/30" 
                  : storageConfig.adapterType === "local"
                  ? "bg-blue-100 dark:bg-blue-900/30"
                  : "bg-yellow-100 dark:bg-yellow-900/30"
              }`}>
                {storageConfig.adapterType === "r2" ? (
                  <CloudIcon className={`w-6 h-6 text-orange-600 dark:text-orange-400`} />
                ) : storageConfig.adapterType === "local" ? (
                  <FolderIcon className={`w-6 h-6 text-blue-600 dark:text-blue-400`} />
                ) : (
                  <DemoIcon className={`w-6 h-6 text-yellow-600 dark:text-yellow-400`} />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {storageConfig.adapterType === "r2" 
                    ? "Cloudflare R2" 
                    : storageConfig.adapterType === "local"
                    ? "Local Storage Adapter"
                    : "Demo Mode (Bundled Content)"}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {storageConfig.adapterType === "r2" 
                    ? "Connected to Cloudflare R2 bucket for production storage" 
                    : storageConfig.adapterType === "local"
                    ? "Reading content from local filesystem"
                    : "Using pre-bundled sample content (read-only)"}
                </p>
              </div>
              {storageConfig.isDevelopment && (
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded-full">
                  Dev Mode
                </span>
              )}
            </div>
            
            {/* Adapter-specific details */}
            {storageConfig.adapterType === "local" && (
              <>
                {/* Local Storage Details */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <FolderIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm flex-1">
                      <p className="text-blue-800 dark:text-blue-200 font-medium">Local Filesystem</p>
                      <p className="text-blue-700 dark:text-blue-300 mt-1">
                        Content is being served from: <code className="bg-blue-100 dark:bg-blue-800 px-2 py-0.5 rounded font-mono">{storageConfig.localPath}</code>
                      </p>
                      <ul className="mt-3 space-y-1 text-blue-600 dark:text-blue-400">
                        <li className="flex items-center gap-2">
                          <CheckIcon className="w-4 h-4" />
                          <span>Full read/write access</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckIcon className="w-4 h-4" />
                          <span>Changes reflect immediately</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckIcon className="w-4 h-4" />
                          <span>No cloud connection required</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Option to connect to R2 */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Connect to R2 Storage</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Want to use Cloudflare R2 for production? You can switch to R2 storage to serve content from the cloud.
                  </p>
                  <button
                    onClick={() => setShowR2Config(true)}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <CloudIcon className="w-4 h-4" />
                    Configure R2 Connection
                  </button>
                </div>
              </>
            )}

            {storageConfig.adapterType === "r2" && (
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

                {/* Edit Configuration */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setShowR2Config(true)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    Edit Configuration
                  </button>
                </div>
              </>
            )}

            {storageConfig.adapterType === "demo" && (
              <>
                {/* Demo Mode Info */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <WarningIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-yellow-800 dark:text-yellow-200 font-medium">Read-Only Mode</p>
                      <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                        The site is running with bundled sample content. This is a demonstration mode with limited functionality.
                        Configure R2 storage to enable full content management.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Option to connect to R2 */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Connect Storage</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Configure R2 storage to enable full content management and uploads.
                  </p>
                  <button
                    onClick={() => setShowR2Config(true)}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <CloudIcon className="w-4 h-4" />
                    Configure R2 Connection
                  </button>
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

        {/* R2 Configuration Modal */}
        {showR2Config && (
          <R2ConfigModal
            isOpen={showR2Config}
            onClose={() => setShowR2Config(false)}
            currentConfig={storageConfig}
          />
        )}

        {/* Content Seeding - only show when using R2 adapter */}
        {storageConfig.adapterType === "r2" && (
          <Section 
            title="Sample Content" 
            icon={<DownloadIcon />}
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Download sample galleries from the VictoPress GitHub repository to your R2 bucket.
                This includes ~250 photos organized into demo galleries.
              </p>

              {/* Seeding Progress */}
              {seedingStatus.isSeeding && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <LoadingSpinner />
                    <div className="flex-1">
                      <p className="text-blue-800 dark:text-blue-200 font-medium">Seeding content from GitHub...</p>
                      {seedingStatus.progress && seedingStatus.progress.total > 0 ? (
                        <>
                          <p className="text-blue-600 dark:text-blue-400 text-sm mt-1">
                            Processing {seedingStatus.progress.uploaded + seedingStatus.progress.skipped + seedingStatus.progress.failed} / {seedingStatus.progress.total} files
                          </p>
                          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-2">
                            <div 
                              className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${Math.round(((seedingStatus.progress.uploaded + seedingStatus.progress.skipped + seedingStatus.progress.failed) / seedingStatus.progress.total) * 100)}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-blue-600 dark:text-blue-400 text-sm mt-1">
                          Starting... (~220 MB of images)
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Success Result */}
              {seedingStatus.success && seedingStatus.message && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <div>
                      <p className="text-green-800 dark:text-green-200 font-medium">Content seeded successfully!</p>
                      <p className="text-green-600 dark:text-green-400 text-sm mt-1">{seedingStatus.message}</p>
                      {seedingStatus.progress && (
                        <div className="mt-3 flex gap-4 text-xs">
                          <span className="text-green-600 dark:text-green-400">
                            ✓ {seedingStatus.progress.uploaded} uploaded
                          </span>
                          {seedingStatus.progress.skipped > 0 && (
                            <span className="text-gray-500">
                              ○ {seedingStatus.progress.skipped} skipped
                            </span>
                          )}
                          {seedingStatus.progress.failed > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              ✗ {seedingStatus.progress.failed} failed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Error Result */}
              {seedingStatus.error && !seedingStatus.success && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <ErrorIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <div>
                      <p className="text-red-800 dark:text-red-200 font-medium">Seeding failed</p>
                      <p className="text-red-600 dark:text-red-400 text-sm mt-1">{seedingStatus.error}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Seed Button */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Existing files will be skipped
                </div>
                <button
                  onClick={seedContent}
                  disabled={seedingStatus.isSeeding}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {seedingStatus.isSeeding ? (
                    <>
                      <LoadingSpinner />
                      Seeding...
                    </>
                  ) : (
                    <>
                      <DownloadIcon />
                      Seed Sample Content
                    </>
                  )}
                </button>
              </div>
            </div>
          </Section>
        )}

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

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
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

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function DemoIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// R2 Configuration Modal Component
function R2ConfigModal({ 
  isOpen, 
  onClose, 
  currentConfig 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  currentConfig: StorageConfig;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <CloudIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  R2 Storage Configuration
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Configure Cloudflare R2 bucket connection
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Info Banner for Development */}
            {currentConfig.isDevelopment && (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <div className="flex gap-3">
                  <InfoIcon className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-purple-800 dark:text-purple-200 font-medium">Development Mode</p>
                    <p className="text-purple-700 dark:text-purple-300 mt-1">
                      You're running locally. To test R2 connection, you'll need to configure credentials in your <code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">.dev.vars</code> file or run with <code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">wrangler dev --remote</code>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Configuration Steps */}
            <div className="space-y-6">
              {/* Step 1: Create Bucket */}
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-orange-600 dark:text-orange-400">1</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">Create R2 Bucket</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Go to Cloudflare Dashboard → R2 → Create Bucket
                    </p>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Recommended bucket name:</p>
                      <code className="text-sm text-orange-600 dark:text-orange-400 font-mono">victopress-content</code>
                    </div>
                    <a 
                      href="https://dash.cloudflare.com/?to=/:account/r2/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalIcon />
                      Open Cloudflare R2 Dashboard
                    </a>
                  </div>
                </div>
              </div>

              {/* Step 2: Configure wrangler.toml */}
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-orange-600 dark:text-orange-400">2</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">Configure wrangler.toml</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Add the R2 binding to your <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">wrangler.toml</code>:
                    </p>
                    <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "victopress-content"

[vars]
R2_BUCKET_NAME = "victopress-content"
R2_ACCOUNT_ID = "your-account-id"  # Optional: enables dashboard links
R2_PUBLIC_URL = ""  # Optional: custom domain for images`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Step 3: For Local Development */}
              {currentConfig.isDevelopment && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-orange-600 dark:text-orange-400">3</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900 dark:text-white mb-2">Test R2 Locally (Optional)</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        To test R2 connection during local development, run:
                      </p>
                      <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`# Run with remote R2 bucket
bun run dev --remote

# Or use wrangler directly
wrangler pages dev --remote`}
                      </pre>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                        Note: This will use your actual R2 bucket instead of local filesystem.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Upload Content */}
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{currentConfig.isDevelopment ? "4" : "3"}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">Upload Content to R2</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Sync your local content folder to R2 using rclone:
                    </p>
                    <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`# Install rclone and configure R2
rclone config

# Sync local content to R2
rclone sync ./content r2:victopress-content --progress`}
                    </pre>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                      Or use the "Seed Sample Content" button in Settings after deployment.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Current Configuration */}
            {currentConfig.isR2 && (
              <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
                <h3 className="font-medium text-gray-900 dark:text-white mb-4">Current Configuration</h3>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Bucket:</span>
                    <span className="text-gray-900 dark:text-white font-mono">{currentConfig.bucketName || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Public URL:</span>
                    <span className="text-gray-900 dark:text-white font-mono">{currentConfig.publicUrl || "Worker routes"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Account ID:</span>
                    <span className="text-gray-900 dark:text-white font-mono">
                      {currentConfig.accountId ? `${currentConfig.accountId.slice(0, 8)}...` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium"
            >
              Close
            </button>
            <a
              href="https://developers.cloudflare.com/r2/get-started/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2"
            >
              <ExternalIcon />
              R2 Documentation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}
