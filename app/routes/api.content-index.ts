/**
 * API - Content Index Management
 * 
 * POST /api/content-index
 *   action: "rebuild-index" - Rebuild using EXIF cache (fast)
 *   action: "rebuild-index-full" - Full rebuild, re-read all EXIF (slow)
 *   action: "invalidate" - Clear the index (next read will rebuild)
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage, rebuildContentIndex, invalidateContentIndex } from "~/lib/content-engine";

export async function action({ request, context }: ActionFunctionArgs) {
  // Require admin authentication
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const action = formData.get("action") as string;
  
  const storage = getStorage(context, request);
  
  switch (action) {
    case "rebuild-index":
    case "rebuild-index-full": {
      const skipCache = action === "rebuild-index-full";
      const startTime = Date.now();
      
      try {
        const index = await rebuildContentIndex(storage, skipCache);
        const rebuildTime = Date.now() - startTime;
        
        return json({
          success: true,
          message: skipCache
            ? `Full rebuild complete! Re-scanned EXIF from all ${index.stats.totalPhotos} photos in ${rebuildTime}ms.`
            : `Index rebuilt in ${rebuildTime}ms. Found ${index.stats.totalGalleries} galleries, ${index.stats.totalPhotos} photos.`,
          rebuildTime,
          stats: index.stats,
          updatedAt: index.updatedAt,
          fullRebuild: skipCache,
        });
      } catch (error) {
        console.error("Failed to rebuild index:", error);
        return json({
          success: false,
          message: `Failed to rebuild index: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }
    
    case "invalidate": {
      try {
        await invalidateContentIndex(storage);
        return json({
          success: true,
          message: "Index invalidated. It will be rebuilt on next access.",
        });
      } catch (error) {
        console.error("Failed to invalidate index:", error);
        return json({
          success: false,
          message: `Failed to invalidate index: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }
    
    default:
      return json({
        success: false,
        message: `Unknown action: ${action}`,
      }, { status: 400 });
  }
}
