/**
 * Photo Detail Page
 * 
 * GET /photo/:gallerySlug/:photoFilename
 * Displays a single photo with sidebar navigation
 * 
 * Uses pre-calculated content index for fast loading.
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { 
  getStorage, 
  getNavigationFromIndex, 
  getGalleryFromIndex,
  type GalleryPhotoEntry,
} from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import { useEffect, useCallback, useState, useRef } from "react";
import { usePhotoPreloading } from "~/hooks/usePhotoNavigation";
import { getOptimizedImageUrl, getOriginalImageUrl } from "~/utils/image-optimization";

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
  
  // Preload URLs for adjacent photos (same 1600w variant)
  const prevPhotoUrl = prevPhoto 
    ? getOptimizedImageUrl(prevPhoto.path, { width: 1600 })
    : null;
  const nextPhotoUrl = nextPhoto
    ? getOptimizedImageUrl(nextPhoto.path, { width: 1600 })
    : null;

  const siteName = "Victoriano Izquierdo";
  const canonicalUrl = `${baseUrl}/photo/${gallerySlug}/${photoFilename}`;
  const ogImage = buildImageUrl(baseUrl, photo.path);

  return json({
    photo,
    photoUrl,
    originalPhotoUrl,
    prevPhotoUrl,
    nextPhotoUrl,
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
  });
}

export default function PhotoPage() {
  const {
    photo,
    photoUrl,
    originalPhotoUrl,
    prevPhotoUrl,
    nextPhotoUrl,
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
  
  // Fallback to original if WebP variant doesn't exist
  const [useOriginal, setUseOriginal] = useState(false);
  const currentPhotoUrl = useOriginal ? originalPhotoUrl : photoUrl;
  
  // Reset fallback when photo changes
  useEffect(() => {
    setUseOriginal(false);
    setIsImageLoaded(false);
  }, [photo.filename]);
  
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const previousPhotoUrl = useRef(currentPhotoUrl);

  // Preload adjacent photos
  usePhotoPreloading([prevPhotoUrl, nextPhotoUrl]);

  // Handle image loading state - reset when current URL changes (including fallback)
  useEffect(() => {
    if (currentPhotoUrl !== previousPhotoUrl.current) {
      setIsImageLoaded(false);
      previousPhotoUrl.current = currentPhotoUrl;
    }
  }, [currentPhotoUrl]);

  // Navigation with transition
  const navigateWithTransition = useCallback(
    (url: string) => {
      setIsTransitioning(true);
      // Small delay for fade-out animation
      setTimeout(() => {
        navigate(url);
        setIsTransitioning(false);
      }, 150);
    },
    [navigate]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevPhoto) {
        navigateWithTransition(`/photo/${gallerySlug}/${prevPhoto.filename}`);
      } else if (e.key === "ArrowRight" && nextPhoto) {
        navigateWithTransition(`/photo/${gallerySlug}/${nextPhoto.filename}`);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
        navigate(`/gallery/${gallerySlug}`);
      }
    },
    [navigate, navigateWithTransition, gallerySlug, prevPhoto, nextPhoto]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Extract photo metadata
  const photoTitle = photo.title || photo.exif?.title || undefined;
  const photoDescription = photo.description || photo.exif?.imageDescription || undefined;
  const photoYear = getPhotoYear(photo);

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
      {/* Mobile layout - simple stacked layout */}
      <div className="lg:hidden">
        {/* Photo with invisible tap zones for navigation */}
        <div className="relative bg-gray-100 dark:bg-gray-900 min-h-[40vh]">
          {/* Loading spinner */}
          {!isImageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <div className="w-8 h-8 border-2 border-gray-300 dark:border-gray-600 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin" />
            </div>
          )}
          <img
            src={currentPhotoUrl}
            alt={photo.title || photo.filename}
            className={`w-full object-contain select-none transition-opacity duration-300 ease-out ${
              isImageLoaded && !isTransitioning ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => {
              console.log(`[Photo] Mobile image loaded: ${currentPhotoUrl}`);
              setIsImageLoaded(true);
            }}
            onError={() => {
              console.warn(`[Photo] Mobile image failed: ${currentPhotoUrl}`);
              if (!useOriginal) {
                console.log(`[Photo] Falling back to original: ${originalPhotoUrl}`);
                setUseOriginal(true);
              }
            }}
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

        {/* Thumbnails link */}
        <div className="bg-white dark:bg-gray-950 px-4 pb-4">
          <Link
            to={`/gallery/${gallerySlug}`}
            className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors uppercase tracking-wide"
          >
            SHOW THUMBNAILS
            {gallery.title && (
              <span className="block text-[11px] mt-0.5 normal-case">
                from <span className="font-bold">{gallery.title}</span>
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Desktop layout - centered with clickable zones */}
      <div className="hidden lg:flex lg:flex-col lg:h-screen">
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-8 pb-8 px-8 relative bg-white dark:bg-black">
          {/* Loading indicator */}
          {!isImageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 border-2 border-gray-200 dark:border-gray-700 border-t-gray-500 dark:border-t-gray-400 rounded-full animate-spin" />
            </div>
          )}
          <img
            src={currentPhotoUrl}
            alt={photo.title || photo.filename}
            className={`max-h-full max-w-full object-contain pointer-events-none select-none transition-opacity duration-300 ease-out ${
              isImageLoaded && !isTransitioning ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => {
              console.log(`[Photo] Desktop image loaded: ${currentPhotoUrl}`);
              setIsImageLoaded(true);
            }}
            onError={() => {
              console.warn(`[Photo] Desktop image failed: ${currentPhotoUrl}`);
              if (!useOriginal) {
                console.log(`[Photo] Falling back to original: ${originalPhotoUrl}`);
                setUseOriginal(true);
              }
            }}
          />
          
          {/* Clickable overlay zones */}
          <div className="absolute inset-0 flex">
            {/* Left zone - Previous */}
            {prevPhoto ? (
              <button
                type="button"
                onClick={() => navigateWithTransition(`/photo/${gallerySlug}/${prevPhoto.filename}`)}
                className="w-1/3 h-full cursor-prev bg-transparent border-0 focus:outline-none"
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
              <button
                type="button"
                onClick={() => navigateWithTransition(`/photo/${gallerySlug}/${nextPhoto.filename}`)}
                className="w-1/3 h-full cursor-next bg-transparent border-0 focus:outline-none"
                aria-label="Next photo"
              />
            ) : (
              <div className="w-1/3 h-full" />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

/**
 * Extract year from photo metadata
 */
function getPhotoYear(photo: {
  dateTaken?: string | Date;
  exif?: {
    dateTimeOriginal?: string | Date;
  };
}): number | undefined {
  if (photo.dateTaken) {
    const year = new Date(photo.dateTaken).getFullYear();
    if (!isNaN(year)) {
      return year;
    }
  } else if (photo.exif?.dateTimeOriginal) {
    const year = new Date(photo.exif.dateTimeOriginal).getFullYear();
    if (!isNaN(year)) {
      return year;
    }
  }
  return undefined;
}

