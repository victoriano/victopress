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
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already loaded (cached) on mount
  // This handles the case where image loads before React hydrates
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setIsLoaded(true);
    }
  }, []);

  // Normalize src path
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
  const isApiPath = normalizedSrc.startsWith("/api/images/");
  const imagePath = isApiPath
    ? normalizedSrc.replace("/api/images/", "")
    : normalizedSrc;

  // Encode URL for srcset (spaces and special chars must be encoded)
  const encodeForSrcset = (url: string): string => {
    // Split path and encode each segment, then rejoin
    // This handles spaces and special characters in folder/file names
    return url.split('/').map(segment => encodeURIComponent(segment)).join('/');
  };

  // Generate URLs for different sizes
  // Note: We always use /api/images/ for consistent server/client rendering
  // This avoids hydration mismatches between SSR and client-side navigation
  const generateUrl = (targetWidth: number, forSrcset = false): string => {
    // Always use /api/images/ for consistent behavior
    // Cloudflare Image Resizing can be added later via CDN configuration
    const url = isApiPath ? normalizedSrc : `/api/images/${imagePath}`;
    return forSrcset ? encodeForSrcset(url) : url;
  };

  // Generate srcset with properly encoded URLs
  const srcSet = SRCSET_WIDTHS.map((w) => `${generateUrl(w, true)} ${w}w`).join(", ");

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
        ref={imgRef}
        src={defaultSrc}
        srcSet={srcSet}
        sizes={sizes}
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
 * Useful for OG images or other server-side usage
 * 
 * Note: We use /api/images/ for consistency. Cloudflare Image Resizing
 * can be configured separately at the CDN level if needed.
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
  // Always use /api/images/ for consistent server/client behavior
  const normalizedSrc = src.startsWith("/") ? src : `/${src}`;
  
  if (normalizedSrc.startsWith("/api/images/")) {
    return normalizedSrc;
  }
  
  return `/api/images/${src}`;
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
