/**
 * Gallery Page (supports nested paths)
 * 
 * GET /gallery/:slug (e.g., /gallery/humans/portraits)
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, getStorage } from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import type { NavItem } from "~/components/Sidebar";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.gallery) {
    return [{ title: "Gallery Not Found - VictoPress" }];
  }
  return [
    { title: `${data.gallery.title} - VictoPress` },
    { name: "description", content: data.gallery.description || `Photo gallery: ${data.gallery.title}` },
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
  const slug = params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const storage = getStorage(context);
  const allGalleries = await scanGalleries(storage);
  
  // Filter galleries for navigation
  const publicGalleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Find exact gallery match
  let gallery = publicGalleries.find((g) => g.slug === slug);
  
  // If no exact match, check if it's a parent category
  // and aggregate all child galleries' photos
  if (!gallery) {
    const childGalleries = publicGalleries.filter(
      (g) => g.slug.startsWith(slug + "/")
    );
    
    if (childGalleries.length > 0) {
      // Create a virtual gallery with all child photos
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
  }

  if (!gallery) {
    throw new Response("Not Found", { status: 404 });
  }

  const navigation = buildNavigation(publicGalleries);

  // Filter out hidden photos and add gallerySlug for linking
  const visiblePhotos = gallery.photos
    .filter((p) => !p.hidden)
    .map((p) => ({
      ...p,
      // Use existing gallerySlug (for virtual galleries) or current gallery slug
      gallerySlug: (p as any).gallerySlug || gallery.slug,
    }));

  return json({
    gallery: {
      ...gallery,
      photos: visiblePhotos,
    },
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

export default function GalleryPage() {
  const { gallery, navigation, siteName, socialLinks } = useLoaderData<typeof loader>();

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      <PhotoGrid>
        {gallery.photos.map((photo) => (
          <PhotoItem
            key={photo.id}
            src={`/api/local-images/${photo.path}`}
            alt={photo.title || photo.filename}
            href={`/photo/${(photo as any).gallerySlug}/${photo.filename}`}
            aspectRatio="auto"
          />
        ))}
      </PhotoGrid>
    </Layout>
  );
}
