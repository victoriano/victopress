import type { GalleryDataEntry, GalleryPhotoEntry } from "../content-engine/content-index";
import { getContentIndex } from "../content-engine/content-index";
import { getStorage } from "../content-engine/storage";
import type { StorageAdapter } from "../content-engine/types";
import {
  AiConfigurationError,
  AiRecordStore,
  buildGalleryTaxonomyCatalog,
  createPhotoAiRecord,
  createPhotoAssetIdentity,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  GeminiPhotoAiProvider,
  type PhotoAiRecord,
} from "./index";
import {
  createPhotoAiJob,
  enqueuePhotoAiPaths,
  nextPendingPhotoAiItems,
  readPhotoAiJob,
  summarizePhotoAiJob,
  writePhotoAiJob,
  type PhotoAiJob,
  type PhotoAiJobItem,
} from "./job-store";
import {
  findPhotoAiSearchDocumentByPath,
  mergeSearchTags,
  readPhotoAiSearchIndex,
  upsertPhotoAiSearchDocument,
  writePhotoAiSearchIndex,
  type PhotoAiSearchDocument,
} from "./search-index";
import {
  createPhotoVectorIndex,
  type PhotoVectorEnv,
  type VectorIndex,
} from "./vector-index";
import { projectEmbeddingMap } from "./embedding-map";

export interface PhotoAiEnv extends PhotoVectorEnv {
  PHOTO_AI_ENABLED?: string | boolean;
  GEMINI_API_KEY?: string;
  GEMINI_ANALYSIS_MODEL?: string;
  GEMINI_EMBEDDING_MODEL?: string;
  GEMINI_EMBEDDING_DIMENSIONS?: string | number;
}

export interface PhotoAiContext {
  cloudflare?: { env?: unknown };
}

interface IndexedPhotoSource {
  gallery: GalleryDataEntry;
  photo: GalleryPhotoEntry;
}

interface PhotoAiRuntime {
  storage: StorageAdapter;
  env: PhotoAiEnv;
  recordStore: AiRecordStore;
  vectorIndex: VectorIndex;
  provider: GeminiPhotoAiProvider;
}

export interface PhotoAiDashboardRecord {
  assetId: string;
  path: string;
  filename: string;
  gallerySlug: string;
  caption: string;
  tags: string[];
  status: "pending" | "completed" | "failed";
  error?: string;
  suggestions: Array<{
    gallerySlug: string;
    galleryTitle: string;
    confidence: number;
    reason: string;
    status: string;
    alreadyCurrent: boolean;
  }>;
}

export interface PhotoAiMapData {
  nodes: Array<{
    assetId: string;
    path: string;
    filename: string;
    caption: string;
    tags: string[];
    gallerySlug: string;
    gallerySlugs: string[];
    x: number;
    y: number;
    clusterId: number;
  }>;
  edges: Array<{ source: string; target: string }>;
  clusters: Array<{ id: number; label: string; count: number; x: number; y: number }>;
  tags: string[];
  galleries: Array<{ slug: string; title: string }>;
}

const PHOTO_AI_MAP_CACHE_KEY = ".victopress/ai/embedding-map.json";
const PHOTO_AI_MAP_CACHE_VERSION = 1 as const;

interface PhotoAiMapCacheFile {
  version: typeof PHOTO_AI_MAP_CACHE_VERSION;
  contentUpdatedAt: string;
  searchUpdatedAt: string;
  data: PhotoAiMapData;
}

function parsePhotoAiMapCache(
  raw: string | null,
  contentUpdatedAt: string,
  searchUpdatedAt: string,
): PhotoAiMapData | null {
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as Partial<PhotoAiMapCacheFile>;
    const data = cached.data;
    if (
      cached.version !== PHOTO_AI_MAP_CACHE_VERSION ||
      cached.contentUpdatedAt !== contentUpdatedAt ||
      cached.searchUpdatedAt !== searchUpdatedAt ||
      !data ||
      !Array.isArray(data.nodes) ||
      !Array.isArray(data.edges) ||
      !Array.isArray(data.clusters) ||
      !Array.isArray(data.tags) ||
      !Array.isArray(data.galleries)
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function envRecord(context: PhotoAiContext): Record<string, unknown> {
  const candidate = context.cloudflare?.env;
  return candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : {};
}

function readEnvString(
  context: PhotoAiContext,
  name: keyof PhotoAiEnv,
): string | undefined {
  const value = envRecord(context)[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "boolean") return String(value);
  const processValue = typeof process !== "undefined" ? process.env[String(name)] : undefined;
  return processValue?.trim() || undefined;
}

export function getPhotoAiConfiguration(context: PhotoAiContext) {
  const apiKey = readEnvString(context, "GEMINI_API_KEY");
  const enabledValue = readEnvString(context, "PHOTO_AI_ENABLED");
  const explicitlyDisabled = /^(0|false|no|off)$/i.test(enabledValue ?? "");
  const enabled = Boolean(apiKey) && !explicitlyDisabled;
  const dimensionValue =
    readEnvString(context, "GEMINI_EMBEDDING_DIMENSIONS") ??
    envRecord(context).GEMINI_EMBEDDING_DIMENSIONS;
  const parsedDimensions = Number(dimensionValue ?? DEFAULT_EMBEDDING_DIMENSIONS);
  return {
    enabled,
    apiKey,
    analysisModel: readEnvString(context, "GEMINI_ANALYSIS_MODEL") ?? DEFAULT_ANALYSIS_MODEL,
    embeddingModel: readEnvString(context, "GEMINI_EMBEDDING_MODEL") ?? DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: Number.isSafeInteger(parsedDimensions)
      ? parsedDimensions
      : DEFAULT_EMBEDDING_DIMENSIONS,
  };
}

/** Photo AI is opt-in: a user-supplied key enables it unless explicitly disabled. */
export function isPhotoAiEnabled(context: PhotoAiContext): boolean {
  return getPhotoAiConfiguration(context).enabled;
}

function getPhotoAiEnv(context: PhotoAiContext): PhotoAiEnv {
  return envRecord(context) as PhotoAiEnv;
}

function createRuntime(context: PhotoAiContext, requireGemini = true): PhotoAiRuntime {
  const storage = getStorage(context as Parameters<typeof getStorage>[0]);
  const config = getPhotoAiConfiguration(context);
  if (requireGemini && !config.enabled) {
    throw new AiConfigurationError(
      "Photo AI is disabled. Add your own GEMINI_API_KEY to enable this optional feature",
    );
  }
  if (requireGemini && !config.apiKey) {
    throw new AiConfigurationError("GEMINI_API_KEY is not configured");
  }

  // A placeholder is safe only for operations that never invoke the provider.
  const provider = new GeminiPhotoAiProvider({
    apiKey: config.apiKey ?? "not-configured-for-read-only-operation",
    analysisModel: config.analysisModel,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
  });
  const env = getPhotoAiEnv(context);
  return {
    storage,
    env,
    provider,
    recordStore: new AiRecordStore(storage),
    vectorIndex: createPhotoVectorIndex(env, storage, {
      dimensions: config.embeddingDimensions,
      defaultModelSpace: `${config.embeddingModel}:${config.embeddingDimensions}`,
      defaultNamespace: "photos",
    }),
  };
}

function flattenPhotoSources(galleries: readonly GalleryDataEntry[]): IndexedPhotoSource[] {
  return galleries.flatMap((gallery) =>
    gallery.photos
      .filter((photo) => !photo.isReference)
      .map((photo) => ({ gallery, photo })),
  );
}

function findPhotoSource(
  galleries: readonly GalleryDataEntry[],
  path: string,
): IndexedPhotoSource | undefined {
  return flattenPhotoSources(galleries).find((source) => source.photo.path === path);
}

function imageMimeType(path: string): "image/jpeg" | "image/png" {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  throw new Error(`Gemini Embedding 2 cannot index this image format: ${path}`);
}

async function loadRecordMap(
  store: AiRecordStore,
  galleries: readonly GalleryDataEntry[],
): Promise<Map<string, PhotoAiRecord>> {
  const files = await Promise.all(
    galleries.map(async (gallery) => store.listGalleryRecords(gallery.slug)),
  );
  return new Map(files.flat().map((record) => [record.asset.sourcePath, record]));
}

function isCurrentRecord(
  record: PhotoAiRecord | undefined,
  source: IndexedPhotoSource,
  taxonomyVersion: string,
  config: ReturnType<typeof getPhotoAiConfiguration>,
  promptVersion: string,
): boolean {
  if (!record?.analysis || !record.embedding) return false;
  return (
    record.asset.sourcePath === source.photo.path &&
    (!source.photo.lastModified || record.asset.lastModified === source.photo.lastModified) &&
    record.analysis.model === config.analysisModel &&
    record.analysis.promptVersion === promptVersion &&
    record.analysis.taxonomyVersion === taxonomyVersion &&
    record.embedding.status === "ready" &&
    record.embedding.model === config.embeddingModel &&
    record.embedding.dimensions === config.embeddingDimensions
  );
}

function jobItemForSource(source: IndexedPhotoSource) {
  return {
    path: source.photo.path,
    gallerySlug: source.gallery.slug,
    filename: source.photo.filename,
    hidden: source.photo.hidden === true,
    protected: source.gallery.isProtected,
  };
}

export async function startPhotoAiJob(context: PhotoAiContext): Promise<{
  job: PhotoAiJob;
  done: boolean;
  remaining: number;
}> {
  const runtime = createRuntime(context);
  const content = await getContentIndex(runtime.storage);
  const taxonomy = await buildGalleryTaxonomyCatalog(content.galleryData);
  const records = await loadRecordMap(runtime.recordStore, content.galleryData);
  const config = getPhotoAiConfiguration(context);
  const sources = flattenPhotoSources(content.galleryData);

  const eligible = sources.filter((source) => !source.gallery.isProtected);
  const stale = eligible.filter((source) =>
    !isCurrentRecord(
      records.get(source.photo.path),
      source,
      taxonomy.version,
      config,
      runtime.provider.promptVersion,
    ),
  );
  const job = createPhotoAiJob({
    items: stale.map(jobItemForSource),
    analysisModel: config.analysisModel,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    taxonomyVersion: taxonomy.version,
  });
  await writePhotoAiJob(runtime.storage, job);
  return { job, done: stale.length === 0, remaining: stale.length };
}

async function analyzePhotoSource(
  runtime: PhotoAiRuntime,
  source: IndexedPhotoSource,
  galleries: readonly GalleryDataEntry[],
): Promise<{ record: PhotoAiRecord; document: PhotoAiSearchDocument }> {
  if (source.gallery.isProtected) throw new Error("Protected galleries are not analyzed by default");
  const bytes = await runtime.storage.get(source.photo.path);
  if (!bytes) throw new Error(`Photo could not be read: ${source.photo.path}`);

  const identity = await createPhotoAssetIdentity({
    bytes,
    sourcePath: source.photo.path,
    filename: source.photo.filename,
    gallerySlug: source.gallery.slug,
    lastModified: source.photo.lastModified,
  });
  const existingRecord = await runtime.recordStore.getRecord(
    source.gallery.slug,
    identity.assetId,
  );
  const taxonomy = await buildGalleryTaxonomyCatalog(galleries);
  const currentGallerySlugs = galleries
    .filter((gallery) => gallery.photos.some((photo) => photo.path === source.photo.path))
    .map((gallery) => gallery.slug);
  const mimeType = imageMimeType(source.photo.path);
  const canReuseEmbedding =
    existingRecord?.embedding?.status === "ready" &&
    existingRecord.embedding.model === runtime.provider.embeddingModel &&
    existingRecord.embedding.dimensions === runtime.provider.embeddingDimensions &&
    existingRecord.embedding.sourceFingerprint === identity.sourceFingerprint;
  const [analysis, embedding] = await Promise.all([
    runtime.provider.analyzePhoto({
      image: bytes,
      mimeType,
      taxonomy,
      currentGallerySlugs,
      language: "es",
    }),
    canReuseEmbedding
      ? Promise.resolve(null)
      : runtime.provider.embedImage({ image: bytes, mimeType }),
  ]);

  if (embedding) {
    await runtime.vectorIndex.upsert([
      {
        id: identity.assetId,
        values: embedding.values,
        modelSpace: `${embedding.model}:${embedding.dimensions}`,
        namespace: "photos",
        metadata: {
          gallerySlug: source.gallery.slug,
          hidden: source.photo.hidden === true,
          protected: source.gallery.isProtected,
        },
      },
    ]);
  }

  const embeddingReference = embedding
    ? {
        status: "ready" as const,
        model: embedding.model,
        dimensions: embedding.dimensions,
        vectorId: identity.assetId,
        sourceFingerprint: identity.sourceFingerprint,
        generatedAt: new Date().toISOString(),
      }
    : existingRecord!.embedding!;

  const candidate = createPhotoAiRecord({
    asset: identity,
    analysis,
    embedding: embeddingReference,
  });
  const record = await runtime.recordStore.upsertRecord(source.gallery.slug, candidate);
  const document: PhotoAiSearchDocument = {
    assetId: identity.assetId,
    path: source.photo.path,
    filename: source.photo.filename,
    gallerySlug: source.gallery.slug,
    galleryTitle: source.gallery.title,
    title: source.photo.title,
    description: source.photo.description,
    caption: record.analysis?.caption ?? "",
    tags: mergeSearchTags(source.photo.tags, record.analysis?.tags),
    year: source.photo.year,
    hidden: source.photo.hidden === true,
    protected: source.gallery.isProtected,
    vectorId: identity.assetId,
    sourceFingerprint: identity.sourceFingerprint,
    model: embeddingReference.model,
    taxonomyVersion: taxonomy.version,
    gallerySuggestions: (record.analysis?.gallerySuggestions ?? []).map((suggestion) => ({
      slug: suggestion.gallerySlug,
      confidence: suggestion.confidence,
      status: suggestion.status,
      alreadyCurrent: suggestion.alreadyCurrent,
    })),
    updatedAt: new Date().toISOString(),
  };
  await upsertPhotoAiSearchDocument(runtime.storage, document);
  return { record, document };
}

export async function processPhotoAiJobBatch(
  context: PhotoAiContext,
  batchSize = 2,
): Promise<{
  job: PhotoAiJob;
  processed: number;
  done: boolean;
  remaining: number;
}> {
  const runtime = createRuntime(context);
  const content = await getContentIndex(runtime.storage);
  let job = await readPhotoAiJob(runtime.storage);
  if (!job) job = (await startPhotoAiJob(context)).job;

  const taxonomy = await buildGalleryTaxonomyCatalog(content.galleryData);
  if (job.taxonomyVersion !== taxonomy.version) {
    job = (await startPhotoAiJob(context)).job;
  }

  const items = nextPendingPhotoAiItems(job, batchSize);
  for (const item of items) {
    item.attempts += 1;
    item.updatedAt = new Date().toISOString();
    try {
      const source = findPhotoSource(content.galleryData, item.path);
      if (!source) throw new Error(`Photo is no longer present in the content index: ${item.path}`);
      const { record } = await analyzePhotoSource(runtime, source, content.galleryData);
      item.assetId = record.asset.assetId;
      item.status = "completed";
      item.error = undefined;
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "Photo analysis failed";
    }
  }

  const summary = summarizePhotoAiJob(job);
  job.status = summary.done ? "completed" : "running";
  await writePhotoAiJob(runtime.storage, job);
  return {
    job,
    processed: items.length,
    done: summary.done,
    remaining: summary.pending,
  };
}

export async function analyzePhotoByPath(
  context: PhotoAiContext,
  path: string,
): Promise<PhotoAiRecord> {
  const runtime = createRuntime(context);
  const content = await getContentIndex(runtime.storage);
  const source = findPhotoSource(content.galleryData, path);
  if (!source) throw new Error("Photo was not found");
  return (await analyzePhotoSource(runtime, source, content.galleryData)).record;
}

export async function retryPhotoAiAsset(
  context: PhotoAiContext,
  assetId: string,
): Promise<PhotoAiRecord> {
  const runtime = createRuntime(context);
  const searchIndex = await readPhotoAiSearchIndex(runtime.storage);
  const existing = searchIndex.documents[assetId];
  if (existing) return analyzePhotoByPath(context, existing.path);

  const job = await readPhotoAiJob(runtime.storage);
  const item = job?.items.find((candidate) => candidate.assetId === assetId);
  if (!item) throw new Error("Photo analysis job item was not found");
  return analyzePhotoByPath(context, item.path);
}

export async function reviewPhotoGallerySuggestion(
  context: PhotoAiContext,
  assetId: string,
  suggestedGallerySlug: string,
  decision: "accepted" | "rejected",
): Promise<PhotoAiRecord> {
  const runtime = createRuntime(context, false);
  const index = await readPhotoAiSearchIndex(runtime.storage);
  const document = index.documents[assetId];
  if (!document) throw new Error("Analyzed photo was not found");

  const record = await runtime.recordStore.reviewGallerySuggestion(
    document.gallerySlug,
    assetId,
    suggestedGallerySlug,
    decision,
  );
  document.gallerySuggestions = (record.analysis?.gallerySuggestions ?? []).map((suggestion) => ({
    slug: suggestion.gallerySlug,
    confidence: suggestion.confidence,
    status: suggestion.status,
    alreadyCurrent: suggestion.alreadyCurrent,
  }));
  await writePhotoAiSearchIndex(runtime.storage, index);
  return record;
}

export async function getPhotoAiDashboard(context: PhotoAiContext) {
  const runtime = createRuntime(context, false);
  const config = getPhotoAiConfiguration(context);
  const content = await getContentIndex(runtime.storage);
  const taxonomy = await buildGalleryTaxonomyCatalog(content.galleryData);
  const recordMap = await loadRecordMap(runtime.recordStore, content.galleryData);
  const job = await readPhotoAiJob(runtime.storage);
  const galleryTitles = new Map(content.galleryData.map((gallery) => [gallery.slug, gallery.title]));
  const failureByPath = new Map(
    (job?.items ?? [])
      .filter((item) => item.status === "failed")
      .map((item) => [item.path, item.error]),
  );
  const sources = flattenPhotoSources(content.galleryData);
  const eligibleSources = sources.filter((source) => !source.gallery.isProtected);
  const currentRecords = eligibleSources.filter((source) =>
    isCurrentRecord(
      recordMap.get(source.photo.path),
      source,
      taxonomy.version,
      config,
      runtime.provider.promptVersion,
    ),
  );

  let vectorBackend = "files-first";
  try {
    vectorBackend = (await runtime.vectorIndex.describe()).backend;
  } catch {
    // The dashboard remains usable while a remote vector binding is unavailable.
  }

  const records: PhotoAiDashboardRecord[] = [];
  for (const [path, record] of recordMap) {
    const source = findPhotoSource(content.galleryData, path);
    if (!source) continue;
    const failedError = failureByPath.get(path);
    records.push({
      assetId: record.asset.assetId,
      path,
      filename: record.asset.filename,
      gallerySlug: record.asset.gallerySlug,
      caption: record.analysis?.caption ?? "",
      tags: record.analysis?.tags ?? [],
      status: failedError
        ? "failed"
        : isCurrentRecord(
            record,
            source,
            taxonomy.version,
            config,
            runtime.provider.promptVersion,
          )
          ? "completed"
          : "pending",
      error: failedError,
      suggestions: (record.analysis?.gallerySuggestions ?? []).map((suggestion) => ({
        gallerySlug: suggestion.gallerySlug,
        galleryTitle: galleryTitles.get(suggestion.gallerySlug) ?? suggestion.gallerySlug,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        status: suggestion.status,
        alreadyCurrent: suggestion.alreadyCurrent,
      })),
    });
  }
  records.sort((a, b) => b.status.localeCompare(a.status) || a.path.localeCompare(b.path));

  const failed = failureByPath.size;
  return {
    enabled: config.enabled,
    configured: config.enabled && Boolean(config.apiKey),
    model: config.analysisModel,
    embeddingModel: `${config.embeddingModel} (${config.embeddingDimensions}d)`,
    vectorBackend,
    summary: {
      total: sources.length,
      eligible: eligibleSources.length,
      pending: Math.max(0, eligibleSources.length - currentRecords.length - failed),
      completed: currentRecords.length,
      failed,
      skippedProtected: sources.length - eligibleSources.length,
    },
    records,
  };
}

/** Builds a server-side 2D projection; raw embeddings are never returned. */
export async function getPhotoAiMap(context: PhotoAiContext): Promise<PhotoAiMapData> {
  const runtime = createRuntime(context, false);
  const [content, searchIndex, cachedMapRaw] = await Promise.all([
    getContentIndex(runtime.storage),
    readPhotoAiSearchIndex(runtime.storage),
    runtime.storage.getText(PHOTO_AI_MAP_CACHE_KEY),
  ]);
  const cachedMap = parsePhotoAiMapCache(
    cachedMapRaw,
    content.updatedAt,
    searchIndex.updatedAt,
  );
  if (cachedMap) return cachedMap;

  const documents = Object.values(searchIndex.documents)
    // Admin exploration includes hidden photos; protected sources are never analyzed.
    .filter((document) => !document.protected)
    .sort((left, right) => left.path.localeCompare(right.path));
  const ids = documents.map((document) => document.assetId);
  const vectorBatches = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 100) }, (_, batchIndex) =>
      runtime.vectorIndex.getByIds(ids.slice(batchIndex * 100, (batchIndex + 1) * 100), {
        includeMetadata: false,
        includeValues: true,
      }),
    ),
  );
  const vectors = vectorBatches.flat() as Awaited<ReturnType<VectorIndex["getByIds"]>>;
  const documentById = new Map(documents.map((document) => [document.assetId, document]));
  const projection = projectEmbeddingMap(
    vectors.flatMap((vector) => {
      const document = documentById.get(vector.id);
      return document && vector.values
        ? [{ id: vector.id, values: vector.values, tags: document.tags }]
        : [];
    }),
  );
  const pointById = new Map(projection.points.map((point) => [point.id, point]));
  const membershipsByPath = new Map<string, string[]>();
  for (const gallery of content.galleryData) {
    for (const photo of gallery.photos) {
      const slugs = membershipsByPath.get(photo.path) ?? [];
      if (!slugs.includes(gallery.slug)) slugs.push(gallery.slug);
      membershipsByPath.set(photo.path, slugs);
    }
  }
  const nodes = documents.flatMap((document) => {
    const point = pointById.get(document.assetId);
    if (!point) return [];
    return [{
      assetId: document.assetId,
      path: document.path,
      filename: document.filename,
      caption: document.caption,
      tags: document.tags,
      gallerySlug: document.gallerySlug,
      gallerySlugs: (membershipsByPath.get(document.path) ?? [document.gallerySlug]).sort(),
      x: point.x,
      y: point.y,
      clusterId: point.clusterId,
    }];
  });
  const visibleIds = new Set(nodes.map((node) => node.assetId));
  const tags = Array.from(
    new Map(
      nodes.flatMap((node) => node.tags.map((tag) => [tag.toLocaleLowerCase(), tag] as const)),
    ).values(),
  ).sort((left, right) => left.localeCompare(right));
  const galleries = content.galleryData
    .filter((gallery) => !gallery.isProtected && !gallery.isParentGallery)
    .map((gallery) => ({ slug: gallery.slug, title: gallery.title }))
    .sort((left, right) => left.title.localeCompare(right.title));

  const data: PhotoAiMapData = {
    nodes,
    edges: projection.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    ),
    clusters: projection.clusters,
    tags,
    galleries,
  };
  const cache: PhotoAiMapCacheFile = {
    version: PHOTO_AI_MAP_CACHE_VERSION,
    contentUpdatedAt: content.updatedAt,
    searchUpdatedAt: searchIndex.updatedAt,
    data,
  };
  await runtime.storage.put(
    PHOTO_AI_MAP_CACHE_KEY,
    JSON.stringify(cache),
    "application/json",
  );
  return data;
}

export async function enqueueUploadedPhotosForAi(
  context: PhotoAiContext,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  const feature = getPhotoAiConfiguration(context);
  if (!feature.enabled || !feature.apiKey) return;
  const runtime = createRuntime(context, false);
  const content = await getContentIndex(runtime.storage);
  const taxonomy = await buildGalleryTaxonomyCatalog(content.galleryData);
  const config = getPhotoAiConfiguration(context);
  const sources = paths
    .map((path) => findPhotoSource(content.galleryData, path))
    .filter((source): source is IndexedPhotoSource => Boolean(source && !source.gallery.isProtected));
  if (sources.length === 0) return;

  let job = await readPhotoAiJob(runtime.storage);
  if (
    !job ||
    job.analysisModel !== config.analysisModel ||
    job.embeddingModel !== config.embeddingModel ||
    job.taxonomyVersion !== taxonomy.version
  ) {
    job = createPhotoAiJob({
      items: [],
      analysisModel: config.analysisModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      taxonomyVersion: taxonomy.version,
    });
  }
  enqueuePhotoAiPaths(job, sources.map(jobItemForSource));
  await writePhotoAiJob(runtime.storage, job);
}

/**
 * Removes rebuildable AI projections after a source photo is deleted or moved.
 * This never mutates the source gallery metadata and is safe when no AI data exists.
 */
export async function removePhotoAiProjectionsByPaths(
  context: PhotoAiContext,
  paths: readonly string[],
): Promise<void> {
  const uniquePaths = new Set(paths.map((path) => path.trim()).filter(Boolean));
  if (uniquePaths.size === 0) return;

  const runtime = createRuntime(context, false);
  const index = await readPhotoAiSearchIndex(runtime.storage);
  const documents = Object.values(index.documents).filter((document) =>
    uniquePaths.has(document.path),
  );

  for (const document of documents) {
    await runtime.recordStore.deleteRecord(document.gallerySlug, document.assetId);
    delete index.documents[document.assetId];
  }
  if (documents.length > 0) await writePhotoAiSearchIndex(runtime.storage, index);

  // The files/search projection is authoritative for cleanup. A remote vector
  // deletion failure must not make a normal CMS delete fail.
  for (const [model, ids] of groupDocumentsByModel(documents)) {
    try {
      await runtime.vectorIndex.delete(ids, {
        modelSpace: `${model}:${getPhotoAiConfiguration(context).embeddingDimensions}`,
        namespace: "photos",
      });
    } catch (error) {
      console.warn("[Photo AI] Could not remove stale vectors", error);
    }
  }

  const job = await readPhotoAiJob(runtime.storage);
  if (job) {
    const remaining = job.items.filter((item) => !uniquePaths.has(item.path));
    if (remaining.length !== job.items.length) {
      job.items = remaining;
      await writePhotoAiJob(runtime.storage, job);
    }
  }
}

/** Keeps hidden photos out of public AI results without re-running Gemini. */
export async function setPhotoAiVisibilityByPaths(
  context: PhotoAiContext,
  paths: readonly string[],
  hidden: boolean,
): Promise<void> {
  const uniquePaths = new Set(paths.map((path) => path.trim()).filter(Boolean));
  if (uniquePaths.size === 0) return;

  const runtime = createRuntime(context, false);
  const index = await readPhotoAiSearchIndex(runtime.storage);
  const documents = Object.values(index.documents).filter((document) =>
    uniquePaths.has(document.path),
  );
  if (documents.length === 0) return;

  for (const document of documents) document.hidden = hidden;
  await writePhotoAiSearchIndex(runtime.storage, index);

  const dimensions = getPhotoAiConfiguration(context).embeddingDimensions;
  for (const [model, ids] of groupDocumentsByModel(documents)) {
    try {
      const modelSpace = `${model}:${dimensions}`;
      const vectors = await runtime.vectorIndex.getByIds(ids, {
        modelSpace,
        namespace: "photos",
        includeMetadata: true,
        includeValues: true,
      });
      await runtime.vectorIndex.upsert(vectors.flatMap((vector) =>
        vector.values
          ? [{
              id: vector.id,
              values: vector.values,
              modelSpace,
              namespace: "photos",
              metadata: { ...vector.metadata, hidden },
            }]
          : [],
      ));
    } catch (error) {
      // Public queries also post-filter the search document, so privacy is
      // preserved even while a remote vector metadata update is unavailable.
      console.warn("[Photo AI] Could not update vector visibility", error);
    }
  }
}

function groupDocumentsByModel(
  documents: readonly PhotoAiSearchDocument[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const document of documents) {
    const ids = groups.get(document.model) ?? [];
    ids.push(document.vectorId);
    groups.set(document.model, ids);
  }
  return groups;
}

export async function getSimilarPhotoDocuments(
  context: PhotoAiContext,
  path: string,
  limit = 8,
): Promise<Array<{ document: PhotoAiSearchDocument; score: number }>> {
  if (!isPhotoAiEnabled(context)) return [];
  const runtime = createRuntime(context, false);
  const index = await readPhotoAiSearchIndex(runtime.storage);
  const source = findPhotoAiSearchDocumentByPath(index, path);
  if (!source || source.hidden || source.protected) return [];

  const result = await runtime.vectorIndex.queryById(source.vectorId, {
    topK: Math.min(50, Math.max(1, limit + 1)),
    modelSpace: `${source.model}:${getPhotoAiConfiguration(context).embeddingDimensions}`,
    namespace: "photos",
    filter: { hidden: false, protected: false },
    includeQueryVector: false,
  });
  return result.matches
    .map((match) => ({ document: index.documents[match.id], score: match.score }))
    .filter((item): item is { document: PhotoAiSearchDocument; score: number } =>
      Boolean(item.document && !item.document.hidden && !item.document.protected),
    )
    .slice(0, limit);
}

function lexicalScore(document: PhotoAiSearchDocument, query: string): number {
  const tokens = query.toLocaleLowerCase().split(/\s+/).filter((token) => token.length > 1);
  if (tokens.length === 0) return 0;
  const haystack = [
    document.title,
    document.description,
    document.caption,
    document.galleryTitle,
    ...document.tags,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

export async function searchPhotoDocuments(
  context: PhotoAiContext,
  query: string,
  options: { gallerySlug?: string; limit?: number } = {},
) {
  const normalizedQuery = query.trim().slice(0, 500);
  if (!normalizedQuery) return { photos: [], galleries: [] };
  const runtime = createRuntime(context);
  const index = await readPhotoAiSearchIndex(runtime.storage);
  const embedding = await runtime.provider.embedText({ text: normalizedQuery });
  const result = await runtime.vectorIndex.query(embedding.values, {
    topK: 50,
    modelSpace: `${embedding.model}:${embedding.dimensions}`,
    namespace: "photos",
    filter: { hidden: false, protected: false },
  });

  const gallerySlug = options.gallerySlug?.trim();
  const photos = result.matches
    .map((match) => ({ document: index.documents[match.id], vectorScore: match.score }))
    .filter((item): item is { document: PhotoAiSearchDocument; vectorScore: number } => {
      if (!item.document || item.document.hidden || item.document.protected) return false;
      if (!gallerySlug) return true;
      return (
        item.document.gallerySlug === gallerySlug ||
        item.document.gallerySuggestions.some(
          (suggestion) => suggestion.slug === gallerySlug && suggestion.status === "accepted",
        )
      );
    })
    .map(({ document, vectorScore }) => ({
      document,
      score: vectorScore * 0.85 + lexicalScore(document, normalizedQuery) * 0.15,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(50, Math.max(1, options.limit ?? 40)));

  const galleryCounts = new Map<string, { slug: string; title: string; count: number }>();
  for (const document of Object.values(index.documents)) {
    if (document.hidden || document.protected) continue;
    const current = galleryCounts.get(document.gallerySlug) ?? {
      slug: document.gallerySlug,
      title: document.galleryTitle,
      count: 0,
    };
    current.count += 1;
    galleryCounts.set(document.gallerySlug, current);
  }
  return {
    photos,
    galleries: Array.from(galleryCounts.values()).sort((a, b) => a.title.localeCompare(b.title)),
  };
}
