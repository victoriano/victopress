/**
 * Cloudflare Image Resizing Handler
 * 
 * This route handles /cdn-cgi/image/* URLs.
 * 
 * In PRODUCTION (Cloudflare Pages/Workers):
 *   - This route is never hit - Cloudflare intercepts /cdn-cgi/* at the edge
 *   - Images are resized, optimized, and cached by Cloudflare
 * 
 * In DEVELOPMENT (localhost):
 *   - This route intercepts CFI URLs and serves the original image
 *   - No resizing happens, but URLs work consistently
 *   - Allows testing with the same URL structure as production
 * 
 * URL format: /cdn-cgi/image/width=800,quality=85,format=auto/api/images/path/to/image.jpg
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isImageFile, getStorage } from "~/lib/content-engine";

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const path = params["*"];
  
  if (!path) {
    return new Response("Not Found", { status: 404 });
  }

  // Parse the CFI URL format: options/original-path
  // Example: width=800,quality=85,format=auto/api/images/galleries/path/image.jpg
  const firstSlashIndex = path.indexOf("/");
  if (firstSlashIndex === -1) {
    return new Response("Invalid CFI URL format", { status: 400 });
  }

  const options = path.substring(0, firstSlashIndex);
  let originalPath = path.substring(firstSlashIndex + 1);

  // Log the CFI request in development
  console.log(`[CFI Dev] Handling: /${options}/${originalPath.substring(0, 50)}...`);

  // Extract the actual image path from /api/images/...
  if (originalPath.startsWith("api/images/")) {
    originalPath = originalPath.substring("api/images/".length);
  } else if (originalPath.startsWith("/api/images/")) {
    originalPath = originalPath.substring("/api/images/".length);
  }

  // Decode URL-encoded segments
  const decodedPath = originalPath
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");

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
      console.error(`[CFI Dev] Image not found: ${decodedPath}`);
      return new Response("Not Found", { status: 404 });
    }

    // Determine content type
    const ext = filename.toLowerCase().split(".").pop() || "";
    const contentTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      svg: "image/svg+xml",
    };

    // In development, we can't resize, but we can at least serve the image
    // Parse width from options for logging
    const widthMatch = options.match(/width=(\d+)/);
    const requestedWidth = widthMatch ? parseInt(widthMatch[1]) : null;
    
    if (requestedWidth) {
      console.log(`[CFI Dev] Serving original (requested w=${requestedWidth}): ${filename}`);
    }

    return new Response(buffer, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        // Indicate this is a dev fallback
        "X-CFI-Dev-Mode": "true",
      },
    });
  } catch (error) {
    console.error("[CFI Dev] Failed to serve image:", decodedPath, error);
    return new Response("Not Found", { status: 404 });
  }
}
