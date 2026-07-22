/**
 * Featured Photo Detail Page
 * 
 * GET /featured/:index
 * Displays a photo from the featured/home virtual album with navigation within that album
 * Uses pre-calculated content index for fast loading.
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getStorage, getNavigationFromIndex, getHomePhotosFromIndex } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { CrossfadePhoto } from "~/components/CrossfadePhoto";
import { useEffect, useCallback, useMemo, useState } from "react";
import yaml from "js-yaml";
import { usePhotoPreloading } from "~/hooks/usePhotoNavigation";
import { getOptimizedImageUrl, getOriginalImageUrl } from "~/utils/image-optimization";
import { localizedPath, photoMessages } from "~/lib/i18n";
import { localizedAlternates, requireRouteLocale } from "~/lib/i18n.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";

export { mergeLocalizedRouteHeaders as headers } from "~/lib/i18n.server";

interface HomeConfig {
  photos?: Array<{
    gallery: string;
    filename: string;
  }>;
}

export const meta: MetaFunction<typeof loader> = ({ data, params }) => {
  if (!data?.photo) {
    return [{ title: `${params.locale === "es" ? "Foto no encontrada" : "Photo not found"} - VictoPress` }];
  }
  return [
    { title: `${data.photo.title || data.photo.filename} - ${data.locale === "es" ? "Destacada" : "Featured"}` },
    { name: "description", content: data.locale === "es" ? "Foto destacada" : "Featured photo" },
    { tagName: "link", rel: "canonical", href: data.alternates.canonical },
    ...(data.alternates.es ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "es", href: data.alternates.es }] : []),
    ...(data.alternates.en ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "en", href: data.alternates.en }] : []),
  ];
};

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const storage = getStorage(context, request);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const locale = requireRouteLocale(request, params.locale, siteLanguages);
  const messages = photoMessages[locale];
  const index = parseInt(params.index || "0", 10);
  
  // Try to load home.yaml config for custom photo selection
  let homeConfig: HomeConfig | null = null;
  try {
    const homeYamlContent = await storage.getText("home.yaml");
    if (homeYamlContent) {
      homeConfig = yaml.load(homeYamlContent) as HomeConfig;
    }
  } catch {
    // No home.yaml or invalid - use defaults from index
  }
  
  // Load navigation and home photos from index in parallel (fast!)
  const [navigation, homePhotos] = await Promise.all([
    getNavigationFromIndex(storage, locale),
    getHomePhotosFromIndex(storage, homeConfig ?? undefined, locale),
  ]);

  if (index < 0 || index >= homePhotos.length) {
    throw new Response(messages.photoNotFound, { status: 404 });
  }

  const photo = homePhotos[index];
  const prevPhoto = index > 0 ? homePhotos[index - 1] : null;
  const nextPhoto = index < homePhotos.length - 1 ? homePhotos[index + 1] : null;
  const prevIndex = index > 0 ? index - 1 : null;
  const nextIndex = index < homePhotos.length - 1 ? index + 1 : null;

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

  const alternates = localizedAlternates(
    request,
    locale,
    `/featured/${index}`,
    siteLanguages,
  );

  return json({
    photo,
    photoUrl,
    originalPhotoUrl,
    prevPhotoUrl,
    nextPhotoUrl,
    prevIndex,
    nextIndex,
    currentIndex: index,
    totalPhotos: homePhotos.length,
    navigation,
    siteName: "Victoriano Izquierdo",
    locale,
    alternates,
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

export default function FeaturedPhotoPage() {
  const {
    photo,
    photoUrl,
    originalPhotoUrl,
    prevPhotoUrl,
    nextPhotoUrl,
    prevIndex,
    nextIndex,
    currentIndex,
    totalPhotos,
    navigation,
    siteName,
    socialLinks,
    locale,
  } = useLoaderData<typeof loader>();
  const messages = photoMessages[locale];

  const navigate = useNavigate();
  const [useOriginal, setUseOriginal] = useState(false);
  
  // Current URL with fallback support
  const currentPhotoUrl = useOriginal ? originalPhotoUrl : photoUrl;
  
  // Track the URL that's finished loading (to prevent flash when navigating)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  
  // Preload adjacent photos for instant navigation
  const adjacentPhotoUrls = useMemo(
    () => [prevPhotoUrl, nextPhotoUrl],
    [prevPhotoUrl, nextPhotoUrl]
  );
  usePhotoPreloading(adjacentPhotoUrls);
  
  // Reset fallback when photo changes
  useEffect(() => {
    setUseOriginal(false);
  }, [photo.filename]);

  // When current URL changes, preload it and only show when ready
  useEffect(() => {
    if (currentPhotoUrl === loadedUrl) return;
    
    // Preload the new image before displaying
    const img = new Image();
    img.onload = () => {
      setLoadedUrl(currentPhotoUrl);
    };
    img.onerror = () => {
      // On error, try original or just show anyway
      if (!useOriginal) {
        setUseOriginal(true);
      } else {
        setLoadedUrl(currentPhotoUrl);
      }
    };
    img.src = currentPhotoUrl;
  }, [currentPhotoUrl, loadedUrl, useOriginal]);
  
  // Use the loaded URL, or fall back to current URL for initial render
  const displayUrl = loadedUrl || currentPhotoUrl;

  // Keyboard navigation - navigate directly without transition delay
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevIndex !== null) {
        navigate(localizedPath(locale, `/featured/${prevIndex}`));
      } else if (e.key === "ArrowRight" && nextIndex !== null) {
        navigate(localizedPath(locale, `/featured/${nextIndex}`));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
        navigate(localizedPath(locale, "/"));
      }
    },
    [navigate, prevIndex, nextIndex, locale]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Extract photo metadata (now pre-computed in index)
  const photoTitle = photo.title;
  const photoDescription = photo.description;
  const photoYear = photo.year;

  // Photo navigation for sidebar
  const photoNav = {
    prevPhotoUrl: prevIndex !== null ? localizedPath(locale, `/featured/${prevIndex}`) : undefined,
    nextPhotoUrl: nextIndex !== null ? localizedPath(locale, `/featured/${nextIndex}`) : undefined,
    thumbnailsUrl: localizedPath(locale, "/"),
    title: photoTitle,
    description: photoDescription,
    year: photoYear,
    currentIndex,
    totalPhotos,
    galleryTitle: photo.galleryTitle,
  };

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      photoNav={photoNav}
      locale={locale}
    >
      {/* Mobile Navigation - show path to photo's original gallery */}
      <GalleryBreadcrumb currentSlug={photo.gallerySlug} navigation={navigation} locale={locale} />

      {/* Mobile layout - simple stacked layout */}
      <div className="lg:hidden">
        {/* Gallery link - above the image */}
        {photo.galleryTitle && (
          <div className="bg-white dark:bg-gray-950 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <Link
              to={localizedPath(locale, `/gallery/${photo.gallerySlug}`)}
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            >
              {messages.goToGallery} <span className="font-semibold">{photo.galleryTitle}</span>{locale === "en" ? " Gallery" : ""} →
            </Link>
          </div>
        )}

        {/* Photo with invisible tap zones for navigation */}
        <div className="photo-transition-stage relative bg-white dark:bg-black min-h-[40vh]">
          <CrossfadePhoto
            photoKey={photo.path}
            src={displayUrl}
            alt={photo.title || photo.filename}
            priority
            containerClassName="w-full"
            className="w-full object-contain select-none"
            onError={() => {
              if (!useOriginal) {
                setUseOriginal(true);
              }
            }}
          />
          {/* Invisible tap zones - left half = prev, right half = next */}
          <div className="absolute inset-0 flex z-10">
            <Link
              to={prevIndex !== null ? localizedPath(locale, `/featured/${prevIndex}`) : "#"}
              onClick={(e) => prevIndex === null && e.preventDefault()}
              prefetch={prevIndex !== null ? "render" : "none"}
              className={`w-1/2 h-full focus:outline-none ${prevIndex === null ? "pointer-events-none" : ""}`}
              aria-label={messages.previousPhoto}
            />
            <Link
              to={nextIndex !== null ? localizedPath(locale, `/featured/${nextIndex}`) : "#"}
              onClick={(e) => nextIndex === null && e.preventDefault()}
              prefetch={nextIndex !== null ? "render" : "none"}
              className={`w-1/2 h-full focus:outline-none ${nextIndex === null ? "pointer-events-none" : ""}`}
              aria-label={messages.nextPhoto}
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
              {currentIndex + 1} {locale === "es" ? "de" : "of"} {totalPhotos}
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            {/* Prev/Next */}
            {prevIndex !== null ? (
              <Link
                to={localizedPath(locale, `/featured/${prevIndex}`)}
                prefetch="render"
                className="hover:text-gray-900 dark:hover:text-white transition-colors uppercase text-xs tracking-wide"
              >
                {locale === "es" ? "ANT" : "PREV"}
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600 uppercase text-xs tracking-wide">{locale === "es" ? "ANT" : "PREV"}</span>
            )}
            <span className="text-gray-300 dark:text-gray-600">/</span>
            {nextIndex !== null ? (
              <Link
                to={localizedPath(locale, `/featured/${nextIndex}`)}
                prefetch="render"
                className="hover:text-gray-900 dark:hover:text-white transition-colors uppercase text-xs tracking-wide"
              >
                {locale === "es" ? "SIG" : "NEXT"}
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600 uppercase text-xs tracking-wide">{locale === "es" ? "SIG" : "NEXT"}</span>
            )}
          </div>
        </div>

      </div>

      {/* Desktop layout - centered with clickable zones */}
      <div className="hidden lg:flex lg:flex-col lg:h-screen">
        <div className="photo-transition-stage flex-1 flex items-center justify-center overflow-hidden pt-8 pb-8 px-8 relative bg-white dark:bg-black">
          <CrossfadePhoto
            photoKey={photo.path}
            src={displayUrl}
            alt={photo.title || photo.filename}
            priority
            containerClassName="h-full w-full"
            className="max-h-full max-w-full object-contain pointer-events-none select-none"
            onError={() => {
              if (!useOriginal) {
                setUseOriginal(true);
              }
            }}
          />
          
          {/* Clickable overlay zones */}
          <div className="absolute inset-0 flex">
            {/* Left zone - Previous */}
            {prevIndex !== null ? (
              <Link
                to={localizedPath(locale, `/featured/${prevIndex}`)}
                prefetch="render"
                className="w-1/3 h-full cursor-prev focus:outline-none"
                aria-label={messages.previousPhoto}
              />
            ) : (
              <div className="w-1/3 h-full" />
            )}
            
            {/* Center zone - Thumbnails */}
            <Link
              to={localizedPath(locale, "/")}
              className="w-1/3 h-full cursor-thumbnails focus:outline-none"
              aria-label={messages.showThumbnails}
            />
            
            {/* Right zone - Next */}
            {nextIndex !== null ? (
              <Link
                to={localizedPath(locale, `/featured/${nextIndex}`)}
                prefetch="render"
                className="w-1/3 h-full cursor-next focus:outline-none"
                aria-label={messages.nextPhoto}
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
