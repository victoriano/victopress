import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  enqueuePhotoMetadataWritebacks,
  getPhotoMetadataWritebackStatus,
  processPhotoMetadataWritebackBatch,
} from "~/lib/ai/photo-metadata-writeback.server";
import { getContentIndex, getStorage } from "~/lib/content-engine";
import { checkAdminAuth } from "~/utils/admin-auth";

const BACKFILL_BATCH_SIZE = 12;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  return json(await getPhotoMetadataWritebackStatus(context));
}

export async function action({ request, context }: ActionFunctionArgs) {
  await checkAdminAuth(request, context);
  const formData = await request.formData();
  const actionType = String(formData.get("action") ?? "process-batch");

  try {
    if (actionType === "process-batch") {
      const result = await processPhotoMetadataWritebackBatch(context, BACKFILL_BATCH_SIZE);
      return json({ success: true, ...result });
    }

    if (actionType === "backfill-batch") {
      const offsetValue = Number(formData.get("offset") ?? 0);
      const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
      const content = await getContentIndex(getStorage(context));
      const paths = Array.from(new Set(content.galleryData.flatMap((gallery) =>
        gallery.photos
          .filter((photo) => !photo.isReference)
          .map((photo) => photo.path),
      ))).sort((left, right) => left.localeCompare(right));
      const batch = paths.slice(offset, offset + BACKFILL_BATCH_SIZE);
      const queued = await enqueuePhotoMetadataWritebacks(context, batch, "backfill");
      const nextOffset = offset + batch.length;
      return json({
        success: true,
        queued: queued.queued,
        offset,
        nextOffset,
        total: paths.length,
        done: nextOffset >= paths.length,
      });
    }

    return json({ success: false, error: "Unknown metadata writeback action" }, { status: 400 });
  } catch (error) {
    console.error("[Metadata Writeback]", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Metadata writeback failed",
    }, { status: 500 });
  }
}
