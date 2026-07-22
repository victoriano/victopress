import { parse, stringify } from "yaml";
import type { StorageAdapter } from "./types";

export const GALLERY_ORDERS_KEY = "gallery-orders.yaml";
const GALLERY_ORDERS_VERSION = 1 as const;

interface GalleryOrdersFile {
  version: typeof GALLERY_ORDERS_VERSION;
  updatedAt: string;
  orders: Record<string, string[]>;
}

function normalizeOrders(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, string[]> = {};
  for (const [rawSlug, rawPaths] of Object.entries(value)) {
    const slug = rawSlug.trim();
    if (!slug || !Array.isArray(rawPaths)) continue;
    const paths = Array.from(
      new Set(
        rawPaths
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    if (paths.length > 0) result[slug] = paths;
  }
  return result;
}

export async function readGalleryOrders(
  storage: StorageAdapter,
): Promise<Record<string, string[]>> {
  const raw = await storage.getText(GALLERY_ORDERS_KEY);
  if (!raw) return {};

  try {
    const parsed = parse(raw) as Partial<GalleryOrdersFile> | null;
    if (!parsed || parsed.version !== GALLERY_ORDERS_VERSION) return {};
    return normalizeOrders(parsed.orders);
  } catch (error) {
    throw new Error(
      `Could not read ${GALLERY_ORDERS_KEY}: ${error instanceof Error ? error.message : "invalid YAML"}`,
    );
  }
}

async function writeGalleryOrders(
  storage: StorageAdapter,
  orders: Record<string, string[]>,
): Promise<void> {
  const normalized = Object.fromEntries(
    Object.entries(normalizeOrders(orders)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const file: GalleryOrdersFile = {
    version: GALLERY_ORDERS_VERSION,
    updatedAt: new Date().toISOString(),
    orders: normalized,
  };
  await storage.put(GALLERY_ORDERS_KEY, stringify(file), "text/yaml");
}

/** Keeps cross-gallery order references valid when physical photo paths move. */
export async function moveGalleryOrderPaths(
  storage: StorageAdapter,
  moves: ReadonlyArray<{ from: string; to: string }>,
): Promise<void> {
  if (moves.length === 0) return;
  const replacements = new Map(moves.map((move) => [move.from, move.to]));
  const orders = await readGalleryOrders(storage);
  let changed = false;
  for (const [slug, paths] of Object.entries(orders)) {
    orders[slug] = paths.map((path) => {
      const replacement = replacements.get(path);
      if (replacement) changed = true;
      return replacement ?? path;
    });
  }
  if (changed) await writeGalleryOrders(storage, orders);
}

/**
 * Put configured paths first and keep every unconfigured photo in its current
 * relative order. This lets imports reproduce an external gallery order
 * without deleting or scrambling CMS-only photos.
 */
export function sortPhotosByGalleryOrder<T extends { path: string }>(
  photos: readonly T[],
  orderedPaths: readonly string[],
): T[] {
  const configuredOrder = new Map<string, number>();
  orderedPaths.forEach((path, index) => {
    if (!configuredOrder.has(path)) configuredOrder.set(path, index);
  });

  return photos
    .map((photo, index) => ({ photo, index, order: configuredOrder.get(photo.path) }))
    .sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) return left.order - right.order;
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ photo }) => photo);
}
