/**
 * Local Image Server
 * 
 * Serves images from the local filesystem during development.
 * In production, images are served directly from R2.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isImageFile } from "~/lib/content-engine";

export async function loader({ params }: LoaderFunctionArgs) {
  const imagePath = params["*"];
  
  if (!imagePath) {
    return new Response("Not Found", { status: 404 });
  }

  // Get the filename for extension check
  const filename = imagePath.split("/").pop() || imagePath;
  
  // Security: only serve image files
  if (!isImageFile(filename)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    
    // The path might include "galleries/folder/file.jpg"
    // We need to resolve it relative to content folder
    const fullPath = nodePath.join(process.cwd(), "content", imagePath);
    
    // Security: prevent directory traversal
    const resolved = nodePath.resolve(fullPath);
    const contentDir = nodePath.resolve(process.cwd(), "content");
    
    if (!resolved.startsWith(contentDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    const buffer = await fs.readFile(resolved);
    
    // Determine content type
    const ext = nodePath.extname(imagePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".svg": "image/svg+xml",
    };
    
    return new Response(buffer, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to serve image:", imagePath, error);
    return new Response("Not Found", { status: 404 });
  }
}
