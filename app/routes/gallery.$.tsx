/**
 * Gallery Page (supports nested paths)
 * 
 * GET /gallery/:slug (e.g., /gallery/humans/portraits)
 * GET /gallery/:slug?page=2 (pagination)
 * 
 * Uses pre-calculated content index for fast loading.
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { 
  getStorage, 
  getNavigationFromIndex, 
  getAllGalleriesFromIndex,
  type GalleryDataEntry,
  type GalleryPhotoEntry,
} from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import { PasswordProtectedGallery } from "~/components/PasswordProtectedGallery";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import { isGalleryAuthenticated } from "~/utils/gallery-auth";

const PHOTOS_PER_PAGE = 50;

// Extended photo type with gallery reference
interface PhotoWithGallery extends GalleryPhotoEntry {
  gallerySlug: string;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.gallery) {
    return [{ title: "Gallery Not Found - VictoPress" }];
  }

  // For protected galleries, show generic title
  if (data.isProtected && !data.isAuthenticated) {
    return [
      { title: `${data.gallery.title} - Protected - ${data.siteName}` },
      { name: "description", content: "This gallery is password protected." },
      { name: "robots", content: "noindex" },
    ];
  }

  const gallery = data.gallery;
  const description =
    gallery.description ||
    `Photo gallery: ${gallery.title} (${gallery.photoCount} photos)`;

  return generateMetaTags({
    title: `${gallery.title} - ${data.siteName}`,
    description,
    url: data.canonicalUrl,
    image: data.ogImage || undefined,
    imageAlt: gallery.title,
    type: "website",
    siteName: data.siteName,
    keywords: gallery.tags,
  });
};

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const slug = params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);
  
  // Load all galleries from index and navigation in parallel (fast!)
  const [allGalleries, navigation] = await Promise.all([
    getAllGalleriesFromIndex(storage),
    getNavigationFromIndex(storage),
  ]);
  
  // Filter public galleries
  const publicGalleries = allGalleries
    .filter((g) => !g.isProtected || g.photoCount > 0)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Find exact gallery match
  let gallery: GalleryDataEntry | undefined = publicGalleries.find((g) => g.slug === slug);
  
  // Find child galleries for this slug
  const childGalleries = publicGalleries.filter(
    (g) => g.slug.startsWith(slug + "/")
  );
  
  // Prepare photos with gallery reference
  let allPhotos: PhotoWithGallery[] = [];
  let displayGallery: {
    slug: string;
    title: string;
    description?: string;
    cover: string;
    photoCount: number;
    tags?: string[];
    password?: string;
  };
  
  if (gallery) {
    // Exact match found - check if we should include nested photos
    const includeNested = gallery.includeNestedPhotos !== false; // default: true
    
    // Get direct photos
    const directPhotos: PhotoWithGallery[] = gallery.photos
      .filter((p) => !p.hidden)
      .map((p) => ({ ...p, gallerySlug: gallery!.slug }));
    
    if (includeNested && childGalleries.length > 0) {
      // Get nested photos from child galleries
      const nestedPhotos: PhotoWithGallery[] = childGalleries.flatMap((g) =>
        g.photos.filter((p) => !p.hidden).map((p) => ({ ...p, gallerySlug: g.slug }))
      );
      allPhotos = [...directPhotos, ...nestedPhotos];
    } else {
      allPhotos = directPhotos;
    }
    
    displayGallery = {
      slug: gallery.slug,
      title: gallery.title,
      description: gallery.description,
      cover: gallery.cover,
      photoCount: allPhotos.length,
      tags: gallery.tags,
      password: gallery.password,
    };
  } else if (childGalleries.length > 0) {
    // No exact match but has children - create virtual gallery
    allPhotos = childGalleries.flatMap((g) =>
      g.photos.filter((p) => !p.hidden).map((p) => ({ ...p, gallerySlug: g.slug }))
    );
    
    // Get title from the category name
    const categoryName = slug.split("/").pop() || slug;
    const title = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    
    displayGallery = {
      slug: slug,
      title: title,
      description: `All photos from ${title}`,
      cover: allPhotos[0]?.path || "",
      photoCount: allPhotos.length,
      tags: [],
    };
  } else {
    throw new Response("Not Found", { status: 404 });
  }

  const siteName = "Victoriano Izquierdo";
  const canonicalUrl = `${baseUrl}/gallery/${displayGallery.slug}`;
  const ogImage = buildImageUrl(baseUrl, displayGallery.cover);

  // Check if gallery is password protected
  const isProtected = !!displayGallery.password;
  let isAuthenticated = false;

  if (isProtected) {
    isAuthenticated = await isGalleryAuthenticated(request, displayGallery.slug);
  }

  // If protected and not authenticated, don't expose photos
  const exposedPhotos = isProtected && !isAuthenticated ? [] : allPhotos;
  const exposedOgImage = isProtected && !isAuthenticated ? null : ogImage;

  // Pagination
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const totalPhotos = exposedPhotos.length;
  const totalPages = Math.ceil(totalPhotos / PHOTOS_PER_PAGE);
  const startIndex = (page - 1) * PHOTOS_PER_PAGE;
  const endIndex = startIndex + PHOTOS_PER_PAGE;
  const paginatedPhotos = exposedPhotos.slice(startIndex, endIndex);

  return json({
    isProtected,
    isAuthenticated,
    gallery: {
      ...displayGallery,
      photos: paginatedPhotos,
      photoCount: totalPhotos,
    },
    pagination: {
      page,
      totalPages,
      totalPhotos,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    navigation,
    siteName,
    canonicalUrl,
    ogImage: exposedOgImage,
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

export default function GalleryPage() {
  const { gallery, navigation, siteName, socialLinks, isProtected, isAuthenticated, pagination } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // Show password form for protected galleries
  if (isProtected && !isAuthenticated) {
    return (
      <PasswordProtectedGallery
        gallerySlug={gallery.slug}
        galleryTitle={gallery.title}
        redirectTo={`/gallery/${gallery.slug}`}
      />
    );
  }

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      {/* Mobile Breadcrumb Navigation */}
      <GalleryBreadcrumb currentSlug={gallery.slug} navigation={navigation} />
      
      <PhotoGrid>
        {gallery.photos.map((photo, index) => (
          <PhotoItem
            key={photo.path}
            src={`/api/images/${photo.path}`}
            alt={photo.title || photo.filename}
            href={`/photo/${(photo as any).gallerySlug}/${photo.filename}`}
            aspectRatio="auto"
            priority={index < 8} // First 8 images are above the fold
          />
        ))}
      </PhotoGrid>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          gallerySlug={gallery.slug}
        />
      )}
    </Layout>
  );
}

/**
 * Pagination Component
 */
function Pagination({
  currentPage,
  totalPages,
  gallerySlug,
}: {
  currentPage: number;
  totalPages: number;
  gallerySlug: string;
}) {
  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    const showPages = 5; // Number of page links to show
    
    if (totalPages <= showPages + 2) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      // Calculate range around current page
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      
      // Adjust if at edges
      if (currentPage <= 3) {
        end = Math.min(showPages, totalPages - 1);
      } else if (currentPage >= totalPages - 2) {
        start = Math.max(2, totalPages - showPages + 1);
      }
      
      // Add ellipsis if needed
      if (start > 2) {
        pages.push("...");
      }
      
      // Add middle pages
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      // Add ellipsis if needed
      if (end < totalPages - 1) {
        pages.push("...");
      }
      
      // Always show last page
      pages.push(totalPages);
    }
    
    return pages;
  };

  const baseUrl = `/gallery/${gallerySlug}`;

  return (
    <nav
      className="flex items-center justify-center gap-2 py-8 px-4"
      aria-label="Pagination"
    >
      {/* Previous button */}
      {currentPage > 1 ? (
        <Link
          to={currentPage === 2 ? baseUrl : `${baseUrl}?page=${currentPage - 1}`}
          className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors"
          aria-label="Previous page"
        >
          ← Prev
        </Link>
      ) : (
        <span className="px-3 py-2 text-sm font-medium text-gray-300 dark:text-gray-600">
          ← Prev
        </span>
      )}

      {/* Page numbers */}
      <div className="flex items-center gap-1">
        {getPageNumbers().map((page, index) =>
          page === "..." ? (
            <span
              key={`ellipsis-${index}`}
              className="px-3 py-2 text-sm text-gray-400"
            >
              …
            </span>
          ) : (
            <Link
              key={page}
              to={page === 1 ? baseUrl : `${baseUrl}?page=${page}`}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                page === currentPage
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </Link>
          )
        )}
      </div>

      {/* Next button */}
      {currentPage < totalPages ? (
        <Link
          to={`${baseUrl}?page=${currentPage + 1}`}
          className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors"
          aria-label="Next page"
        >
          Next →
        </Link>
      ) : (
        <span className="px-3 py-2 text-sm font-medium text-gray-300 dark:text-gray-600">
          Next →
        </span>
      )}
    </nav>
  );
}
