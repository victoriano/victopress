/**
 * Server-side Image Optimizer
 * 
 * Uses @cf-wasm/photon for image processing in Cloudflare Workers runtime.
 * 
 * IMPORTANT: This only works when running in the Workers runtime:
 * - `wrangler pages dev ./build/client` (local Workers emulation)
 * - Production (Cloudflare Pages/Workers)
 * 
 * When running `bun run dev` (Vite dev server), image optimization is skipped
 * because the WASM module can't load outside Workers runtime.
 * 
 * Generates WebP variants at multiple sizes for responsive images.
 */

// Standard widths for responsive images
export const VARIANT_WIDTHS = [400, 800, 1200, 1600] as const;
export const WEBP_QUALITY = 80;

export interface ImageVariant {
  width: number;
  data: Uint8Array;
  filename: string;
  size: number;
}

export interface ProcessedImageResult {
  original: {
    filename: string;
    width: number;
    height: number;
  };
  variants: ImageVariant[];
}

/**
 * Get variant filename from original
 * photo.jpg → photo_800w.webp
 */
export function getVariantFilename(originalFilename: string, width: number): string {
  const dotIndex = originalFilename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 
    ? originalFilename.substring(0, dotIndex) 
    : originalFilename;
  return `${nameWithoutExt}_${width}w.webp`;
}

/**
 * Get all variant filenames for an image
 */
export function getAllVariantFilenames(originalFilename: string): string[] {
  return VARIANT_WIDTHS.map(w => getVariantFilename(originalFilename, w));
}

/**
 * Check if a filename is a variant (ends with _NNNw.webp)
 */
export function isVariantFile(filename: string): boolean {
  return /_\d+w\.webp$/.test(filename);
}

/**
 * Check if file is an image
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext || "");
}

// Cached photon module
let photonModule: {
  PhotonImage: any;
  resize: any;
  SamplingFilter: any;
} | null = null;
let photonLoadAttempted = false;

// Load photon - works in Workers runtime (wrangler pages dev or production)
async function loadPhoton(): Promise<{
  PhotonImage: any;
  resize: any;
  SamplingFilter: any;
} | null> {
  // Return cached module if already loaded
  if (photonModule) return photonModule;
  if (photonLoadAttempted) return null;
  
  photonLoadAttempted = true;
  
  try {
    // Direct dynamic import - works in Workers runtime
    const mod = await import("@cf-wasm/photon");
    photonModule = {
      PhotonImage: mod.PhotonImage,
      resize: mod.resize,
      SamplingFilter: mod.SamplingFilter,
    };
    console.log("[Image Optimizer] ✅ @cf-wasm/photon loaded successfully");
    return photonModule;
  } catch (error) {
    console.warn("[Image Optimizer] ⚠️ @cf-wasm/photon not available");
    console.warn("[Image Optimizer] Use 'bun run dev:workers' for image optimization");
    console.warn("[Image Optimizer] Error:", error);
    return null;
  }
}

/**
 * Process an image and generate WebP variants
 * 
 * @param imageData - Raw image bytes (ArrayBuffer or Uint8Array)
 * @param filename - Original filename (for naming variants)
 * @returns Processed result with variants
 */
export async function processImageServer(
  imageData: ArrayBuffer | Uint8Array,
  filename: string
): Promise<ProcessedImageResult> {
  const photon = await loadPhoton();
  
  if (!photon) {
    console.log(`[Image Optimizer] Skipping ${filename} (not in Workers runtime)`);
    return {
      original: { filename, width: 0, height: 0 },
      variants: [],
    };
  }
  
  try {
    const { PhotonImage, resize, SamplingFilter } = photon;
    
    const bytes = imageData instanceof ArrayBuffer 
      ? new Uint8Array(imageData) 
      : imageData;
    
    // Load image with Photon
    const image = PhotonImage.new_from_byteslice(bytes);
    const originalWidth = image.get_width();
    const originalHeight = image.get_height();
    
    console.log(`[Image Optimizer] Processing ${filename} (${originalWidth}x${originalHeight})`);
    
    const variants: ImageVariant[] = [];
    
    for (const targetWidth of VARIANT_WIDTHS) {
      // Don't upscale - skip if original is smaller
      if (targetWidth >= originalWidth) {
        console.log(`[Image Optimizer] Skipping ${targetWidth}w (original is ${originalWidth}w)`);
        continue;
      }
      
      // Calculate new height maintaining aspect ratio
      const scale = targetWidth / originalWidth;
      const targetHeight = Math.round(originalHeight * scale);
      
      // Clone the image for this variant
      const variantImage = PhotonImage.new_from_byteslice(bytes);
      
      // Resize using Lanczos3 for high quality
      resize(variantImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
      
      // Convert to WebP
      const webpData = variantImage.get_bytes_webp();
      
      // Free memory
      variantImage.free();
      
      const variantFilename = getVariantFilename(filename, targetWidth);
      console.log(`[Image Optimizer] Created ${variantFilename} (${webpData.length} bytes)`);
      
      variants.push({
        width: targetWidth,
        data: webpData,
        filename: variantFilename,
        size: webpData.length,
      });
    }
    
    // Free the original image
    image.free();
    
    console.log(`[Image Optimizer] Done: ${filename} → ${variants.length} variants`);
    
    return {
      original: {
        filename,
        width: originalWidth,
        height: originalHeight,
      },
      variants,
    };
  } catch (error) {
    console.error(`[Image Optimizer] Error processing ${filename}:`, error);
    return {
      original: { filename, width: 0, height: 0 },
      variants: [],
    };
  }
}

/**
 * Generate a single variant at a specific width
 */
export async function generateVariant(
  imageData: ArrayBuffer | Uint8Array,
  targetWidth: number,
  _quality: number = WEBP_QUALITY
): Promise<Uint8Array | null> {
  const photon = await loadPhoton();
  
  if (!photon) {
    return null;
  }
  
  try {
    const { PhotonImage, resize, SamplingFilter } = photon;
    
    const bytes = imageData instanceof ArrayBuffer 
      ? new Uint8Array(imageData) 
      : imageData;
    
    const image = PhotonImage.new_from_byteslice(bytes);
    const originalWidth = image.get_width();
    const originalHeight = image.get_height();
    
    // Don't upscale
    if (targetWidth >= originalWidth) {
      image.free();
      return null;
    }
    
    // Calculate new height
    const scale = targetWidth / originalWidth;
    const targetHeight = Math.round(originalHeight * scale);
    
    // Resize
    resize(image, targetWidth, targetHeight, SamplingFilter.Lanczos3);
    
    // Convert to WebP
    const webpData = image.get_bytes_webp();
    
    // Free memory
    image.free();
    
    return webpData;
  } catch (error) {
    console.error("[Image Optimizer] Error generating variant:", error);
    return null;
  }
}

/**
 * Get image dimensions without full processing
 */
export async function getImageDimensions(
  imageData: ArrayBuffer | Uint8Array
): Promise<{ width: number; height: number } | null> {
  const photon = await loadPhoton();
  
  if (!photon) {
    return null;
  }
  
  try {
    const { PhotonImage } = photon;
    
    const bytes = imageData instanceof ArrayBuffer 
      ? new Uint8Array(imageData) 
      : imageData;
    
    const image = PhotonImage.new_from_byteslice(bytes);
    const width = image.get_width();
    const height = image.get_height();
    image.free();
    
    return { width, height };
  } catch (error) {
    console.error("[Image Optimizer] Error reading dimensions:", error);
    return null;
  }
}
