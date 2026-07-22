/**
 * Image Optimization Utilities
 * 
 * Uses pre-generated WebP variants for optimal performance.
 * 
 * Variants are generated at upload time:
 * - photo_800w.webp  (mobile, thumbnails)
 * - photo_1600w.webp (desktop, tablets)
 * - photo_2400w.webp (Retina, 5K displays)
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

// Available variant widths (must match browser-image-optimizer.ts)
export const VARIANT_WIDTHS = [800, 1600, 2400] as const;

/**
 * Cache revision for generated variants.
 *
 * Rollouts intentionally use two revisions: deploy the responsive UI with the
 * legacy assets, regenerate every variant, then bump this value so browsers
 * and Cloudflare cannot reuse a lower-quality response under the same path.
 */
export const IMAGE_VARIANT_CACHE_REVISION = "webp-q86-v3";

export interface ResponsiveImageOptions {
  /** Width of the source image. Used to avoid requesting variants that cannot exist. */
  originalWidth?: number;
  /** Add the original file as the largest srcset candidate. */
  includeOriginal?: boolean;
}

/**
 * Encode a path for use in URLs (handles spaces and special chars)
 */
function encodeImagePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Find the best variant width for a requested width
 */
function findBestVariantWidth(requestedWidth: number): number {
  // Find the smallest variant that's >= requested width
  for (const w of VARIANT_WIDTHS) {
    if (w >= requestedWidth) return w;
  }
  // If requested is larger than all variants, return the largest
  return VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

function getSourceExtension(filename: string): string | null {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) return null;
  return filename.slice(dotIndex + 1).toLowerCase();
}

function addVariantCacheRevision(url: string, sourceExtension?: string | null): string {
  const params = new URLSearchParams({ v: IMAGE_VARIANT_CACHE_REVISION });
  if (sourceExtension) params.set("source", sourceExtension);
  return `${url}?${params.toString()}`;
}

/**
 * Return only variants that can be generated without enlarging the source.
 *
 * Browser-based optimization deliberately skips a target that is the same
 * width as the source, so use a strict comparison here. The original file is
 * added separately to responsive srcsets when its width is known.
 */
export function getResponsiveVariantWidths(
  originalWidth?: number,
  widths: readonly number[] = VARIANT_WIDTHS,
): number[] {
  const supportedWidths = widths
    .filter((width) => VARIANT_WIDTHS.includes(width as (typeof VARIANT_WIDTHS)[number]))
    .sort((left, right) => left - right);

  if (!originalWidth || !Number.isFinite(originalWidth) || originalWidth <= 0) {
    return supportedWidths;
  }

  return supportedWidths.filter((width) => width < originalWidth);
}

/**
 * Generate URL for a pre-generated WebP variant
 * 
 * @param src - Original image path
 * @param options - Optional width hint (will pick closest variant)
 * @returns URL to the WebP variant
 */
export function getOptimizedImageUrl(
  src: string,
  options: ImageOptimizationOptions = {}
): string {
  // Normalize the source path - strip /api/images/ prefix if present
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  // Determine which variant width to use
  const requestedWidth = options.width || 1600; // Default to middle size
  const variantWidth = findBestVariantWidth(requestedWidth);
  
  // Build variant filename: photo.jpg → photo_1600w.webp
  const lastSlash = basePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? basePath.substring(lastSlash + 1) : basePath;
  
  const dotIndex = filename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  
  const variantPath = `${dir}${nameWithoutExt}_${variantWidth}w.webp`;
  
  // Encode the path (handles spaces in folder names like "new york")
  const encodedPath = encodeImagePath(variantPath);
  
  return addVariantCacheRevision(
    `/api/images/${encodedPath}`,
    getSourceExtension(filename),
  );
}

/**
 * Generate URL without optimization (original file)
 */
export function getOriginalImageUrl(src: string): string {
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  const encodedPath = encodeImagePath(basePath);
  return `/api/images/${encodedPath}`;
}

/**
 * Generate srcset for responsive images using pre-generated variants
 */
export function generateSrcSet(
  src: string,
  widths: readonly number[] = VARIANT_WIDTHS,
  options: ResponsiveImageOptions = {},
): string {
  // Normalize the source path
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  const lastSlash = basePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? basePath.substring(lastSlash + 1) : basePath;
  
  const dotIndex = filename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  
  const candidates = getResponsiveVariantWidths(options.originalWidth, widths)
    .map((width) => {
      const variantPath = `${dir}${nameWithoutExt}_${width}w.webp`;
      const encodedPath = encodeImagePath(variantPath);
      return `${addVariantCacheRevision(
        `/api/images/${encodedPath}`,
        getSourceExtension(filename),
      )} ${width}w`;
    });

  if (
    options.includeOriginal &&
    options.originalWidth &&
    Number.isFinite(options.originalWidth) &&
    options.originalWidth > 0
  ) {
    candidates.push(
      `${getOriginalImageUrl(src)} ${Math.round(options.originalWidth)}w`,
    );
  }

  return candidates.join(", ");
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
    img.fetchPriority = "low";

    // Some callers already pass a generated variant. Transforming that URL a
    // second time produces names such as photo_1600w_1600w.webp and silently
    // defeats adjacent-photo preloading.
    const isVariantUrl = /(?:^|\/)api\/images\/.*_\d+w\.webp(?:\?.*)?$/i.test(src);
    img.src = isVariantUrl ? src : getOptimizedImageUrl(src, options);
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
    type: "image/webp", // Always WebP for variants
  };
}
