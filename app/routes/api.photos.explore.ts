import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  getPublicPhotoAiMap,
  isPhotoAiEnabled,
} from "~/lib/ai/photo-ai-service.server";
import { getAllGalleriesFromIndex, getStorage } from "~/lib/content-engine";
import {
  DEFAULT_LOCALE,
  localizedPath,
  normalizeLocale,
  parseAcceptLanguage,
} from "~/lib/i18n";
import { getOptimizedImageUrl } from "~/utils/image-optimization";

function photoHref(gallerySlug: string, filename: string): string {
  const gallery = gallerySlug.split("/").map(encodeURIComponent).join("/");
  return `/photo/${gallery}/${encodeURIComponent(filename)}`;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const locale =
    normalizeLocale(url.searchParams.get("locale")) ||
    parseAcceptLanguage(request.headers.get("Accept-Language")) ||
    DEFAULT_LOCALE;

  if (!isPhotoAiEnabled(context)) {
    return json(
      { error: locale === "es" ? "La exploración fotográfica está desactivada" : "Photo exploration is disabled" },
      { status: 404 },
    );
  }

  try {
    const [map, localizedGalleries] = await Promise.all([
      getPublicPhotoAiMap(context),
      getAllGalleriesFromIndex(getStorage(context, request), locale),
    ]);
    const publicGalleries = localizedGalleries.filter(
      (gallery) => !gallery.isProtected && !gallery.isParentGallery,
    );
    const galleriesBySlug = new Map(
      publicGalleries.map((gallery) => [gallery.slug, gallery]),
    );
    const photosByPath = new Map(
      publicGalleries.flatMap((gallery) =>
        gallery.photos
          .filter((photo) => !photo.hidden)
          .map((photo) => [photo.path, photo] as const),
      ),
    );

    return json({
      ...map,
      galleries: map.galleries.map((gallery) => ({
        ...gallery,
        title: galleriesBySlug.get(gallery.slug)?.title || gallery.title,
      })),
      nodes: map.nodes.map((node) => {
        const photo = photosByPath.get(node.path);
        const gallery = galleriesBySlug.get(node.gallerySlug);
        return {
          ...node,
          title: photo?.title,
          caption: photo?.description || node.caption,
          galleryTitle: gallery?.title || node.gallerySlug,
          galleryTitles: node.gallerySlugs.map(
            (slug) => galleriesBySlug.get(slug)?.title || slug,
          ),
          thumbnailUrl: getOptimizedImageUrl(node.path, { width: 800 }),
          href: localizedPath(locale, photoHref(node.gallerySlug, node.filename)),
        };
      }),
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=3600",
        "Content-Language": locale,
        Vary: "Accept-Language",
      },
    });
  } catch (error) {
    console.error("[Photo Explore] Could not build the public photo map", error);
    return json(
      { error: locale === "es" ? "No se ha podido cargar el mapa fotográfico" : "The photo map could not be loaded" },
      { status: 503 },
    );
  }
}
