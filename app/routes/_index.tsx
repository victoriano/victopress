/**
 * Home Page
 * 
 * Main portfolio page with sidebar navigation and photo grid
 * Photos are loaded from the pre-calculated content index for fast performance.
 * Custom selection can be configured via content/home.yaml
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json, redirect } from "@remix-run/cloudflare";
import { getStorage, needsSetup, getNavigationFromIndex, getHomePhotosFromIndex } from "~/lib/content-engine";
import { Layout, PhotoGrid, PhotoItem } from "~/components/Layout";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import yaml from "js-yaml";

interface HomeConfig {
  photos?: Array<{
    gallery: string;
    filename: string;
  }>;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return generateMetaTags({
    title: data?.siteName || "VictoPress - Photo Portfolio",
    description: data?.siteDescription || "A curated photography portfolio",
    url: data?.canonicalUrl,
    image: data?.ogImage,
    imageAlt: data?.siteName || "VictoPress",
    type: "website",
    siteName: data?.siteName || "VictoPress",
  });
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  // Check if setup is needed (production + not configured)
  if (needsSetup(context)) {
    return redirect("/setup");
  }
  
  const baseUrl = getBaseUrl(request);
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

  const siteName = "Victoriano Izquierdo"; // TODO: Make configurable
  const siteDescription = "Photography portfolio showcasing travel, street, and portrait photography";
  const canonicalUrl = baseUrl;
  // Use first photo as OG image if available
  const ogImage = homePhotos.length > 0 
    ? buildImageUrl(baseUrl, homePhotos[0].path) 
    : undefined;

  return json({
    navigation,
    photos: homePhotos,
    siteName,
    siteDescription,
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
