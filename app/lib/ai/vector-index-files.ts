import type { StorageAdapter } from "../content-engine/types";
import {
  FILES_FIRST_VECTOR_INDEX_KEY,
  matchesVectorFilter,
  normalizeTopK,
  resolveVectorScope,
  sanitizePhotoVectorMetadata,
  validateVector,
  validateVectorId,
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

const FILE_VERSION = 1 as const;

interface StoredVector {
  id: string;
  modelSpace: string;
  namespace: string;
  values: number[];
  metadata?: PhotoVectorMetadata;
}

interface StoredVectorFile {
  version: typeof FILE_VERSION;
  dimensions: number;
  metric: "cosine";
  updatedAt: string;
  vectors: Record<string, StoredVector>;
}

interface FilesFirstVectorOptions {
  dimensions: number;
  defaultModelSpace: string;
  defaultNamespace: string;
  storageKey?: string;
}

function compositeKey(modelSpace: string, namespace: string, id: string): string {
  return `${encodeURIComponent(modelSpace)}::${encodeURIComponent(namespace)}::${encodeURIComponent(id)}`;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export class FilesFirstVectorIndex implements VectorIndex {
  private readonly storageKey: string;
  private writeLock: Promise<void> = Promise.resolve();
  private readCache: Promise<StoredVectorFile> | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly options: FilesFirstVectorOptions,
  ) {
    this.storageKey = options.storageKey ?? FILES_FIRST_VECTOR_INDEX_KEY;
  }

  async upsert(vectors: readonly VectorUpsertInput[]): Promise<VectorMutationResult> {
    if (vectors.length === 0) return { ids: [], count: 0 };
    const prepared = vectors.map((vector) => {
      const scope = resolveVectorScope(vector, this.options);
      const id = validateVectorId(vector.id);
      return {
        key: compositeKey(scope.modelSpace, scope.namespace, id),
        vector: {
          id,
          ...scope,
          values: validateVector(vector.values, this.options.dimensions),
          metadata: sanitizePhotoVectorMetadata(vector.metadata),
        } satisfies StoredVector,
      };
    });

    await this.withWriteLock(async () => {
      const current = await this.read();
      const file = { ...current, vectors: { ...current.vectors } };
      for (const entry of prepared) file.vectors[entry.key] = entry.vector;
      await this.write(file);
    });
    return { ids: prepared.map((entry) => entry.vector.id), count: prepared.length };
  }

  async query(
    values: readonly number[] | Float32Array | Float64Array,
    options: VectorQueryOptions = {},
  ): Promise<VectorQueryResult> {
    const queryVector = validateVector(values, this.options.dimensions);
    const scope = resolveVectorScope(options, this.options);
    const topK = normalizeTopK(options.topK);
    const excluded = new Set(options.excludeIds ?? []);
    const file = await this.read();
    const matches = Object.values(file.vectors)
      .filter((vector) =>
        vector.modelSpace === scope.modelSpace &&
        vector.namespace === scope.namespace &&
        !excluded.has(vector.id) &&
        matchesVectorFilter(vector.metadata, options.filter),
      )
      .map((vector) => ({
        id: vector.id,
        modelSpace: vector.modelSpace,
        namespace: vector.namespace,
        score: cosine(queryVector, vector.values),
        metadata: options.includeMetadata === false ? undefined : vector.metadata,
        values: options.includeValues ? [...vector.values] : undefined,
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, topK);
    return { matches, count: matches.length };
  }

  async queryById(id: string, options: VectorQueryOptions = {}): Promise<VectorQueryResult> {
    const scope = resolveVectorScope(options, this.options);
    const file = await this.read();
    const normalizedId = validateVectorId(id);
    const source = file.vectors[compositeKey(scope.modelSpace, scope.namespace, normalizedId)];
    if (!source) return { matches: [], count: 0 };
    return this.query(source.values, {
      ...options,
      excludeIds: options.includeQueryVector
        ? options.excludeIds
        : Array.from(new Set([...(options.excludeIds ?? []), normalizedId])),
    });
  }

  async delete(ids: readonly string[], scopeInput?: VectorScope): Promise<VectorMutationResult> {
    const scope = resolveVectorScope(scopeInput, this.options);
    const normalized = Array.from(new Set(ids.map(validateVectorId)));
    let count = 0;
    await this.withWriteLock(async () => {
      const current = await this.read();
      const file = { ...current, vectors: { ...current.vectors } };
      for (const id of normalized) {
        const key = compositeKey(scope.modelSpace, scope.namespace, id);
        if (file.vectors[key]) {
          delete file.vectors[key];
          count += 1;
        }
      }
      if (count > 0) await this.write(file);
    });
    return { ids: normalized, count };
  }

  async getByIds(ids: readonly string[], options: VectorLookupOptions = {}): Promise<VectorRecord[]> {
    const scope = resolveVectorScope(options, this.options);
    const file = await this.read();
    return ids.flatMap((candidate) => {
      const id = validateVectorId(candidate);
      const vector = file.vectors[compositeKey(scope.modelSpace, scope.namespace, id)];
      if (!vector) return [];
      return [{
        id,
        modelSpace: vector.modelSpace,
        namespace: vector.namespace,
        metadata: options.includeMetadata === false ? undefined : vector.metadata,
        values: options.includeValues ? [...vector.values] : undefined,
      }];
    });
  }

  async describe(): Promise<VectorIndexDescription> {
    const file = await this.read();
    return {
      backend: "files-first",
      dimensions: file.dimensions,
      vectorCount: Object.keys(file.vectors).length,
      metric: "cosine",
      storageKey: this.storageKey,
    };
  }

  private async read(): Promise<StoredVectorFile> {
    if (!this.readCache) {
      this.readCache = this.readFromStorage();
    }

    try {
      return await this.readCache;
    } catch (error) {
      this.readCache = null;
      throw error;
    }
  }

  private async readFromStorage(): Promise<StoredVectorFile> {
    const raw = await this.storage.getText(this.storageKey);
    if (!raw) return this.empty();
    try {
      const parsed = JSON.parse(raw) as Partial<StoredVectorFile>;
      if (
        parsed.version !== FILE_VERSION ||
        parsed.dimensions !== this.options.dimensions ||
        parsed.metric !== "cosine" ||
        !parsed.vectors ||
        typeof parsed.vectors !== "object"
      ) {
        throw new Error("Incompatible vector index file");
      }
      return parsed as StoredVectorFile;
    } catch (error) {
      throw new Error(`Could not read ${this.storageKey}: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }

  private empty(): StoredVectorFile {
    return {
      version: FILE_VERSION,
      dimensions: this.options.dimensions,
      metric: "cosine",
      updatedAt: new Date().toISOString(),
      vectors: {},
    };
  }

  private async write(file: StoredVectorFile): Promise<void> {
    file.updatedAt = new Date().toISOString();
    await this.storage.put(this.storageKey, JSON.stringify(file), "application/json");
    this.readCache = Promise.resolve(file);
  }

  private async withWriteLock(operation: () => Promise<void>): Promise<void> {
    const task = this.writeLock.catch(() => undefined).then(operation);
    this.writeLock = task.catch(() => undefined);
    await task;
  }
}
