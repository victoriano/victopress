/**
 * Home Page
 * 
 * Main portfolio page with sidebar navigation and photo grid
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, getStorage } from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import type { NavItem } from "~/components/Sidebar";

export const meta: MetaFunction = () => {
  return [
    { title: "VictoPress - Photo Portfolio" },
    { name: "description", content: "A files-first photo gallery CMS" },
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  const storage = getStorage(context);
  const allGalleries = await scanGalleries(storage);
  
  // Filter public galleries and sort by order
  const galleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  // Build navigation structure from galleries
  const navigation = buildNavigation(galleries);
  
  // Get all photos from all galleries for the home grid
  const allPhotos = galleries.flatMap((g) =>
    g.photos
      .filter((p) => !p.hidden)
      .slice(0, 4) // Max 4 photos per gallery on home
      .map((p) => ({
        ...p,
        gallerySlug: g.slug,
        galleryTitle: g.title,
      }))
  );

  return json({
    navigation,
    photos: allPhotos,
    siteName: "Victoriano Izquierdo", // TODO: Make configurable
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

/**
 * Build hierarchical navigation from flat gallery list
 */
function buildNavigation(
  galleries: Awaited<ReturnType<typeof scanGalleries>>
): NavItem[] {
  const navMap = new Map<string, NavItem>();
  const rootItems: NavItem[] = [];

  // Group galleries by their parent category
  for (const gallery of galleries) {
    const parts = gallery.slug.split("/");
    
    if (parts.length === 1) {
      // Top-level gallery
      const item: NavItem = {
        title: gallery.title,
        slug: gallery.slug,
        path: `/gallery/${gallery.slug}`,
        children: [],
      };
      navMap.set(gallery.slug, item);
      rootItems.push(item);
    } else {
      // Nested gallery - find or create parent
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
        // Create parent as nav-only item (no actual gallery)
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

export default function Index() {
  const { navigation, photos, siteName, socialLinks } = useLoaderData<typeof loader>();

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      <PhotoGrid>
        {photos.map((photo, index) => (
          <PhotoItem
            key={`${photo.gallerySlug}-${photo.id}-${index}`}
            src={`/api/local-images/${photo.path}`}
            alt={photo.title || photo.filename}
            aspectRatio="auto"
            href={`/photo/${photo.gallerySlug}/${photo.filename}`}
          />
        ))}
      </PhotoGrid>
    </Layout>
  );
}
