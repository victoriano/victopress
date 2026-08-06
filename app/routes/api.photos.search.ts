import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isPhotoAiEnabled, searchPhotoDocuments } from "~/lib/ai/photo-ai-service.server";
import { getAllGalleriesFromIndex, getStorage } from "~/lib/content-engine";
import {
  DEFAULT_LOCALE,
  localizedPath,
  normalizeLocale,
  parseAcceptLanguage,
  photoMessages,
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
  const messages = photoMessages[locale];
  if (!isPhotoAiEnabled(context)) {
    return json({ error: locale === "es" ? "La búsqueda fotográfica está desactivada" : "Photo search is disabled" }, { status: 404 });
  }
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return json({ error: locale === "es" ? "La búsqueda debe tener al menos dos caracteres" : "Search query must contain at least two characters" }, { status: 400 });
  }
  const gallerySlug = url.searchParams.get("gallery")?.trim() || undefined;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  try {
    const [results, localizedGalleries] = await Promise.all([
      searchPhotoDocuments(context, query, { gallerySlug, limit }),
      getAllGalleriesFromIndex(getStorage(context), locale),
    ]);
    const publicGalleries = localizedGalleries.filter(
      (gallery) => !gallery.isProtected && !gallery.isParentGallery,
    );
    const galleryTitles = new Map(publicGalleries.map((gallery) => [gallery.slug, gallery.title]));
    const photosByPath = new Map(
      publicGalleries.flatMap((gallery) =>
        gallery.photos
          .filter((photo) => !photo.hidden)
          .map((photo) => [photo.path, photo] as const),
      ),
    );
    return json({
      query,
      mode: results.mode,
      galleries: results.galleries.map((gallery) => ({
        ...gallery,
        title: galleryTitles.get(gallery.slug) || gallery.title,
      })),
      photos: results.photos.map(({ document, score }) => {
        const localizedPhoto = photosByPath.get(document.path);
        return {
          assetId: document.assetId,
          path: document.path,
          filename: document.filename,
          title: localizedPhoto?.title || document.title || document.caption,
          caption: localizedPhoto?.description || document.caption,
          gallerySlug: document.gallerySlug,
          galleryTitle: galleryTitles.get(document.gallerySlug) || document.galleryTitle,
          score,
          thumbnailUrl: getOptimizedImageUrl(document.path, { width: 800 }),
          href: localizedPath(locale, photoHref(document.gallerySlug, document.filename)),
          // Keep the same AI/editorial search tags used by the embedding map so
          // Explore filters behave identically in graph and grid views.
          tags: document.tags,
        };
      }),
    }, {
      headers: {
        "Cache-Control": results.mode === "semantic"
          ? "public, max-age=60, s-maxage=3600"
          : "public, max-age=15, s-maxage=60",
        "Content-Language": locale,
        "X-Photo-Search-Mode": results.mode,
        Vary: "Accept-Language",
      },
    });
  } catch (error) {
    console.error("[Photo AI] Search failed", error);
    const message = error instanceof Error && /not configured/i.test(error.message)
      ? locale === "es" ? "La búsqueda semántica no está configurada" : "Semantic search is not configured"
      : messages.searchUnavailable;
    return json({ error: message }, { status: 503 });
  }
}
