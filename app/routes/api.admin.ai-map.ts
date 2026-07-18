import { json } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getPhotoAiMap } from "~/lib/ai/photo-ai-service.server";
import { checkAdminAuth } from "~/utils/admin-auth";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  try {
    return json(await getPhotoAiMap(context));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the photo map";
    console.error("[Photo AI Map]", error);
    return json({ error: message }, { status: 500 });
  }
}
