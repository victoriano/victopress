import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isPhotoAiEnabled, searchPhotoDocuments } from "~/lib/ai/photo-ai-service.server";
import { getOptimizedImageUrl } from "~/utils/image-optimization";

function photoHref(gallerySlug: string, filename: string): string {
  const gallery = gallerySlug.split("/").map(encodeURIComponent).join("/");
  return `/photo/${gallery}/${encodeURIComponent(filename)}`;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (!isPhotoAiEnabled(context)) {
    return json({ error: "Photo AI is disabled" }, { status: 404 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return json({ error: "Search query must contain at least two characters" }, { status: 400 });
  }
  const gallerySlug = url.searchParams.get("gallery")?.trim() || undefined;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  try {
    const results = await searchPhotoDocuments(context, query, { gallerySlug, limit });
    return json({
      query,
      galleries: results.galleries,
      photos: results.photos.map(({ document, score }) => ({
        assetId: document.assetId,
        path: document.path,
        filename: document.filename,
        title: document.title || document.caption,
        caption: document.caption,
        gallerySlug: document.gallerySlug,
        galleryTitle: document.galleryTitle,
        score,
        thumbnailUrl: getOptimizedImageUrl(document.path, { width: 800 }),
        href: photoHref(document.gallerySlug, document.filename),
        tags: document.tags,
      })),
    }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
    });
  } catch (error) {
    console.error("[Photo AI] Search failed", error);
    const message = error instanceof Error && /not configured/i.test(error.message)
      ? "Semantic search is not configured"
      : "Photo search is temporarily unavailable";
    return json({ error: message }, { status: 503 });
  }
}
