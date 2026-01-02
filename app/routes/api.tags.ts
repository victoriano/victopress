/**
 * API Route: Tags
 * 
 * GET /api/tags
 * Returns all tags with counts
 */

import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  scanGalleries,
  scanBlog,
  buildTagIndex,
  getStorage,
} from "~/lib/content-engine";

export async function loader({ context }: LoaderFunctionArgs) {
  const storage = getStorage(context);
  
  try {
    const [galleries, posts] = await Promise.all([
      scanGalleries(storage),
      scanBlog(storage),
    ]);
    
    const tags = buildTagIndex(galleries, posts);
    
    return json({ tags }, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch (error) {
    console.error("Failed to build tag index:", error);
    return json(
      { error: "Failed to load tags" },
      { status: 500 }
    );
  }
}
