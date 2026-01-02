/**
 * Photo Detail Page
 * 
 * GET /photo/:gallerySlug/:photoFilename
 * Displays a single photo with sidebar navigation
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, getStorage } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import type { NavItem } from "~/components/Sidebar";
import { useEffect, useCallback } from "react";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.photo) {
    return [{ title: "Photo Not Found - VictoPress" }];
  }
  return [
    { title: `${data.photo.title || data.photo.filename} - ${data.gallery.title}` },
    { name: "description", content: data.gallery.description },
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
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

  const storage = getStorage(context);
  const allGalleries = await scanGalleries(storage);

  // Find the gallery
  const gallery = allGalleries.find((g) => g.slug === gallerySlug);
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

  // Get signed URL for the photo
  const photoUrl = await storage.getSignedUrl(photo.path);

  // Build navigation from all galleries
  const publicGalleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const navigation = buildNavigation(publicGalleries);

  return json({
    photo,
    photoUrl,
    gallery,
    gallerySlug,
    prevPhoto,
    nextPhoto,
    currentIndex: photoIndex,
    totalPhotos: photos.length,
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

function buildNavigation(
  galleries: Awaited<ReturnType<typeof scanGalleries>>
): NavItem[] {
  const navMap = new Map<string, NavItem>();
  const rootItems: NavItem[] = [];

  for (const gallery of galleries) {
    const parts = gallery.slug.split("/");
    
    if (parts.length === 1) {
      const item: NavItem = {
        title: gallery.title,
        slug: gallery.slug,
        path: `/gallery/${gallery.slug}`,
        children: [],
      };
      navMap.set(gallery.slug, item);
      rootItems.push(item);
    } else {
      const parentSlug = parts.slice(0, -1).join("/");
      const parent = navMap.get(parentSlug);
      
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push({
          title: gallery.title,
          slug: gallery.slug,
          path: `/gallery/${gallery.slug}`,
        });
      } else {
        const parentTitle = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        const parentItem: NavItem = {
          title: parentTitle,
          slug: parentSlug,
          path: `/gallery/${parentSlug}`,
          children: [{
            title: gallery.title,
            slug: gallery.slug,
            path: `/gallery/${gallery.slug}`,
          }],
        };
        navMap.set(parentSlug, parentItem);
        rootItems.push(parentItem);
      }
    }
  }

  return rootItems;
}

export default function PhotoPage() {
  const {
    photo,
    photoUrl,
    gallery,
    gallerySlug,
    prevPhoto,
    nextPhoto,
    navigation,
    siteName,
    socialLinks,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevPhoto) {
        navigate(`/photo/${gallerySlug}/${prevPhoto.filename}`);
      } else if (e.key === "ArrowRight" && nextPhoto) {
        navigate(`/photo/${gallerySlug}/${nextPhoto.filename}`);
      } else if (e.key === "Escape") {
        navigate(`/gallery/${gallerySlug}`);
      }
    },
    [navigate, gallerySlug, prevPhoto, nextPhoto]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Format photo info (title/description · year)
  const photoInfo = formatPhotoInfo(photo);

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      {/* Photo container - full height */}
      <div className="h-screen flex flex-col">
        {/* Main photo area */}
        <div className="flex-1 flex items-center justify-center overflow-hidden pt-8">
          <img
            src={photoUrl}
            alt={photo.title || photo.filename}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        {/* Bottom info bar */}
        <div className="bg-white px-6 py-4 flex items-center justify-between text-sm">
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
              {prevPhoto ? (
                <Link
                  to={`/photo/${gallerySlug}/${prevPhoto.filename}`}
                  className="hover:text-gray-900 transition-colors uppercase text-xs tracking-wide"
                >
                  PREV
                </Link>
              ) : (
                <span className="text-gray-300 uppercase text-xs tracking-wide">PREV</span>
              )}
              <span className="text-gray-300 mx-1">/</span>
              {nextPhoto ? (
                <Link
                  to={`/photo/${gallerySlug}/${nextPhoto.filename}`}
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

        {/* Show thumbnails link */}
        <div className="bg-white px-6 pb-4">
          <Link
            to={`/gallery/${gallerySlug}`}
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
