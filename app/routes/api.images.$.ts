/**
 * R2 Image Server
 * 
 * Serves images from R2 storage when using cloud storage adapter.
 * Falls back to local filesystem if R2 is not available.
 * 
 * Features:
 * - ETag-based caching for efficient revalidation
 * - Immutable cache headers for long-term browser caching
 * - Content-Type detection based on the image's actual bytes
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isImageFile, getStorage } from "~/lib/content-engine";
import { detectImageContentType } from "~/lib/image-content-type";

type RuntimeCacheContext = {
  cloudflare?: {
    caches?: { default?: Cache };
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
};

function getRuntimeCache(context: unknown): Cache | undefined {
  const contextCache = (context as RuntimeCacheContext).cloudflare?.caches?.default;
  if (contextCache) return contextCache;

  if (typeof caches !== "undefined") {
    return (caches as unknown as { default?: Cache }).default;
  }

  return undefined;
}

function scheduleCacheWrite(context: unknown, cacheWrite: Promise<unknown>): void {
  const runtimeContext = context as RuntimeCacheContext;
  const waitUntil = runtimeContext.cloudflare?.ctx?.waitUntil;

  if (typeof waitUntil === "function") {
    waitUntil.call(runtimeContext.cloudflare?.ctx, cacheWrite);
    return;
  }

  // Vite development does not always expose an ExecutionContext. Cache
  // failures must never turn a valid image response into a 5xx.
  void cacheWrite.catch(() => undefined);
}

/**
 * Generate a simple hash for ETag
 * Uses file path + size + detected MIME type as a quick fingerprint
 */
function generateETag(path: string, size: number, contentType: string): string {
  // Simple hash based on path and size
  const hash = `${path}-${size}-${contentType}`.split("").reduce((acc, char) => {
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
    const runtimeCache = getRuntimeCache(context);
    const cacheKey = new Request(request.url, { method: "GET" });

    if (runtimeCache) {
      try {
        const cached = await runtimeCache.match(cacheKey);
        if (cached) {
          const cachedEtag = cached.headers.get("ETag");
          if (cachedEtag && request.headers.get("If-None-Match") === cachedEtag) {
            return new Response(null, {
              status: 304,
              headers: {
                "ETag": cachedEtag,
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-VictoPress-Image-Cache": "HIT",
              },
            });
          }

          const headers = new Headers(cached.headers);
          headers.set("X-VictoPress-Image-Cache", "HIT");
          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
      } catch {
        // R2/local storage remains the source of truth when Cache API is absent.
      }
    }

    const storage = getStorage(context, request);
    
    // Get the image from storage
    const buffer = await storage.get(decodedPath);
    
    if (!buffer) {
      return new Response("Not Found", { status: 404 });
    }
    
    const contentType = detectImageContentType(buffer, filename);

    // Include the detected MIME type so an old extension-derived ETag cannot
    // keep stale response metadata after a hard refresh or revalidation.
    const etag = generateETag(decodedPath, buffer.byteLength, contentType);
    
    // Check for conditional request (If-None-Match)
    const ifNoneMatch = request.headers.get("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          "ETag": etag,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Vary": "Accept-Encoding",
        },
      });
    }

    const response = new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cloudflare-CDN-Cache-Control": "public, max-age=31536000, immutable",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Vary": "Accept-Encoding",
        "X-VictoPress-Image-Cache": "MISS",
      },
    });

    if (runtimeCache) {
      scheduleCacheWrite(
        context,
        runtimeCache.put(cacheKey, response.clone()).catch(() => undefined),
      );
    }

    return response;
  } catch (error) {
    console.error("Failed to serve image:", decodedPath, error);
    return new Response("Not Found", { status: 404 });
  }
}
