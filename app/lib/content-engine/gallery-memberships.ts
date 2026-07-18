import { parse, stringify } from "yaml";
import type { StorageAdapter } from "./types";

export const GALLERY_MEMBERSHIPS_KEY = "gallery-memberships.yaml";
const GALLERY_MEMBERSHIPS_VERSION = 1 as const;

interface GalleryMembershipFile {
  version: typeof GALLERY_MEMBERSHIPS_VERSION;
  updatedAt: string;
  memberships: Record<string, string[]>;
}

function normalizeMemberships(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [rawPath, rawGalleries] of Object.entries(value)) {
    const path = rawPath.trim();
    if (!path || !Array.isArray(rawGalleries)) continue;
    const galleries = Array.from(
      new Set(rawGalleries.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)),
    ).sort();
    if (galleries.length > 0) result[path] = galleries;
  }
  return result;
}

export async function readGalleryMemberships(
  storage: StorageAdapter,
): Promise<Record<string, string[]>> {
  const raw = await storage.getText(GALLERY_MEMBERSHIPS_KEY);
  if (!raw) return {};
  try {
    const parsed = parse(raw) as Partial<GalleryMembershipFile> | null;
    if (!parsed || parsed.version !== GALLERY_MEMBERSHIPS_VERSION) return {};
    return normalizeMemberships(parsed.memberships);
  } catch (error) {
    throw new Error(
      `Could not read ${GALLERY_MEMBERSHIPS_KEY}: ${error instanceof Error ? error.message : "invalid YAML"}`,
    );
  }
}

async function writeGalleryMemberships(
  storage: StorageAdapter,
  memberships: Record<string, string[]>,
): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(normalizeMemberships(memberships)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const file: GalleryMembershipFile = {
    version: GALLERY_MEMBERSHIPS_VERSION,
    updatedAt: new Date().toISOString(),
    memberships: sorted,
  };
  await storage.put(GALLERY_MEMBERSHIPS_KEY, stringify(file), "text/yaml");
}

export async function addGalleryMemberships(
  storage: StorageAdapter,
  photoPaths: readonly string[],
  gallerySlug: string,
): Promise<void> {
  const target = gallerySlug.trim();
  if (!target) throw new Error("Gallery slug is required");
  const memberships = await readGalleryMemberships(storage);
  for (const rawPath of photoPaths) {
    const path = rawPath.trim();
    if (!path) continue;
    memberships[path] = Array.from(new Set([...(memberships[path] ?? []), target])).sort();
  }
  await writeGalleryMemberships(storage, memberships);
}

export async function removeGalleryMembershipsForPhotos(
  storage: StorageAdapter,
  photoPaths: readonly string[],
): Promise<void> {
  const memberships = await readGalleryMemberships(storage);
  let changed = false;
  for (const path of photoPaths) {
    if (memberships[path]) {
      delete memberships[path];
      changed = true;
    }
  }
  if (changed) await writeGalleryMemberships(storage, memberships);
}

export async function moveGalleryMemberships(
  storage: StorageAdapter,
  moves: readonly Array<{ from: string; to: string }>,
): Promise<void> {
  const memberships = await readGalleryMemberships(storage);
  let changed = false;
  for (const move of moves) {
    const current = memberships[move.from];
    if (!current) continue;
    memberships[move.to] = Array.from(new Set([...(memberships[move.to] ?? []), ...current])).sort();
    delete memberships[move.from];
    changed = true;
  }
  if (changed) await writeGalleryMemberships(storage, memberships);
}
