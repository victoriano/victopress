/**
 * Server-side Image Optimizer
 * 
 * Uses @cf-wasm/photon for image processing in Cloudflare Workers.
 * Generates WebP variants at multiple sizes for responsive images.
 * 
 * This runs entirely server-side, no browser processing needed!
 */

import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon";

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
 * @param imageData - Raw image bytes (ArrayBuffer or Uint8Array)
 * @param filename - Original filename (for naming variants)
 * @returns Processed result with variants
 */
export async function processImageServer(
  imageData: ArrayBuffer | Uint8Array,
  filename: string
): Promise<ProcessedImageResult> {
  const bytes = imageData instanceof ArrayBuffer 
    ? new Uint8Array(imageData) 
    : imageData;
  
  // Load image with Photon
  const image = PhotonImage.new_from_byteslice(bytes);
  const originalWidth = image.get_width();
  const originalHeight = image.get_height();
  
  const variants: ImageVariant[] = [];
  
  for (const targetWidth of VARIANT_WIDTHS) {
    // Don't upscale - skip if original is smaller
    if (targetWidth >= originalWidth) continue;
    
    // Calculate new height maintaining aspect ratio
    const scale = targetWidth / originalWidth;
    const targetHeight = Math.round(originalHeight * scale);
    
    // Clone the image for this variant (don't modify original)
    const variantImage = PhotonImage.new_from_byteslice(bytes);
    
    // Resize using Lanczos3 for high quality (SamplingFilter.Lanczos3 = 3)
    resize(variantImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
    
    // Convert to WebP
    const webpData = variantImage.get_bytes_webp();
    
    // Free memory
    variantImage.free();
    
    variants.push({
      width: targetWidth,
      data: webpData,
      filename: getVariantFilename(filename, targetWidth),
      size: webpData.length,
    });
  }
  
  // Free the original image
  image.free();
  
  return {
    original: {
      filename,
      width: originalWidth,
      height: originalHeight,
    },
    variants,
  };
}

/**
 * Generate a single variant at a specific width
 */
export async function generateVariant(
  imageData: ArrayBuffer | Uint8Array,
  targetWidth: number,
  quality: number = WEBP_QUALITY
): Promise<Uint8Array> {
  const bytes = imageData instanceof ArrayBuffer 
    ? new Uint8Array(imageData) 
    : imageData;
  
  const image = PhotonImage.new_from_byteslice(bytes);
  const originalWidth = image.get_width();
  const originalHeight = image.get_height();
  
  // Calculate new height maintaining aspect ratio
  const scale = Math.min(targetWidth / originalWidth, 1); // Don't upscale
  const newWidth = Math.round(originalWidth * scale);
  const newHeight = Math.round(originalHeight * scale);
  
  // Resize if needed
  if (newWidth < originalWidth) {
    resize(image, newWidth, newHeight, SamplingFilter.Lanczos3);
  }
  
  // Convert to WebP
  const webpData = image.get_bytes_webp();
  
  // Free memory
  image.free();
  
  return webpData;
}

/**
 * Get image dimensions without full processing
 */
export function getImageDimensions(
  imageData: ArrayBuffer | Uint8Array
): { width: number; height: number } {
  const bytes = imageData instanceof ArrayBuffer 
    ? new Uint8Array(imageData) 
    : imageData;
  
  const image = PhotonImage.new_from_byteslice(bytes);
  const width = image.get_width();
  const height = image.get_height();
  image.free();
  
  return { width, height };
}
