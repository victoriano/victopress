/**
 * Browser-side Image Processing
 * 
 * Generates optimized WebP variants using Canvas API.
 * Works in any modern browser without server-side dependencies.
 */

// Standard widths for responsive images
export const VARIANT_WIDTHS = [400, 800, 1200, 1600] as const;
export const WEBP_QUALITY = 0.8;

export interface ImageVariant {
  width: number;
  blob: Blob;
  filename: string;
}

export interface ProcessedImage {
  original: {
    blob: Blob;
    filename: string;
    width: number;
    height: number;
  };
  variants: ImageVariant[];
}

/**
 * Load an image file into an HTMLImageElement
 */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Resize an image to a specific width using Canvas
 * Maintains aspect ratio
 */
function resizeImage(
  img: HTMLImageElement,
  targetWidth: number,
  quality: number = WEBP_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Don't upscale
    const actualWidth = Math.min(targetWidth, img.naturalWidth);
    const scale = actualWidth / img.naturalWidth;
    const actualHeight = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = actualWidth;
    canvas.height = actualHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }

    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw the resized image
    ctx.drawImage(img, 0, 0, actualWidth, actualHeight);

    // Convert to WebP blob
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob"));
        }
      },
      "image/webp",
      quality
    );
  });
}

/**
 * Generate variant filename from original
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
 * Process an image file and generate all WebP variants
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  // Load the image
  const img = await loadImage(file);
  
  // Generate variants for each width
  const variants: ImageVariant[] = [];
  
  for (const width of VARIANT_WIDTHS) {
    // Skip if original is smaller than target
    if (img.naturalWidth < width) continue;
    
    const blob = await resizeImage(img, width);
    const filename = getVariantFilename(file.name, width);
    
    variants.push({ width, blob, filename });
  }
  
  // Clean up object URL
  URL.revokeObjectURL(img.src);
  
  return {
    original: {
      blob: file,
      filename: file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
    },
    variants,
  };
}

/**
 * Process multiple images in parallel
 */
export async function processImages(
  files: File[],
  onProgress?: (processed: number, total: number) => void
): Promise<ProcessedImage[]> {
  const results: ProcessedImage[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const result = await processImage(files[i]);
    results.push(result);
    onProgress?.(i + 1, files.length);
  }
  
  return results;
}

/**
 * Check if a file is an image
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext || "");
}

/**
 * Check if a filename is a variant (ends with _NNNw.webp)
 */
export function isVariantFile(filename: string): boolean {
  return /_.+w\.webp$/.test(filename);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
