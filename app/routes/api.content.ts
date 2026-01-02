/**
 * API Route: Content Index
 * 
 * GET /api/content
 * Returns the full content index (galleries, posts, tags)
 */

import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { generateContentIndex, getStorage } from "~/lib/content-engine";

export async function loader({ context }: LoaderFunctionArgs) {
  const storage = getStorage(context);
  
  try {
    const index = await generateContentIndex(storage);
    
    return json(index, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch (error) {
    console.error("Failed to generate content index:", error);
    return json(
      { error: "Failed to load content" },
      { status: 500 }
    );
  }
}
