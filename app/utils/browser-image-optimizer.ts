/**
 * Browser-based image optimization using Canvas API
 * 
 * Runs entirely in the browser - no server CPU limits!
 * Uses native WebP encoding supported by all modern browsers.
 */

export const VARIANT_WIDTHS = [800, 1600, 2400] as const;
export const WEBP_QUALITY = 0.85;

export interface ImageVariant {
  width: number;
  filename: string;
  blob: Blob;
  size: number;
  url: string; // Object URL for preview
}

export interface OptimizationResult {
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  variants: ImageVariant[];
}

/**
 * Load an image from a URL or File into an HTMLImageElement
 */
async function loadImage(source: string | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Allow loading from API
    
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    
    if (source instanceof File) {
      img.src = URL.createObjectURL(source);
    } else {
      img.src = source;
    }
  });
}

/**
 * Resize an image to a target width using Canvas
 */
function resizeImage(
  img: HTMLImageElement,
  targetWidth: number
): HTMLCanvasElement {
  const aspectRatio = img.height / img.width;
  const targetHeight = Math.round(targetWidth * aspectRatio);
  
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  
  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  
  return canvas;
}

/**
 * Convert canvas to WebP blob
 */
async function canvasToWebP(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create WebP blob"));
      },
      "image/webp",
      quality
    );
  });
}

/**
 * Get variant filename from original
 */
export function getVariantFilename(originalFilename: string, width: number): string {
  const dotIndex = originalFilename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 
    ? originalFilename.substring(0, dotIndex) 
    : originalFilename;
  return `${nameWithoutExt}_${width}w.webp`;
}

/**
 * Optimize an image in the browser
 * 
 * @param source - URL to fetch image from, or File object
 * @param originalFilename - Original filename for naming variants
 * @returns Optimization result with variants
 */
export async function optimizeImageInBrowser(
  source: string | File,
  originalFilename: string
): Promise<OptimizationResult> {
  // Load the image
  const img = await loadImage(source);
  
  // Get original size
  let originalSize = 0;
  if (source instanceof File) {
    originalSize = source.size;
  } else {
    // Estimate from image data (we'll get actual size from fetch if needed)
    originalSize = img.width * img.height * 3; // Rough estimate
  }
  
  const variants: ImageVariant[] = [];
  
  // Generate variants for each width
  for (const targetWidth of VARIANT_WIDTHS) {
    // Skip if image is smaller than target
    if (img.width <= targetWidth) {
      console.log(`[Optimizer] Skipping ${targetWidth}w - image is only ${img.width}px wide`);
      continue;
    }
    
    // Resize
    const canvas = resizeImage(img, targetWidth);
    
    // Convert to WebP
    const blob = await canvasToWebP(canvas, WEBP_QUALITY);
    
    // Create object URL for preview
    const url = URL.createObjectURL(blob);
    
    variants.push({
      width: targetWidth,
      filename: getVariantFilename(originalFilename, targetWidth),
      blob,
      size: blob.size,
      url,
    });
  }
  
  // Clean up object URL if we created one for loading
  if (source instanceof File) {
    // The img.src URL will be garbage collected
  }
  
  return {
    originalSize,
    originalWidth: img.width,
    originalHeight: img.height,
    variants,
  };
}

/**
 * Clean up object URLs to prevent memory leaks
 */
export function cleanupVariantUrls(variants: ImageVariant[]): void {
  for (const variant of variants) {
    URL.revokeObjectURL(variant.url);
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
