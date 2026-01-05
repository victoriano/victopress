/**
 * R2 Image Server
 * 
 * Serves images from R2 storage when using cloud storage adapter.
 * Falls back to local filesystem if R2 is not available.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isImageFile, getStorage } from "~/lib/content-engine";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const imagePath = params["*"];
  
  if (!imagePath) {
    return new Response("Not Found", { status: 404 });
  }

  // Decode the path (segments might be URL-encoded)
  const decodedPath = imagePath.split("/").map(segment => decodeURIComponent(segment)).join("/");

  // Get the filename for extension check
  const filename = decodedPath.split("/").pop() || decodedPath;
  
  // Security: only serve image files
  if (!isImageFile(filename)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const storage = getStorage(context, request);
    
    // Get the image from storage
    const buffer = await storage.get(decodedPath);
    
    if (!buffer) {
      return new Response("Not Found", { status: 404 });
    }
    
    // Determine content type
    const ext = filename.toLowerCase().split('.').pop() || '';
    const contentTypes: Record<string, string> = {
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "png": "image/png",
      "gif": "image/gif",
      "webp": "image/webp",
      "avif": "image/avif",
      "svg": "image/svg+xml",
    };
    
    return new Response(buffer, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to serve image:", decodedPath, error);
    return new Response("Not Found", { status: 404 });
  }
}
