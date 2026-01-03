/**
 * Featured Photo Detail Page
 * 
 * GET /featured/:index
 * Displays a photo from the featured/home virtual album with navigation within that album
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, scanParentMetadata, getStorage } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { buildNavigation } from "~/utils/navigation";
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
  const [allGalleries, parentMetadata] = await Promise.all([
    scanGalleries(storage),
    scanParentMetadata(storage),
  ]);
  
  // Filter public galleries and sort by order
  const galleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Build navigation with parent metadata
  const navigation = buildNavigation(galleries, parentMetadata);
  
  // Try to load home.yaml config
  let homeConfig: HomeConfig | null = null;
  try {
    const homeYamlContent = await storage.getText("home.yaml");
    if (homeYamlContent) {
      homeConfig = yaml.load(homeYamlContent) as HomeConfig;
    }
  } catch {
    // No home.yaml or invalid - use defaults
  }

  // Build the same photo list as the home page
  let homePhotos: Array<{
    id: string;
    path: string;
    filename: string;
    title?: string;
    description?: string;
    dateTaken?: string | Date;
    exif?: {
      dateTimeOriginal?: string | Date;
      title?: string;
      imageDescription?: string;
    };
    gallerySlug: string;
    galleryTitle: string;
  }> = [];

  if (homeConfig?.photos && homeConfig.photos.length > 0) {
    // Use handpicked photos from config
    homeConfig.photos.forEach((config) => {
      const gallery = galleries.find((g) => g.slug === config.gallery);
      if (gallery) {
        const photo = gallery.photos.find((p) => p.filename === config.filename);
        if (photo && !photo.hidden) {
          homePhotos.push({
            ...photo,
            gallerySlug: gallery.slug,
            galleryTitle: gallery.title,
          });
        }
      }
    });
  } else {
    // Default: 4 photos per gallery
    galleries.forEach((g) => {
      g.photos
        .filter((p) => !p.hidden)
        .slice(0, 4)
        .forEach((p) => {
          homePhotos.push({
            ...p,
            gallerySlug: g.slug,
            galleryTitle: g.title,
          });
        });
    });
  }

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

  // Format photo info
  const photoInfo = formatPhotoInfo(photo);

  // Photo navigation for sidebar
  const photoNav = {
    prevPhotoUrl: prevIndex !== null ? `/featured/${prevIndex}` : undefined,
    nextPhotoUrl: nextIndex !== null ? `/featured/${nextIndex}` : undefined,
    thumbnailsUrl: "/",
    photoInfo: photoInfo || undefined,
    currentIndex,
    totalPhotos,
  };

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      photoNav={photoNav}
    >
      {/* Photo container - full height */}
      <div className="min-h-screen lg:h-screen flex flex-col">
        {/* Main photo area with clickable zones */}
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-0 lg:pt-8 pb-4 lg:pb-8 px-4 lg:px-8 relative">
          {/* Photo */}
          <img
            src={photoUrl}
            alt={photo.title || photo.filename}
            className="max-h-full max-w-full object-contain pointer-events-none select-none"
          />
          
          {/* Clickable overlay zones (desktop only) */}
          <div className="absolute inset-0 hidden lg:flex">
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
            
            {/* Center zone - Thumbnails (go to home) */}
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

        {/* Bottom info bar (mobile only) */}
        <div className="bg-white px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-sm gap-2 sm:gap-0 lg:hidden">
          {/* Photo info - left side */}
          <div>
            {photoInfo && (
              <p className="text-gray-700">{photoInfo}</p>
            )}
          </div>

          {/* Navigation - right side */}
          <div className="flex items-center gap-4 text-gray-500">
            {/* Prev/Next */}
            <div className="flex items-center gap-1">
              {prevIndex !== null ? (
                <Link
                  to={`/featured/${prevIndex}`}
                  className="hover:text-gray-900 transition-colors uppercase text-xs tracking-wide"
                >
                  PREV
                </Link>
              ) : (
                <span className="text-gray-300 uppercase text-xs tracking-wide">PREV</span>
              )}
              <span className="text-gray-300 mx-1">/</span>
              {nextIndex !== null ? (
                <Link
                  to={`/featured/${nextIndex}`}
                  className="hover:text-gray-900 transition-colors uppercase text-xs tracking-wide"
                >
                  NEXT
                </Link>
              ) : (
                <span className="text-gray-300 uppercase text-xs tracking-wide">NEXT</span>
              )}
            </div>
          </div>
        </div>

        {/* Show thumbnails link (mobile only) */}
        <div className="bg-white px-4 pb-4 lg:hidden">
          <Link
            to="/"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors uppercase tracking-wide"
          >
            SHOW THUMBNAILS
          </Link>
        </div>
      </div>
    </Layout>
  );
}

/**
 * Format photo info from metadata
 */
function formatPhotoInfo(photo: {
  title?: string;
  description?: string;
  dateTaken?: string | Date;
  exif?: {
    dateTimeOriginal?: string | Date;
    title?: string;
    imageDescription?: string;
  };
}): string | null {
  const parts: string[] = [];

  // Title or description
  if (photo.title) {
    parts.push(photo.title);
  } else if (photo.description) {
    parts.push(photo.description);
  } else if (photo.exif?.title) {
    parts.push(photo.exif.title);
  } else if (photo.exif?.imageDescription) {
    parts.push(photo.exif.imageDescription);
  }

  // Year from date
  if (photo.dateTaken) {
    const year = new Date(photo.dateTaken).getFullYear();
    if (!isNaN(year)) {
      parts.push(String(year));
    }
  } else if (photo.exif?.dateTimeOriginal) {
    const year = new Date(photo.exif.dateTimeOriginal).getFullYear();
    if (!isNaN(year)) {
      parts.push(String(year));
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
