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

// Track optimization progress in memory (updated by the optimize action)
let optimizationProgress: { 
  totalImages: number;
  imagesWithVariants: number; 
  isRunning: boolean;
  lastChecked: number;
} = { totalImages: 0, imagesWithVariants: 0, isRunning: false, lastChecked: 0 };

// Increment this during optimization
function updateProgress(processed: number, total: number) {
  optimizationProgress.imagesWithVariants = processed;
  optimizationProgress.totalImages = total;
}

/**
 * GET - Get optimization status (uses in-memory progress during optimization)
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  // If optimization is running, return the live progress immediately
  if (optimizationProgress.isRunning) {
    const { totalImages, imagesWithVariants } = optimizationProgress;
    const percentOptimized = totalImages > 0 
      ? Math.round((imagesWithVariants / totalImages) * 100) 
      : 0;
    
    return json({
      totalImages,
      imagesWithVariants,
      imagesNeedingOptimization: totalImages - imagesWithVariants,
      percentOptimized,
      isRunning: true,
    });
  }
  
  // If not running but we have recent data, return it
  const now = Date.now();
  if (optimizationProgress.lastChecked && (now - optimizationProgress.lastChecked) < 30000) {
    const { totalImages, imagesWithVariants } = optimizationProgress;
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
  
  // Otherwise, do a full scan (slow but accurate)
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  let totalImages = 0;
  let imagesWithVariants = 0;
  
  // Count total images first (fast - just uses the content index)
  for (const gallery of contentIndex.galleryData || []) {
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      totalImages++;
    }
  }
  
  // Spot-check a few random images to estimate optimization status
  // This is much faster than checking every file
  const sampleSize = Math.min(10, totalImages);
  const allPhotos: { gallery: typeof contentIndex.galleryData[0]; photo: { filename: string } }[] = [];
  
  for (const gallery of contentIndex.galleryData || []) {
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      allPhotos.push({ gallery, photo });
    }
  }
  
  // Sample random photos
  let optimizedCount = 0;
  for (let i = 0; i < sampleSize && allPhotos.length > 0; i++) {
    const idx = Math.floor(Math.random() * allPhotos.length);
    const { gallery, photo } = allPhotos.splice(idx, 1)[0];
    
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    const variantFilename = getVariantFilename(photo.filename, 800);
    const variantPath = `${galleryPath}/${variantFilename}`;
    
    try {
      const exists = await storage.exists(variantPath);
      if (exists) optimizedCount++;
    } catch {
      // Ignore errors in sampling
    }
  }
  
  // Extrapolate from sample
  const sampleRatio = sampleSize > 0 ? optimizedCount / sampleSize : 0;
  imagesWithVariants = Math.round(totalImages * sampleRatio);
  
  const percentOptimized = totalImages > 0 
    ? Math.round((imagesWithVariants / totalImages) * 100) 
    : 100;
  
  // Update the progress cache
  optimizationProgress = {
    totalImages,
    imagesWithVariants,
    isRunning: false,
    lastChecked: now,
  };
  
  console.log(`[Optimize] Status (sampled): ${imagesWithVariants}/${totalImages} (${percentOptimized}%)`);
  
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

/**
 * Optimize all images in all galleries
 */
async function handleOptimizeAll(
  context: Parameters<typeof getStorage>[0]
) {
  // Dynamic import to avoid blocking Vite startup
  const { processImageServer } = await import("~/lib/image-optimizer.server");
  
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  // Count total images first
  let totalImages = 0;
  for (const gallery of contentIndex.galleryData || []) {
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      totalImages++;
    }
  }
  
  // Initialize progress tracking
  optimizationProgress = {
    totalImages,
    imagesWithVariants: 0,
    isRunning: true,
    lastChecked: Date.now(),
  };
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  let alreadyOptimized = 0;
  
  // Use galleryData which has photos
  for (const gallery of contentIndex.galleryData || []) {
    const galleryPath = gallery.path || `galleries/${gallery.slug}`;
    
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      
      // Check if already optimized
      const variantPath = `${galleryPath}/${getVariantFilename(photo.filename, 800)}`;
      if (await storage.exists(variantPath)) {
        skipped++;
        alreadyOptimized++;
        // Update progress
        optimizationProgress.imagesWithVariants = alreadyOptimized + processed;
        continue;
      }
      
      // Process this image
      const photoPath = `${galleryPath}/${photo.filename}`;
      
      try {
        const imageData = await storage.get(photoPath);
        if (!imageData) {
          failed++;
          continue;
        }
        
        const result = await processImageServer(imageData, photo.filename);
        
        // Save variants - convert Uint8Array to ArrayBuffer
        for (const variant of result.variants) {
          const savePath = `${galleryPath}/${variant.filename}`;
          await storage.put(savePath, variant.data.buffer as ArrayBuffer, "image/webp");
          variantsCreated++;
        }
        
        processed++;
        // Update progress after each successful processing
        optimizationProgress.imagesWithVariants = alreadyOptimized + processed;
        console.log(`[Optimize] Processed ${photo.filename} (${result.variants.length} variants) - Progress: ${optimizationProgress.imagesWithVariants}/${totalImages}`);
      } catch (err) {
        console.error(`[Optimize] Failed to process ${photoPath}:`, err);
        failed++;
      }
    }
  }
  
  // Mark optimization as complete
  optimizationProgress.isRunning = false;
  optimizationProgress.lastChecked = Date.now();
  
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
