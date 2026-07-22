#!/usr/bin/env bun

import { R2ApiAdapter } from "../app/lib/content-engine/storage/r2-api-adapter";
import { getContentIndex } from "../app/lib/content-engine/content-index";
import {
  enqueuePhotoMetadataWritebacksInStorage,
  PHOTO_METADATA_WRITEBACK_FAILED_PREFIX,
  PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX,
  processPhotoMetadataWritebackBatchInStorage,
} from "../app/lib/ai/photo-metadata-writeback.server";
import { AiRecordStore } from "../app/lib/ai/record-store";
import { readPhotoAiSearchIndex } from "../app/lib/ai/search-index";
import {
  canonicalizeImageBytes,
  createCanonicalImageSourceFingerprint,
  readVictoPressEmbeddedMetadata,
} from "../app/lib/content-engine/victopress-xmp";

const DEFAULT_PROCESS_BATCH_SIZE = 48;
const DEFAULT_VERIFY_CONCURRENCY = 6;
const AUDIT_PREFIX = ".victopress/metadata-writeback/v1/audits";

type Mode = "canary" | "all" | "verify";

interface VerificationSummary {
  checked: number;
  valid: number;
  missing: string[];
  invalid: Array<{ path: string; error: string }>;
  withAi: number;
  withSearchIndex: number;
  withVectorValues: number;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Run with --env-file=.dev.vars.`);
  return value;
}

function integerArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.slice(prefix.length), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${prefix}<n> must be a positive integer`);
  }
  return value;
}

function stringArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function selectedMode(): Mode {
  const modes = (["canary", "all", "verify"] as const)
    .filter((mode) => process.argv.includes(`--${mode}`));
  if (modes.length !== 1) {
    throw new Error("Choose exactly one mode: --canary, --all, or --verify");
  }
  return modes[0];
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await operation(values[index]);
    }
  });
  await Promise.all(workers);
}

async function verifyWriteAccess(storage: R2ApiAdapter): Promise<void> {
  const key = `.victopress/health/metadata-writeback-${crypto.randomUUID()}.txt`;
  const marker = crypto.randomUUID();
  try {
    await storage.put(key, marker, "text/plain");
    if (await storage.getText(key) !== marker) {
      throw new Error("R2 reversible write check returned different bytes");
    }
  } finally {
    await storage.delete(key);
  }
}

async function sourcePaths(storage: R2ApiAdapter): Promise<{
  paths: string[];
  photos: Map<string, {
    title?: string;
    description?: string;
    tags?: string[];
    sourceFingerprint?: string;
  }>;
}> {
  const content = await getContentIndex(storage);
  const photos = new Map<string, {
    title?: string;
    description?: string;
    tags?: string[];
    sourceFingerprint?: string;
  }>();
  for (const gallery of content.galleryData) {
    for (const photo of gallery.photos) {
      if (photo.isReference || !/\.(?:jpe?g|png)$/i.test(photo.path)) continue;
      if (!photos.has(photo.path)) photos.set(photo.path, photo);
    }
  }
  return {
    paths: [...photos.keys()].sort((left, right) => left.localeCompare(right)),
    photos,
  };
}

async function verifyOne(
  storage: R2ApiAdapter,
  path: string,
  expectedPhoto?: {
    title?: string;
    description?: string;
    tags?: string[];
  },
): Promise<{
  withAi: boolean;
  withSearchIndex: boolean;
  withVectorValues: boolean;
}> {
  const bytes = await storage.get(path);
  if (!bytes) throw new Error("source object is missing");
  const metadata = readVictoPressEmbeddedMetadata(bytes);
  if (!metadata) throw new Error("VictoPress XMP payload is missing");
  const fingerprint = await createCanonicalImageSourceFingerprint(bytes);
  const canonicalLength = canonicalizeImageBytes(bytes).byteLength;
  if (metadata.source.path !== path) throw new Error("embedded source path differs");
  if (metadata.source.sourceFingerprint !== fingerprint) {
    throw new Error("embedded fingerprint does not match canonical image bytes");
  }
  if (metadata.source.canonicalByteLength !== canonicalLength) {
    throw new Error("embedded canonical byte length differs");
  }
  if (expectedPhoto) {
    if ((metadata.editorial.title ?? undefined) !== (expectedPhoto.title ?? undefined)) {
      throw new Error("editorial title differs from the content index");
    }
    if ((metadata.editorial.description ?? undefined) !== (expectedPhoto.description ?? undefined)) {
      throw new Error("editorial description differs from the content index");
    }
    if (!arraysEqual(metadata.editorial.tags, expectedPhoto.tags ?? [])) {
      throw new Error("editorial tags differ from the content index");
    }
  }
  if (!metadata.ai?.description) throw new Error("AI description is missing");
  if (metadata.ai.tags.length === 0) throw new Error("AI tags are missing");
  if (!metadata.indexes.search?.document) throw new Error("search document is missing");
  if (
    metadata.indexes.vector?.status === "ready" &&
    (!metadata.indexes.vector.values || metadata.indexes.vector.encoding !== "base64-f32le")
  ) {
    throw new Error("ready vector values are missing");
  }
  return {
    withAi: Boolean(metadata.ai),
    withSearchIndex: Boolean(metadata.indexes.search?.document),
    withVectorValues: Boolean(metadata.indexes.vector?.values),
  };
}

async function verifyAll(
  storage: R2ApiAdapter,
  paths: readonly string[],
  photos: Map<string, {
    title?: string;
    description?: string;
    tags?: string[];
  }>,
  concurrency: number,
): Promise<VerificationSummary> {
  const summary: VerificationSummary = {
    checked: 0,
    valid: 0,
    missing: [],
    invalid: [],
    withAi: 0,
    withSearchIndex: 0,
    withVectorValues: 0,
  };
  await mapWithConcurrency(paths, concurrency, async (path) => {
    try {
      const result = await verifyOne(storage, path, photos.get(path));
      summary.valid += 1;
      if (result.withAi) summary.withAi += 1;
      if (result.withSearchIndex) summary.withSearchIndex += 1;
      if (result.withVectorValues) summary.withVectorValues += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification failed";
      if (/missing/i.test(message) && /source object/i.test(message)) summary.missing.push(path);
      else summary.invalid.push({ path, error: message });
    } finally {
      summary.checked += 1;
      if (summary.checked % 50 === 0 || summary.checked === paths.length) {
        console.log(`Verification progress: ${summary.checked}/${paths.length}`);
      }
    }
  });
  summary.missing.sort();
  summary.invalid.sort((left, right) => left.path.localeCompare(right.path));
  return summary;
}

async function runCanary(
  storage: R2ApiAdapter,
  paths: readonly string[],
  photos: Map<string, {
    title?: string;
    description?: string;
    tags?: string[];
  }>,
  requestedPath?: string,
): Promise<void> {
  const search = await readPhotoAiSearchIndex(storage);
  const documents = Object.values(search.documents);
  const path = requestedPath || paths.find((candidate) => {
    const document = documents.find((value) => value.path === candidate);
    const editorial = photos.get(candidate)?.description?.trim();
    const ai = (document?.aiDescription ?? document?.caption)?.trim();
    return editorial && ai && editorial !== ai;
  }) || paths[0];
  if (!paths.includes(path)) throw new Error(`Canary path is not a physical source image: ${path}`);

  const before = await storage.get(path);
  if (!before) throw new Error(`Canary source is missing: ${path}`);
  const canonicalBefore = canonicalizeImageBytes(before);
  const searchDocument = documents.find((document) => document.path === path);
  if (!searchDocument) throw new Error(`Canary has no AI search document: ${path}`);
  const record = await new AiRecordStore(storage).getRecord(
    searchDocument.gallerySlug,
    searchDocument.assetId,
  );
  if (!record?.analysis) throw new Error(`Canary has no AI analysis record: ${path}`);

  await enqueuePhotoMetadataWritebacksInStorage(storage, [path], "backfill");
  const result = await processPhotoMetadataWritebackBatchInStorage(storage, {}, 1, [path]);
  if (result.failed || result.unsupported || result.written + result.unchanged !== 1) {
    throw new Error(`Canary write failed: ${JSON.stringify(result)}`);
  }

  const after = await storage.get(path);
  if (!after) throw new Error(`Canary disappeared after write: ${path}`);
  const canonicalAfter = canonicalizeImageBytes(after);
  if (!bytesEqual(canonicalBefore, canonicalAfter)) {
    throw new Error("Canary compressed image/original metadata bytes changed");
  }
  const metadata = readVictoPressEmbeddedMetadata(after);
  if (!metadata) throw new Error("Canary XMP could not be read after write");
  if (metadata.ai?.description !== record.analysis.caption) {
    throw new Error("Canary AI description differs from its AI record");
  }
  if (!arraysEqual(metadata.ai.tags, record.analysis.tags)) {
    throw new Error("Canary AI tags differ from their AI record");
  }
  await verifyOne(storage, path, photos.get(path));

  console.log(JSON.stringify({
    canary: "passed",
    path,
    originalBytes: canonicalBefore.byteLength,
    embeddedBytes: after.byteLength,
    aiDescriptionSeparate: metadata.ai.description !== metadata.editorial.description,
    aiTags: metadata.ai.tags.length,
    galleries: metadata.galleries.length,
    searchIndex: Boolean(metadata.indexes.search),
    vectorValues: Boolean(metadata.indexes.vector?.values),
  }));
}

async function runBackfill(
  storage: R2ApiAdapter,
  paths: readonly string[],
  batchSize: number,
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 64) {
    const batch = paths.slice(offset, offset + 64);
    await enqueuePhotoMetadataWritebacksInStorage(storage, batch, "backfill");
    console.log(`Queue progress: ${Math.min(offset + batch.length, paths.length)}/${paths.length}`);
  }

  let processed = 0;
  while (true) {
    const result = await processPhotoMetadataWritebackBatchInStorage(storage, {}, batchSize);
    processed += result.processed;
    console.log(JSON.stringify({ phase: "write", processedTotal: processed, ...result }));
    if (result.done) break;
    if (result.processed === 0) throw new Error("Metadata queue made no progress");
  }
}

async function saveAudit(storage: R2ApiAdapter, summary: VerificationSummary): Promise<string> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const key = `${AUDIT_PREFIX}/${timestamp}.json`;
  await storage.put(key, JSON.stringify({
    version: 1,
    verifiedAt: new Date().toISOString(),
    ...summary,
  }, null, 2), "application/json");
  return key;
}

async function queueStatus(storage: R2ApiAdapter): Promise<{ queued: number; failed: number }> {
  const [queued, failed] = await Promise.all([
    storage.listRecursive(PHOTO_METADATA_WRITEBACK_QUEUE_PREFIX),
    storage.listRecursive(PHOTO_METADATA_WRITEBACK_FAILED_PREFIX),
  ]);
  return {
    queued: queued.filter((file) => !file.isDirectory && file.name.endsWith(".json")).length,
    failed: failed.filter((file) => !file.isDirectory && file.name.endsWith(".json")).length,
  };
}

async function main(): Promise<void> {
  const mode = selectedMode();
  const storage = new R2ApiAdapter({
    accountId: requireEnvironmentVariable("R2_ACCOUNT_ID"),
    accessKeyId: requireEnvironmentVariable("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnvironmentVariable("R2_SECRET_ACCESS_KEY"),
    bucketName: process.env.R2_BUCKET_NAME?.trim() || "victopress-content",
  });
  const batchSize = integerArgument("batch-size", DEFAULT_PROCESS_BATCH_SIZE);
  const verifyConcurrency = integerArgument("verify-concurrency", DEFAULT_VERIFY_CONCURRENCY);
  const requestedPath = stringArgument("path");
  const { paths, photos } = await sourcePaths(storage);
  if (paths.length === 0) throw new Error("The content index has no supported source images");

  console.log(JSON.stringify({ mode, sourceImages: paths.length, batchSize, verifyConcurrency }));
  if (mode !== "verify") {
    await verifyWriteAccess(storage);
    console.log("R2 reversible write check: passed");
  }

  if (mode === "canary") {
    await runCanary(storage, paths, photos, requestedPath);
    return;
  }

  if (mode === "all") await runBackfill(storage, paths, batchSize);
  const verification = await verifyAll(storage, paths, photos, verifyConcurrency);
  const status = await queueStatus(storage);
  const auditKey = await saveAudit(storage, verification);
  console.log(JSON.stringify({ verification, queue: status, auditKey }));
  if (
    verification.valid !== paths.length ||
    verification.withAi !== paths.length ||
    verification.withSearchIndex !== paths.length ||
    verification.withVectorValues !== paths.length ||
    status.queued !== 0 ||
    status.failed !== 0
  ) {
    throw new Error("R2 metadata backfill verification did not reach full coverage");
  }
}

await main();
