import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getSimilarPhotoDocuments } from "~/lib/ai/photo-ai-service.server";
import { getOptimizedImageUrl } from "~/utils/image-optimization";

function photoHref(gallerySlug: string, filename: string): string {
  const gallery = gallerySlug.split("/").map(encodeURIComponent).join("/");
  return `/photo/${gallery}/${encodeURIComponent(filename)}`;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path")?.trim();
  if (!path || !path.startsWith("galleries/")) {
    return json({ error: "Missing or invalid photo path" }, { status: 400 });
  }
  const limit = Math.min(16, Math.max(1, Number(url.searchParams.get("limit")) || 8));

  try {
    const matches = await getSimilarPhotoDocuments(context, path, limit);
    return json({
      photos: matches.map(({ document, score }) => ({
        assetId: document.assetId,
        path: document.path,
        filename: document.filename,
        title: document.title || document.caption,
        gallerySlug: document.gallerySlug,
        galleryTitle: document.galleryTitle,
        score,
        thumbnailUrl: getOptimizedImageUrl(document.path, { width: 800 }),
        href: photoHref(document.gallerySlug, document.filename),
      })),
    }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" },
    });
  } catch (error) {
    console.error("[Photo AI] Similar photos failed", error);
    // Similarity is an enhancement; an unbuilt index should not break photo pages.
    return json({ photos: [] }, { status: 200 });
  }
}
