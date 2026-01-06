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
import { useEffect, useCallback } from "react";
import yaml from "js-yaml";

interface HomeConfig {
  photos?: Array<{
    gallery: string;
    filename: string;
  }>;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.photo) {
    return [{ title: "Photo Not Found - VictoPress" }];
  }
  return [
    { title: `${data.photo.title || data.photo.filename} - Featured` },
    { name: "description", content: "Featured photo" },
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
  const index = parseInt(params.index || "0", 10);
  
  const storage = getStorage(context);
  
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
    getNavigationFromIndex(storage),
    getHomePhotosFromIndex(storage, homeConfig ?? undefined),
  ]);

  if (index < 0 || index >= homePhotos.length) {
    throw new Response("Photo Not Found", { status: 404 });
  }

  const photo = homePhotos[index];
  const prevPhoto = index > 0 ? index - 1 : null;
  const nextPhoto = index < homePhotos.length - 1 ? index + 1 : null;

  // Get signed URL for the photo
  const photoUrl = await storage.getSignedUrl(photo.path);

  return json({
    photo,
    photoUrl,
    prevIndex: prevPhoto,
    nextIndex: nextPhoto,
    currentIndex: index,
    totalPhotos: homePhotos.length,
    navigation,
    siteName: "Victoriano Izquierdo",
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
    prevIndex,
    nextIndex,
    currentIndex,
    totalPhotos,
    navigation,
    siteName,
    socialLinks,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevIndex !== null) {
        navigate(`/featured/${prevIndex}`);
      } else if (e.key === "ArrowRight" && nextIndex !== null) {
        navigate(`/featured/${nextIndex}`);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
        navigate("/");
      }
    },
    [navigate, prevIndex, nextIndex]
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
    prevPhotoUrl: prevIndex !== null ? `/featured/${prevIndex}` : undefined,
    nextPhotoUrl: nextIndex !== null ? `/featured/${nextIndex}` : undefined,
    thumbnailsUrl: "/",
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
    >
      {/* Mobile layout - simple stacked layout */}
      <div className="lg:hidden">
        {/* Photo - full width, no margins */}
        <img
          src={photoUrl}
          alt={photo.title || photo.filename}
          className="w-full object-contain pointer-events-none select-none"
        />
        
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
          <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            {prevIndex !== null ? (
              <Link
                to={`/featured/${prevIndex}`}
                className="hover:text-gray-900 dark:hover:text-white transition-colors uppercase text-xs tracking-wide"
              >
                PREV
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600 uppercase text-xs tracking-wide">PREV</span>
            )}
            <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
            {nextIndex !== null ? (
              <Link
                to={`/featured/${nextIndex}`}
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
        <div className="bg-white dark:bg-gray-950 px-4 pb-4 flex flex-col items-center justify-center">
          <Link
            to="/"
            className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors uppercase tracking-wide text-center"
          >
            SHOW THUMBNAILS
            {photo.galleryTitle && (
              <span className="block text-[11px] mt-0.5 normal-case">
                from <span className="font-bold">{photo.galleryTitle}</span>
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Desktop layout - centered with clickable zones */}
      <div className="hidden lg:flex lg:flex-col lg:h-screen">
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-8 pb-8 px-8 relative">
          <img
            src={photoUrl}
            alt={photo.title || photo.filename}
            className="max-h-full max-w-full object-contain pointer-events-none select-none"
          />
          
          {/* Clickable overlay zones */}
          <div className="absolute inset-0 flex">
            {/* Left zone - Previous */}
            {prevIndex !== null ? (
              <Link
                to={`/featured/${prevIndex}`}
                className="w-1/3 h-full cursor-prev"
                aria-label="Previous photo"
              />
            ) : (
              <div className="w-1/3 h-full" />
            )}
            
            {/* Center zone - Thumbnails */}
            <Link
              to="/"
              className="w-1/3 h-full cursor-thumbnails"
              aria-label="Show thumbnails"
            />
            
            {/* Right zone - Next */}
            {nextIndex !== null ? (
              <Link
                to={`/featured/${nextIndex}`}
                className="w-1/3 h-full cursor-next"
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

