/**
 * Gallery Page (supports nested paths)
 * 
 * GET /gallery/:slug (e.g., /gallery/humans/portraits)
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, scanParentMetadata, getStorage } from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import { PasswordProtectedGallery } from "~/components/PasswordProtectedGallery";
import { buildNavigation } from "~/utils/navigation";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import { isGalleryAuthenticated } from "~/utils/gallery-auth";

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

  // Type guard - at this point, gallery has full properties
  const gallery = data.gallery as {
    title: string;
    description?: string;
    photoCount: number;
    tags?: string[];
  };

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
  const [allGalleries, parentMetadata] = await Promise.all([
    scanGalleries(storage),
    scanParentMetadata(storage),
  ]);
  
  // Filter galleries for navigation
  const publicGalleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Find exact gallery match
  let gallery = publicGalleries.find((g) => g.slug === slug);
  
  // Find child galleries for this slug
  const childGalleries = publicGalleries.filter(
    (g) => g.slug.startsWith(slug + "/")
  );
  
  if (gallery) {
    // Exact match found - check if we should include nested photos
    const includeNested = gallery.includeNestedPhotos !== false; // default: true
    
    if (includeNested && childGalleries.length > 0) {
      // Get direct photos (with gallerySlug set to current gallery)
      const directPhotos = gallery.photos
        .filter((p) => !p.hidden)
        .map((p) => ({
          ...p,
          gallerySlug: gallery!.slug,
        }));
      
      // Get nested photos from child galleries (recursively)
      const nestedPhotos = childGalleries.flatMap((g) =>
        g.photos.filter((p) => !p.hidden).map((p) => ({
          ...p,
          gallerySlug: g.slug,
        }))
      );
      
      // Combine: direct photos first, then nested
      gallery = {
        ...gallery,
        photos: [...directPhotos, ...nestedPhotos],
        photoCount: directPhotos.length + nestedPhotos.length,
      };
    }
  } else if (childGalleries.length > 0) {
    // No exact match but has children - create virtual gallery
    // Add gallerySlug to each photo for proper linking
    const allPhotos = childGalleries.flatMap((g) =>
      g.photos.filter((p) => !p.hidden).map((p) => ({
        ...p,
        gallerySlug: g.slug,
      }))
    );
    
    // Get title from the category name
    const categoryName = slug.split("/").pop() || slug;
    const title = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
    
    gallery = {
      id: slug,
      slug: slug,
      title: title,
      description: `All photos from ${title}`,
      path: `galleries/${slug}`,
      cover: allPhotos[0]?.path || "",
      photos: allPhotos,
      photoCount: allPhotos.length,
      date: new Date(),
      lastModified: new Date(),
      tags: [],
      category: undefined,
      private: false,
      password: undefined,
      order: undefined,
      hasCustomMetadata: false,
    };
  }

  if (!gallery) {
    throw new Response("Not Found", { status: 404 });
  }

  const navigation = buildNavigation(publicGalleries, parentMetadata);

  const siteName = "Victoriano Izquierdo";
  const canonicalUrl = `${baseUrl}/gallery/${gallery.slug}`;
  const ogImage = buildImageUrl(baseUrl, gallery.cover);

  // Check if gallery is password protected
  const isProtected = !!gallery.password;
  let isAuthenticated = false;

  if (isProtected) {
    isAuthenticated = await isGalleryAuthenticated(request, gallery.slug);
  }

  // Filter out hidden photos and add gallerySlug for linking
  const visiblePhotos = gallery.photos
    .filter((p) => !p.hidden)
    .map((p) => ({
      ...p,
      // Use existing gallerySlug (for virtual galleries) or current gallery slug
      gallerySlug: (p as any).gallerySlug || gallery.slug,
    }));

  // If protected and not authenticated, don't expose photos
  const exposedPhotos = isProtected && !isAuthenticated ? [] : visiblePhotos;
  const exposedOgImage = isProtected && !isAuthenticated ? null : ogImage;

  return json({
    isProtected,
    isAuthenticated,
    gallery: {
      ...gallery,
      photos: exposedPhotos,
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
  const { gallery, navigation, siteName, socialLinks, isProtected, isAuthenticated } =
    useLoaderData<typeof loader>();

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
      <PhotoGrid>
        {gallery.photos.map((photo, index) => (
          <PhotoItem
            key={photo.id}
            src={`/api/local-images/${photo.path}`}
            alt={photo.title || photo.filename}
            href={`/photo/${(photo as any).gallerySlug}/${photo.filename}`}
            aspectRatio="auto"
            priority={index < 8} // First 8 images are above the fold
          />
        ))}
      </PhotoGrid>
    </Layout>
  );
}
