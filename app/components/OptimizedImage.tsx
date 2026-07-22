/**
 * OptimizedImage Component
 *
 * Responsive image component using pre-generated WebP variants.
 * 
 * Features:
 * - Automatic srcset using pre-generated WebP variants (800w, 1600w, 2400w)
 * - Optimized for 5K displays and Retina MacBooks
 * - Native lazy loading
 * - Intrinsic layout reservation with immediate SSR paint
 * - Fallback to original image if variants don't exist
 * 
 * Pre-requisite: Run `bun run optimize-images` to generate WebP variants
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateSrcSet,
  getOptimizedImageUrl,
  getOriginalImageUrl,
  getResponsiveVariantWidths,
} from "~/utils/image-optimization";

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
  priority = false,
  onClick,
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRevealPending, setIsRevealPending] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset state when src changes
  useEffect(() => {
    setIsLoaded(false);
    setIsRevealPending(false);
    setHasError(false);
    setUseOriginal(false);

    const image = imgRef.current;

    // Preserve immediate SSR paint: cached, priority, or already-decoding
    // images remain visible. Only a lazy image with no decodable pixels yet is
    // hidden, so its eventual reveal cannot introduce a flash or extra wait.
    if (image?.complete && image.naturalHeight > 0) {
      setIsLoaded(true);
      return;
    }

    if (!priority && image?.naturalWidth === 0) {
      setIsRevealPending(true);
    }
  }, [priority, src]);

  const availableVariantWidths = useMemo(
    () => getResponsiveVariantWidths(width),
    [width],
  );
  const srcSet = useOriginal
    ? undefined
    : generateSrcSet(src, availableVariantWidths, {
        originalWidth: width,
        includeOriginal: width !== undefined,
      });

  // Keep the universally available original in `src`. Modern browsers select
  // an optimized candidate from `srcset`; crawlers, no-JS clients and legacy
  // browsers still get a valid image before hydration.
  const defaultSrc = getOriginalImageUrl(src);

  // Placeholder styles
  const resolvedAspectRatio =
    aspectRatio ?? (width && height ? `${width} / ${height}` : undefined);
  const placeholderStyles = resolvedAspectRatio
    ? { aspectRatio: resolvedAspectRatio, backgroundColor: "#f3f4f6" }
    : undefined;

  const handleError = () => {
    if (!useOriginal) {
      // WebP variant failed, fall back to original
      console.log(`[OptimizedImage] Variant not found, falling back to original: ${src}`);
      setIsLoaded(false);
      setIsRevealPending(!priority);
      setUseOriginal(true);
    } else {
      // Original also failed
      setHasError(true);
    }
  };

  const handleLoad = () => {
    setIsLoaded(true);
    setIsRevealPending(false);
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
      {/* Keep the placeholder behind the image so SSR can paint progressively. */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-100 dark:bg-gray-900" aria-hidden="true" />
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
        decoding="async"
        // @ts-expect-error - React types use fetchPriority but DOM expects lowercase
        fetchpriority={priority ? "high" : undefined}
        data-image-state={isRevealPending ? "waiting" : "visible"}
        className={`relative block w-full h-full object-cover ${
          isRevealPending
            ? "opacity-0 scale-[1.012]"
            : "opacity-100 scale-100 transition-[opacity,transform] duration-[480ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none motion-reduce:transform-none"
        }`}
        onLoad={handleLoad}
        onError={handleError}
        onClick={onClick}
      />
    </div>
  );
}

export { getOptimizedImageUrl, getOriginalImageUrl } from "~/utils/image-optimization";

export default OptimizedImage;
