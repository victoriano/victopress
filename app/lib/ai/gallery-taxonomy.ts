import type { GalleryDataEntry } from "../content-engine/content-index";
import { sha256Hex } from "./identity";
import {
  GALLERY_TAXONOMY_SCHEMA_VERSION,
  type GalleryTaxonomyCatalog,
  type GalleryTaxonomyEntry,
} from "./types";

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).sort(compareStrings);
}

/**
 * Converts the existing gallery index into the only taxonomy Gemini may use.
 * The ordering is deterministic so its content hash can invalidate analyses.
 */
export function buildGalleryTaxonomyEntries(
  galleries: readonly GalleryDataEntry[],
): GalleryTaxonomyEntry[] {
  const normalized = galleries
    .filter((gallery) => gallery.slug.trim() && gallery.title.trim())
    .map((gallery) => ({
      slug: gallery.slug.trim(),
      title: gallery.title.trim(),
      description: normalizeOptional(gallery.description),
      classificationHint: normalizeOptional(gallery.classificationHint),
      tags: normalizeTags(gallery.tags),
      category: normalizeOptional(gallery.category),
      path: gallery.path.trim(),
      isProtected: gallery.isProtected,
      isParentGallery: gallery.isParentGallery === true,
      acceptsDirectPhotos: gallery.isParentGallery !== true,
      photoCount: Math.max(0, Math.trunc(gallery.photoCount)),
    }))
    .sort((a, b) => compareStrings(a.slug, b.slug));

  const knownSlugs = new Set(normalized.map((entry) => entry.slug));

  return normalized.map((entry) => {
    const segments = entry.slug.split("/").filter(Boolean);
    const possibleAncestors = segments
      .slice(0, -1)
      .map((_, index) => segments.slice(0, index + 1).join("/"));
    const ancestorSlugs = possibleAncestors.filter((slug) => knownSlugs.has(slug));

    return {
      ...entry,
      parentSlug: ancestorSlugs.at(-1),
      ancestorSlugs,
    };
  });
}

function taxonomyVersionPayload(entries: readonly GalleryTaxonomyEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      classificationHint: entry.classificationHint,
      tags: entry.tags,
      category: entry.category,
      path: entry.path,
      parentSlug: entry.parentSlug,
      ancestorSlugs: entry.ancestorSlugs,
      isProtected: entry.isProtected,
      isParentGallery: entry.isParentGallery,
      acceptsDirectPhotos: entry.acceptsDirectPhotos,
    })),
  );
}

export async function buildGalleryTaxonomyCatalog(
  galleries: readonly GalleryDataEntry[],
  generatedAt = new Date().toISOString(),
): Promise<GalleryTaxonomyCatalog> {
  const entries = buildGalleryTaxonomyEntries(galleries);
  const versionHash = await sha256Hex(taxonomyVersionPayload(entries));

  return {
    schemaVersion: GALLERY_TAXONOMY_SCHEMA_VERSION,
    version: `sha256:${versionHash}`,
    generatedAt,
    entries,
  };
}

/** Compact prompt representation; it intentionally excludes photo lists. */
export function serializeGalleryTaxonomyForPrompt(
  catalog: GalleryTaxonomyCatalog,
): string {
  return JSON.stringify(
    catalog.entries
      .filter((entry) => entry.acceptsDirectPhotos && !entry.isProtected)
      .map((entry) => ({
        slug: entry.slug,
        title: entry.title.slice(0, 200),
        description: entry.description?.slice(0, 500),
        classificationHint: entry.classificationHint?.slice(0, 1_500),
        tags: entry.tags.slice(0, 30).map((tag) => tag.slice(0, 80)),
        category: entry.category,
        parentSlug: entry.parentSlug,
      })),
  );
}
