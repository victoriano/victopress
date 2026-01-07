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

// Progress file path in R2
const PROGRESS_FILE = ".optimization-progress.json";

// Progress data type
interface OptimizationProgressData {
  totalImages: number;
  imagesWithVariants: number;
  isRunning: boolean;
  startedAt: number;
}

// Helper to read progress from R2
async function getProgress(storage: ReturnType<typeof getStorage>): Promise<OptimizationProgressData | null> {
  try {
    const data = await storage.get(PROGRESS_FILE);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Helper to save progress to R2
async function saveProgress(storage: ReturnType<typeof getStorage>, progress: OptimizationProgressData): Promise<void> {
  const data = JSON.stringify(progress);
  await storage.put(PROGRESS_FILE, new TextEncoder().encode(data), "application/json");
}

// Helper to clear progress
async function clearProgress(storage: ReturnType<typeof getStorage>): Promise<void> {
  try {
    await storage.delete(PROGRESS_FILE);
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * GET - Get optimization status (reads from R2 progress file for instant updates)
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const storage = getStorage(context);
  
  // Check for active optimization progress (fast - single R2 read)
  const progress = await getProgress(storage);
  
  if (progress && progress.isRunning) {
    const { totalImages, imagesWithVariants } = progress;
    const percentOptimized = totalImages > 0 
      ? Math.round((imagesWithVariants / totalImages) * 100) 
      : 0;
    
    console.log(`[Optimize GET] ⚡ Fast: ${imagesWithVariants}/${totalImages}`);
    
    return json({
      totalImages,
      imagesWithVariants,
      imagesNeedingOptimization: totalImages - imagesWithVariants,
      percentOptimized,
      isRunning: true,
    });
  }
  
  // If we have recent completed progress, use it
  if (progress && !progress.isRunning) {
    const { totalImages, imagesWithVariants } = progress;
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
  
  console.log(`[Optimize GET] 🐢 No progress file, scanning...`);
  
  // No progress file - do a quick count from content index
  const contentIndex = await getContentIndex(storage);
  
  let totalImages = 0;
  for (const gallery of contentIndex.galleryData || []) {
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      totalImages++;
    }
  }
  
  // Quick sample to estimate (check just 2 random images for speed)
  const allPhotos: { galleryPath: string; filename: string }[] = [];
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      allPhotos.push({ galleryPath, filename: photo.filename });
    }
  }
  
  let optimizedCount = 0;
  const sampleSize = Math.min(2, allPhotos.length);
  // Check in parallel for speed
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
    case "optimize-gallery":
      return handleOptimizeGallery(formData, context);
    case "optimize-image":
      return handleOptimizeImage(formData, context);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

// Number of images to process in parallel
// R2 has no rate limits, but we keep this reasonable for memory/CPU
const PARALLEL_BATCH_SIZE = 10;

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
