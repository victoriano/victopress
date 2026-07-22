/**
 * Durable background writeback of VictoPress state into source image XMP.
 *
 * One R2/local marker per photo avoids a lossy shared queue file. Request
 * handlers persist markers first, then use Cloudflare waitUntil when available;
 * failed work remains resumable through the batch API.
 */

import {
  getContentIndex,
  getStorage,
} from "../content-engine";
import type {
  ContentIndex,
  GalleryDataEntry,
  GalleryPhotoEntry,
} from "../content-engine/content-index";
import type { StorageAdapter } from "../content-engine/types";
import {
  VICTOPRESS_EMBEDDED_METADATA_VERSION,
  UnsupportedEmbeddedMetadataFormatError,
  canonicalizeImageBytes,
  createCanonicalImageSourceFingerprint,
  writeVictoPressEmbeddedMetadata,
  type VictoPressEmbeddedMetadata,
  type VictoPressEmbeddedVectorIndex,
} from "../content-engine/victopress-xmp";
import { AiRecordStore } from "./record-store";
import {
  PHOTO_AI_SEARCH_INDEX_VERSION,
  findPhotoAiSearchDocumentByPath,
  readPhotoAiSearchIndex,
  type PhotoAiSearchIndex,
} from "./search-index";
import {
  createPhotoVectorIndex,
  type PhotoVectorEnv,
  type VectorIndex,
} from "./vector-index";
import type { PhotoAiRecord } from "./types";

export const PHOTO_METADATA_WRITEBACK_PREFIX = ".victopress/metadata-writeback/v1";
export const PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX = `${PHOTO_METADATA_WRITEBACK_PREFIX}/queue`;
export const PHOTO_METADATA_WRITEBACK_FAILED_PREFIX = `${PHOTO_METADATA_WRITEBACK_PREFIX}/failed`;
const WRITEBACK_MARKER_VERSION = 1 as const;
const DEFAULT_BACKGROUND_BATCH_SIZE = 6;
const MAX_WRITEBACK_ATTEMPTS = 3;
const BACKGROUND_DRAIN_BUDGET_MS = 20_000;

export type PhotoMetadataWritebackReason =
  | "upload"
  | "ai-analysis"
  | "ai-review"
  | "editorial-metadata"
  | "gallery-membership"
  | "gallery-order"
  | "gallery-move"
  | "backfill";

interface PhotoMetadataWritebackMarker {
  version: typeof WRITEBACK_MARKER_VERSION;
  requestId: string;
  path: string;
  reasons: PhotoMetadataWritebackReason[];
  requestedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

export interface PhotoMetadataWritebackContext {
  cloudflare?: {
    env?: unknown;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

export interface PhotoMetadataWritebackBatchResult {
  processed: number;
  written: number;
  unchanged: number;
  failed: number;
  unsupported: number;
  remaining: number;
  done: boolean;
}

export interface PhotoMetadataWritebackStatus {
  queued: number;
  failed: number;
}

function queueKey(path: string): string {
  return `${PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX}/${encodeURIComponent(path)}.json`;
}

function failedKey(path: string): string {
  return `${PHOTO_METADATA_WRITEBACK_FAILED_PREFIX}/${encodeURIComponent(path)}.json`;
}

function normalizePaths(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function contentTypeForPath(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  return "image/jpeg";
}

function envRecord(context: PhotoMetadataWritebackContext): Record<string, unknown> {
  return (context.cloudflare?.env ?? {}) as Record<string, unknown>;
}

async function readMarker(
  storage: StorageAdapter,
  key: string,
): Promise<PhotoMetadataWritebackMarker | null> {
  const raw = await storage.getText(key);
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as Partial<PhotoMetadataWritebackMarker>;
    return marker.version === WRITEBACK_MARKER_VERSION && typeof marker.path === "string"
      ? marker as PhotoMetadataWritebackMarker
      : null;
  } catch {
    return null;
  }
}

async function writeMarker(
  storage: StorageAdapter,
  key: string,
  marker: PhotoMetadataWritebackMarker,
): Promise<void> {
  await storage.put(key, JSON.stringify(marker), "application/json");
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < values.length; offset += concurrency) {
    await Promise.all(values.slice(offset, offset + concurrency).map(operation));
  }
}

export async function enqueuePhotoMetadataWritebacksInStorage(
  storage: StorageAdapter,
  paths: readonly string[],
  reason: PhotoMetadataWritebackReason,
): Promise<number> {
  const uniquePaths = normalizePaths(paths);
  const requestedAt = new Date().toISOString();
  await mapWithConcurrency(uniquePaths, 8, async (path) => {
    const key = queueKey(path);
    const existing = await readMarker(storage, key);
    const marker: PhotoMetadataWritebackMarker = {
      version: WRITEBACK_MARKER_VERSION,
      requestId: crypto.randomUUID(),
      path,
      reasons: Array.from(new Set([...(existing?.reasons ?? []), reason])),
      requestedAt,
      attempts: 0,
      lastAttemptAt: undefined,
      error: undefined,
    };
    await writeMarker(storage, key, marker);
    const previousFailure = failedKey(path);
    if (await storage.exists(previousFailure)) await storage.delete(previousFailure);
  });
  return uniquePaths.length;
}

function backgroundWaitUntil(
  context: PhotoMetadataWritebackContext,
  promise: Promise<unknown>,
): boolean {
  const runtime = context.cloudflare?.ctx;
  const waitUntil = runtime?.waitUntil;
  if (typeof waitUntil !== "function") return false;
  waitUntil.call(runtime, promise);
  return true;
}

/** Persists queue markers before handing a bounded write batch to waitUntil. */
export async function enqueuePhotoMetadataWritebacks(
  context: PhotoMetadataWritebackContext,
  paths: readonly string[],
  reason: PhotoMetadataWritebackReason,
): Promise<{ queued: number; background: boolean }> {
  const uniquePaths = normalizePaths(paths);
  if (uniquePaths.length === 0) return { queued: 0, background: false };
  const storage = getStorage(context as Parameters<typeof getStorage>[0]);
  const queued = await enqueuePhotoMetadataWritebacksInStorage(storage, uniquePaths, reason);
  const hasBackgroundRuntime = typeof context.cloudflare?.ctx?.waitUntil === "function";
  const processPromise = (hasBackgroundRuntime
    ? drainPhotoMetadataWritebacks(context, uniquePaths)
    : processPhotoMetadataWritebackBatch(
        context,
        Math.min(DEFAULT_BACKGROUND_BATCH_SIZE, uniquePaths.length),
        uniquePaths,
      )).catch((error) => {
    console.error("[Metadata Writeback] Background batch failed", error);
  });
  const background = backgroundWaitUntil(context, processPromise);
  if (!background) await processPromise;
  return { queued, background };
}

function findPhysicalPhoto(
  content: ContentIndex,
  path: string,
): { gallery: GalleryDataEntry; photo: GalleryPhotoEntry } | null {
  for (const gallery of content.galleryData) {
    const photo = gallery.photos.find((candidate) => candidate.path === path && !candidate.isReference);
    if (photo) return { gallery, photo };
  }
  return null;
}

function galleryMemberships(
  content: ContentIndex,
  path: string,
  physicalGallerySlug: string,
): VictoPressEmbeddedMetadata["galleries"] {
  return content.galleryData.flatMap((gallery) => {
    const order = gallery.photos.findIndex((photo) => photo.path === path);
    if (order < 0) return [];
    return [{
      slug: gallery.slug,
      title: gallery.title,
      path: gallery.path,
      physicalSource: gallery.slug === physicalGallerySlug,
      order: order + 1,
    }];
  }).sort((left, right) => {
    if (left.physicalSource !== right.physicalSource) return left.physicalSource ? -1 : 1;
    return left.slug.localeCompare(right.slug);
  });
}

function encodeFloat32Values(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function analysisMetadata(record: PhotoAiRecord | null) {
  const analysis = record?.analysis;
  if (!analysis) return undefined;
  return {
    // These names are intentionally not `description`/`tags` at the editorial
    // level: AI output can be regenerated without changing the public caption.
    description: analysis.caption,
    tags: [...analysis.tags],
    model: analysis.model,
    promptVersion: analysis.promptVersion,
    taxonomyVersion: analysis.taxonomyVersion,
    generatedAt: analysis.generatedAt,
    gallerySuggestions: analysis.gallerySuggestions.map((suggestion) => ({ ...suggestion })),
    usage: analysis.usage ? { ...analysis.usage } : undefined,
  };
}

async function vectorMetadata(
  context: PhotoMetadataWritebackContext,
  storage: StorageAdapter,
  record: PhotoAiRecord | null,
  vectorIndexes: Map<string, VectorIndex>,
): Promise<VictoPressEmbeddedVectorIndex | undefined> {
  const embedding = record?.embedding;
  if (!embedding) return undefined;
  const result: VictoPressEmbeddedVectorIndex = { ...embedding };
  if (embedding.status !== "ready") return result;

  const modelSpace = `${embedding.model}:${embedding.dimensions}`;
  let index = vectorIndexes.get(modelSpace);
  if (!index) {
    index = createPhotoVectorIndex(envRecord(context) as PhotoVectorEnv, storage, {
      dimensions: embedding.dimensions,
      defaultModelSpace: modelSpace,
      defaultNamespace: "photos",
    });
    vectorIndexes.set(modelSpace, index);
  }

  try {
    const [vector] = await index.getByIds([embedding.vectorId], {
      modelSpace,
      namespace: "photos",
      includeMetadata: true,
      includeValues: true,
    });
    if (vector?.values?.length === embedding.dimensions) {
      result.encoding = "base64-f32le";
      result.values = encodeFloat32Values(vector.values);
      result.metadata = vector.metadata;
    }
  } catch (error) {
    // The stable reference still survives in XMP; a later retry can add values.
    console.warn(`[Metadata Writeback] Could not read vector ${embedding.vectorId}`, error);
  }
  return result;
}

interface WritebackSnapshot {
  content: ContentIndex;
  searchIndex: PhotoAiSearchIndex;
  recordStore: AiRecordStore;
  vectorIndexes: Map<string, VectorIndex>;
}

async function createEmbeddedMetadata(
  context: PhotoMetadataWritebackContext,
  storage: StorageAdapter,
  snapshot: WritebackSnapshot,
  path: string,
  bytes: ArrayBuffer,
): Promise<VictoPressEmbeddedMetadata> {
  const source = findPhysicalPhoto(snapshot.content, path);
  if (!source) throw new Error(`Photo is not present in the content index: ${path}`);

  const sourceFingerprint = await createCanonicalImageSourceFingerprint(bytes);
  const canonicalByteLength = canonicalizeImageBytes(bytes).byteLength;
  const document = findPhotoAiSearchDocumentByPath(snapshot.searchIndex, path);
  const candidateRecord = document
    ? await snapshot.recordStore.getRecord(document.gallerySlug, document.assetId)
    : null;
  // Never attach derived AI data to pixels it was not generated from.
  const record = candidateRecord?.asset.sourceFingerprint === sourceFingerprint
    ? candidateRecord
    : null;
  const currentDocument = record && document?.sourceFingerprint === sourceFingerprint
    ? document
    : undefined;

  return {
    schemaVersion: VICTOPRESS_EMBEDDED_METADATA_VERSION,
    source: {
      path,
      filename: source.photo.filename,
      sourceFingerprint,
      canonicalByteLength,
    },
    editorial: {
      title: source.photo.title,
      description: source.photo.description,
      tags: [...(source.photo.tags ?? [])],
      dateTaken: source.photo.dateTaken,
      order: source.photo.order,
      hidden: source.photo.hidden === true,
    },
    galleries: galleryMemberships(snapshot.content, path, source.gallery.slug),
    ai: analysisMetadata(record),
    indexes: {
      contentVersion: snapshot.content.version,
      search: currentDocument
        ? {
            version: PHOTO_AI_SEARCH_INDEX_VERSION,
            document: { ...currentDocument } as unknown as Record<string, unknown>,
          }
        : undefined,
      vector: await vectorMetadata(
        context,
        storage,
        record,
        snapshot.vectorIndexes,
      ),
    },
  };
}

async function processMarker(
  context: PhotoMetadataWritebackContext,
  storage: StorageAdapter,
  snapshot: WritebackSnapshot,
  key: string,
): Promise<"written" | "unchanged" | "failed" | "unsupported"> {
  const marker = await readMarker(storage, key);
  if (!marker) {
    await storage.delete(key);
    return "failed";
  }
  marker.attempts += 1;
  marker.lastAttemptAt = new Date().toISOString();
  marker.error = undefined;

  try {
    const bytes = await storage.get(marker.path);
    if (!bytes) throw new Error(`Photo could not be read: ${marker.path}`);
    const metadata = await createEmbeddedMetadata(context, storage, snapshot, marker.path, bytes);
    const result = writeVictoPressEmbeddedMetadata(bytes, metadata);
    if (result.changed) {
      const put = storage.putPreservingMetadata?.bind(storage) ?? storage.put.bind(storage);
      await put(
        marker.path,
        exactArrayBuffer(result.bytes),
        contentTypeForPath(marker.path),
      );
    }
    const latest = await readMarker(storage, key);
    if (!latest || latest.requestId === marker.requestId) await storage.delete(key);
    return result.changed ? "written" : "unchanged";
  } catch (error) {
    marker.error = error instanceof Error ? error.message : "Metadata writeback failed";
    const latest = await readMarker(storage, key);
    if (latest && latest.requestId !== marker.requestId) {
      // A newer edit was queued while this image was being read/written. Leave
      // that marker intact so the newer state receives its own writeback.
      return "failed";
    }
    if (error instanceof UnsupportedEmbeddedMetadataFormatError) {
      await writeMarker(storage, failedKey(marker.path), marker);
      await storage.delete(key);
      return "unsupported";
    }
    if (marker.attempts >= MAX_WRITEBACK_ATTEMPTS) {
      await writeMarker(storage, failedKey(marker.path), marker);
      await storage.delete(key);
      console.error(`[Metadata Writeback] ${marker.path}: ${marker.error}`);
      return "failed";
    }
    await writeMarker(storage, key, marker);
    console.error(`[Metadata Writeback] ${marker.path}: ${marker.error}`);
    return "failed";
  }
}

async function drainPhotoMetadataWritebacks(
  context: PhotoMetadataWritebackContext,
  requestedPaths: readonly string[],
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < BACKGROUND_DRAIN_BUDGET_MS) {
    const result = await processPhotoMetadataWritebackBatch(
      context,
      DEFAULT_BACKGROUND_BATCH_SIZE,
      requestedPaths,
    );
    if (result.done || result.processed === 0) return;
  }
}

async function queuedKeys(
  storage: StorageAdapter,
  requestedPaths?: readonly string[],
): Promise<string[]> {
  if (requestedPaths) {
    const keys = normalizePaths(requestedPaths).map(queueKey);
    const existing = await Promise.all(keys.map(async (key) => await storage.exists(key) ? key : null));
    return existing.filter((key): key is string => Boolean(key));
  }
  return (await storage.listRecursive(PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX))
    .filter((file) => !file.isDirectory && file.name.endsWith(".json"))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
}

export async function processPhotoMetadataWritebackBatchInStorage(
  storage: StorageAdapter,
  context: PhotoMetadataWritebackContext,
  batchSize = DEFAULT_BACKGROUND_BATCH_SIZE,
  requestedPaths?: readonly string[],
): Promise<PhotoMetadataWritebackBatchResult> {
  const keys = await queuedKeys(storage, requestedPaths);
  const selected = keys.slice(0, Math.max(1, batchSize));
  if (selected.length === 0) {
    return {
      processed: 0,
      written: 0,
      unchanged: 0,
      failed: 0,
      unsupported: 0,
      remaining: 0,
      done: true,
    };
  }

  const [content, searchIndex] = await Promise.all([
    getContentIndex(storage),
    readPhotoAiSearchIndex(storage),
  ]);
  const snapshot: WritebackSnapshot = {
    content,
    searchIndex,
    recordStore: new AiRecordStore(storage),
    vectorIndexes: new Map(),
  };
  const outcomes: Array<"written" | "unchanged" | "failed" | "unsupported"> = [];
  await mapWithConcurrency(selected, 3, async (key) => {
    outcomes.push(await processMarker(context, storage, snapshot, key));
  });
  const remaining = (await queuedKeys(storage)).length;
  return {
    processed: outcomes.length,
    written: outcomes.filter((outcome) => outcome === "written").length,
    unchanged: outcomes.filter((outcome) => outcome === "unchanged").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    unsupported: outcomes.filter((outcome) => outcome === "unsupported").length,
    remaining,
    done: remaining === 0,
  };
}

export async function processPhotoMetadataWritebackBatch(
  context: PhotoMetadataWritebackContext,
  batchSize = DEFAULT_BACKGROUND_BATCH_SIZE,
  requestedPaths?: readonly string[],
): Promise<PhotoMetadataWritebackBatchResult> {
  const storage = getStorage(context as Parameters<typeof getStorage>[0]);
  return processPhotoMetadataWritebackBatchInStorage(
    storage,
    context,
    batchSize,
    requestedPaths,
  );
}

export async function getPhotoMetadataWritebackStatus(
  context: PhotoMetadataWritebackContext,
): Promise<PhotoMetadataWritebackStatus> {
  const storage = getStorage(context as Parameters<typeof getStorage>[0]);
  const [queued, failed] = await Promise.all([
    storage.listRecursive(PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX),
    storage.listRecursive(PHOTO_METADATA_WRITEBACK_FAILED_PREFIX),
  ]);
  return {
    queued: queued.filter((file) => !file.isDirectory && file.name.endsWith(".json")).length,
    failed: failed.filter((file) => !file.isDirectory && file.name.endsWith(".json")).length,
  };
}
