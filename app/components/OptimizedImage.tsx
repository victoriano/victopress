/**
 * OptimizedImage Component
 *
 * Responsive image component with Cloudflare Image Resizing.
 * 
 * Features:
 * - Automatic srcset with CFI for responsive images
 * - Multiple sizes: 400w (thumb), 800w (mobile), 1200w (tablet), 1600w (desktop)
 * - Automatic WebP/AVIF format via Cloudflare
 * - Native lazy loading
 * - Loading placeholder
 * 
 * In production: Images are resized/optimized at Cloudflare's edge
 * In development: Falls back to original images (CFI not available on localhost)
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
  /** Whether to use Cloudflare Image Resizing (default: true) */
  useCloudflare?: boolean;
  /** Quality (1-100), default: 80 */
  quality?: number;
  /** Priority loading (for above-the-fold images) */
  priority?: boolean;
  /** On click handler */
  onClick?: () => void;
}

// Standard breakpoint widths for srcset
const SRCSET_WIDTHS = [400, 800, 1200, 1600];

// Default sizes attribute (can be overridden)
const DEFAULT_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

/**
 * CFI Toggle
 * 
 * Set to true when:
 * - You have a custom domain (not .pages.dev)
 * - Cloudflare Image Resizing is enabled for your zone
 * 
 * Set to false to use direct /api/images/ URLs (works everywhere)
 */
const USE_CFI = true; // Enabled - requires custom domain (photos.victoriano.me)

/**
 * Encode a path for use in URLs (handles spaces and special chars)
 */
function encodeImagePath(path: string): string {
  // Split by / and encode each segment, then rejoin
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Generate an image URL - either CFI or direct based on configuration
 */
function generateImageUrl(
  imagePath: string,
  targetWidth: number,
  quality: number
): string {
  // Normalize and encode the image path
  let basePath = imagePath;
  
  // Remove /api/images/ prefix if present, we'll add it back encoded
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  // Encode the path (handles spaces in folder names like "new york")
  const encodedPath = encodeImagePath(basePath);
  
  if (USE_CFI) {
    // Build CFI URL for Cloudflare Image Resizing
    const cfiOptions = `width=${targetWidth},quality=${quality},format=auto,fit=scale-down`;
    return `/cdn-cgi/image/${cfiOptions}/api/images/${encodedPath}`;
  }
  
  // Direct URL - no resizing, but works everywhere
  return `/api/images/${encodedPath}`;
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
  useCloudflare = true,
  quality = 80,
  priority = false,
  onClick,
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already loaded (cached) on mount
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setIsLoaded(true);
    }
  }, []);

  // Normalize src path - remove /api/images/ prefix if present
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
  const imagePath = normalizedSrc.startsWith("/api/images/")
    ? normalizedSrc
    : `/api/images/${normalizedSrc.replace(/^\//, "")}`;

  // Generate srcset for each width (CFI or direct based on config)
  const srcSet = USE_CFI
    ? SRCSET_WIDTHS.map((w) => `${generateImageUrl(imagePath, w, quality)} ${w}w`).join(", ")
    : undefined; // No srcset needed for direct URLs (browser handles it)

  // Default src
  const defaultSrc = generateImageUrl(imagePath, 1200, quality);

  // Placeholder styles
  const placeholderStyles = aspectRatio
    ? { aspectRatio, backgroundColor: "#f3f4f6" }
    : undefined;

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
        onError={() => setHasError(true)}
        onClick={onClick}
      />
    </div>
  );
}

/**
 * Generate optimized image URL for a specific width
 * Uses Cloudflare Image Resizing for automatic optimization
 */
export function getOptimizedImageUrl(
  src: string,
  options: {
    width?: number;
    height?: number;
    quality?: number;
    format?: "auto" | "webp" | "avif";
  } = {}
): string {
  // Normalize the path
  let basePath = src;
  if (basePath.startsWith("/api/images/")) {
    basePath = basePath.substring("/api/images/".length);
  } else if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }
  
  // Encode the path (handles spaces in folder names)
  const encodedPath = encodeImagePath(basePath);
  
  // Build CFI options
  const cfiParts: string[] = [];
  if (options.width) cfiParts.push(`width=${options.width}`);
  if (options.height) cfiParts.push(`height=${options.height}`);
  cfiParts.push(`quality=${options.quality || 80}`);
  cfiParts.push(`format=${options.format || "auto"}`);
  cfiParts.push("fit=scale-down");
  
  return `/cdn-cgi/image/${cfiParts.join(",")}/api/images/${encodedPath}`;
}

/**
 * Picture component with WebP/AVIF support
 * Provides better browser format negotiation
 * 
 * Note: This component is currently disabled for consistent rendering.
 * Cloudflare Image Resizing can cause hydration mismatches.
 * Use OptimizedImage instead.
 */
export function OptimizedPicture({
  src,
  alt,
  className = "",
  sizes = DEFAULT_SIZES,
  loading = "lazy",
  priority = false,
}: Omit<OptimizedImageProps, "useCloudflare" | "quality">) {
  // For consistent server/client rendering, we use the standard OptimizedImage approach
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      className={className}
      sizes={sizes}
      loading={loading}
      priority={priority}
    />
  );
}

export default OptimizedImage;
