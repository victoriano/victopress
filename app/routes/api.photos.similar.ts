import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getSimilarPhotoDocuments } from "~/lib/ai/photo-ai-service.server";
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
  const path = url.searchParams.get("path")?.trim();
  if (!path || !path.startsWith("galleries/")) {
    return json({ error: locale === "es" ? "Falta una ruta de foto válida" : "Missing or invalid photo path" }, { status: 400 });
  }
  const limit = Math.min(16, Math.max(1, Number(url.searchParams.get("limit")) || 8));

  try {
    const [matches, localizedGalleries] = await Promise.all([
      getSimilarPhotoDocuments(context, path, limit),
      getAllGalleriesFromIndex(getStorage(context), locale),
    ]);
    const galleryTitles = new Map(localizedGalleries.map((gallery) => [gallery.slug, gallery.title]));
    const photosByPath = new Map(
      localizedGalleries.flatMap((gallery) => gallery.photos.map((photo) => [photo.path, photo] as const)),
    );
    return json({
      photos: matches.map(({ document, score }) => {
        const localizedPhoto = photosByPath.get(document.path);
        return {
          assetId: document.assetId,
          path: document.path,
          filename: document.filename,
          title: localizedPhoto?.title || document.title || document.caption,
          gallerySlug: document.gallerySlug,
          galleryTitle: galleryTitles.get(document.gallerySlug) || document.galleryTitle,
          score,
          thumbnailUrl: getOptimizedImageUrl(document.path, { width: 800 }),
          href: localizedPath(locale, photoHref(document.gallerySlug, document.filename)),
        };
      }),
    }, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400",
        "Content-Language": locale,
        Vary: "Accept-Language",
      },
    });
  } catch (error) {
    console.error("[Photo AI] Similar photos failed", error);
    // Similarity is an enhancement; an unbuilt index should not break photo pages.
    return json({ photos: [] }, {
      status: 200,
      headers: { "Content-Language": locale, Vary: "Accept-Language" },
    });
  }
}
