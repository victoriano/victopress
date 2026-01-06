/**
 * Server-side Image Optimizer
 * 
 * Utility functions for image optimization.
 * 
 * NOTE: The actual @cf-wasm/photon processing is in a separate worker-only module.
 * These utilities work in both dev and production.
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
 * 
 * NOTE: This is a stub that returns empty variants in development.
 * In production (Cloudflare Workers), you should use the worker-specific
 * implementation that imports @cf-wasm/photon.
 * 
 * @param imageData - Raw image bytes (ArrayBuffer or Uint8Array)
 * @param filename - Original filename (for naming variants)
 * @returns Processed result with variants (empty in dev)
 */
export async function processImageServer(
  _imageData: ArrayBuffer | Uint8Array,
  filename: string
): Promise<ProcessedImageResult> {
  // In development, we can't use @cf-wasm/photon (it requires Workers runtime)
  // Return empty variants - images will be served without optimization in dev
  console.log(`[Image Optimizer] Skipping optimization for ${filename} (not in Workers runtime)`);
  
  return {
    original: {
      filename,
      width: 0,
      height: 0,
    },
    variants: [],
  };
}

/**
 * Generate a single variant at a specific width
 * Returns null in development
 */
export async function generateVariant(
  _imageData: ArrayBuffer | Uint8Array,
  _targetWidth: number,
  _quality: number = WEBP_QUALITY
): Promise<Uint8Array | null> {
  console.log("[Image Optimizer] Skipping variant generation (not in Workers runtime)");
  return null;
}

/**
 * Get image dimensions without full processing
 * Returns null in development
 */
export async function getImageDimensions(
  _imageData: ArrayBuffer | Uint8Array
): Promise<{ width: number; height: number } | null> {
  return null;
}
