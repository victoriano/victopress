/**
 * Photo Detail Page
 * 
 * GET /photo/:gallerySlug/:photoFilename
 * Displays a single photo with sidebar navigation
 * 
 * Uses pre-calculated content index for fast loading.
 */

import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { 
  getStorage, 
  getNavigationFromIndex, 
  getGalleryFromIndex,
  type GalleryPhotoEntry,
} from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { SimilarPhotos } from "~/components/SimilarPhotos";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import { useEffect, useCallback, useMemo, useState } from "react";
import { usePhotoPreloading } from "~/hooks/usePhotoNavigation";
import {
  generateSrcSet,
  getOptimizedImageUrl,
  getOriginalImageUrl,
} from "~/utils/image-optimization";

// The desktop photo area is the viewport minus the 16rem sidebar and 4rem padding.
// Giving the browser the real slot size lets Retina displays select the 2400w variant.
const PHOTO_SIZES = "(min-width: 1024px) calc(100vw - 20rem), 100vw";

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.photo) {
    return [{ title: "Photo Not Found - VictoPress" }];
  }

  const photoTitle = data.photo.title || data.photo.filename;
  const description =
    data.photo.description ||
    `Photo from ${data.gallery.title}`;

  return generateMetaTags({
    title: `${photoTitle} - ${data.gallery.title}`,
    description,
    url: data.canonicalUrl,
    image: data.ogImage,
    imageAlt: photoTitle,
    type: "website",
    siteName: data.siteName,
    keywords: data.photo.tags,
  });
};

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const path = params["*"];
  if (!path) {
    throw new Response("Not Found", { status: 404 });
  }

  // Parse path: gallery/slug/photo-filename
  const segments = path.split("/");
  const photoFilename = segments.pop();
  const gallerySlug = segments.join("/");

  if (!photoFilename || !gallerySlug) {
    throw new Response("Not Found", { status: 404 });
  }

  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);
  
  // Load gallery from index and navigation in parallel (fast!)
  const [gallery, navigation] = await Promise.all([
    getGalleryFromIndex(storage, gallerySlug),
    getNavigationFromIndex(storage),
  ]);

  if (!gallery) {
    throw new Response("Gallery Not Found", { status: 404 });
  }

  // Find the photo
  const photos = gallery.photos.filter((p) => !p.hidden);
  const photoIndex = photos.findIndex(
    (p) => p.filename === photoFilename || p.filename === decodeURIComponent(photoFilename)
  );

  if (photoIndex === -1) {
    throw new Response("Photo Not Found", { status: 404 });
  }

  const photo = photos[photoIndex];
  const prevPhoto = photoIndex > 0 ? photos[photoIndex - 1] : null;
  const nextPhoto = photoIndex < photos.length - 1 ? photos[photoIndex + 1] : null;

  // Generate optimized image URLs using pre-generated WebP variants
  // Uses 1600w variant (good balance of quality and size)
  const photoUrl = getOptimizedImageUrl(photo.path, { width: 1600 });
  const originalPhotoUrl = getOriginalImageUrl(photo.path); // Fallback
  
  const siteName = "Victoriano Izquierdo";
  const canonicalUrl = `${baseUrl}/photo/${gallerySlug}/${photoFilename}`;
  const ogImage = buildImageUrl(baseUrl, photo.path);

  return json(
    {
      photo,
      photoUrl,
      originalPhotoUrl,
      gallery: {
        slug: gallery.slug,
        title: gallery.title,
      },
      gallerySlug,
      prevPhoto,
      nextPhoto,
      currentIndex: photoIndex,
      totalPhotos: photos.length,
      navigation,
      siteName,
      canonicalUrl,
      ogImage,
      socialLinks: {
        instagram: "https://instagram.com/victoriano",
        twitter: "https://twitter.com/victoriano",
        linkedin: "https://linkedin.com/in/victoriano",
        facebook: "https://facebook.com/victoriano",
      },
    },
    {
      // The dev site serves live Vite modules. Caching its HTML can mix an old
      // server render with new client code and leave React in a broken state.
      headers:
        new URL(baseUrl).hostname === "victopress-dev.nominao.com"
          ? {
              "Cache-Control": "no-store, max-age=0",
              "Cloudflare-CDN-Cache-Control": "no-store",
            }
          : undefined,
    }
  );
}

export default function PhotoPage() {
  const {
    photo,
    photoUrl,
    originalPhotoUrl,
    gallery,
    gallerySlug,
    prevPhoto,
    nextPhoto,
    currentIndex,
    totalPhotos,
    navigation,
    siteName,
    socialLinks,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  // If a responsive candidate fails, retry the stable 1600w source before
  // falling back to the original. This avoids leaving Safari on a broken
  // srcset candidate after a transient CDN or variant error.
  const [photoSourceMode, setPhotoSourceMode] = useState<
    "responsive" | "optimized" | "original"
  >("responsive");
  const [hasHydrated, setHasHydrated] = useState(false);
  const currentPhotoUrl =
    photoSourceMode === "original" ? originalPhotoUrl : photoUrl;
  const currentPhotoSrcSet =
    hasHydrated && photoSourceMode === "responsive"
      ? generateSrcSet(photo.path, undefined, {
          originalWidth: photo.exif?.width,
          includeOriginal: photo.exif?.width !== undefined,
        })
      : undefined;

  // Preload adjacent photos for instant navigation (no delay for faster nav)
  const adjacentPhotoPaths = useMemo(
    () => [prevPhoto?.path, nextPhoto?.path],
    [prevPhoto?.path, nextPhoto?.path]
  );
  usePhotoPreloading(adjacentPhotoPaths);
  
  // Reset fallback state when photo changes
  useEffect(() => {
    setPhotoSourceMode("responsive");
  }, [photo.filename]);

  // Start SSR with the reliable 1600w source, then enable responsive Retina
  // candidates once React has attached the error recovery handler.
  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const handlePhotoError = useCallback(() => {
    setPhotoSourceMode((currentMode) => {
      // Both the mobile and desktop images exist in the DOM. Only advance once
      // if they report the same failed source at nearly the same time.
      if (currentMode !== photoSourceMode) return currentMode;
      if (currentMode === "responsive") return "optimized";
      if (currentMode === "optimized") return "original";
      return currentMode;
    });
  }, [photoSourceMode]);

  // Keyboard navigation - navigate directly without transition delay
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevPhoto) {
        navigate(`/photo/${gallerySlug}/${prevPhoto.filename}`);
      } else if (e.key === "ArrowRight" && nextPhoto) {
        navigate(`/photo/${gallerySlug}/${nextPhoto.filename}`);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
        navigate(`/gallery/${gallerySlug}`);
      }
    },
    [navigate, gallerySlug, prevPhoto, nextPhoto]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Extract photo metadata
  const photoTitle = photo.title || undefined;
  const photoDescription = photo.description || undefined;
  const photoYear = photo.year;

  // Photo navigation for sidebar
  const photoNav = {
    prevPhotoUrl: prevPhoto ? `/photo/${gallerySlug}/${prevPhoto.filename}` : undefined,
    nextPhotoUrl: nextPhoto ? `/photo/${gallerySlug}/${nextPhoto.filename}` : undefined,
    thumbnailsUrl: `/gallery/${gallerySlug}`,
    title: photoTitle,
    description: photoDescription,
    year: photoYear,
    currentIndex,
    totalPhotos,
    galleryTitle: gallery.title,
  };

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      photoNav={photoNav}
    >
      {/* Mobile Navigation - show full gallery path */}
      <GalleryBreadcrumb currentSlug={gallerySlug} navigation={navigation} />

      {/* Mobile layout - simple stacked layout */}
      <div className="lg:hidden">
        {/* Gallery link - above the image */}
        {gallery.title && (
          <div className="bg-white dark:bg-gray-950 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <Link
              to={`/gallery/${gallerySlug}`}
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            >
              Go to <span className="font-semibold">{gallery.title}</span> Gallery →
            </Link>
          </div>
        )}

        {/* Photo with invisible tap zones for navigation */}
        <div className="relative bg-white dark:bg-black min-h-[40vh]">
          {/* Remount when the source mode changes so a failed request retries cleanly. */}
          <img
            key={`${photo.path}:${photoSourceMode}`}
            src={currentPhotoUrl}
            srcSet={currentPhotoSrcSet}
            sizes={currentPhotoSrcSet ? PHOTO_SIZES : undefined}
            alt={photo.title || photo.filename}
            width={photo.exif?.width}
            height={photo.exif?.height}
            loading="eager"
            decoding="async"
            // @ts-expect-error React 18's DOM types use a different casing.
            fetchpriority="high"
            className="w-full object-contain select-none"
            onError={handlePhotoError}
          />
          {/* Invisible tap zones - left half = prev, right half = next */}
          <div className="absolute inset-0 flex z-10">
            <Link
              to={prevPhoto ? `/photo/${gallerySlug}/${prevPhoto.filename}` : "#"}
              onClick={(e) => !prevPhoto && e.preventDefault()}
              className={`w-1/2 h-full focus:outline-none ${!prevPhoto ? "pointer-events-none" : ""}`}
              aria-label="Previous photo"
            />
            <Link
              to={nextPhoto ? `/photo/${gallerySlug}/${nextPhoto.filename}` : "#"}
              onClick={(e) => !nextPhoto && e.preventDefault()}
              className={`w-1/2 h-full focus:outline-none ${!nextPhoto ? "pointer-events-none" : ""}`}
              aria-label="Next photo"
            />
          </div>
        </div>
        
        {/* Info bar */}
        <div className="bg-white dark:bg-gray-950 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between text-sm gap-2 sm:gap-0">
          {/* Photo info */}
          <div className="space-y-0.5">
            {photoTitle && (
              <h2 className="text-[15px] font-bold text-black dark:text-white leading-tight">{photoTitle}</h2>
            )}
            {photoDescription && (
              <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-snug">{photoDescription}</p>
            )}
            {photoYear && (
              <p className="text-[12px] text-gray-400 dark:text-gray-500">{photoYear}</p>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            {/* Photo counter */}
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {currentIndex + 1} of {totalPhotos}
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            {/* Prev/Next */}
            {prevPhoto ? (
              <Link
                to={`/photo/${gallerySlug}/${prevPhoto.filename}`}
                className="hover:text-gray-900 dark:hover:text-white transition-colors uppercase text-xs tracking-wide"
              >
                PREV
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600 uppercase text-xs tracking-wide">PREV</span>
            )}
            <span className="text-gray-300 dark:text-gray-600">/</span>
            {nextPhoto ? (
              <Link
                to={`/photo/${gallerySlug}/${nextPhoto.filename}`}
                className="hover:text-gray-900 dark:hover:text-white transition-colors uppercase text-xs tracking-wide"
              >
                NEXT
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600 uppercase text-xs tracking-wide">NEXT</span>
            )}
          </div>
        </div>

      </div>

      {/* Desktop layout - centered with clickable zones */}
      <div className="hidden lg:flex lg:flex-col lg:h-screen">
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-8 pb-8 px-8 relative bg-white dark:bg-black">
          {/* Remount when the source mode changes so a failed request retries cleanly. */}
          <img
            key={`${photo.path}:${photoSourceMode}`}
            src={currentPhotoUrl}
            srcSet={currentPhotoSrcSet}
            sizes={currentPhotoSrcSet ? PHOTO_SIZES : undefined}
            alt={photo.title || photo.filename}
            width={photo.exif?.width}
            height={photo.exif?.height}
            loading="eager"
            decoding="async"
            // @ts-expect-error React 18's DOM types use a different casing.
            fetchpriority="high"
            className="max-h-full max-w-full object-contain pointer-events-none select-none"
            onError={handlePhotoError}
          />
          
          {/* Clickable overlay zones */}
          <div className="absolute inset-0 flex">
            {/* Left zone - Previous */}
            {prevPhoto ? (
              <Link
                to={`/photo/${gallerySlug}/${prevPhoto.filename}`}
                className="w-1/3 h-full cursor-prev focus:outline-none"
                aria-label="Previous photo"
              />
            ) : (
              <div className="w-1/3 h-full" />
            )}
            
            {/* Center zone - Thumbnails */}
            <Link
              to={`/gallery/${gallerySlug}`}
              className="w-1/3 h-full cursor-thumbnails focus:outline-none"
              aria-label="Show thumbnails"
            />
            
            {/* Right zone - Next */}
            {nextPhoto ? (
              <Link
                to={`/photo/${gallerySlug}/${nextPhoto.filename}`}
                className="w-1/3 h-full cursor-next focus:outline-none"
                aria-label="Next photo"
              />
            ) : (
              <div className="w-1/3 h-full" />
            )}
          </div>
        </div>
      </div>

      <SimilarPhotos key={photo.path} photoPath={photo.path} />
    </Layout>
  );
}
