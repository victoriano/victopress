/**
 * Home Page
 * 
 * Main portfolio page with sidebar navigation and photo grid
 * Photos can be configured via content/home.yaml or default to 4 per gallery
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanGalleries, getStorage } from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import { buildNavigation } from "~/utils/navigation";
import yaml from "js-yaml";

interface HomeConfig {
  photos?: Array<{
    gallery: string;
    filename: string;
  }>;
}

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

  let homePhotos: Array<{
    id: string;
    path: string;
    filename: string;
    title?: string;
    gallerySlug: string;
    galleryTitle: string;
    homeIndex: number;
  }> = [];

  if (homeConfig?.photos && homeConfig.photos.length > 0) {
    // Use handpicked photos from config
    homeConfig.photos.forEach((config, index) => {
      const gallery = galleries.find((g) => g.slug === config.gallery);
      if (gallery) {
        const photo = gallery.photos.find((p) => p.filename === config.filename);
        if (photo && !photo.hidden) {
          homePhotos.push({
            ...photo,
            gallerySlug: gallery.slug,
            galleryTitle: gallery.title,
            homeIndex: index,
          });
        }
      }
    });
  } else {
    // Default: 4 photos per gallery
    let index = 0;
    galleries.forEach((g) => {
      g.photos
        .filter((p) => !p.hidden)
        .slice(0, 4)
        .forEach((p) => {
          homePhotos.push({
            ...p,
            gallerySlug: g.slug,
            galleryTitle: g.title,
            homeIndex: index++,
          });
        });
    });
  }

  return json({
    navigation,
    photos: homePhotos,
    siteName: "Victoriano Izquierdo", // TODO: Make configurable
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
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
        {photos.map((photo) => (
          <PhotoItem
            key={`${photo.gallerySlug}-${photo.id}-${photo.homeIndex}`}
            src={`/api/local-images/${photo.path}`}
            alt={photo.title || photo.filename}
            aspectRatio="auto"
            href={`/featured/${photo.homeIndex}`}
          />
        ))}
      </PhotoGrid>
    </Layout>
  );
}
