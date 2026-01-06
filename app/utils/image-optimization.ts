/**
 * Image Optimization Utilities
 * 
 * Handles Cloudflare Image Resizing URLs and image preloading.
 * 
 * Cloudflare Image Resizing transforms images on-the-fly:
 * - Resizes to specified dimensions
 * - Converts to modern formats (WebP, AVIF)
 * - Optimizes quality
 * - Caches at the edge
 */

/**
 * Options for optimized image URLs
 */
export interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "auto" | "webp" | "avif" | "jpeg" | "png";
  fit?: "contain" | "cover" | "crop" | "scale-down" | "pad";
}

/**
 * Build Cloudflare Image Resizing options string
 */
function buildCFIOptions(options: ImageOptimizationOptions): string {
  const cfOptions: string[] = [];
  
  if (options.width) cfOptions.push(`width=${options.width}`);
  if (options.height) cfOptions.push(`height=${options.height}`);
  cfOptions.push(`quality=${options.quality || 85}`);
  cfOptions.push(`format=${options.format || "auto"}`);
  if (options.fit) cfOptions.push(`fit=${options.fit}`);
  
  return cfOptions.join(",");
}

/**
 * Generate a Cloudflare Image Resizing URL
 * 
 * This ALWAYS generates CFI URLs - they work in production on Cloudflare.
 * In development on localhost, CFI won't resize but the URL still works.
 * 
 * Format: /cdn-cgi/image/width=800,quality=85,format=auto/api/images/path.jpg
 */
export function getOptimizedImageUrl(
  src: string,
  options: ImageOptimizationOptions = {}
): string {
  // Normalize the source path
  let imagePath = src;
  
  // Handle various input formats
  if (src.startsWith("/api/images/")) {
    imagePath = src;
  } else if (src.startsWith("/")) {
    imagePath = `/api/images${src}`;
  } else {
    imagePath = `/api/images/${src}`;
  }
  
  // Build CFI URL with options
  const cfiOptions = buildCFIOptions(options);
  
  return `/cdn-cgi/image/${cfiOptions}${imagePath}`;
}

/**
 * Generate URL without CFI (for fallback or when original is needed)
 */
export function getOriginalImageUrl(src: string): string {
  if (src.startsWith("/api/images/")) {
    return src;
  } else if (src.startsWith("/")) {
    return `/api/images${src}`;
  } else {
    return `/api/images/${src}`;
  }
}

/**
 * Generate srcset for responsive images
 */
export function generateSrcSet(
  src: string,
  widths: number[] = [400, 800, 1200, 1600, 2400],
  options: Omit<ImageOptimizationOptions, "width"> = {}
): string {
  return widths
    .map((width) => {
      const url = getOptimizedImageUrl(src, { ...options, width });
      return `${url} ${width}w`;
    })
    .join(", ");
}

/**
 * Preload an image with optional optimization
 */
export function preloadImage(
  src: string,
  options: ImageOptimizationOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to preload: ${src}`));
    img.src = getOptimizedImageUrl(src, options);
  });
}

/**
 * Preload multiple images in parallel
 */
export function preloadImages(
  sources: string[],
  options: ImageOptimizationOptions = {}
): Promise<void[]> {
  return Promise.all(
    sources
      .filter(Boolean)
      .map((src) => preloadImage(src, options).catch(() => undefined))
  ) as Promise<void[]>;
}

/**
 * Create a <link rel="preload"> element for an image
 * Use this for server-side rendering to hint to the browser
 */
export function createPreloadLink(
  src: string,
  options: ImageOptimizationOptions = {}
): { rel: string; href: string; as: string; type?: string } {
  return {
    rel: "preload",
    href: getOptimizedImageUrl(src, options),
    as: "image",
    type: options.format === "webp" ? "image/webp" : undefined,
  };
}
