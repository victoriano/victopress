export {
  AiCoreError,
  AiConfigurationError,
  AiDataValidationError,
  AiStorageError,
  GeminiRequestError,
  GeminiResponseError,
} from "./errors";
export type { AiErrorCode } from "./errors";

export {
  sha256Hex,
  sourceFingerprintFromHex,
  assetIdFromFingerprint,
  createSourceFingerprint,
  createPhotoAssetIdentity,
} from "./identity";

export {
  buildGalleryTaxonomyEntries,
  buildGalleryTaxonomyCatalog,
  serializeGalleryTaxonomyForPrompt,
} from "./gallery-taxonomy";

export {
  AI_GALLERY_RECORDS_PREFIX,
  AiRecordStore,
  validatePhotoAiRecord,
  createPhotoAiRecord,
  mergeGallerySuggestionReviews,
  galleryAiRecordStorageKey,
} from "./record-store";
export type { AiRecordStoreOptions } from "./record-store";

export {
  GeminiPhotoAiProvider,
  encodeBase64,
} from "./gemini-provider";
export type { GeminiPhotoAiProviderOptions } from "./gemini-provider";

export {
  AI_RECORD_SCHEMA_VERSION,
  GALLERY_TAXONOMY_SCHEMA_VERSION,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from "./types";
export type {
  AssetId,
  SourceFingerprint,
  PhotoAssetIdentity,
  GallerySuggestionReviewStatus,
  GallerySuggestion,
  AiUsageMetadata,
  PhotoAnalysis,
  AiProjectionStatus,
  PhotoEmbeddingReference,
  PhotoAiRecord,
  GalleryAiRecordFile,
  GalleryTaxonomyEntry,
  GalleryTaxonomyCatalog,
  GeminiAnalysisImageMimeType,
  GeminiEmbeddingImageMimeType,
  AnalyzePhotoInput,
  EmbedImageInput,
  EmbedTextInput,
  EmbeddingResult,
  PhotoAiProvider,
} from "./types";
