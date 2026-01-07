/**
 * OptimizedImage Component
 *
 * Responsive image component using pre-generated WebP variants.
 * 
 * Features:
 * - Automatic srcset using pre-generated WebP variants (800w, 1600w, 2400w)
 * - Optimized for 5K displays and Retina MacBooks
 * - Native lazy loading
 * - Loading placeholder with smooth fade-in
 * - Fallback to original image if variants don't exist
 * 
 * Pre-requisite: Run `bun run optimize-images` to generate WebP variants
 */

import { useState, useRef, useEffect } from "react";

interface OptimizedImageProps {
  /** Image source path (relative to content folder) */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Optional width constraint */
  width?: number;
  /** Optional height constraint */
  height?: number;
  /** CSS class names */
  className?: string;
  /** Loading strategy */
  loading?: "lazy" | "eager";
  /** Sizes attribute for responsive images */
  sizes?: string;
  /** Aspect ratio for placeholder (e.g., "16/9", "4/3", "1/1") */
  aspectRatio?: string;
  /** Priority loading (for above-the-fold images) */
  priority?: boolean;
  /** On click handler */
  onClick?: () => void;
}

// Standard breakpoint widths for srcset
// - 800w: mobile, thumbnails, small screens
// - 1600w: desktop HD, tablets
// - 2400w: Retina displays, 4K/5K monitors
const SRCSET_WIDTHS = [800, 1600, 2400];

// Default sizes attribute (can be overridden)
const DEFAULT_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

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
 * Generate URL for a pre-generated WebP variant
 * Example: photo.jpg → photo_800w.webp
 */
function getVariantUrl(imagePath: string, width: number): string {
  // Remove /api/images/ prefix if present
  let basePath = imagePath;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  // Get path parts
  const lastSlash = basePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? basePath.substring(lastSlash + 1) : basePath;
  
  // Remove extension and add variant suffix
  const dotIndex = filename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  
  // Construct variant path: photo.jpg → photo_800w.webp
  const variantPath = `${dir}${nameWithoutExt}_${width}w.webp`;
  
  // Encode and return full URL
  return `/api/images/${encodeImagePath(variantPath)}`;
}

/**
 * Get the original image URL (encoded)
 */
function getOriginalUrl(imagePath: string): string {
  let basePath = imagePath;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  return `/api/images/${encodeImagePath(basePath)}`;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = "",
  loading = "lazy",
  sizes = DEFAULT_SIZES,
  aspectRatio,
  priority = false,
  onClick,
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already loaded (cached) on mount
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setIsLoaded(true);
    }
  }, []);

  // Reset state when src changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setUseOriginal(false);
  }, [src]);

  // Normalize src path
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
  const imagePath = normalizedSrc.startsWith("/api/images/")
    ? normalizedSrc
    : `/api/images/${normalizedSrc.replace(/^\//, "")}`;

  // Generate srcset with WebP variants
  const srcSet = !useOriginal
    ? SRCSET_WIDTHS.map((w) => `${getVariantUrl(imagePath, w)} ${w}w`).join(", ")
    : undefined;

  // Default src - use 1600w variant (middle size) or original
  const defaultSrc = useOriginal 
    ? getOriginalUrl(imagePath)
    : getVariantUrl(imagePath, 1600);

  // Placeholder styles
  const placeholderStyles = aspectRatio
    ? { aspectRatio, backgroundColor: "#f3f4f6" }
    : undefined;

  const handleError = () => {
    if (!useOriginal) {
      // WebP variant failed, fall back to original
      console.log(`[OptimizedImage] Variant not found, falling back to original: ${src}`);
      setUseOriginal(true);
    } else {
      // Original also failed
      setHasError(true);
    }
  };

  if (hasError) {
    return (
      <div
        className={`bg-gray-200 dark:bg-gray-800 flex items-center justify-center ${className}`}
        style={placeholderStyles}
      >
        <span className="text-gray-400 text-sm">Image not available</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`} style={placeholderStyles}>
      {/* Loading placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 animate-pulse" />
      )}

      <img
        ref={imgRef}
        src={defaultSrc}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : loading}
        decoding={priority ? "sync" : "async"}
        // @ts-expect-error - React types use fetchPriority but DOM expects lowercase
        fetchpriority={priority ? "high" : undefined}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setIsLoaded(true)}
        onError={handleError}
        onClick={onClick}
      />
    </div>
  );
}

/**
 * Generate URL for a pre-generated WebP variant
 * For use outside the component (e.g., meta tags, preloading)
 */
export function getOptimizedImageUrl(
  src: string,
  options: {
    width?: number;
  } = {}
): string {
  const width = options.width || 1600; // Default to middle variant
  
  // Normalize the path
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  // Get path parts
  const lastSlash = basePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? basePath.substring(lastSlash + 1) : basePath;
  
  // Remove extension and add variant suffix
  const dotIndex = filename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  
  // Construct variant path
  const variantPath = `${dir}${nameWithoutExt}_${width}w.webp`;
  
  return `/api/images/${encodeImagePath(variantPath)}`;
}

/**
 * Get the original (non-optimized) image URL
 */
export function getOriginalImageUrl(src: string): string {
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  return `/api/images/${encodeImagePath(basePath)}`;
}

export default OptimizedImage;
