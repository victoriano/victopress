/**
 * API - Batch Image Optimization
 * 
 * POST /api/admin/optimize
 * 
 * Actions:
 * - action: "optimize-all" - Process all images in the gallery system
 * - action: "optimize-gallery" - Process all images in a specific gallery
 * - action: "optimize-image" - Process a single image
 * - action: "status" - Get optimization status (how many images need processing)
 * 
 * Uses Jimp for server-side WebP generation.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";

// Helper functions that don't need Jimp
function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext || "");
}

function isVariantFile(filename: string): boolean {
  return /_\d+w\.webp$/.test(filename);
}

function getVariantFilename(originalFilename: string, width: number): string {
  const dotIndex = originalFilename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 
    ? originalFilename.substring(0, dotIndex) 
    : originalFilename;
  return `${nameWithoutExt}_${width}w.webp`;
}

// ============================================================================
// OPTIMIZATION INDEX - Tracks which images have been optimized
// Single JSON file for fast bulk lookups (no per-image network calls)
// ============================================================================

const OPTIMIZATION_INDEX_FILE = ".optimization-index.json";
const PROGRESS_COUNTER_FILE = ".opt-progress.txt";

interface OptimizationIndex {
  version: number;
  variantWidths: number[]; // [800, 1600, 2400] - to detect if widths changed
  optimizedImages: string[]; // List of optimized image paths
  lastUpdated: string;
}

// Load optimization index (single file read)
async function getOptimizationIndex(storage: ReturnType<typeof getStorage>): Promise<OptimizationIndex | null> {
  try {
    const data = await storage.get(OPTIMIZATION_INDEX_FILE);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as OptimizationIndex;
  } catch {
    return null;
  }
}

// Save optimization index
async function saveOptimizationIndex(storage: ReturnType<typeof getStorage>, index: OptimizationIndex): Promise<void> {
  const json = JSON.stringify(index);
  await storage.put(OPTIMIZATION_INDEX_FILE, new TextEncoder().encode(json), "application/json");
}

// Add image to optimization index
async function markImageOptimized(storage: ReturnType<typeof getStorage>, imagePath: string): Promise<void> {
  let index = await getOptimizationIndex(storage);
  if (!index) {
    index = {
      version: 1,
      variantWidths: [...CURRENT_VARIANT_WIDTHS],
      optimizedImages: [],
      lastUpdated: new Date().toISOString(),
    };
  }
  if (!index.optimizedImages.includes(imagePath)) {
    index.optimizedImages.push(imagePath);
    index.lastUpdated = new Date().toISOString();
    await saveOptimizationIndex(storage, index);
  }
}

// Batch update optimization index (more efficient for bulk operations)
async function markImagesOptimized(storage: ReturnType<typeof getStorage>, imagePaths: string[]): Promise<void> {
  let index = await getOptimizationIndex(storage);
  if (!index) {
    index = {
      version: 1,
      variantWidths: [...CURRENT_VARIANT_WIDTHS],
      optimizedImages: [],
      lastUpdated: new Date().toISOString(),
    };
  }
  const existingSet = new Set(index.optimizedImages);
  for (const path of imagePaths) {
    existingSet.add(path);
  }
  index.optimizedImages = Array.from(existingSet);
  index.lastUpdated = new Date().toISOString();
  await saveOptimizationIndex(storage, index);
}

// Clear optimization index (for full re-optimization)
async function clearOptimizationIndex(storage: ReturnType<typeof getStorage>): Promise<void> {
  try {
    await storage.delete(OPTIMIZATION_INDEX_FILE);
  } catch {
    // Ignore
  }
}

// Check if image is optimized (uses in-memory Set for fast lookups)
function isImageOptimized(index: OptimizationIndex | null, imagePath: string): boolean {
  if (!index) return false;
  // Check if variant widths match current config
  const widthsMatch = JSON.stringify(index.variantWidths) === JSON.stringify([...CURRENT_VARIANT_WIDTHS]);
  if (!widthsMatch) return false; // Needs re-optimization with new widths
  return index.optimizedImages.includes(imagePath);
}

// ============================================================================
// PROGRESS COUNTER - For real-time progress bar updates
// ============================================================================

// Read progress counter (fast - just a tiny text file)
async function getProgressCounter(storage: ReturnType<typeof getStorage>): Promise<{ current: number; total: number } | null> {
  try {
    const data = await storage.get(PROGRESS_COUNTER_FILE);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    const [current, total] = text.split("/").map(Number);
    return { current, total };
  } catch {
    return null;
  }
}

// Write progress counter (fast - just a tiny text file)
async function setProgressCounter(storage: ReturnType<typeof getStorage>, current: number, total: number): Promise<void> {
  await storage.put(PROGRESS_COUNTER_FILE, new TextEncoder().encode(`${current}/${total}`), "text/plain");
}

// Clear progress counter
async function clearProgressCounter(storage: ReturnType<typeof getStorage>): Promise<void> {
  try {
    await storage.delete(PROGRESS_COUNTER_FILE);
  } catch {
    // Ignore
  }
}

/**
 * GET - Get optimization status
 * 
 * Priority:
 * 1. Progress counter (real-time during optimization)
 * 2. Optimization index (accurate count of optimized images)
 * 3. Fallback to 0% if no data
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const storage = getStorage(context);
  
  // 1. Check for active progress counter (real-time updates during optimization)
  const counter = await getProgressCounter(storage);
  if (counter && counter.current < counter.total) {
    const { current, total } = counter;
    const percentOptimized = total > 0 ? Math.round((current / total) * 100) : 0;
    
    console.log(`[Optimize GET] ⚡ Progress: ${current}/${total}`);
    
    return json({
      totalImages: total,
      imagesWithVariants: current,
      imagesNeedingOptimization: total - current,
      percentOptimized,
      isRunning: true,
    });
  }
  
  // 2. Load optimization index and content index (2 file reads, no per-image calls)
  const [optIndex, contentIndex] = await Promise.all([
    getOptimizationIndex(storage),
    getContentIndex(storage),
  ]);
  
  // Count total images from content index
  let totalImages = 0;
  const allImagePaths: string[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      totalImages++;
      allImagePaths.push(`${galleryPath}/${photo.filename}`);
    }
  }
  
  // Count optimized images from index (instant - no network calls)
  let imagesWithVariants = 0;
  if (optIndex) {
    // Check if variant widths match current config
    const widthsMatch = JSON.stringify(optIndex.variantWidths) === JSON.stringify([...CURRENT_VARIANT_WIDTHS]);
    if (widthsMatch) {
      // Count how many of our images are in the optimized set
      const optimizedSet = new Set(optIndex.optimizedImages);
      imagesWithVariants = allImagePaths.filter(p => optimizedSet.has(p)).length;
    }
    // If widths don't match, all images need re-optimization (imagesWithVariants stays 0)
  }
  
  const percentOptimized = totalImages > 0 
    ? Math.round((imagesWithVariants / totalImages) * 100) 
    : 100;
  
  console.log(`[Optimize GET] 📊 Index: ${imagesWithVariants}/${totalImages} (${percentOptimized}%)`);
  
  return json({
    totalImages,
    imagesWithVariants,
    imagesNeedingOptimization: totalImages - imagesWithVariants,
    percentOptimized,
  });
}

/**
 * POST - Run optimization
 */
export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  
  switch (actionType) {
    case "optimize-all":
      return handleOptimizeAll(context);
    case "optimize-batch":
      // Process a batch of images (for chunked processing to avoid timeouts)
      return handleOptimizeBatch(formData, context);
    case "cleanup-old-sizes":
      // Just delete old sizes without re-optimizing
      return handleCleanupOldSizes(context);
    case "cleanup-and-optimize":
      return handleCleanupAndOptimize(context);
    
    // Browser-based optimization actions
    case "get-unoptimized":
      return handleGetUnoptimized(context, formData);
    case "get-job":
      return handleGetJob(context);
    case "pause-job":
      return handlePauseJob(context);
    case "update-job":
      return handleUpdateJob(context, formData);
    case "clear-job":
      return handleClearJob(context);
    case "optimize-gallery":
      return handleOptimizeGallery(formData, context);
    case "optimize-image":
      return handleOptimizeImage(formData, context);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

// Number of images to process in parallel within a batch
const PARALLEL_BATCH_SIZE = 3;

// Max images per request (to avoid Cloudflare timeout ~30s)
// With 3 variants per image, ~3s per image, this gives ~15s processing time
const MAX_IMAGES_PER_REQUEST = 5;

// Old variant sizes that are no longer used (to be cleaned up)
const OLD_VARIANT_WIDTHS = [400, 1200];

// Current variant sizes (must match image-optimizer.server.ts)
const CURRENT_VARIANT_WIDTHS = [800, 1600, 2400];

/**
 * Process a batch of images (for chunked processing to avoid timeouts)
 * The UI calls this repeatedly until all images are done.
 * 
 * @param offset - Start index in the list of images needing optimization
 * @param limit - Max images to process (default: MAX_IMAGES_PER_REQUEST)
 * @param cleanup - If true, delete old sizes first
 */
async function handleOptimizeBatch(
  formData: FormData,
  context: Parameters<typeof getStorage>[0]
) {
  const { processImageServer } = await import("~/lib/image-optimizer.server");
  const storage = getStorage(context);
  
  const offset = parseInt(formData.get("offset") as string || "0", 10);
  const limit = parseInt(formData.get("limit") as string || String(MAX_IMAGES_PER_REQUEST), 10);
  const cleanup = formData.get("cleanup") === "true";
  
  // Load content index and optimization index in parallel (2 file reads)
  const [contentIndex, optIndex] = await Promise.all([
    getContentIndex(storage),
    getOptimizationIndex(storage),
  ]);
  
  // Build set of already-optimized images for fast lookup
  const optimizedSet = new Set(optIndex?.optimizedImages || []);
  const widthsMatch = optIndex 
    ? JSON.stringify(optIndex.variantWidths) === JSON.stringify([...CURRENT_VARIANT_WIDTHS])
    : false;
  
  // Collect all images
  const allImages: { galleryPath: string; filename: string; imagePath: string }[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      const imagePath = `${galleryPath}/${photo.filename}`;
      allImages.push({ galleryPath, filename: photo.filename, imagePath });
    }
  }
  
  const totalImages = allImages.length;
  const batchImages = allImages.slice(offset, offset + limit);
  
  // Initialize progress counter and clear optimization index on first batch
  if (offset === 0) {
    await setProgressCounter(storage, 0, totalImages);
    if (cleanup) {
      await clearOptimizationIndex(storage);
    }
  }
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  let variantsDeleted = 0;
  let currentProgress = offset;
  const newlyOptimized: string[] = [];
  
  // Track processed images for UI display
  interface ProcessedImageInfo {
    filename: string;
    status: "processed" | "skipped" | "failed";
    variants?: { width: number; size: number }[];
    originalSize?: number;
  }
  const processedImages: ProcessedImageInfo[] = [];
  
  for (const { galleryPath, filename, imagePath } of batchImages) {
    // If cleanup mode, delete old and current variants first
    if (cleanup) {
      for (const width of [...OLD_VARIANT_WIDTHS, ...CURRENT_VARIANT_WIDTHS]) {
        const variantPath = `${galleryPath}/${getVariantFilename(filename, width)}`;
        try {
          if (await storage.exists(variantPath)) {
            await storage.delete(variantPath);
            variantsDeleted++;
          }
        } catch { /* ignore */ }
      }
    } else {
      // Skip if already optimized (instant check from in-memory Set, no network!)
      if (widthsMatch && optimizedSet.has(imagePath)) {
        skipped++;
        currentProgress++;
        processedImages.push({ filename, status: "skipped" });
        await setProgressCounter(storage, currentProgress, totalImages);
        continue;
      }
    }
    
    // Process the image
    try {
      const imageData = await storage.get(imagePath);
      if (!imageData) {
        failed++;
        currentProgress++;
        processedImages.push({ filename, status: "failed" });
        await setProgressCounter(storage, currentProgress, totalImages);
        continue;
      }
      
      const result = await processImageServer(imageData, filename);
      
      // Save variants and track sizes
      const variantSizes: { width: number; size: number }[] = [];
      for (const variant of result.variants) {
        const savePath = `${galleryPath}/${variant.filename}`;
        await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
        variantsCreated++;
        variantSizes.push({ width: variant.width, size: variant.size });
      }
      
      processed++;
      currentProgress++;
      newlyOptimized.push(imagePath);
      processedImages.push({
        filename,
        status: "processed",
        variants: variantSizes,
        originalSize: imageData.byteLength,
      });
      
      // Update progress counter after each image
      await setProgressCounter(storage, currentProgress, totalImages);
      
      // Log with size info
      const sizeSummary = variantSizes.map(v => `${v.width}w:${Math.round(v.size/1024)}KB`).join(", ");
      console.log(`[Batch] ✅ ${filename} (${Math.round(imageData.byteLength/1024)}KB → ${sizeSummary}) - ${currentProgress}/${totalImages}`);
    } catch (err) {
      console.error(`[Batch] ❌ Failed ${imagePath}:`, err);
      failed++;
      currentProgress++;
      processedImages.push({ filename, status: "failed" });
      await setProgressCounter(storage, currentProgress, totalImages);
    }
  }
  
  // Batch update the optimization index with newly optimized images
  if (newlyOptimized.length > 0) {
    await markImagesOptimized(storage, newlyOptimized);
  }
  
  const nextOffset = offset + limit;
  const hasMore = nextOffset < totalImages;
  
  // Clear progress counter when done (so next GET uses the optimization index)
  if (!hasMore) {
    await clearProgressCounter(storage);
  }
  
  return json({
    success: true,
    batch: {
      offset,
      limit,
      processed,
      skipped,
      failed,
      variantsCreated,
      variantsDeleted,
    },
    progress: {
      totalImages,
      processedSoFar: currentProgress,
      percentComplete: Math.round((currentProgress / totalImages) * 100),
    },
    // Detailed info about each processed image for UI display
    processedImages,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  });
}

/**
 * Just delete old variant sizes (400w, 1200w) without regenerating
 */
async function handleCleanupOldSizes(
  context: Parameters<typeof getStorage>[0]
) {
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  let deletedCount = 0;
  console.log(`[Cleanup] 🧹 Deleting old variants (${OLD_VARIANT_WIDTHS.join("w, ")}w)...`);
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      
      for (const width of OLD_VARIANT_WIDTHS) {
        const oldVariantPath = `${galleryPath}/${getVariantFilename(photo.filename, width)}`;
        try {
          if (await storage.exists(oldVariantPath)) {
            await storage.delete(oldVariantPath);
            deletedCount++;
            console.log(`[Cleanup] 🗑️ Deleted ${oldVariantPath}`);
          }
        } catch (err) {
          console.error(`[Cleanup] ❌ Failed to delete ${oldVariantPath}:`, err);
        }
      }
    }
  }
  
  // Clear optimization index since we deleted variants
  await clearOptimizationIndex(storage);
  
  console.log(`[Cleanup] ✅ Deleted ${deletedCount} old variants`);
  
  return json({
    success: true,
    deletedCount,
  });
}

/**
 * Clean up old variant sizes and regenerate with new sizes
 */
async function handleCleanupAndOptimize(
  context: Parameters<typeof getStorage>[0]
) {
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  // First, delete all old variants
  let deletedCount = 0;
  console.log(`[Cleanup] 🧹 Deleting old variants (${OLD_VARIANT_WIDTHS.join("w, ")}w)...`);
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      
      // Delete old variants
      for (const width of OLD_VARIANT_WIDTHS) {
        const oldVariantPath = `${galleryPath}/${getVariantFilename(photo.filename, width)}`;
        try {
          if (await storage.exists(oldVariantPath)) {
            await storage.delete(oldVariantPath);
            deletedCount++;
            console.log(`[Cleanup] 🗑️ Deleted ${oldVariantPath}`);
          }
        } catch (err) {
          console.error(`[Cleanup] ❌ Failed to delete ${oldVariantPath}:`, err);
        }
      }
      
      // Also delete ALL existing variants so we regenerate fresh
      for (const width of CURRENT_VARIANT_WIDTHS) {
        const variantPath = `${galleryPath}/${getVariantFilename(photo.filename, width)}`;
        try {
          if (await storage.exists(variantPath)) {
            await storage.delete(variantPath);
            deletedCount++;
          }
        } catch {
          // Ignore errors
        }
      }
    }
  }
  
  console.log(`[Cleanup] ✅ Deleted ${deletedCount} old variants`);
  
  // Now run the optimization
  return handleOptimizeAll(context);
}

/**
 * Optimize all images in all galleries (parallelized)
 */
async function handleOptimizeAll(
  context: Parameters<typeof getStorage>[0]
) {
  // Dynamic import to avoid blocking Vite startup
  const { processImageServer } = await import("~/lib/image-optimizer.server");
  
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  // Collect all images to process
  const imagesToProcess: { galleryPath: string; photo: { filename: string } }[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      imagesToProcess.push({ galleryPath, photo });
    }
  }
  
  const totalImages = imagesToProcess.length;
  
  // Initialize progress in R2
  let currentProgress = 0;
  await saveProgress(storage, {
    totalImages,
    imagesWithVariants: 0,
    isRunning: true,
    startedAt: Date.now(),
  });
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  let lastProgressSave = Date.now();
  
  // Save progress to R2 (rate limited to every 500ms)
  async function updateProgressFile() {
    const now = Date.now();
    if (now - lastProgressSave > 500) {
      lastProgressSave = now;
      await saveProgress(storage, {
        totalImages,
        imagesWithVariants: currentProgress,
        isRunning: true,
        startedAt: 0,
      });
    }
  }
  
  // Process a single image
  async function processImage(item: { galleryPath: string; photo: { filename: string } }) {
    const { galleryPath, photo } = item;
    
    // Check if already optimized
    const variantPath = `${galleryPath}/${getVariantFilename(photo.filename, 800)}`;
    try {
      if (await storage.exists(variantPath)) {
        skipped++;
        currentProgress++;
        return { status: 'skipped' as const };
      }
    } catch {
      // If exists check fails, try to process anyway
    }
    
    // Process this image
    const photoPath = `${galleryPath}/${photo.filename}`;
    
    try {
      const imageData = await storage.get(photoPath);
      if (!imageData) {
        failed++;
        return { status: 'failed' as const, reason: 'not found' };
      }
      
      const result = await processImageServer(imageData, photo.filename);
      
      // Save variants in parallel
      await Promise.all(result.variants.map(async (variant) => {
        const savePath = `${galleryPath}/${variant.filename}`;
        await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
        variantsCreated++;
      }));
      
      processed++;
      currentProgress++;
      console.log(`[Optimize] ✅ ${photo.filename} - ${currentProgress}/${totalImages}`);
      return { status: 'processed' as const };
    } catch (err) {
      console.error(`[Optimize] ❌ Failed ${photoPath}:`, err);
      failed++;
      return { status: 'failed' as const, reason: String(err) };
    }
  }
  
  // Process in parallel batches
  console.log(`[Optimize] 🚀 Starting parallel optimization of ${totalImages} images (batch size: ${PARALLEL_BATCH_SIZE})`);
  
  for (let i = 0; i < imagesToProcess.length; i += PARALLEL_BATCH_SIZE) {
    const batch = imagesToProcess.slice(i, i + PARALLEL_BATCH_SIZE);
    await Promise.all(batch.map(processImage));
    
    // Save progress to R2 after each batch
    await saveProgress(storage, {
      totalImages,
      imagesWithVariants: currentProgress,
      isRunning: true,
      startedAt: 0,
    });
    
    // Log batch progress
    const batchNum = Math.floor(i / PARALLEL_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(imagesToProcess.length / PARALLEL_BATCH_SIZE);
    console.log(`[Optimize] 📦 Batch ${batchNum}/${totalBatches} - Progress: ${currentProgress}/${totalImages}`);
  }
  
  // Mark optimization as complete - save final state
  await saveProgress(storage, {
    totalImages,
    imagesWithVariants: currentProgress,
    isRunning: false,
    startedAt: 0,
  });
  
  console.log(`[Optimize] 🎉 Complete! Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}`);
  
  return json({
    success: true,
    message: `Optimization complete`,
    stats: {
      processed,
      skipped,
      failed,
      variantsCreated,
    },
  });
}

/**
 * Optimize all images in a specific gallery
 */
async function handleOptimizeGallery(
  formData: FormData,
  context: Parameters<typeof getStorage>[0]
) {
  const { processImageServer } = await import("~/lib/image-optimizer.server");
  
  const gallerySlug = formData.get("gallerySlug") as string;
  
  if (!gallerySlug) {
    return json({ success: false, error: "Gallery slug required" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const galleryPath = `galleries/${gallerySlug}`;
  
  // List all files in the gallery
  const files = await storage.list(galleryPath);
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  
  for (const fileInfo of files) {
    const filename = fileInfo.name;
    
    if (!isImageFile(filename)) continue;
    if (isVariantFile(filename)) continue;
    
    // Check if already optimized
    const variantPath = `${galleryPath}/${getVariantFilename(filename, 800)}`;
    if (await storage.exists(variantPath)) {
      skipped++;
      continue;
    }
    
    const filePath = `${galleryPath}/${filename}`;
    
    try {
      const imageData = await storage.get(filePath);
      if (!imageData) {
        failed++;
        continue;
      }
      
      const result = await processImageServer(imageData, filename);
      
      for (const variant of result.variants) {
        const savePath = `${galleryPath}/${variant.filename}`;
        await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
        variantsCreated++;
      }
      
      processed++;
    } catch (err) {
      console.error(`[Optimize] Failed to process ${filePath}:`, err);
      failed++;
    }
  }
  
  return json({
    success: true,
    message: `Optimized gallery: ${gallerySlug}`,
    stats: {
      processed,
      skipped,
      failed,
      variantsCreated,
    },
  });
}

/**
 * Optimize a single image
 */
async function handleOptimizeImage(
  formData: FormData,
  context: Parameters<typeof getStorage>[0]
) {
  const { processImageServer } = await import("~/lib/image-optimizer.server");
  
  const imagePath = formData.get("imagePath") as string;
  
  if (!imagePath) {
    return json({ success: false, error: "Image path required" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const filename = imagePath.split("/").pop()!;
  const dir = imagePath.substring(0, imagePath.lastIndexOf("/"));
  
  if (!isImageFile(filename)) {
    return json({ success: false, error: "Not an image file" }, { status: 400 });
  }
  
  if (isVariantFile(filename)) {
    return json({ success: false, error: "Cannot process a variant file" }, { status: 400 });
  }
  
  try {
    const imageData = await storage.get(imagePath);
    if (!imageData) {
      return json({ success: false, error: "Image not found" }, { status: 404 });
    }
    
    const result = await processImageServer(imageData, filename);
    
    // Save variants - convert Uint8Array to ArrayBuffer
    let variantsCreated = 0;
    for (const variant of result.variants) {
      const savePath = `${dir}/${variant.filename}`;
      await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
      variantsCreated++;
    }
    
    return json({
      success: true,
      message: `Created ${variantsCreated} variants for ${filename}`,
      original: result.original,
      variantsCreated,
    });
  } catch (err) {
    console.error(`[Optimize] Failed to process ${imagePath}:`, err);
    return json({ 
      success: false, 
      error: err instanceof Error ? err.message : "Processing failed" 
    }, { status: 500 });
  }
}

// ============================================================================
// BROWSER-BASED OPTIMIZATION HANDLERS
// ============================================================================

const JOB_FILE = ".optimization-job.json";

interface OptimizationJob {
  status: "running" | "paused" | "completed";
  currentIndex: number;
  totalImages: number;
  stats: {
    processed: number;
    skipped: number;
    failed: number;
  };
  cleanup: boolean;
  startedAt: string;
  updatedAt: string;
}

async function getJob(storage: ReturnType<typeof getStorage>): Promise<OptimizationJob | null> {
  try {
    const data = await storage.get(JOB_FILE);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as OptimizationJob;
  } catch {
    return null;
  }
}

async function saveJob(storage: ReturnType<typeof getStorage>, job: OptimizationJob): Promise<void> {
  const jsonStr = JSON.stringify(job);
  await storage.put(JOB_FILE, new TextEncoder().encode(jsonStr), "application/json");
}

async function clearJob(storage: ReturnType<typeof getStorage>): Promise<void> {
  try {
    await storage.delete(JOB_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Get list of images needing optimization (for browser-based processing)
 */
async function handleGetUnoptimized(
  context: Parameters<typeof getStorage>[0],
  formData: FormData
) {
  const storage = getStorage(context);
  const cleanup = formData.get("cleanup") === "true";
  
  // Load indexes
  const [optIndex, contentIndex] = await Promise.all([
    getOptimizationIndex(storage),
    getContentIndex(storage),
  ]);
  
  // Build optimized set for fast lookup
  const optimizedSet = new Set(optIndex?.optimizedImages || []);
  const widthsMatch = optIndex 
    ? JSON.stringify(optIndex.variantWidths) === JSON.stringify([...CURRENT_VARIANT_WIDTHS])
    : false;
  
  // Collect images needing optimization
  interface ImageInfo {
    path: string;
    filename: string;
    galleryPath: string;
    url: string;
  }
  const unoptimized: ImageInfo[] = [];
  const allImages: ImageInfo[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      
      const imagePath = `${galleryPath}/${photo.filename}`;
      const imageInfo: ImageInfo = {
        path: imagePath,
        filename: photo.filename,
        galleryPath,
        url: `/api/images/${encodeURIComponent(imagePath).replace(/%2F/g, "/")}`,
      };
      
      allImages.push(imageInfo);
      
      // If cleanup mode, include all images
      // Otherwise, only include unoptimized
      if (cleanup) {
        unoptimized.push(imageInfo);
      } else if (!widthsMatch || !optimizedSet.has(imagePath)) {
        unoptimized.push(imageInfo);
      }
    }
  }
  
  // Create/update job file
  const job: OptimizationJob = {
    status: "running",
    currentIndex: 0,
    totalImages: unoptimized.length,
    stats: { processed: 0, skipped: 0, failed: 0 },
    cleanup,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveJob(storage, job);
  
  // If cleanup mode, clear the optimization index
  if (cleanup) {
    await clearOptimizationIndex(storage);
  }
  
  console.log(`[GetUnoptimized] Found ${unoptimized.length} images to process (cleanup=${cleanup})`);
  
  return json({
    success: true,
    images: unoptimized,
    totalImages: allImages.length,
    toProcess: unoptimized.length,
    cleanup,
  });
}

/**
 * Get current job state
 */
async function handleGetJob(context: Parameters<typeof getStorage>[0]) {
  const storage = getStorage(context);
  const job = await getJob(storage);
  
  if (!job) {
    return json({ success: true, job: null });
  }
  
  return json({ success: true, job });
}

/**
 * Pause the current job
 */
async function handlePauseJob(context: Parameters<typeof getStorage>[0]) {
  const storage = getStorage(context);
  const job = await getJob(storage);
  
  if (!job) {
    return json({ success: false, error: "No active job" }, { status: 404 });
  }
  
  job.status = "paused";
  job.updatedAt = new Date().toISOString();
  await saveJob(storage, job);
  
  console.log(`[PauseJob] Paused at ${job.currentIndex}/${job.totalImages}`);
  
  return json({ success: true, job });
}

/**
 * Update job progress (called by browser after each image)
 */
async function handleUpdateJob(
  context: Parameters<typeof getStorage>[0],
  formData: FormData
) {
  const storage = getStorage(context);
  const job = await getJob(storage);
  
  if (!job) {
    return json({ success: false, error: "No active job" }, { status: 404 });
  }
  
  // Update job with progress
  const currentIndex = parseInt(formData.get("currentIndex") as string || "0", 10);
  const processed = parseInt(formData.get("processed") as string || "0", 10);
  const skipped = parseInt(formData.get("skipped") as string || "0", 10);
  const failed = parseInt(formData.get("failed") as string || "0", 10);
  const status = formData.get("status") as "running" | "paused" | "completed" | null;
  
  job.currentIndex = currentIndex;
  job.stats.processed = processed;
  job.stats.skipped = skipped;
  job.stats.failed = failed;
  if (status) job.status = status;
  job.updatedAt = new Date().toISOString();
  
  await saveJob(storage, job);
  
  return json({ success: true, job });
}

/**
 * Clear the job file
 */
async function handleClearJob(context: Parameters<typeof getStorage>[0]) {
  const storage = getStorage(context);
  await clearJob(storage);
  
  console.log("[ClearJob] Job file cleared");
  
  return json({ success: true });
}
