/**
 * API Route: Photos
 * 
 * GET /api/photos?tag=street
 * Returns photos filtered by tag
 */

import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  scanGalleries,
  filterPhotosByTag,
  getStorage,
} from "~/lib/content-engine";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const storage = getStorage(context);
  
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag");
  
  if (!tag) {
    return json(
      { error: "Missing 'tag' query parameter" },
      { status: 400 }
    );
  }
  
  try {
    const galleries = await scanGalleries(storage);
    const photos = filterPhotosByTag(galleries, tag);
    
    return json({ 
      tag,
      count: photos.length,
      photos,
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch (error) {
    console.error("Failed to filter photos:", error);
    return json(
      { error: "Failed to load photos" },
      { status: 500 }
    );
  }
}
