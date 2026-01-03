/**
 * OptimizedImage Component
 *
 * Responsive image component with automatic srcset generation.
 * Supports Cloudflare Image Resizing (production) and local fallback (development).
 *
 * Features:
 * - Automatic srcset for responsive images
 * - Multiple sizes: 400w (thumb), 800w (mobile), 1600w (desktop), 2400w (retina)
 * - Automatic WebP format via Cloudflare
 * - Native lazy loading
 * - Loading placeholder
 */

import { useState } from "react";

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
  /** Whether to use Cloudflare Image Resizing (default: true in production) */
  useCloudflare?: boolean;
  /** Quality (1-100), default: 80 */
  quality?: number;
  /** Priority loading (for above-the-fold images) */
  priority?: boolean;
  /** On click handler */
  onClick?: () => void;
}

// Standard breakpoint widths for srcset
const SRCSET_WIDTHS = [400, 800, 1200, 1600, 2400];

// Default sizes attribute (can be overridden)
const DEFAULT_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

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

  // Normalize src path
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
  const isLocalPath = normalizedSrc.startsWith("/api/local-images/");
  const imagePath = isLocalPath
    ? normalizedSrc.replace("/api/local-images/", "")
    : normalizedSrc;

  // Generate URLs for different sizes
  const generateUrl = (targetWidth: number): string => {
    if (useCloudflare && typeof window !== "undefined" && !window.location.hostname.includes("localhost")) {
      // Cloudflare Image Resizing URL format
      // https://developers.cloudflare.com/images/image-resizing/url-format/
      const cfOptions = [`width=${targetWidth}`, `quality=${quality}`, "format=auto"];
      return `/cdn-cgi/image/${cfOptions.join(",")}${normalizedSrc}`;
    }

    // Development / fallback: use original image
    return isLocalPath ? normalizedSrc : `/api/local-images/${imagePath}`;
  };

  // Generate srcset
  const srcSet = SRCSET_WIDTHS.map((w) => `${generateUrl(w)} ${w}w`).join(", ");

  // Default src (medium size)
  const defaultSrc = generateUrl(1200);

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
        src={defaultSrc}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : loading}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : undefined}
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
 * Useful for OG images or other server-side usage
 */
export function getOptimizedImageUrl(
  src: string,
  options: {
    width?: number;
    height?: number;
    quality?: number;
    format?: "auto" | "webp" | "avif" | "json";
  } = {}
): string {
  const { width = 1200, quality = 80, format = "auto" } = options;

  // For local development, return the original path
  if (typeof window !== "undefined" && window.location.hostname.includes("localhost")) {
    return src.startsWith("/api/local-images/") ? src : `/api/local-images/${src}`;
  }

  // Cloudflare Image Resizing format
  const cfOptions = [`width=${width}`, `quality=${quality}`, `format=${format}`];
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;

  return `/cdn-cgi/image/${cfOptions.join(",")}${normalizedSrc}`;
}

/**
 * Picture component with WebP/AVIF support
 * Provides better browser format negotiation
 */
export function OptimizedPicture({
  src,
  alt,
  className = "",
  sizes = DEFAULT_SIZES,
  loading = "lazy",
  priority = false,
}: Omit<OptimizedImageProps, "useCloudflare" | "quality">) {
  const [isLoaded, setIsLoaded] = useState(false);

  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;

  // Generate srcset for different formats
  const generateSrcSet = (format: string) =>
    SRCSET_WIDTHS.map((w) => {
      const url = `/cdn-cgi/image/width=${w},quality=80,format=${format}${normalizedSrc}`;
      return `${url} ${w}w`;
    }).join(", ");

  // Fallback srcset (original format)
  const fallbackSrcSet = SRCSET_WIDTHS.map((w) => {
    const url = `/cdn-cgi/image/width=${w},quality=80${normalizedSrc}`;
    return `${url} ${w}w`;
  }).join(", ");

  return (
    <picture className={className}>
      {/* AVIF - best compression, newest format */}
      <source type="image/avif" srcSet={generateSrcSet("avif")} sizes={sizes} />

      {/* WebP - good compression, wide support */}
      <source type="image/webp" srcSet={generateSrcSet("webp")} sizes={sizes} />

      {/* Fallback - original format or JPEG */}
      <img
        src={`/cdn-cgi/image/width=1200,quality=80${normalizedSrc}`}
        srcSet={fallbackSrcSet}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : loading}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : undefined}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setIsLoaded(true)}
      />
    </picture>
  );
}

export default OptimizedImage;
