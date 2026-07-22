import { json } from "@remix-run/cloudflare";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  getPhotoAiDashboard,
  processPhotoAiJobBatch,
  retryPhotoAiAsset,
  reviewPhotoGallerySuggestion,
  startPhotoAiJob,
} from "~/lib/ai/photo-ai-service.server";
import { checkAdminAuth } from "~/utils/admin-auth";
import { assignPhotosToGalleryInIndex, getStorage } from "~/lib/content-engine";
import { enqueuePhotoMetadataWritebacks } from "~/lib/ai/photo-metadata-writeback.server";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Photo AI operation failed";
  const status = /not configured/i.test(message) ? 503 : 400;
  console.error("[Photo AI]", error);
  return json({ success: false, error: message }, { status });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  try {
    return json(await getPhotoAiDashboard(context));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  await checkAdminAuth(request, context);
  const formData = await request.formData();
  const actionType = String(formData.get("action") ?? "status");

  try {
    if (actionType === "status") {
      return json(await getPhotoAiDashboard(context));
    }

    if (actionType === "start") {
      const result = await startPhotoAiJob(context);
      return json({
        success: true,
        ...result,
        message: result.done
          ? "All eligible photos already have current AI data."
          : `Queued ${result.remaining} photos for analysis.`,
      });
    }

    if (actionType === "process-batch") {
      const result = await processPhotoAiJobBatch(context, 2);
      return json({
        success: true,
        ...result,
        message: result.done
          ? "Photo analysis finished."
          : `Processed ${result.processed} photos; ${result.remaining} remain.`,
      });
    }

    if (actionType === "analyze-photo") {
      const assetId = String(formData.get("assetId") ?? "").trim();
      if (!assetId) return json({ success: false, error: "Missing assetId" }, { status: 400 });
      await retryPhotoAiAsset(context, assetId);
      return json({ success: true, message: "Photo analysis completed." });
    }

    if (actionType === "review-suggestion") {
      const assetId = String(formData.get("assetId") ?? "").trim();
      const gallerySlug = String(formData.get("gallerySlug") ?? "").trim();
      const decision = String(formData.get("decision") ?? "");
      if (!assetId || !gallerySlug || (decision !== "accepted" && decision !== "rejected")) {
        return json({ success: false, error: "Invalid suggestion review" }, { status: 400 });
      }
      await reviewPhotoGallerySuggestion(context, assetId, gallerySlug, decision);
      return json({
        success: true,
        message: decision === "accepted"
          ? "Gallery suggestion accepted. No photo was moved or published."
          : "Gallery suggestion rejected.",
      });
    }

    if (actionType === "assign-gallery") {
      const gallerySlug = String(formData.get("gallerySlug") ?? "").trim();
      const photoPaths = formData.getAll("photoPaths").map((value) => String(value));
      if (!gallerySlug || photoPaths.length === 0) {
        return json(
          { success: false, error: "Choose photos and a destination gallery" },
          { status: 400 },
        );
      }
      const result = await assignPhotosToGalleryInIndex(
        getStorage(context),
        photoPaths,
        gallerySlug,
      );
      if (result.added > 0) {
        await enqueuePhotoMetadataWritebacks(
          context,
          photoPaths,
          "gallery-membership",
        );
      }
      return json(result, { status: result.success ? 200 : 400 });
    }

    return json({ success: false, error: "Unknown Photo AI action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
