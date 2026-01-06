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
 * Uses @cf-wasm/photon for server-side WebP generation.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";
import {
  processImageServer,
  isVariantFile,
  isImageFile,
  getVariantFilename,
  VARIANT_WIDTHS,
} from "~/lib/image-optimizer.server";

/**
 * GET - Get optimization status
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  let totalImages = 0;
  let imagesWithVariants = 0;
  let imagesNeedingOptimization = 0;
  
  // Check each gallery from galleryData (which has photos)
  for (const gallery of contentIndex.galleryData || []) {
    for (const photo of gallery.photos || []) {
      if (!isImageFile(photo.filename)) continue;
      if (isVariantFile(photo.filename)) continue;
      
      totalImages++;
      
      // Check if this image has all variants
      const galleryPath = gallery.path || `galleries/${gallery.slug}`;
      const variantFilename = getVariantFilename(photo.filename, 800); // Check for 800w as indicator
      const variantPath = `${galleryPath}/${variantFilename}`;
      
      const hasVariants = await storage.exists(variantPath);
      
      if (hasVariants) {
        imagesWithVariants++;
      } else {
        imagesNeedingOptimization++;
      }
    }
  }
  
  return json({
    totalImages,
    imagesWithVariants,
    imagesNeedingOptimization,
    percentOptimized: totalImages > 0 
      ? Math.round((imagesWithVariants / totalImages) * 100) 
      : 100,
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
  const storage = getStorage(context);
  const contentIndex = await getContentIndex(storage);
  
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let variantsCreated = 0;
  
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
        console.log(`[Optimize] Processed ${photo.filename} (${result.variants.length} variants)`);
      } catch (err) {
        console.error(`[Optimize] Failed to process ${photoPath}:`, err);
        failed++;
      }
    }
  }
  
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
