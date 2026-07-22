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
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import yaml from "js-yaml";
import { localizedPath } from "~/lib/i18n";
import { localizedAlternates, requireRouteLocale } from "~/lib/i18n.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";

export { mergeLocalizedRouteHeaders as headers } from "~/lib/i18n.server";

interface HomeConfig {
  photos?: Array<{
    gallery: string;
    filename: string;
  }>;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const tags = generateMetaTags({
    title: data?.siteName || "VictoPress - Photo Portfolio",
    description: data?.siteDescription || "A curated photography portfolio",
    url: data?.canonicalUrl,
    image: data?.ogImage,
    imageAlt: data?.siteName || "VictoPress",
    type: "website",
    siteName: data?.siteName || "VictoPress",
  });
  if (!data?.alternates) return tags;
  return [
    ...tags,
    ...(data.alternates.es ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "es", href: data.alternates.es }] : []),
    ...(data.alternates.en ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "en", href: data.alternates.en }] : []),
    ...(data.alternates.xDefault ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "x-default", href: data.alternates.xDefault }] : []),
  ];
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  // Check if setup is needed (production + not configured)
  if (needsSetup(context)) {
    return redirect("/setup");
  }
  
  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context, request);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const locale = requireRouteLocale(request, params.locale, siteLanguages);
  
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

  const siteName = "Victoriano Izquierdo"; // TODO: Make configurable
  const siteDescription = locale === "es"
    ? "Archivo fotográfico de viajes, calle y retratos"
    : "Photography archive spanning travel, street life and portraiture";
  const alternates = localizedAlternates(request, locale, "/", siteLanguages);
  const canonicalUrl = alternates.canonical;
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

export default function Index() {
  const { navigation, photos, siteName, socialLinks, locale } = useLoaderData<typeof loader>();

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      locale={locale}
    >
      {/* Mobile Navigation Breadcrumb */}
      <GalleryBreadcrumb navigation={navigation} locale={locale} />
      
      <PhotoGrid>
        {photos.map((photo, index) => (
          <PhotoItem
            key={`${photo.gallerySlug}-${photo.id}-${photo.homeIndex}`}
            src={`/api/images/${photo.path}`}
            alt={photo.title || photo.filename}
            width={photo.width}
            height={photo.height}
            aspectRatio="3:2"
            href={localizedPath(locale, `/featured/${photo.homeIndex}`)}
            priority={index === 0}
          />
        ))}
      </PhotoGrid>
    </Layout>
  );
}
