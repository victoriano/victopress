/**
 * R2 Image Server
 * 
 * Serves images from R2 storage when using cloud storage adapter.
 * Falls back to local filesystem if R2 is not available.
 * 
 * Features:
 * - ETag-based caching for efficient revalidation
 * - Immutable cache headers for long-term browser caching
 * - Content-Type detection based on file extension
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isImageFile, getStorage } from "~/lib/content-engine";

/**
 * Generate a simple hash for ETag
 * Uses file path + size as a quick fingerprint
 */
function generateETag(path: string, size: number): string {
  // Simple hash based on path and size
  const hash = `${path}-${size}`.split("").reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `"${Math.abs(hash).toString(16)}"`;
}

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
    
    // Generate ETag for caching
    const etag = generateETag(decodedPath, buffer.byteLength);
    
    // Check for conditional request (If-None-Match)
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          "ETag": etag,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
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
        "ETag": etag,
        // Allow browser to cache and revalidate
        "Vary": "Accept-Encoding",
      },
    });
  } catch (error) {
    console.error("Failed to serve image:", decodedPath, error);
    return new Response("Not Found", { status: 404 });
  }
}
