/**
 * Photo Navigation Hook
 * 
 * Provides smooth transitions and preloading for photo detail pages.
 * Features:
 * - Preloads next/previous images on page load
 * - Smooth fade transitions between photos
 * - Loading state management
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "@remix-run/react";
import {
  preloadImages,
  type ImagePreloadSource,
} from "~/utils/image-optimization";

interface PhotoNavigationOptions {
  /** Current photo URL */
  currentPhotoUrl: string;
  /** Previous photo URL (or null if no previous) */
  prevPhotoUrl?: string | null;
  /** Next photo URL (or null if no next) */
  nextPhotoUrl?: string | null;
  /** Width to preload images at (for optimization) */
  preloadWidth?: number;
}

interface PhotoNavigationResult {
  /** Whether the current photo is still loading */
  isLoading: boolean;
  /** Whether a transition is in progress */
  isTransitioning: boolean;
  /** The displayed photo URL (may lag behind during transitions) */
  displayedPhotoUrl: string;
  /** Handler for when the image has loaded */
  onImageLoad: () => void;
  /** Trigger a navigation with transition effect */
  navigateWithTransition: (url: string) => void;
}

export function usePhotoNavigation({
  currentPhotoUrl,
  prevPhotoUrl,
  nextPhotoUrl,
  preloadWidth = 1600,
}: PhotoNavigationOptions): PhotoNavigationResult {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedPhotoUrl, setDisplayedPhotoUrl] = useState(currentPhotoUrl);
  const preloadedRef = useRef<Set<string>>(new Set());

  // When the route changes, update the displayed photo
  useEffect(() => {
    if (currentPhotoUrl !== displayedPhotoUrl) {
      setIsLoading(true);
      setDisplayedPhotoUrl(currentPhotoUrl);
    }
  }, [currentPhotoUrl, displayedPhotoUrl]);

  // Preload adjacent images when the page loads
  useEffect(() => {
    const imagesToPreload: string[] = [];
    
    if (prevPhotoUrl && !preloadedRef.current.has(prevPhotoUrl)) {
      imagesToPreload.push(prevPhotoUrl);
      preloadedRef.current.add(prevPhotoUrl);
    }
    
    if (nextPhotoUrl && !preloadedRef.current.has(nextPhotoUrl)) {
      imagesToPreload.push(nextPhotoUrl);
      preloadedRef.current.add(nextPhotoUrl);
    }
    
    if (imagesToPreload.length > 0) {
      // Preload with a slight delay to not block the main image
      const timeout = setTimeout(() => {
        preloadImages(imagesToPreload, { width: preloadWidth })
          .catch(() => {
            // Silently fail - preloading is an optimization
          });
      }, 100);
      
      return () => clearTimeout(timeout);
    }
  }, [prevPhotoUrl, nextPhotoUrl, preloadWidth]);

  // Mark current photo as preloaded
  useEffect(() => {
    preloadedRef.current.add(currentPhotoUrl);
  }, [currentPhotoUrl]);

  const onImageLoad = useCallback(() => {
    setIsLoading(false);
    setIsTransitioning(false);
  }, []);

  const navigateWithTransition = useCallback(
    (url: string) => {
      setIsTransitioning(true);
      // Small delay to allow the fade-out animation to start
      setTimeout(() => {
        navigate(url);
      }, 50);
    },
    [navigate]
  );

  return {
    isLoading,
    isTransitioning,
    displayedPhotoUrl,
    onImageLoad,
    navigateWithTransition,
  };
}

/**
 * Simple preloading hook for adjacent photos
 * Use this when you just want preloading without transition management
 */
export function usePhotoPreloading(
  photoSources: (string | ImagePreloadSource | null | undefined)[]
): void {
  const preloadedRef = useRef<Set<string>>(new Set());

  const getSourceKey = (source: string | ImagePreloadSource) =>
    typeof source === "string"
      ? source
      : JSON.stringify([source.src, source.srcSet ?? "", source.sizes ?? ""]);

  // Depending on a semantic key avoids cancelling a scheduled preload when a
  // caller creates an equivalent array during an unrelated render.
  const sourcesKey = photoSources
    .filter((source): source is string | ImagePreloadSource => !!source)
    .map(getSourceKey)
    .join("\u0000");

  useEffect(() => {
    const validSources = photoSources.filter(
      (source): source is string | ImagePreloadSource =>
        !!source && !preloadedRef.current.has(getSourceKey(source))
    );

    if (validSources.length > 0) {
      // Start after the primary image has had a head start. Each Image also
      // carries low fetch priority, so this never competes as critical work.
      const timeout = setTimeout(() => {
        validSources.forEach((source) =>
          preloadedRef.current.add(getSourceKey(source))
        );
        preloadImages(validSources).catch(() => {
          // Silent fail
        });
      }, 200);

      return () => clearTimeout(timeout);
    }
  }, [sourcesKey]);
}
