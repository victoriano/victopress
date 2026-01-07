/**
 * Admin - Upload Page
 * 
 * GET /admin/upload
 * POST /admin/upload (form submission)
 * 
 * Features:
 * - Drag & drop upload
 * - Automatic WebP variant generation (browser-side)
 * - Progress tracking for processing and upload
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useFetcher, useSearchParams, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getContentIndex, addPhotosToGalleryIndex } from "~/lib/content-engine";
import { useState, useCallback, useRef, useEffect } from "react";

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Sort galleries for dropdown
  const galleries = [...contentIndex.galleries].sort((a, b) => a.title.localeCompare(b.title));
  
  return json({ username, galleries });
}

export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const files = formData.getAll("files") as File[];
  const gallery = formData.get("gallery") as string;
  const generateVariantsFlag = formData.get("generateVariants") !== "false"; // Default true
  
  if (files.length === 0) {
    return json({ error: "No files selected" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const results: Array<{
    name: string;
    status: string;
    path?: string;
    error?: string;
    variantsCreated?: number;
  }> = [];
  
  // Helper to check if file is a variant
  const isVariantFile = (filename: string) => /_\d+w\.webp$/i.test(filename);
  
  // Separate original files from pre-generated variants (from browser)
  const originalFiles: File[] = [];
  const variantFiles: File[] = [];
  
  for (const file of files) {
    if (isVariantFile(file.name)) {
      variantFiles.push(file);
    } else {
      originalFiles.push(file);
    }
  }
  
  // Process original files
  for (const file of originalFiles) {
    try {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        results.push({ name: file.name, status: "error", error: "Not an image" });
        continue;
      }
      
      // Build destination path
      const destPath = gallery
        ? `galleries/${gallery}/${file.name}`
        : `galleries/uploads/${file.name}`;
      
      // Upload original file
      const buffer = await file.arrayBuffer();
      await storage.put(destPath, buffer, file.type);
      
      // Variants are now generated in the browser and uploaded separately via /api/admin/upload-variant
      
      results.push({ 
        name: file.name, 
        status: "success", 
        path: destPath,
        variantsCreated: 0, // Variants are counted separately via upload-variant endpoint
      });
    } catch (error) {
      results.push({
        name: file.name,
        status: "error",
        error: error instanceof Error ? error.message : "Upload failed",
      });
    }
  }
  
  // Upload any pre-generated variants (from browser processing)
  for (const file of variantFiles) {
    try {
      const destPath = gallery
        ? `galleries/${gallery}/${file.name}`
        : `galleries/uploads/${file.name}`;
      
      const buffer = await file.arrayBuffer();
      await storage.put(destPath, buffer, "image/webp");
      // Don't add to results - variants are counted with their originals
    } catch (error) {
      console.error(`[Upload] Failed to upload variant ${file.name}:`, error);
    }
  }
  
  const successCount = results.filter((r) => r.status === "success").length;
  const totalVariants = results.reduce((sum, r) => sum + (r.variantsCreated || 0), 0);
  
  // Update content index incrementally
  if (successCount > 0) {
    const successfulPaths = results
      .filter((r) => r.status === "success" && r.path)
      .map((r) => r.path as string);
    
    const galleryPath = gallery
      ? `galleries/${gallery}`
      : "galleries/uploads";
    
    try {
      await addPhotosToGalleryIndex(storage, galleryPath, successfulPaths);
      console.log(`[Upload] Updated index with ${successfulPaths.length} new photos`);
    } catch (error) {
      console.error("[Upload] Failed to update index:", error);
    }
  }
  
  const variantMsg = totalVariants > 0 ? ` (+ ${totalVariants} optimized variants)` : "";
  
  return json({
    success: successCount > 0,
    message: `Uploaded ${successCount} photo${successCount !== 1 ? 's' : ''}${variantMsg}`,
    results,
  });
}

export default function AdminUpload() {
  const { username, galleries } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const defaultGallery = searchParams.get("gallery") || "";
  
  const fetcher = useFetcher<typeof action>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedGallery, setSelectedGallery] = useState(defaultGallery);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [generateVariants, setGenerateVariants] = useState(true);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter((f) =>
        f.type.startsWith("image/")
      );
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Processing state for browser-based optimization
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  
  const handleSubmit = useCallback(async () => {
    if (files.length === 0) return;
    
    const formData = new FormData();
    formData.append("gallery", selectedGallery);
    formData.append("generateVariants", "false"); // We'll handle variants in browser
    
    // Upload original files first
    files.forEach((file) => formData.append("files", file));
    
    fetcher.submit(formData, {
      method: "POST",
      encType: "multipart/form-data",
    });
    
    // If generateVariants is enabled, process in browser after upload starts
    if (generateVariants) {
      setIsProcessing(true);
      setProcessingProgress({ current: 0, total: files.length });
      
      try {
        const { optimizeImageInBrowser, cleanupVariantUrls } = await import("~/utils/browser-image-optimizer");
        const galleryPath = selectedGallery ? `galleries/${selectedGallery}` : "galleries/uploads";
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProcessingProgress({ current: i + 1, total: files.length });
          
          try {
            const result = await optimizeImageInBrowser(file, file.name);
            
            // Upload each variant
            for (let vi = 0; vi < result.variants.length; vi++) {
              const variant = result.variants[vi];
              const isLast = vi === result.variants.length - 1;
              
              const variantFormData = new FormData();
              variantFormData.append("file", variant.blob, variant.filename);
              variantFormData.append("path", `${galleryPath}/${variant.filename}`);
              variantFormData.append("originalPath", `${galleryPath}/${file.name}`);
              if (isLast) variantFormData.append("markOptimized", "true");
              
              await fetch("/api/admin/upload-variant", {
                method: "POST",
                body: variantFormData,
                credentials: "include",
              });
            }
            
            cleanupVariantUrls(result.variants);
          } catch (err) {
            console.error(`[Upload] Failed to optimize ${file.name}:`, err);
          }
        }
      } catch (err) {
        console.error("[Upload] Browser optimization failed:", err);
      } finally {
        setIsProcessing(false);
      }
    }
  }, [files, selectedGallery, fetcher, generateVariants]);

  const isUploading = fetcher.state !== "idle";
  
  // Track upload success state
  const uploadSuccess = fetcher.data && "success" in fetcher.data && fetcher.data.success;
  const uploadedGallery = selectedGallery;
  
  // Clear files after successful upload
  useEffect(() => {
    if (uploadSuccess && fetcher.state === "idle") {
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [uploadSuccess, fetcher.state]);
  
  // Reset success state when starting new upload
  const handleUploadMore = useCallback(() => {
    // Just focus on the file input to allow new selection
    fileInputRef.current?.click();
  }, []);

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Upload Photos</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Drag & drop photos or click to select files
          </p>
        </div>

        {/* Gallery Selector */}
        <div className="mb-6">
          <label
            htmlFor="gallery"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Destination Gallery
          </label>
          <select
            id="gallery"
            value={selectedGallery}
            onChange={(e) => setSelectedGallery(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">New Gallery (uploads)</option>
            {galleries.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.title} ({g.photoCount} photos)
              </option>
            ))}
          </select>
        </div>

        {/* Optimization Options */}
        <div className="mb-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={generateVariants}
              onChange={(e) => setGenerateVariants(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 dark:border-gray-700 text-blue-500 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Generate optimized WebP variants
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Creates 800px, 1600px, and 2400px WebP versions for faster loading (processed in your browser)
              </p>
            </div>
          </label>
        </div>

        {/* Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
            dragActive
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <UploadIcon />
          </div>
          
          <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {dragActive ? "Drop photos here" : "Drag & drop photos here"}
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            or click to select files
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            Supports JPG, PNG, GIF, WebP
          </p>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900 dark:text-white">
                {files.length} file{files.length !== 1 ? "s" : ""} selected
              </h3>
              <button
                onClick={clearFiles}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Clear all
              </button>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="relative group aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <CloseIcon />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                    <p className="text-white text-xs truncate">{file.name}</p>
                    <p className="text-white/70 text-xs">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Upload Button */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleSubmit}
                  disabled={isUploading || isProcessing}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <>
                      <LoadingIcon />
                      Uploading...
                    </>
                  ) : isProcessing ? (
                    <>
                      <LoadingIcon />
                      Optimizing {processingProgress.current}/{processingProgress.total}...
                    </>
                  ) : (
                    <>
                      <UploadIcon />
                      Upload {files.length} photo{files.length !== 1 ? "s" : ""}
                      {generateVariants && <span className="text-xs opacity-70 ml-1">(+ WebP variants)</span>}
                    </>
                  )}
                </button>
                
                {fetcher.data && "message" in fetcher.data && !isProcessing && (
                  <p
                    className={`text-sm ${
                      "success" in fetcher.data && fetcher.data.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {fetcher.data.message}
                  </p>
                )}
              </div>
              
              {/* Processing Progress Bar */}
              {isProcessing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>Generating WebP variants in browser...</span>
                    <span>{processingProgress.current}/{processingProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success State - Show after successful upload */}
        {uploadSuccess && files.length === 0 && (
          <div className="mt-8 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                <SuccessIcon />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-green-800 dark:text-green-300 mb-1">
                  Upload Complete!
                </h3>
                <p className="text-green-700 dark:text-green-400 mb-4">
                  {fetcher.data && "message" in fetcher.data ? fetcher.data.message : "Your photos have been uploaded successfully."}
                </p>
                
                {/* Upload Results List */}
                {fetcher.data && "results" in fetcher.data && fetcher.data.results && (
                  <div className="mb-4 space-y-1">
                    {(fetcher.data.results as Array<{ name: string; status: string; error?: string }>).map((result, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-sm"
                      >
                        {result.status === "success" ? (
                          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                            <CheckIcon />
                            <span className="text-green-700 dark:text-green-300">{result.name}</span>
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            ✕ {result.name}: {result.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to={uploadedGallery ? `/admin/galleries/${uploadedGallery}` : "/admin/galleries"}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium text-sm"
                  >
                    <GalleryIcon />
                    View Gallery
                  </Link>
                  <button
                    type="button"
                    onClick={handleUploadMore}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors font-medium text-sm"
                  >
                    <UploadIcon />
                    Upload More
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Results - Only show if there are errors and files still present */}
        {fetcher.data && "results" in fetcher.data && fetcher.data.results && files.length > 0 && (
          <div className="mt-6 bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">Upload Results</h3>
            <div className="space-y-2">
              {(fetcher.data.results as Array<{ name: string; status: string; error?: string }>).map((result, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-700 dark:text-gray-300 truncate">
                    {result.name}
                  </span>
                  {result.status === "success" ? (
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckIcon />
                      Uploaded
                    </span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">
                      {result.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// Icons
function UploadIcon() {
  return (
    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}
