/**
 * Admin - Settings
 * 
 * GET /admin/settings
 * POST /admin/settings (storage test, R2 configuration)
 */

import React, { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, isDemoMode, getStorageMode, isDevelopment, getAdapterPreference, getContentIndex, rebuildContentIndex } from "~/lib/content-engine";
import type { StorageAdapterPreference, ContentIndex } from "~/lib/content-engine";

type StorageAdapterType = "local" | "r2" | "unconfigured";

interface StorageConfig {
  adapterType: StorageAdapterType;
  adapterPreference: StorageAdapterPreference;
  isR2: boolean;
  r2Available: boolean; // R2 bucket is configured and available
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
  
  const storage = getStorage(context, request);
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
  const storage = getStorage(context, request);
  const env = context.cloudflare?.env as Env | undefined;
  const demoMode = isDemoMode(context);
  const storageMode = getStorageMode(context);
  const isDevMode = isDevelopment();
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Get adapter preference from .dev.vars
  const adapterPreference = getAdapterPreference(context);
  
  // Get storage configuration details
  const storageConfig: StorageConfig = {
    adapterType: storageMode,
    adapterPreference,
    isR2: storageMode === "r2",
    r2Available: !!env?.CONTENT_BUCKET, // R2 is configured even if not in use
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
    stats: contentIndex.stats,
    indexInfo: {
      updatedAt: contentIndex.updatedAt,
      version: contentIndex.version,
    },
    env: {
      hasAdminCredentials: !!env?.ADMIN_USERNAME,
      hasR2Bucket: !!env?.CONTENT_BUCKET,
    },
    storageConfig,
  });
}

export default function AdminSettings() {
  const { username, isDemoMode: demoMode, stats, indexInfo, env, storageConfig } = useLoaderData<typeof loader>();
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
          <InfoRow label="Galleries" value={stats.totalGalleries.toString()} />
          <InfoRow label="Photos" value={stats.totalPhotos.toString()} />
          <InfoRow label="Blog Posts" value={stats.totalPosts.toString()} />
          <InfoRow label="Pages" value={stats.totalPages.toString()} />
        </Section>

        {/* Content Index */}
        <Section 
          title="Content Index" 
          icon={<IndexIcon />}
          badge={{ 
            text: indexInfo.updatedAt ? "Active" : "Not Built", 
            color: indexInfo.updatedAt ? "green" : "yellow" 
          }}
        >
          <ContentIndexPanel indexInfo={indexInfo} />
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
            
            {/* Adapter Toggle - only in development when R2 is available */}
            {storageConfig.isDevelopment && storageConfig.r2Available && (
              <AdapterToggle 
                currentAdapter={storageConfig.adapterType}
                bucketName={storageConfig.bucketName}
              />
            )}
            
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

            {storageConfig.adapterType === "unconfigured" && (
              <>
                {/* Storage Not Configured Error */}
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <WarningIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-red-800 dark:text-red-200 font-medium">Storage Not Configured</p>
                      <p className="text-red-700 dark:text-red-300 mt-1">
                        R2 Storage is required for VictoPress to function. Please connect an R2 bucket to continue.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Option to connect to R2 */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Connect Storage</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Configure R2 storage to enable content management and uploads.
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
          <ImageOptimizationPanel />
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

function IndexIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
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

// R2 Configuration Wizard Component
function R2ConfigModal({ 
  isOpen, 
  onClose, 
  currentConfig 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  currentConfig: StorageConfig;
}) {
  const fetcher = useFetcher<{
    success: boolean;
    error?: string;
    message?: string;
    tokenInfo?: { id: string; name: string; status: string };
    accounts?: Array<{ id: string; name: string }>;
    buckets?: Array<{ name: string; creation_date: string }>;
    bucket?: { name: string };
    configSaved?: boolean;
    wranglerConfig?: string;
    wranglerUpdated?: boolean;
    deploymentId?: string;
    deploymentUrl?: string;
    deploymentNote?: string;
  }>();
  
  // Wizard state
  const [step, setStep] = useState(1);
  const [apiToken, setApiToken] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<{ id: string; name: string } | null>(null);
  const [buckets, setBuckets] = useState<Array<{ name: string; creation_date: string }>>([]);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [newBucketName, setNewBucketName] = useState("victopress-content");
  const [createNewBucket, setCreateNewBucket] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [projectName, setProjectName] = useState("victopress"); // Cloudflare Pages project name
  const [showToken, setShowToken] = useState(false);
  
  // Reset state when modal closes
  const handleClose = () => {
    setStep(1);
    setApiToken("");
    setSelectedAccount(null);
    setBuckets([]);
    setSelectedBucket("");
    setNewBucketName("victopress-content");
    setCreateNewBucket(false);
    setPublicUrl("");
    setShowToken(false);
    onClose();
  };
  
  // Handle API token verification
  const handleVerifyToken = () => {
    const formData = new FormData();
    formData.append("action", "test-token");
    formData.append("apiToken", apiToken);
    fetcher.submit(formData, { method: "post", action: "/api/storage-config" });
  };
  
  // Handle listing buckets
  const handleListBuckets = (accountId: string) => {
    const formData = new FormData();
    formData.append("action", "list-buckets");
    formData.append("apiToken", apiToken);
    formData.append("accountId", accountId);
    fetcher.submit(formData, { method: "post", action: "/api/storage-config" });
  };
  
  // Handle creating bucket
  const handleCreateBucket = () => {
    const formData = new FormData();
    formData.append("action", "create-bucket");
    formData.append("apiToken", apiToken);
    formData.append("accountId", selectedAccount!.id);
    formData.append("bucketName", newBucketName);
    fetcher.submit(formData, { method: "post", action: "/api/storage-config" });
  };
  
  // Handle saving configuration
  const handleSaveConfig = () => {
    const formData = new FormData();
    formData.append("action", "save-config");
    formData.append("apiToken", apiToken); // Need token for production API calls
    formData.append("accountId", selectedAccount!.id);
    formData.append("bucketName", createNewBucket ? newBucketName : selectedBucket);
    formData.append("publicUrl", publicUrl);
    // Include project name for production deployment via API
    if (!currentConfig.isDevelopment && projectName) {
      formData.append("projectName", projectName);
    }
    fetcher.submit(formData, { method: "post", action: "/api/storage-config" });
  };
  
  // Handle fetcher results
  React.useEffect(() => {
    if (fetcher.data?.success) {
      // Token verified - get accounts
      if (fetcher.data.accounts && step === 1) {
        setStep(2);
      }
      // Buckets listed
      if (fetcher.data.buckets !== undefined && step === 2) {
        setBuckets(fetcher.data.buckets);
        setStep(3);
      }
      // Bucket created
      if (fetcher.data.bucket) {
        setSelectedBucket(fetcher.data.bucket.name);
        setCreateNewBucket(false);
        // Refresh bucket list
        handleListBuckets(selectedAccount!.id);
      }
      // Config saved
      if (fetcher.data.configSaved !== undefined) {
        setStep(5);
      }
    }
  }, [fetcher.data]);
  
  const isLoading = fetcher.state === "submitting";
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <CloudIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  R2 Storage Setup Wizard
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Step {step} of 5 — {getStepTitle(step)}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
          
          {/* Progress Bar */}
          <div className="px-6 pt-4">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <div key={s} className="flex-1 flex items-center">
                  <div className={`flex-1 h-1.5 rounded-full transition-colors ${
                    s <= step ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-700"
                  }`} />
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Step 1: API Token */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 mb-4">
                    <KeyIcon className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Connect to Cloudflare
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Enter your Cloudflare API Token to get started
                  </p>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Cloudflare API Token
                    </label>
                    <div className="relative">
                      <input
                        type={showToken ? "text" : "password"}
                        value={apiToken}
                        onChange={(e) => setApiToken(e.target.value)}
                        placeholder="Enter your API token..."
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showToken ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      Need a token? Create one with <strong>R2:Edit</strong> permissions.
                    </p>
                  </div>
                  
                  <a
                    href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22r2_bucket%22%2C%22type%22%3A%22edit%22%7D%5D&name=VictoPress+R2+Access"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalIcon />
                    Create API Token with R2 permissions
                  </a>
                  
                  {fetcher.data?.error && step === 1 && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                      <p className="text-sm text-red-700 dark:text-red-300">{fetcher.data.error}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Step 2: Select Account */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                    <CheckCircleIcon className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Token Verified!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Select the Cloudflare account to use
                  </p>
                </div>
                
                <div className="space-y-3">
                  {fetcher.data?.accounts?.map((account) => (
                    <button
                      key={account.id}
                      onClick={() => {
                        setSelectedAccount(account);
                        handleListBuckets(account.id);
                      }}
                      disabled={isLoading}
                      className={`w-full p-4 border rounded-xl text-left transition-all ${
                        selectedAccount?.id === account.id
                          ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{account.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{account.id}</p>
                        </div>
                        {selectedAccount?.id === account.id && isLoading && (
                          <LoadingSpinner />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                
                {fetcher.data?.error && step === 2 && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm text-red-700 dark:text-red-300">{fetcher.data.error}</p>
                  </div>
                )}
              </div>
            )}
            
            {/* Step 3: Select or Create Bucket */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 mb-4">
                    <StorageIcon className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Choose R2 Bucket
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Select an existing bucket or create a new one
                  </p>
                </div>
                
                {/* Existing Buckets */}
                {buckets.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Existing Buckets:</p>
                    {buckets.map((bucket) => (
                      <button
                        key={bucket.name}
                        onClick={() => {
                          setSelectedBucket(bucket.name);
                          setCreateNewBucket(false);
                        }}
                        className={`w-full p-4 border rounded-xl text-left transition-all ${
                          selectedBucket === bucket.name && !createNewBucket
                            ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                            : "border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white font-mono">{bucket.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400" suppressHydrationWarning>
                              Created: {new Date(bucket.creation_date).toLocaleDateString()}
                            </p>
                          </div>
                          {selectedBucket === bucket.name && !createNewBucket && (
                            <CheckCircleIcon className="w-5 h-5 text-orange-500" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Create New Bucket */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <button
                    onClick={() => setCreateNewBucket(true)}
                    className={`w-full p-4 border-2 border-dashed rounded-xl text-left transition-all ${
                      createNewBucket
                        ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                        : "border-gray-300 dark:border-gray-600 hover:border-orange-300 dark:hover:border-orange-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <PlusIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Create New Bucket</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Create a fresh bucket for your content
                        </p>
                      </div>
                    </div>
                  </button>
                  
                  {createNewBucket && (
                    <div className="mt-4 space-y-3">
                      <input
                        type="text"
                        value={newBucketName}
                        onChange={(e) => setNewBucketName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                        placeholder="bucket-name"
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        3-63 characters, lowercase letters, numbers, and hyphens only
                      </p>
                      <button
                        onClick={handleCreateBucket}
                        disabled={isLoading || newBucketName.length < 3}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2"
                      >
                        {isLoading ? <LoadingSpinner /> : <PlusIcon className="w-4 h-4" />}
                        Create Bucket
                      </button>
                    </div>
                  )}
                </div>
                
                {fetcher.data?.error && step === 3 && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm text-red-700 dark:text-red-300">{fetcher.data.error}</p>
                  </div>
                )}
                
                {fetcher.data?.message && fetcher.data.bucket && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <p className="text-sm text-green-700 dark:text-green-300">{fetcher.data.message}</p>
                  </div>
                )}
              </div>
            )}
            
            {/* Step 4: Review & Save */}
            {step === 4 && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
                    <SettingsIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Review Configuration
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Confirm your R2 storage settings
                  </p>
                </div>
                
                {/* Configuration Summary */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Account:</span>
                    <span className="text-gray-900 dark:text-white font-medium">{selectedAccount?.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Account ID:</span>
                    <span className="text-gray-900 dark:text-white font-mono text-sm">{selectedAccount?.id}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Bucket:</span>
                    <span className="text-gray-900 dark:text-white font-mono">{createNewBucket ? newBucketName : selectedBucket}</span>
                  </div>
                </div>
                
                {/* Optional Public URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Custom Public URL (optional)
                  </label>
                  <input
                    type="text"
                    value={publicUrl}
                    onChange={(e) => setPublicUrl(e.target.value)}
                    placeholder="https://cdn.example.com"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    If you have a custom domain configured for your R2 bucket
                  </p>
                </div>
                
                {currentConfig.isDevelopment ? (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex gap-3">
                      <InfoIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="text-blue-800 dark:text-blue-200 font-medium">Local Development</p>
                        <p className="text-blue-700 dark:text-blue-300 mt-1">
                          Credentials will be verified and saved. Local dev will continue using <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">./content/</code> folder. R2 is used in production.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Project Name for Production Auto-Deploy */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Cloudflare Pages Project Name
                      </label>
                      <input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="your-project-name"
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        The name of your Cloudflare Pages project (used to configure R2 and trigger deployment)
                      </p>
                    </div>
                    
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-green-800 dark:text-green-200 font-medium">Automatic Configuration</p>
                          <p className="text-green-700 dark:text-green-300 mt-1">
                            We'll use the Cloudflare API to automatically configure your project with the R2 bucket and trigger a new deployment.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                
                {fetcher.data?.error && step === 4 && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm text-red-700 dark:text-red-300">{fetcher.data.error}</p>
                  </div>
                )}
              </div>
            )}
            
            {/* Step 5: Complete */}
            {step === 5 && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                    <CheckCircleIcon className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Configuration Complete!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    {fetcher.data?.message}
                  </p>
                </div>
                
                {/* Production with deployment triggered */}
                {fetcher.data?.deploymentId && (
                  <div className="space-y-4">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-green-800 dark:text-green-200 font-medium">Deployment Triggered!</p>
                          <p className="text-green-700 dark:text-green-300 mt-1">
                            Your project is being redeployed with the new R2 configuration.
                          </p>
                          {fetcher.data.deploymentUrl && (
                            <a 
                              href={fetcher.data.deploymentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-2 text-green-600 dark:text-green-400 hover:underline"
                            >
                              <ExternalIcon />
                              View Deployment
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Production config saved but no deployment (manual trigger needed) */}
                {fetcher.data?.configSaved && fetcher.data?.deploymentNote && !fetcher.data?.deploymentId && (
                  <div className="space-y-4">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-green-800 dark:text-green-200 font-medium">Configuration Saved!</p>
                          <p className="text-green-700 dark:text-green-300 mt-1">
                            R2 settings have been configured for your project.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <InfoIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-blue-800 dark:text-blue-200 font-medium">Deploy to Apply</p>
                          <p className="text-blue-700 dark:text-blue-300 mt-1">
                            {fetcher.data.deploymentNote}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Fallback: Show wrangler config to copy (when API fails) */}
                {fetcher.data?.wranglerConfig && !fetcher.data?.configSaved && (
                  <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <WarningIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-amber-800 dark:text-amber-200 font-medium">Manual Configuration Required</p>
                          <p className="text-amber-700 dark:text-amber-300 mt-1">
                            We couldn't automatically configure your project. Copy the configuration below to your wrangler.toml and redeploy.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Add to wrangler.toml:
                      </p>
                      <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
                        {fetcher.data.wranglerConfig}
                      </pre>
                    </div>
                  </div>
                )}
                
                {/* Development: Config auto-saved to local files */}
                {fetcher.data?.configSaved && currentConfig.isDevelopment && (
                  <div className="space-y-4">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-green-800 dark:text-green-200 font-medium">Files Updated Automatically</p>
                          <ul className="text-green-700 dark:text-green-300 mt-1 space-y-1">
                            <li>✓ <code className="bg-green-100 dark:bg-green-800 px-1 rounded">.dev.vars</code> - R2 credentials saved</li>
                            {fetcher.data.wranglerUpdated && (
                              <li>✓ <code className="bg-green-100 dark:bg-green-800 px-1 rounded">wrangler.toml</code> - R2 bucket binding configured</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="flex gap-3">
                        <InfoIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-blue-800 dark:text-blue-200 font-medium">Ready for Production</p>
                          <p className="text-blue-700 dark:text-blue-300 mt-1">
                            You can switch to R2 storage using the toggle above, or commit your changes and deploy to Cloudflare where R2 will be used automatically.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-between rounded-b-2xl">
            <button
              onClick={step === 1 ? handleClose : () => setStep(step - 1)}
              disabled={step === 5}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 rounded-lg transition-colors text-sm font-medium"
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>
            
            <div className="flex gap-3">
              {step === 1 && (
                <button
                  onClick={handleVerifyToken}
                  disabled={!apiToken || isLoading}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2"
                >
                  {isLoading ? <LoadingSpinner /> : null}
                  Verify Token
                </button>
              )}
              
              {step === 3 && (
                <button
                  onClick={() => setStep(4)}
                  disabled={!selectedBucket && !createNewBucket}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Continue
                </button>
              )}
              
              {step === 4 && (
                <button
                  onClick={handleSaveConfig}
                  disabled={isLoading}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2"
                >
                  {isLoading ? <LoadingSpinner /> : null}
                  Save Configuration
                </button>
              )}
              
              {step === 5 && (
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStepTitle(step: number): string {
  switch (step) {
    case 1: return "Connect to Cloudflare";
    case 2: return "Select Account";
    case 3: return "Choose Bucket";
    case 4: return "Review & Save";
    case 5: return "Complete";
    default: return "";
  }
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

// Image Optimization Panel Component
function ImageOptimizationPanel() {
  const fetcher = useFetcher<{
    totalImages?: number;
    imagesWithVariants?: number;
    imagesNeedingOptimization?: number;
    percentOptimized?: number;
    success?: boolean;
    message?: string;
    stats?: {
      processed: number;
      skipped: number;
      failed: number;
      variantsCreated: number;
    };
  }>();
  
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<{
    processed: number;
    skipped: number;
    failed: number;
    variantsCreated: number;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState<{
    totalImages: number;
    imagesWithVariants: number;
    percentOptimized: number;
  } | null>(null);
  
  // Fetch optimization status on mount  
  React.useEffect(() => {
    console.log("[Progress] Component mounted, fetching status...");
    // Use direct fetch to avoid Remix fetcher issues
    fetch("/api/admin/optimize", { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        console.log("[Progress] Initial load:", data);
        setLiveStatus({
          totalImages: data.totalImages || 0,
          imagesWithVariants: data.imagesWithVariants || 0,
          percentOptimized: data.percentOptimized || 0,
        });
      })
      .catch(err => console.error("[Progress] Initial load failed:", err));
  }, []);
  
  // Sync fetcher data to liveStatus on initial load
  React.useEffect(() => {
    if (fetcher.data) {
      console.log("[Progress] Fetcher data received:", fetcher.data);
      setLiveStatus({
        totalImages: fetcher.data.totalImages || 0,
        imagesWithVariants: fetcher.data.imagesWithVariants || 0,
        percentOptimized: fetcher.data.percentOptimized || 0,
      });
    }
  }, [fetcher.data]);
  
  // Chunked optimization to avoid Cloudflare timeout (~30s limit)
  // Processes 5 images per request, loops until done
  const handleOptimizeAll = async (cleanup = false) => {
    setIsOptimizing(true);
    setOptimizeProgress(null);
    
    let offset = 0;
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalVariantsCreated = 0;
    let totalImages = 0;
    let hasMore = true;
    
    console.log(`[Optimize] Starting chunked optimization (cleanup=${cleanup})...`);
    
    try {
      while (hasMore) {
        console.log(`[Optimize] Processing batch at offset ${offset}...`);
        
        const response = await fetch("/api/admin/optimize", {
          method: "POST",
          body: new URLSearchParams({ 
            action: "optimize-batch",
            offset: String(offset),
            limit: "5", // 5 images per request to stay under 30s timeout
            cleanup: cleanup ? "true" : "false",
          }),
          credentials: "include",
        });
        
        if (!response.ok) {
          console.error(`[Optimize] Batch failed with status ${response.status}`);
          break;
        }
        
        const result = await response.json() as {
          success: boolean;
          batch: {
            processed: number;
            skipped: number;
            failed: number;
            variantsCreated: number;
          };
          progress: {
            totalImages: number;
            processedSoFar: number;
            percentComplete: number;
          };
          hasMore: boolean;
          nextOffset: number | null;
        };
        
        // Accumulate stats
        totalProcessed += result.batch.processed;
        totalSkipped += result.batch.skipped;
        totalFailed += result.batch.failed;
        totalVariantsCreated += result.batch.variantsCreated;
        totalImages = result.progress.totalImages;
        
        // Update UI with progress
        setLiveStatus({
          totalImages: result.progress.totalImages,
          imagesWithVariants: result.progress.processedSoFar,
          percentOptimized: result.progress.percentComplete,
        });
        
        console.log(`[Optimize] Batch complete: ${result.progress.processedSoFar}/${result.progress.totalImages} (${result.progress.percentComplete}%)`);
        
        hasMore = result.hasMore;
        offset = result.nextOffset || 0;
        
        // Small delay between batches to be nice to the API
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Set final progress
      setOptimizeProgress({
        processed: totalProcessed,
        skipped: totalSkipped,
        failed: totalFailed,
        variantsCreated: totalVariantsCreated,
      });
      
      console.log(`[Optimize] ✅ Complete! Processed: ${totalProcessed}, Skipped: ${totalSkipped}, Failed: ${totalFailed}`);
      
      // Refresh status from server
      fetcher.load("/api/admin/optimize");
      
    } catch (error) {
      console.error("[Optimize] Error:", error);
    } finally {
      setIsOptimizing(false);
    }
  };
  
  const status = liveStatus || fetcher.data;
  const isLoading = fetcher.state === "loading" && !liveStatus;
  
  return (
    <div className="space-y-4">
      {/* How it works */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-800/50 rounded-lg">
            <ImageIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              WebP Variant Generation
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Uses @cf-wasm/photon to generate optimized WebP variants (800, 1600, 2400px) for Retina & 5K displays
            </p>
          </div>
        </div>
      </div>
      
      {/* Status */}
      {status && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Total Images</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{status.totalImages}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Optimized</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{status.percentOptimized}%</p>
              <p className="text-xs text-gray-500">({status.imagesWithVariants}/{status.totalImages})</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Progress Bar */}
      {status && status.totalImages > 0 && status.percentOptimized < 100 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{isOptimizing ? "Processing..." : `${status.totalImages - status.imagesWithVariants} images need optimization`}</span>
            <span>{status.imagesWithVariants}/{status.totalImages} ({status.percentOptimized}%)</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div 
              className={`bg-gradient-to-r from-purple-500 to-pink-500 h-2.5 rounded-full transition-all duration-300 ${isOptimizing ? 'animate-pulse' : ''}`}
              style={{ width: `${Math.max(1, (status.imagesWithVariants / status.totalImages) * 100)}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Live counter during optimization */}
      {isOptimizing && status && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
            {status.imagesWithVariants} / {status.totalImages}
          </p>
          <p className="text-xs text-purple-500 dark:text-purple-400">images optimized</p>
        </div>
      )}
      
      {/* Optimize All Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleOptimizeAll}
          disabled={isOptimizing || (status?.percentOptimized === 100)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
        >
          {isOptimizing ? (
            <>
              <LoadingSpinner />
              Optimizing... {status?.imagesWithVariants ?? 0}/{status?.totalImages ?? '?'} done
            </>
          ) : isLoading ? (
            <>
              <LoadingSpinner />
              Loading Status...
            </>
          ) : status?.percentOptimized === 100 ? (
            <>
              <CheckIcon className="w-5 h-5" />
              All Images Optimized
            </>
          ) : (
            <>
              <ImageIcon className="w-5 h-5" />
              Optimize All Images
            </>
          )}
        </button>
        
        {status?.percentOptimized === 100 && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
            All images have WebP variants. New uploads are optimized automatically.
          </p>
        )}
        
        {/* Regenerate button - deletes old sizes and regenerates all */}
        <button
          type="button"
          onClick={async () => {
            if (!confirm("This will delete ALL existing variants (including old 400w, 1200w sizes) and regenerate them with new sizes (800w, 1600w, 2400w). Continue?")) {
              return;
            }
            setIsOptimizing(true);
            setOptimizeProgress(null);
            
            const pollInterval = setInterval(async () => {
              try {
                const res = await fetch("/api/admin/optimize", { credentials: "include" });
                const data = await res.json();
                setLiveStatus({
                  totalImages: data.totalImages || 0,
                  imagesWithVariants: data.imagesWithVariants || 0,
                  percentOptimized: data.percentOptimized || 0,
                });
              } catch (e) {
                console.error("Poll failed:", e);
              }
            }, 500);
            
            try {
              const response = await fetch("/api/admin/optimize", {
                method: "POST",
                body: new URLSearchParams({ action: "cleanup-and-optimize" }),
                credentials: "include",
              });
              const result = await response.json() as { stats?: { processed: number; skipped: number; failed: number; variantsCreated: number } };
              if (result.stats) {
                setOptimizeProgress(result.stats);
              }
              fetcher.load("/api/admin/optimize");
            } catch (error) {
              console.error("Regeneration failed:", error);
            } finally {
              clearInterval(pollInterval);
              setIsOptimizing(false);
            }
          }}
          disabled={isOptimizing}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isOptimizing ? (
            <>
              <LoadingSpinner />
              Regenerating...
            </>
          ) : (
            <>
              🔄 Regenerate All (delete old sizes)
            </>
          )}
        </button>
      </div>
      
      {/* Results */}
      {optimizeProgress && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-start gap-3">
            <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-800 dark:text-green-200 font-medium">Optimization Complete</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="text-green-700 dark:text-green-300">
                  <span className="font-semibold">{optimizeProgress.processed}</span> processed
                </div>
                <div className="text-green-700 dark:text-green-300">
                  <span className="font-semibold">{optimizeProgress.variantsCreated}</span> variants created
                </div>
                {optimizeProgress.skipped > 0 && (
                  <div className="text-gray-600 dark:text-gray-400">
                    <span className="font-semibold">{optimizeProgress.skipped}</span> skipped
                  </div>
                )}
                {optimizeProgress.failed > 0 && (
                  <div className="text-red-600 dark:text-red-400">
                    <span className="font-semibold">{optimizeProgress.failed}</span> failed
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Info about auto-optimization */}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p><strong>Auto-optimization:</strong> New uploads automatically generate WebP variants</p>
        <p><strong>Deletion:</strong> Variants are automatically deleted when original is removed</p>
      </div>
    </div>
  );
}

// Content Index Panel Component
function ContentIndexPanel({ 
  indexInfo 
}: { 
  indexInfo: { updatedAt: string; version: number } 
}) {
  const fetcher = useFetcher<{ success: boolean; message: string; rebuildTime?: number; fullRebuild?: boolean }>();
  const isRebuilding = fetcher.state !== "idle";
  
  // State for client-side date rendering to avoid hydration mismatch
  const [formattedDate, setFormattedDate] = React.useState<string | null>(null);
  const [timeSince, setTimeSince] = React.useState<string | null>(null);
  
  // Format date only on client to avoid hydration mismatch
  React.useEffect(() => {
    if (indexInfo.updatedAt) {
      const date = new Date(indexInfo.updatedAt);
      // Use consistent format: YYYY-MM-DD HH:MM:SS
      const formatted = date.toISOString().replace('T', ' ').substring(0, 19);
      setFormattedDate(formatted);
      
      // Calculate time since
      const ms = Date.now() - date.getTime();
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      
      if (days > 0) setTimeSince(`${days} day${days > 1 ? 's' : ''} ago`);
      else if (hours > 0) setTimeSince(`${hours} hour${hours > 1 ? 's' : ''} ago`);
      else if (minutes > 0) setTimeSince(`${minutes} minute${minutes > 1 ? 's' : ''} ago`);
      else setTimeSince('just now');
    }
  }, [indexInfo.updatedAt]);
  
  const handleRebuild = (full = false) => {
    fetcher.submit(
      { action: full ? "rebuild-index-full" : "rebuild-index" },
      { method: "POST", action: "/api/content-index" }
    );
  };
  
  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-800/50 rounded-lg">
              <IndexIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Pre-calculated Index
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enables instant navigation in admin panel
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400 rounded-full">
            v{indexInfo.version}
          </span>
        </div>
      </div>
      
      {/* Index Status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Last Updated</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formattedDate || (indexInfo.updatedAt ? '...' : 'Never')}
          </p>
          {indexInfo.updatedAt && timeSince && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {timeSince}
            </p>
          )}
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</p>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Active</p>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Auto-updates on content changes
          </p>
        </div>
      </div>
      
      {/* Rebuild Buttons */}
      <div className="pt-2 space-y-3">
        {/* Fast Rebuild (with EXIF cache) */}
        <button
          onClick={() => handleRebuild(false)}
          disabled={isRebuilding}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:shadow-none"
        >
          {isRebuilding ? (
            <>
              <LoadingSpinner />
              Rebuilding Index...
            </>
          ) : (
            <>
              <RefreshIcon className="w-5 h-5" />
              Rebuild Index
            </>
          )}
        </button>
        
        {/* Full Rebuild (re-scan all EXIF) */}
        <button
          onClick={() => handleRebuild(true)}
          disabled={isRebuilding}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded-xl font-medium transition-all border border-gray-200 dark:border-gray-700"
        >
          {isRebuilding ? (
            <>
              <LoadingSpinner />
              Rebuilding...
            </>
          ) : (
            <>
              <ImageIcon className="w-4 h-4" />
              Full Rebuild (Re-scan EXIF)
            </>
          )}
        </button>
        
        <p className="text-xs text-center text-gray-500 dark:text-gray-400">
          <strong>Rebuild Index:</strong> Uses cached EXIF data (~40ms) • 
          <strong className="ml-1">Full Rebuild:</strong> Re-reads all images (~400ms)
        </p>
      </div>
      
      {/* Result Messages */}
      {fetcher.data?.success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-700 dark:text-green-400">
            {fetcher.data.message}
            {fetcher.data.rebuildTime && (
              <span className="block text-xs mt-1 opacity-75">
                Completed in {fetcher.data.rebuildTime}ms
                {fetcher.data.fullRebuild && " (full EXIF re-scan)"}
              </span>
            )}
          </p>
        </div>
      )}
      {fetcher.data?.success === false && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{fetcher.data.message}</p>
        </div>
      )}
    </div>
  );
}

// Adapter Toggle Component
function AdapterToggle({ 
  currentAdapter, 
  bucketName 
}: { 
  currentAdapter: StorageAdapterType;
  bucketName: string | null;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string; adapter?: string; needsRestart?: boolean }>();
  const isLoading = fetcher.state !== "idle";
  const switchSuccess = fetcher.data?.success && fetcher.data?.needsRestart;
  
  const handleSwitch = (newAdapter: "local" | "r2") => {
    if (newAdapter === currentAdapter) return;
    
    fetcher.submit(
      { action: "switch-adapter", adapter: newAdapter },
      { method: "POST", action: "/api/storage-config" }
    );
  };
  
  return (
    <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-800/30 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Storage Adapter</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Switch between local files and cloud storage (requires restart)
          </p>
        </div>
        <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded-full">
          Dev Only
        </span>
      </div>
      
      {/* Toggle Buttons */}
      <div className="flex bg-gray-200 dark:bg-gray-700 rounded-lg p-1 gap-1">
        <button
          onClick={() => handleSwitch("local")}
          disabled={isLoading || switchSuccess}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            currentAdapter === "local"
              ? "bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <FolderIcon className="w-4 h-4" />
          <span>Local Storage</span>
          {currentAdapter === "local" && (
            <CheckIcon className="w-4 h-4 text-green-500" />
          )}
        </button>
        
        <button
          onClick={() => handleSwitch("r2")}
          disabled={isLoading || switchSuccess}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            currentAdapter === "r2"
              ? "bg-white dark:bg-gray-600 text-orange-600 dark:text-orange-400 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <CloudIcon className="w-4 h-4" />
          <span>R2 Storage</span>
          {bucketName && (
            <span className="text-xs opacity-60">({bucketName})</span>
          )}
          {currentAdapter === "r2" && (
            <CheckIcon className="w-4 h-4 text-green-500" />
          )}
        </button>
      </div>
      
      {/* Loading State */}
      {isLoading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <LoadingSpinner />
          <span>Updating .dev.vars...</span>
        </div>
      )}
      
      {/* Success State - Restart Required */}
      {switchSuccess && (
        <div className="mt-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Restart Required
              </h5>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Configuration saved to <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded font-mono text-xs">.dev.vars</code>. 
                Restart the dev server for changes to take effect:
              </p>
              <div className="mt-3 bg-gray-900 dark:bg-gray-950 rounded-lg p-3 font-mono text-sm text-green-400">
                <span className="text-gray-500 select-none">$ </span>
                <span className="select-all">bun run dev</span>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                Press Ctrl+C in the terminal first to stop the current server
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Error State */}
      {fetcher.data && !fetcher.data.success && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-400">{fetcher.data.message}</p>
        </div>
      )}
      
      {/* Switching indicator */}
      {fetcher.data?.success && (
        <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-700 dark:text-green-400">
              {fetcher.data.message} Reloading...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
