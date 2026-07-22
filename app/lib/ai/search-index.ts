import type { StorageAdapter } from "../content-engine/types";
import type { GallerySuggestionReviewStatus } from "./types";

export const PHOTO_AI_SEARCH_INDEX_KEY = ".victopress/ai/search-index.json";
export const PHOTO_AI_SEARCH_INDEX_VERSION = 1 as const;

export interface PhotoAiSearchGallery {
  slug: string;
  confidence: number;
  status: GallerySuggestionReviewStatus;
  alreadyCurrent: boolean;
}

export interface PhotoAiSearchDocument {
  assetId: string;
  path: string;
  filename: string;
  gallerySlug: string;
  galleryTitle: string;
  title?: string;
  /** Editorial/public description from photos.yaml/content index. */
  description?: string;
  /** AI description kept separate from the editorial/public description. */
  aiDescription?: string;
  /** Legacy alias retained for existing consumers. */
  caption: string;
  editorialTags?: string[];
  aiTags?: string[];
  /** Derived union used only for search; never written back as editorial tags. */
  tags: string[];
  year?: number;
  hidden: boolean;
  protected: boolean;
  vectorId: string;
  sourceFingerprint: string;
  model: string;
  taxonomyVersion: string;
  gallerySuggestions: PhotoAiSearchGallery[];
  updatedAt: string;
}

export interface PhotoAiSearchIndex {
  version: typeof PHOTO_AI_SEARCH_INDEX_VERSION;
  updatedAt: string;
  documents: Record<string, PhotoAiSearchDocument>;
}

function emptySearchIndex(): PhotoAiSearchIndex {
  return {
    version: PHOTO_AI_SEARCH_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    documents: {},
  };
}

export async function readPhotoAiSearchIndex(
  storage: StorageAdapter,
): Promise<PhotoAiSearchIndex> {
  const raw = await storage.getText(PHOTO_AI_SEARCH_INDEX_KEY);
  if (!raw) return emptySearchIndex();

  try {
    const parsed = JSON.parse(raw) as Partial<PhotoAiSearchIndex>;
    if (
      parsed.version !== PHOTO_AI_SEARCH_INDEX_VERSION ||
      !parsed.documents ||
      typeof parsed.documents !== "object"
    ) {
      return emptySearchIndex();
    }
    return parsed as PhotoAiSearchIndex;
  } catch {
    return emptySearchIndex();
  }
}

export async function writePhotoAiSearchIndex(
  storage: StorageAdapter,
  index: PhotoAiSearchIndex,
): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await storage.put(
    PHOTO_AI_SEARCH_INDEX_KEY,
    JSON.stringify(index, null, 2),
    "application/json",
  );
}

export async function upsertPhotoAiSearchDocument(
  storage: StorageAdapter,
  document: PhotoAiSearchDocument,
): Promise<void> {
  const index = await readPhotoAiSearchIndex(storage);
  index.documents[document.assetId] = document;
  await writePhotoAiSearchIndex(storage, index);
}

export async function removePhotoAiSearchDocuments(
  storage: StorageAdapter,
  assetIds: readonly string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  const index = await readPhotoAiSearchIndex(storage);
  for (const assetId of assetIds) delete index.documents[assetId];
  await writePhotoAiSearchIndex(storage, index);
}

export function findPhotoAiSearchDocumentByPath(
  index: PhotoAiSearchIndex,
  path: string,
): PhotoAiSearchDocument | undefined {
  return Object.values(index.documents).find((document) => document.path === path);
}

export function mergeSearchTags(...groups: Array<readonly string[] | undefined>): string[] {
  const values = new Map<string, string>();
  for (const group of groups) {
    for (const candidate of group ?? []) {
      const tag = candidate.trim();
      if (tag) values.set(tag.toLocaleLowerCase(), tag);
    }
  }
  return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
}
