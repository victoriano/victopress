import type { StorageAdapter } from "../content-engine/types";
import { AiDataValidationError, AiStorageError } from "./errors";
import {
  AI_RECORD_SCHEMA_VERSION,
  type AssetId,
  type GalleryAiRecordFile,
  type GallerySuggestion,
  type GallerySuggestionReviewStatus,
  type PhotoAiRecord,
  type PhotoAnalysis,
  type PhotoAssetIdentity,
  type PhotoEmbeddingReference,
} from "./types";

export const AI_GALLERY_RECORDS_PREFIX = ".victopress/ai/galleries";

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assert(
  condition: unknown,
  message: string,
  path: string,
): asserts condition {
  if (!condition) throw new AiDataValidationError(message, path);
}

function validateAsset(asset: unknown, path: string): void {
  assert(isObject(asset), "Asset must be an object", path);
  assert(
    isNonEmptyString(asset.assetId) && /^asset_[a-f0-9]{58}$/.test(asset.assetId),
    "Invalid asset id",
    `${path}.assetId`,
  );
  assert(
    isNonEmptyString(asset.sourceFingerprint) &&
      /^sha256:[a-f0-9]{64}$/.test(asset.sourceFingerprint),
    "Invalid source fingerprint",
    `${path}.sourceFingerprint`,
  );
  assert(isNonEmptyString(asset.sourcePath), "Missing source path", `${path}.sourcePath`);
  assert(isNonEmptyString(asset.filename), "Missing filename", `${path}.filename`);
  assert(isNonEmptyString(asset.gallerySlug), "Missing gallery slug", `${path}.gallerySlug`);
  assert(
    typeof asset.byteLength === "number" &&
      Number.isSafeInteger(asset.byteLength) &&
      asset.byteLength >= 0,
    "Invalid byte length",
    `${path}.byteLength`,
  );
  if (asset.lastModified !== undefined) {
    assert(isNonEmptyString(asset.lastModified), "Invalid lastModified", `${path}.lastModified`);
  }
}

function validateGallerySuggestion(value: unknown, path: string): void {
  assert(isObject(value), "Gallery suggestion must be an object", path);
  assert(isNonEmptyString(value.gallerySlug), "Missing gallery slug", `${path}.gallerySlug`);
  assert(
    typeof value.confidence === "number" &&
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1,
    "Confidence must be between 0 and 1",
    `${path}.confidence`,
  );
  assert(isNonEmptyString(value.reason), "Missing suggestion reason", `${path}.reason`);
  assert(typeof value.alreadyCurrent === "boolean", "Invalid alreadyCurrent", `${path}.alreadyCurrent`);
  assert(
    value.status === "pending" ||
      value.status === "accepted" ||
      value.status === "rejected",
    "Invalid review status",
    `${path}.status`,
  );
  if (value.reviewedAt !== undefined) {
    assert(isNonEmptyString(value.reviewedAt), "Invalid reviewedAt", `${path}.reviewedAt`);
  }
}

function validateAnalysis(analysis: unknown, path: string): void {
  assert(isObject(analysis), "Analysis must be an object", path);
  assert(isNonEmptyString(analysis.model), "Missing analysis model", `${path}.model`);
  assert(isNonEmptyString(analysis.promptVersion), "Missing prompt version", `${path}.promptVersion`);
  assert(isNonEmptyString(analysis.taxonomyVersion), "Missing taxonomy version", `${path}.taxonomyVersion`);
  assert(isNonEmptyString(analysis.generatedAt), "Missing generatedAt", `${path}.generatedAt`);
  assert(typeof analysis.caption === "string", "Invalid caption", `${path}.caption`);
  assert(
    Array.isArray(analysis.tags) && analysis.tags.every((tag) => isNonEmptyString(tag)),
    "Invalid tags",
    `${path}.tags`,
  );
  assert(Array.isArray(analysis.gallerySuggestions), "Invalid suggestions", `${path}.gallerySuggestions`);
  analysis.gallerySuggestions.forEach((suggestion, index) =>
    validateGallerySuggestion(suggestion, `${path}.gallerySuggestions[${index}]`),
  );
}

function validateEmbedding(embedding: unknown, path: string): void {
  assert(isObject(embedding), "Embedding reference must be an object", path);
  assert(
    embedding.status === "pending" ||
      embedding.status === "ready" ||
      embedding.status === "failed",
    "Invalid embedding status",
    `${path}.status`,
  );
  assert(isNonEmptyString(embedding.model), "Missing embedding model", `${path}.model`);
  assert(
    typeof embedding.dimensions === "number" &&
      Number.isSafeInteger(embedding.dimensions) &&
      embedding.dimensions > 0,
    "Invalid embedding dimensions",
    `${path}.dimensions`,
  );
  assert(isNonEmptyString(embedding.vectorId), "Missing vector id", `${path}.vectorId`);
  assert(
    isNonEmptyString(embedding.sourceFingerprint) &&
      /^sha256:[a-f0-9]{64}$/.test(embedding.sourceFingerprint),
    "Invalid embedding fingerprint",
    `${path}.sourceFingerprint`,
  );
  if (embedding.generatedAt !== undefined) {
    assert(isNonEmptyString(embedding.generatedAt), "Invalid generatedAt", `${path}.generatedAt`);
  }
  if (embedding.error !== undefined) {
    assert(typeof embedding.error === "string", "Invalid embedding error", `${path}.error`);
  }
}

export function validatePhotoAiRecord(
  value: unknown,
  path = "record",
): asserts value is PhotoAiRecord {
  assert(isObject(value), "AI record must be an object", path);
  assert(
    value.schemaVersion === AI_RECORD_SCHEMA_VERSION,
    `Unsupported AI record schema version: ${String(value.schemaVersion)}`,
    `${path}.schemaVersion`,
  );
  assert(
    typeof value.revision === "number" &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 1,
    "Invalid revision",
    `${path}.revision`,
  );
  assert(isNonEmptyString(value.createdAt), "Missing createdAt", `${path}.createdAt`);
  assert(isNonEmptyString(value.updatedAt), "Missing updatedAt", `${path}.updatedAt`);
  validateAsset(value.asset, `${path}.asset`);
  if (value.analysis !== undefined) validateAnalysis(value.analysis, `${path}.analysis`);
  if (value.embedding !== undefined) {
    validateEmbedding(value.embedding, `${path}.embedding`);
    assert(
      isObject(value.asset) &&
        isObject(value.embedding) &&
        value.embedding.sourceFingerprint === value.asset.sourceFingerprint,
      "Embedding fingerprint must match the source asset",
      `${path}.embedding.sourceFingerprint`,
    );
  }
}

export function createPhotoAiRecord(
  input: {
    asset: PhotoAssetIdentity;
    analysis?: PhotoAnalysis;
    embedding?: PhotoEmbeddingReference;
  },
  now = new Date().toISOString(),
): PhotoAiRecord {
  const record: PhotoAiRecord = {
    schemaVersion: AI_RECORD_SCHEMA_VERSION,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    asset: input.asset,
    analysis: input.analysis,
    embedding: input.embedding,
  };
  validatePhotoAiRecord(record);
  return record;
}

export function mergeGallerySuggestionReviews(
  previous: readonly GallerySuggestion[],
  next: readonly GallerySuggestion[],
): GallerySuggestion[] {
  const previousBySlug = new Map(previous.map((suggestion) => [suggestion.gallerySlug, suggestion]));

  return next.map((suggestion) => {
    const reviewed = previousBySlug.get(suggestion.gallerySlug);
    if (!reviewed || reviewed.status === "pending" || suggestion.status !== "pending") {
      return { ...suggestion };
    }

    return {
      ...suggestion,
      status: reviewed.status,
      reviewedAt: reviewed.reviewedAt,
    };
  });
}

function mergeRecordReviewState(
  previous: PhotoAiRecord | undefined,
  next: PhotoAiRecord,
): PhotoAiRecord {
  if (!previous?.analysis || !next.analysis) return next;

  return {
    ...next,
    analysis: {
      ...next.analysis,
      gallerySuggestions: mergeGallerySuggestionReviews(
        previous.analysis.gallerySuggestions,
        next.analysis.gallerySuggestions,
      ),
    },
  };
}

export function galleryAiRecordStorageKey(gallerySlug: string): string {
  const normalized = gallerySlug.trim();
  if (!normalized) {
    throw new AiDataValidationError("Gallery slug cannot be empty", "gallerySlug");
  }
  return `${AI_GALLERY_RECORDS_PREFIX}/${encodeURIComponent(normalized)}.json`;
}

function emptyGalleryFile(gallerySlug: string, now: string): GalleryAiRecordFile {
  return {
    schemaVersion: AI_RECORD_SCHEMA_VERSION,
    gallerySlug,
    updatedAt: now,
    records: {},
  };
}

function parseGalleryFile(
  raw: string,
  expectedGallerySlug: string,
  storageKey: string,
): GalleryAiRecordFile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new AiDataValidationError("AI record file is not valid JSON", storageKey, {
      cause,
    });
  }

  assert(isObject(value), "AI gallery file must be an object", storageKey);
  assert(
    value.schemaVersion === AI_RECORD_SCHEMA_VERSION,
    `Unsupported AI gallery schema version: ${String(value.schemaVersion)}`,
    `${storageKey}.schemaVersion`,
  );
  assert(value.gallerySlug === expectedGallerySlug, "Gallery slug mismatch", `${storageKey}.gallerySlug`);
  assert(isNonEmptyString(value.updatedAt), "Missing updatedAt", `${storageKey}.updatedAt`);
  assert(isObject(value.records), "Records must be an object", `${storageKey}.records`);

  for (const [assetId, record] of Object.entries(value.records)) {
    validatePhotoAiRecord(record, `${storageKey}.records.${assetId}`);
    assert(record.asset.assetId === assetId, "Record key does not match asset id", `${storageKey}.records.${assetId}`);
  }

  return value as unknown as GalleryAiRecordFile;
}

export interface AiRecordStoreOptions {
  now?: () => string;
}

/**
 * Stores one rebuildable JSON sidecar per source gallery. Mutations are
 * serialized per gallery within an isolate to avoid lost read-modify-writes.
 */
export class AiRecordStore {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly now: () => string;

  constructor(
    private readonly storage: StorageAdapter,
    options: AiRecordStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async readGallery(gallerySlug: string): Promise<GalleryAiRecordFile> {
    const normalized = gallerySlug.trim();
    const storageKey = galleryAiRecordStorageKey(normalized);
    let raw: string | null;

    try {
      raw = await this.storage.getText(storageKey);
    } catch (cause) {
      throw new AiStorageError("Could not read AI gallery records", storageKey, {
        cause,
      });
    }

    return raw
      ? parseGalleryFile(raw, normalized, storageKey)
      : emptyGalleryFile(normalized, this.now());
  }

  async listGalleryRecords(gallerySlug: string): Promise<PhotoAiRecord[]> {
    const file = await this.readGallery(gallerySlug);
    return Object.values(file.records).sort((a, b) =>
      a.asset.sourcePath.localeCompare(b.asset.sourcePath),
    );
  }

  async getRecord(
    gallerySlug: string,
    assetId: AssetId | string,
  ): Promise<PhotoAiRecord | null> {
    const file = await this.readGallery(gallerySlug);
    return file.records[assetId] ?? null;
  }

  async upsertRecord(
    gallerySlug: string,
    record: PhotoAiRecord,
  ): Promise<PhotoAiRecord> {
    const [stored] = await this.upsertRecords(gallerySlug, [record]);
    return stored;
  }

  async upsertRecords(
    gallerySlug: string,
    records: readonly PhotoAiRecord[],
  ): Promise<PhotoAiRecord[]> {
    if (records.length === 0) return [];
    const normalized = gallerySlug.trim();
    for (const record of records) {
      validatePhotoAiRecord(record);
      if (record.asset.gallerySlug !== normalized) {
        throw new AiDataValidationError(
          "Record source gallery does not match destination sidecar",
          "record.asset.gallerySlug",
        );
      }
    }

    return this.withGalleryLock(normalized, async () => {
      const file = await this.readGallery(normalized);
      const storedRecords = records.map((record) => {
        const existing = file.records[record.asset.assetId];
        const now = this.now();
        const merged = mergeRecordReviewState(existing, record);
        const stored: PhotoAiRecord = {
          ...merged,
          schemaVersion: AI_RECORD_SCHEMA_VERSION,
          revision: existing ? existing.revision + 1 : Math.max(1, record.revision),
          createdAt: existing?.createdAt ?? record.createdAt,
          updatedAt: now,
        };
        validatePhotoAiRecord(stored);
        file.records[stored.asset.assetId] = stored;
        file.updatedAt = now;
        return stored;
      });
      await this.writeGallery(file);
      return storedRecords;
    });
  }

  async reviewGallerySuggestion(
    sourceGallerySlug: string,
    assetId: AssetId | string,
    suggestedGallerySlug: string,
    status: GallerySuggestionReviewStatus,
  ): Promise<PhotoAiRecord> {
    if (status !== "pending" && status !== "accepted" && status !== "rejected") {
      throw new AiDataValidationError("Invalid review status", "status");
    }
    return this.withGalleryLock(sourceGallerySlug, async () => {
      const file = await this.readGallery(sourceGallerySlug);
      const record = file.records[assetId];
      if (!record?.analysis) {
        throw new AiDataValidationError("Photo analysis was not found", String(assetId));
      }

      const suggestion = record.analysis.gallerySuggestions.find(
        (candidate) => candidate.gallerySlug === suggestedGallerySlug,
      );
      if (!suggestion) {
        throw new AiDataValidationError(
          "Gallery suggestion was not found",
          suggestedGallerySlug,
        );
      }

      const now = this.now();
      suggestion.status = status;
      suggestion.reviewedAt = status === "pending" ? undefined : now;
      record.revision += 1;
      record.updatedAt = now;
      file.updatedAt = now;
      await this.writeGallery(file);
      return record;
    });
  }

  async deleteRecord(
    gallerySlug: string,
    assetId: AssetId | string,
  ): Promise<boolean> {
    return this.withGalleryLock(gallerySlug, async () => {
      const file = await this.readGallery(gallerySlug);
      if (!file.records[assetId]) return false;
      delete file.records[assetId];
      file.updatedAt = this.now();
      await this.writeGallery(file);
      return true;
    });
  }

  private async writeGallery(file: GalleryAiRecordFile): Promise<void> {
    const storageKey = galleryAiRecordStorageKey(file.gallerySlug);
    try {
      await this.storage.put(
        storageKey,
        `${JSON.stringify(file, null, 2)}\n`,
        "application/json",
      );
    } catch (cause) {
      throw new AiStorageError("Could not write AI gallery records", storageKey, {
        cause,
      });
    }
  }

  private async withGalleryLock<T>(
    gallerySlug: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const storageKey = galleryAiRecordStorageKey(gallerySlug);
    const previous = this.locks.get(storageKey) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    const marker = task.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(storageKey, marker);

    try {
      return await task;
    } finally {
      if (this.locks.get(storageKey) === marker) this.locks.delete(storageKey);
    }
  }
}
