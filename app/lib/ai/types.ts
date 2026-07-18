/**
 * Domain types for VictoPress AI projections.
 *
 * AI data is derived and rebuildable. Manual metadata remains in photos.yaml;
 * these records never imply that a photo should be moved or published.
 */

export const AI_RECORD_SCHEMA_VERSION = 1 as const;
export const GALLERY_TAXONOMY_SCHEMA_VERSION = 2 as const;
export const DEFAULT_ANALYSIS_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

declare const assetIdBrand: unique symbol;
declare const sourceFingerprintBrand: unique symbol;

export type AssetId = string & { readonly [assetIdBrand]: true };
export type SourceFingerprint = string & {
  readonly [sourceFingerprintBrand]: true;
};

export interface PhotoAssetIdentity {
  assetId: AssetId;
  sourceFingerprint: SourceFingerprint;
  sourcePath: string;
  filename: string;
  gallerySlug: string;
  byteLength: number;
  lastModified?: string;
}

export type GallerySuggestionReviewStatus =
  | "pending"
  | "accepted"
  | "rejected";

/**
 * A semantic suggestion, not a content mutation. `alreadyCurrent` is computed
 * from CMS state rather than trusted from the model.
 */
export interface GallerySuggestion {
  gallerySlug: string;
  confidence: number;
  reason: string;
  alreadyCurrent: boolean;
  status: GallerySuggestionReviewStatus;
  reviewedAt?: string;
}

export interface AiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface PhotoAnalysis {
  model: string;
  promptVersion: string;
  taxonomyVersion: string;
  generatedAt: string;
  caption: string;
  tags: string[];
  gallerySuggestions: GallerySuggestion[];
  usage?: AiUsageMetadata;
}

export type AiProjectionStatus = "pending" | "ready" | "failed";

/** Vector values live in VectorIndex, never in the files-first AI record. */
export interface PhotoEmbeddingReference {
  status: AiProjectionStatus;
  model: string;
  dimensions: number;
  vectorId: string;
  sourceFingerprint: SourceFingerprint;
  generatedAt?: string;
  error?: string;
}

export interface PhotoAiRecord {
  schemaVersion: typeof AI_RECORD_SCHEMA_VERSION;
  revision: number;
  createdAt: string;
  updatedAt: string;
  asset: PhotoAssetIdentity;
  analysis?: PhotoAnalysis;
  embedding?: PhotoEmbeddingReference;
}

export interface GalleryAiRecordFile {
  schemaVersion: typeof AI_RECORD_SCHEMA_VERSION;
  gallerySlug: string;
  updatedAt: string;
  records: Record<string, PhotoAiRecord>;
}

/** One existing CMS gallery becomes one value in the gallery taxonomy. */
export interface GalleryTaxonomyEntry {
  slug: string;
  title: string;
  description?: string;
  /** Strict editorial inclusion/exclusion criteria authored by the CMS user. */
  classificationHint?: string;
  tags: string[];
  category?: string;
  path: string;
  parentSlug?: string;
  ancestorSlugs: string[];
  isProtected: boolean;
  isParentGallery: boolean;
  /** Parent/container galleries stay visible in context but are not suggested. */
  acceptsDirectPhotos: boolean;
  photoCount: number;
}

export interface GalleryTaxonomyCatalog {
  schemaVersion: typeof GALLERY_TAXONOMY_SCHEMA_VERSION;
  version: string;
  generatedAt: string;
  entries: GalleryTaxonomyEntry[];
}

export type GeminiAnalysisImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";

export type GeminiEmbeddingImageMimeType = "image/jpeg" | "image/png";

export interface AnalyzePhotoInput {
  image: ArrayBuffer | Uint8Array;
  mimeType: GeminiAnalysisImageMimeType;
  taxonomy: GalleryTaxonomyCatalog;
  currentGallerySlugs: readonly string[];
  language?: string;
  signal?: AbortSignal;
}

export interface EmbedImageInput {
  image: ArrayBuffer | Uint8Array;
  mimeType: GeminiEmbeddingImageMimeType;
  signal?: AbortSignal;
}

export interface EmbedTextInput {
  text: string;
  /** Optional explicit instruction prepended to the text for Embedding 2. */
  instruction?: string;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  model: string;
  dimensions: number;
  values: number[];
}

export interface PhotoAiProvider {
  analyzePhoto(input: AnalyzePhotoInput): Promise<PhotoAnalysis>;
  embedImage(input: EmbedImageInput): Promise<EmbeddingResult>;
  embedText(input: EmbedTextInput): Promise<EmbeddingResult>;
}
