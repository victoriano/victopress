/**
 * Server-side Image Optimizer
 * 
 * Uses Jimp for image processing - works in ALL environments:
 * - Node.js / Bun (local development)
 * - Cloudflare Workers (production)
 * - Edge runtimes
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

/**
 * Process an image and generate WebP variants
 * Uses dynamic import to avoid blocking Vite startup
 * 
 * @param imageData - Raw image bytes (ArrayBuffer or Uint8Array)
 * @param filename - Original filename (for naming variants)
 * @returns Processed result with variants
 */
export async function processImageServer(
  imageData: ArrayBuffer | Uint8Array,
  filename: string
): Promise<ProcessedImageResult> {
  try {
    // Dynamic import to avoid blocking Vite startup
    const { Jimp } = await import("jimp");
    
    const buffer = imageData instanceof ArrayBuffer 
      ? Buffer.from(imageData) 
      : Buffer.from(imageData);
    
    // Load image with Jimp
    const image = await Jimp.read(buffer);
    const originalWidth = image.width;
    const originalHeight = image.height;
    
    console.log(`[Image Optimizer] Processing ${filename} (${originalWidth}x${originalHeight})`);
    
    const variants: ImageVariant[] = [];
    
    for (const targetWidth of VARIANT_WIDTHS) {
      // Don't upscale - skip if original is smaller
      if (targetWidth >= originalWidth) {
        console.log(`[Image Optimizer] Skipping ${targetWidth}w (original is ${originalWidth}w)`);
        continue;
      }
      
      // Clone and resize
      const resized = image.clone().resize({ w: targetWidth });
      
      // Convert to WebP buffer
      const webpBuffer = await resized.getBuffer("image/webp", { quality: WEBP_QUALITY });
      
      const variantFilename = getVariantFilename(filename, targetWidth);
      console.log(`[Image Optimizer] Created ${variantFilename} (${webpBuffer.length} bytes)`);
      
      variants.push({
        width: targetWidth,
        data: new Uint8Array(webpBuffer),
        filename: variantFilename,
        size: webpBuffer.length,
      });
    }
    
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
  quality: number = WEBP_QUALITY
): Promise<Uint8Array | null> {
  try {
    const { Jimp } = await import("jimp");
    
    const buffer = imageData instanceof ArrayBuffer 
      ? Buffer.from(imageData) 
      : Buffer.from(imageData);
    
    const image = await Jimp.read(buffer);
    const originalWidth = image.width;
    
    // Don't upscale
    if (targetWidth >= originalWidth) {
      return null;
    }
    
    // Resize and convert to WebP
    const resized = image.resize({ w: targetWidth });
    const webpBuffer = await resized.getBuffer("image/webp", { quality });
    
    return new Uint8Array(webpBuffer);
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
  try {
    const { Jimp } = await import("jimp");
    
    const buffer = imageData instanceof ArrayBuffer 
      ? Buffer.from(imageData) 
      : Buffer.from(imageData);
    
    const image = await Jimp.read(buffer);
    return { width: image.width, height: image.height };
  } catch (error) {
    console.error("[Image Optimizer] Error reading dimensions:", error);
    return null;
  }
}
