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

// Simple progress counter file - just stores "current/total" for fast reads
const PROGRESS_COUNTER_FILE = ".opt-progress.txt";

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
 * First checks for live progress counter (updated every image), then falls back to sampling
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const storage = getStorage(context);
  
  // Check for active optimization progress counter (super fast - tiny text file)
  const counter = await getProgressCounter(storage);
  
  if (counter) {
    const { current, total } = counter;
    const percentOptimized = total > 0 
      ? Math.round((current / total) * 100) 
      : 0;
    
    console.log(`[Optimize GET] ⚡ Counter: ${current}/${total}`);
    
    return json({
      totalImages: total,
      imagesWithVariants: current,
      imagesNeedingOptimization: total - current,
      percentOptimized,
      isRunning: current < total, // Running if not yet complete
    });
  }
  
  console.log(`[Optimize GET] 🐢 No counter, sampling...`);
  
  // No progress counter - do a quick count from content index
  const contentIndex = await getContentIndex(storage);
  
  let totalImages = 0;
  const allPhotos: { galleryPath: string; filename: string }[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      totalImages++;
      allPhotos.push({ galleryPath, filename: photo.filename });
    }
  }
  
  // Quick sample to estimate (check 3 random images)
  let optimizedCount = 0;
  const sampleSize = Math.min(3, allPhotos.length);
  const checks = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(Math.random() * allPhotos.length);
    const { galleryPath, filename } = allPhotos[idx];
    const variantPath = `${galleryPath}/${getVariantFilename(filename, 800)}`;
    checks.push(storage.exists(variantPath).catch(() => false));
  }
  const results = await Promise.all(checks);
  optimizedCount = results.filter(Boolean).length;
  
  const imagesWithVariants = sampleSize > 0 
    ? Math.round(totalImages * (optimizedCount / sampleSize)) 
    : 0;
  const percentOptimized = totalImages > 0 
    ? Math.round((imagesWithVariants / totalImages) * 100) 
    : 100;
  
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
  const contentIndex = await getContentIndex(storage);
  
  const offset = parseInt(formData.get("offset") as string || "0", 10);
  const limit = parseInt(formData.get("limit") as string || String(MAX_IMAGES_PER_REQUEST), 10);
  const cleanup = formData.get("cleanup") === "true";
  
  // Collect all images that need optimization
  const allImages: { galleryPath: string; filename: string }[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      allImages.push({ galleryPath, filename: photo.filename });
    }
  }
  
  const totalImages = allImages.length;
  const batchImages = allImages.slice(offset, offset + limit);
  
  // Initialize or update progress counter
  // If this is the first batch (offset=0), start fresh
  if (offset === 0) {
    await setProgressCounter(storage, 0, totalImages);
  }
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  let variantsDeleted = 0;
  let currentProgress = offset; // Track overall progress
  
  for (const { galleryPath, filename } of batchImages) {
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
      // Skip if already optimized
      const variantPath = `${galleryPath}/${getVariantFilename(filename, 800)}`;
      try {
        if (await storage.exists(variantPath)) {
          skipped++;
          currentProgress++;
          // Update progress counter after each skip
          await setProgressCounter(storage, currentProgress, totalImages);
          continue;
        }
      } catch { /* ignore */ }
    }
    
    // Process the image
    const photoPath = `${galleryPath}/${filename}`;
    try {
      const imageData = await storage.get(photoPath);
      if (!imageData) {
        failed++;
        currentProgress++;
        await setProgressCounter(storage, currentProgress, totalImages);
        continue;
      }
      
      const result = await processImageServer(imageData, filename);
      
      // Save variants
      for (const variant of result.variants) {
        const savePath = `${galleryPath}/${variant.filename}`;
        await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
        variantsCreated++;
      }
      
      processed++;
      currentProgress++;
      
      // Update progress counter after each image
      await setProgressCounter(storage, currentProgress, totalImages);
      console.log(`[Batch] ✅ ${filename} - ${currentProgress}/${totalImages}`);
    } catch (err) {
      console.error(`[Batch] ❌ Failed ${photoPath}:`, err);
      failed++;
      currentProgress++;
      await setProgressCounter(storage, currentProgress, totalImages);
    }
  }
  
  const nextOffset = offset + limit;
  const hasMore = nextOffset < totalImages;
  
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
      processedSoFar: Math.min(nextOffset, totalImages),
      percentComplete: Math.round((Math.min(nextOffset, totalImages) / totalImages) * 100),
    },
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
