/**
 * API - Upload Image Variant
 * 
 * POST /api/admin/upload-variant
 * 
 * Receives WebP variants generated in the browser and saves them to storage.
 * Updates the optimization index to mark the original image as optimized.
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage } from "~/lib/content-engine";

// Optimization index file path (same as in api.admin.optimize.ts)
const OPTIMIZATION_INDEX_FILE = ".optimization-index.json";
const CURRENT_VARIANT_WIDTHS = [800, 1600, 2400];

interface OptimizationIndex {
  version: number;
  variantWidths: number[];
  optimizedImages: string[];
  lastUpdated: string;
}

async function getOptimizationIndex(
  storage: ReturnType<typeof getStorage>
): Promise<OptimizationIndex | null> {
  try {
    const data = await storage.get(OPTIMIZATION_INDEX_FILE);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as OptimizationIndex;
  } catch {
    return null;
  }
}

async function saveOptimizationIndex(
  storage: ReturnType<typeof getStorage>,
  index: OptimizationIndex
): Promise<void> {
  const jsonStr = JSON.stringify(index);
  await storage.put(
    OPTIMIZATION_INDEX_FILE,
    new TextEncoder().encode(jsonStr),
    "application/json"
  );
}

async function markImageOptimized(
  storage: ReturnType<typeof getStorage>,
  imagePath: string
): Promise<void> {
  let index = await getOptimizationIndex(storage);
  if (!index) {
    index = {
      version: 1,
      variantWidths: [...CURRENT_VARIANT_WIDTHS],
      optimizedImages: [],
      lastUpdated: new Date().toISOString(),
    };
  }
  if (!index.optimizedImages.includes(imagePath)) {
    index.optimizedImages.push(imagePath);
    index.lastUpdated = new Date().toISOString();
    await saveOptimizationIndex(storage, index);
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  // Check admin auth
  checkAdminAuth(request, context.cloudflare?.env || {});

  const storage = getStorage(context);
  const formData = await request.formData();

  const file = formData.get("file") as File | null;
  const variantPath = formData.get("path") as string | null;
  const originalPath = formData.get("originalPath") as string | null;

  if (!file || !variantPath || !originalPath) {
    return json(
      { success: false, error: "Missing required fields: file, path, originalPath" },
      { status: 400 }
    );
  }

  try {
    // Save the variant file
    const buffer = await file.arrayBuffer();
    await storage.put(variantPath, buffer, "image/webp");

    // Mark original as optimized (we'll do this once per original, not per variant)
    // The caller should only call markImageOptimized after all variants are uploaded
    const shouldMarkOptimized = formData.get("markOptimized") === "true";
    if (shouldMarkOptimized) {
      await markImageOptimized(storage, originalPath);
    }

    console.log(`[Upload Variant] Saved ${variantPath} (${Math.round(buffer.byteLength / 1024)}KB)`);

    return json({
      success: true,
      path: variantPath,
      size: buffer.byteLength,
    });
  } catch (error) {
    console.error("[Upload Variant] Error:", error);
    return json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
