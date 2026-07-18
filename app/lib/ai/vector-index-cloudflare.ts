import {
  normalizeTopK,
  resolveVectorScope,
  sanitizePhotoVectorMetadata,
  validateVector,
  validateVectorId,
  type CloudflareVectorizeBinding,
  type CloudflareVectorizeQueryOptions,
  type PhotoVectorMetadata,
  type VectorIndex,
  type VectorIndexDescription,
  type VectorLookupOptions,
  type VectorMutationResult,
  type VectorQueryOptions,
  type VectorQueryResult,
  type VectorRecord,
  type VectorScope,
  type VectorUpsertInput,
} from "./vector-index";

interface CloudflareVectorOptions {
  dimensions: number;
  defaultModelSpace: string;
  defaultNamespace: string;
}

function cloudflareNamespace(modelSpace: string, namespace: string): string {
  const value = `${modelSpace}--${namespace}`;
  if (value.length <= 63) return value;
  // Current model spaces are short; keep a deterministic bounded fallback.
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${value.slice(0, 52)}-${(hash >>> 0).toString(16)}`;
}

function queryOptions(
  options: VectorQueryOptions,
  scope: Required<VectorScope>,
  requestedTopK: number,
): CloudflareVectorizeQueryOptions {
  const filter: Record<string, boolean | string | { $in: Array<string | number | boolean | string[]> }> = {};
  if (options.filter?.gallerySlug !== undefined) {
    const gallerySlug = options.filter.gallerySlug;
    filter.gallerySlug = typeof gallerySlug === "string"
      ? gallerySlug
      : { $in: Array.from(gallerySlug) };
  }
  if (options.filter?.hidden !== undefined) filter.hidden = options.filter.hidden;
  if (options.filter?.protected !== undefined) filter.protected = options.filter.protected;
  return {
    topK: Math.min(50, requestedTopK),
    namespace: cloudflareNamespace(scope.modelSpace, scope.namespace),
    returnValues: options.includeValues === true,
    returnMetadata: options.includeMetadata === false ? "none" : "all",
    filter: Object.keys(filter).length > 0 ? filter : undefined,
  };
}

export class CloudflareVectorIndex implements VectorIndex {
  constructor(
    private readonly binding: CloudflareVectorizeBinding,
    private readonly options: CloudflareVectorOptions,
  ) {}

  async upsert(vectors: readonly VectorUpsertInput[]): Promise<VectorMutationResult> {
    if (vectors.length === 0) return { ids: [], count: 0 };
    const prepared = vectors.map((vector) => {
      const scope = resolveVectorScope(vector, this.options);
      return {
        id: validateVectorId(vector.id),
        values: validateVector(vector.values, this.options.dimensions),
        namespace: cloudflareNamespace(scope.modelSpace, scope.namespace),
        metadata: sanitizePhotoVectorMetadata(vector.metadata),
      };
    });
    const mutation = await this.binding.upsert(prepared);
    return {
      ids: prepared.map((vector) => vector.id),
      count: mutation.count ?? prepared.length,
      mutationId: mutation.mutationId,
    };
  }

  async query(
    values: readonly number[] | Float32Array | Float64Array,
    options: VectorQueryOptions = {},
  ): Promise<VectorQueryResult> {
    const scope = resolveVectorScope(options, this.options);
    const topK = normalizeTopK(options.topK);
    const excluded = new Set(options.excludeIds ?? []);
    const overfetch = Math.min(50, topK + excluded.size);
    const response = await this.binding.query(
      validateVector(values, this.options.dimensions),
      queryOptions(options, scope, overfetch),
    );
    const matches = response.matches
      .filter((match) => !excluded.has(match.id))
      .slice(0, topK)
      .map((match) => ({
        id: match.id,
        score: match.score,
        modelSpace: scope.modelSpace,
        namespace: scope.namespace,
        metadata: options.includeMetadata === false
          ? undefined
          : sanitizePhotoVectorMetadata(match.metadata as PhotoVectorMetadata | undefined),
        values: options.includeValues && match.values ? Array.from(match.values) : undefined,
      }));
    return { matches, count: matches.length };
  }

  async queryById(id: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult> {
    const normalizedId = validateVectorId(id);
    const scope = resolveVectorScope(options, this.options);
    const topK = normalizeTopK(options.topK);
    const excluded = new Set(options.excludeIds ?? []);
    if (!options.includeQueryVector) excluded.add(normalizedId);

    if (this.binding.queryById) {
      const response = await this.binding.queryById(
        normalizedId,
        queryOptions(options, scope, Math.min(50, topK + excluded.size)),
      );
      const matches = response.matches
        .filter((match) => !excluded.has(match.id))
        .slice(0, topK)
        .map((match) => ({
          id: match.id,
          score: match.score,
          modelSpace: scope.modelSpace,
          namespace: scope.namespace,
          metadata: options.includeMetadata === false
            ? undefined
            : sanitizePhotoVectorMetadata(match.metadata as PhotoVectorMetadata | undefined),
          values: options.includeValues && match.values ? Array.from(match.values) : undefined,
        }));
      return { matches, count: matches.length };
    }

    const [source] = await this.binding.getByIds([normalizedId]);
    if (!source?.values) return { matches: [], count: 0 };
    return this.query(source.values, { ...options, excludeIds: Array.from(excluded) });
  }

  async delete(ids: readonly string[], _scope?: VectorScope): Promise<VectorMutationResult> {
    const normalized = Array.from(new Set(ids.map(validateVectorId)));
    if (normalized.length === 0) return { ids: [], count: 0 };
    const mutation = await this.binding.deleteByIds(normalized);
    return {
      ids: normalized,
      count: mutation.count ?? normalized.length,
      mutationId: mutation.mutationId,
    };
  }

  async getByIds(ids: readonly string[], options: VectorLookupOptions = {}): Promise<VectorRecord[]> {
    const scope = resolveVectorScope(options, this.options);
    const records = await this.binding.getByIds(ids.map(validateVectorId));
    const expectedNamespace = cloudflareNamespace(scope.modelSpace, scope.namespace);
    return records
      .filter((record) => !record.namespace || record.namespace === expectedNamespace)
      .map((record) => ({
        id: record.id,
        modelSpace: scope.modelSpace,
        namespace: scope.namespace,
        metadata: options.includeMetadata === false
          ? undefined
          : sanitizePhotoVectorMetadata(record.metadata as PhotoVectorMetadata | undefined),
        values: options.includeValues ? Array.from(record.values) : undefined,
      }));
  }

  async describe(): Promise<VectorIndexDescription> {
    const details = await this.binding.describe();
    const configuredDimensions = "dimensions" in details && typeof details.dimensions === "number"
      ? details.dimensions
      : "config" in details && details.config && "dimensions" in details.config
        ? details.config.dimensions
        : undefined;
    return {
      backend: "cloudflare-vectorize",
      dimensions: configuredDimensions ?? this.options.dimensions,
      vectorCount: details.vectorCount ?? details.vectorsCount ?? 0,
      metric: "cosine",
      processedUpToDatetime: details.processedUpToDatetime,
      processedUpToMutation: details.processedUpToMutation,
    };
  }
}
