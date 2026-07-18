import type { StorageAdapter } from "../content-engine/types";
import { CloudflareVectorIndex } from "./vector-index-cloudflare";
import { FilesFirstVectorIndex } from "./vector-index-files";

export const DEFAULT_VECTOR_DIMENSIONS = 768;
export const DEFAULT_VECTOR_MODEL_SPACE = "gemini-embedding-2:768";
export const DEFAULT_VECTOR_NAMESPACE = "photos";
export const FILES_FIRST_VECTOR_INDEX_KEY = ".victopress/ai/vector-index.json";

export type VectorMetadataValue = string | number | boolean | string[];

/**
 * Metadata is deliberately small. The stable fields below can be used for
 * filtering while extra scalar values allow callers to attach durable IDs.
 */
export interface PhotoVectorMetadata {
  gallerySlug?: string;
  hidden?: boolean;
  protected?: boolean;
}

export interface VectorScope {
  /** Separates incompatible embedding models or model revisions. */
  modelSpace?: string;
  /** Separates tenants or other logical collections within a model space. */
  namespace?: string;
}

export interface VectorUpsertInput extends VectorScope {
  id: string;
  values: readonly number[] | Float32Array | Float64Array;
  metadata?: PhotoVectorMetadata;
}

export interface VectorFilter {
  gallerySlug?: string | readonly string[];
  hidden?: boolean;
  protected?: boolean;
}

export interface VectorQueryOptions extends VectorScope {
  topK?: number;
  filter?: VectorFilter;
  excludeIds?: readonly string[];
  /** queryById excludes its source vector unless this is explicitly true. */
  includeQueryVector?: boolean;
  /** Metadata is returned by default. */
  includeMetadata?: boolean;
  /** Vector values are never returned unless explicitly requested. */
  includeValues?: boolean;
}

export interface VectorLookupOptions extends VectorScope {
  includeMetadata?: boolean;
  /** Vector values are never returned unless explicitly requested. */
  includeValues?: boolean;
}

export interface VectorRecord {
  id: string;
  modelSpace: string;
  namespace: string;
  metadata?: PhotoVectorMetadata;
  values?: number[];
}

export interface VectorMatch extends VectorRecord {
  score: number;
}

export interface VectorQueryResult {
  matches: VectorMatch[];
  count: number;
}

export interface VectorMutationResult {
  ids: string[];
  count: number;
  mutationId?: string;
}

export interface VectorIndexDescription {
  backend: "cloudflare-vectorize" | "files-first";
  dimensions: number;
  vectorCount: number;
  metric: "cosine";
  storageKey?: string;
  processedUpToDatetime?: number;
  processedUpToMutation?: string | number;
}

export interface VectorIndex {
  upsert(vectors: readonly VectorUpsertInput[]): Promise<VectorMutationResult>;
  query(
    values: readonly number[] | Float32Array | Float64Array,
    options?: VectorQueryOptions,
  ): Promise<VectorQueryResult>;
  queryById(id: string, options?: VectorQueryOptions): Promise<VectorQueryResult>;
  delete(ids: readonly string[], scope?: VectorScope): Promise<VectorMutationResult>;
  getByIds(ids: readonly string[], options?: VectorLookupOptions): Promise<VectorRecord[]>;
  describe(): Promise<VectorIndexDescription>;
}

/** Minimal structural contract for both current and legacy Vectorize bindings. */
export interface CloudflareVectorizeBinding {
  describe(): Promise<{
    dimensions?: number;
    vectorCount?: number;
    vectorsCount?: number;
    processedUpToDatetime?: number;
    processedUpToMutation?: string | number;
    config?: { dimensions?: number; metric?: string } | { preset: string };
  }>;
  query(
    values: readonly number[] | Float32Array | Float64Array,
    options?: CloudflareVectorizeQueryOptions,
  ): Promise<CloudflareVectorizeMatches>;
  queryById?(
    id: string,
    options?: CloudflareVectorizeQueryOptions,
  ): Promise<CloudflareVectorizeMatches>;
  upsert(vectors: CloudflareVectorizeVector[]): Promise<CloudflareVectorizeMutation>;
  deleteByIds(ids: string[]): Promise<CloudflareVectorizeMutation>;
  getByIds(ids: string[]): Promise<CloudflareVectorizeVector[]>;
}

export interface CloudflareVectorizeVector {
  id: string;
  values: readonly number[] | Float32Array | Float64Array;
  namespace?: string;
  metadata?: PhotoVectorMetadata;
}

export interface CloudflareVectorizeMatch extends CloudflareVectorizeVector {
  score: number;
}

export interface CloudflareVectorizeMatches {
  matches: CloudflareVectorizeMatch[];
  count: number;
}

export interface CloudflareVectorizeMutation {
  mutationId?: string;
  ids?: string[];
  count?: number;
}

export interface CloudflareVectorizeQueryOptions {
  topK?: number;
  namespace?: string;
  returnValues?: boolean;
  returnMetadata?: boolean | "all" | "indexed" | "none";
  filter?: Record<
    string,
    VectorMetadataValue | { $in?: VectorMetadataValue[] }
  >;
}

export interface CreateVectorIndexOptions {
  storage: StorageAdapter;
  /** When present, Cloudflare Vectorize is preferred over the files-first index. */
  binding?: CloudflareVectorizeBinding | null;
  dimensions?: number;
  defaultModelSpace?: string;
  defaultNamespace?: string;
}

export interface PhotoVectorEnv {
  PHOTO_VECTORS?: CloudflareVectorizeBinding;
}

/**
 * Selects Vectorize in deployed environments and a rebuildable JSON index when
 * the binding is absent (local development, tests, or an unconfigured deploy).
 */
export function createVectorIndex(options: CreateVectorIndexOptions): VectorIndex {
  const commonOptions = {
    dimensions: options.dimensions ?? DEFAULT_VECTOR_DIMENSIONS,
    defaultModelSpace: options.defaultModelSpace ?? DEFAULT_VECTOR_MODEL_SPACE,
    defaultNamespace: options.defaultNamespace ?? DEFAULT_VECTOR_NAMESPACE,
  };

  if (options.binding) {
    return new CloudflareVectorIndex(options.binding, commonOptions);
  }

  return new FilesFirstVectorIndex(options.storage, commonOptions);
}

export function createPhotoVectorIndex(
  env: PhotoVectorEnv | undefined,
  storage: StorageAdapter,
  options: Omit<CreateVectorIndexOptions, "storage" | "binding"> = {},
): VectorIndex {
  return createVectorIndex({
    ...options,
    storage,
    binding: env?.PHOTO_VECTORS,
  });
}

export function resolveVectorScope(
  scope: VectorScope | undefined,
  defaults: { defaultModelSpace: string; defaultNamespace: string },
): Required<VectorScope> {
  const modelSpace = scope?.modelSpace?.trim() || defaults.defaultModelSpace;
  const namespace = scope?.namespace?.trim() || defaults.defaultNamespace;

  return { modelSpace, namespace };
}

export function validateVector(
  values: readonly number[] | Float32Array | Float64Array,
  dimensions: number,
): number[] {
  if (values.length !== dimensions) {
    throw new RangeError(
      `Expected a ${dimensions}-dimension vector, received ${values.length}`,
    );
  }

  const vector = Array.from(values);
  let magnitudeSquared = 0;

  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new TypeError("Vector values must be finite numbers");
    }
    magnitudeSquared += value * value;
  }

  if (magnitudeSquared === 0) {
    throw new RangeError("A cosine vector cannot have zero magnitude");
  }

  return vector;
}

export function validateVectorId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new TypeError("Vector id cannot be empty");
  }
  return normalized;
}

export function normalizeTopK(topK: number | undefined): number {
  if (topK === undefined) return 10;
  if (!Number.isSafeInteger(topK) || topK < 1) {
    throw new RangeError("topK must be a positive integer");
  }
  return Math.min(topK, 50);
}

export function matchesVectorFilter(
  metadata: PhotoVectorMetadata | undefined,
  filter: VectorFilter | undefined,
): boolean {
  if (!filter) return true;

  if (filter.gallerySlug !== undefined) {
    const accepted = Array.isArray(filter.gallerySlug)
      ? filter.gallerySlug
      : [filter.gallerySlug];
    if (
      typeof metadata?.gallerySlug !== "string" ||
      !accepted.includes(metadata.gallerySlug)
    ) {
      return false;
    }
  }

  if (filter.hidden !== undefined && metadata?.hidden !== filter.hidden) {
    return false;
  }

  if (filter.protected !== undefined && metadata?.protected !== filter.protected) {
    return false;
  }

  return true;
}

export function sanitizePhotoVectorMetadata(
  metadata: PhotoVectorMetadata | undefined,
): PhotoVectorMetadata | undefined {
  if (!metadata) return undefined;

  const sanitized: PhotoVectorMetadata = {};

  if (metadata.gallerySlug !== undefined) {
    const gallerySlug = metadata.gallerySlug.trim();
    if (gallerySlug) sanitized.gallerySlug = gallerySlug;
  }
  if (metadata.hidden !== undefined) sanitized.hidden = metadata.hidden;
  if (metadata.protected !== undefined) sanitized.protected = metadata.protected;

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
