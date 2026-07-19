#!/usr/bin/env bun

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

const CONTENT_INDEX_KEY = "_content-index.json";
const OPTIMIZATION_INDEX_KEY = ".optimization-index.json";
const OPTIMIZATION_INDEX_VERSION = 2;
const OPTIMIZATION_PROFILE = "webp-800q85-1600q86-2400q86";
const VARIANT_QUALITY = new Map([
  [800, 85],
  [1600, 86],
  [2400, 86],
]);
const DEFAULT_CONCURRENCY = 3;
const CHECKPOINT_SIZE = 24;

interface ContentPhoto {
  path: string;
  filename: string;
}

interface ContentIndex {
  galleryData?: Array<{ photos?: ContentPhoto[] }>;
}

interface OptimizationIndex {
  version: number;
  variantWidths: number[];
  profile: string;
  optimizedImages: string[];
  lastUpdated: string;
}

interface ProcessResult {
  path: string;
  variants: number;
  sourceBytes: number;
  outputBytes: number;
}

function readIntegerArgument(name: string, fallback?: number): number | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (!value) return fallback;

  const parsed = Number.parseInt(value.slice(prefix.length), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Run with --env-file=.dev.vars.`);
  return value;
}

function isSourceImage(path: string): boolean {
  return /\.(?:jpe?g|png|webp)$/i.test(path) && !/_\d+w\.webp$/i.test(path);
}

function variantPath(originalPath: string, width: number): string {
  const dotIndex = originalPath.lastIndexOf(".");
  const stem = dotIndex >= 0 ? originalPath.slice(0, dotIndex) : originalPath;
  return `${stem}_${width}w.webp`;
}

async function getObjectBytes(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`R2 object has no body: ${key}`);
  return bytes;
}

async function getJson<T>(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<T | null> {
  try {
    const bytes = await getObjectBytes(client, bucket, key);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

async function putJson(
  client: S3Client,
  bucket: string,
  key: string,
  value: unknown,
): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
    CacheControl: "no-store",
  }));
}

async function verifyReversibleWrite(client: S3Client, bucket: string): Promise<void> {
  const key = `.victopress/health/image-optimizer-${crypto.randomUUID()}.txt`;
  const marker = crypto.randomUUID();

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: marker,
      ContentType: "text/plain",
      CacheControl: "no-store",
    }));
    const stored = new TextDecoder().decode(await getObjectBytes(client, bucket, key));
    if (stored !== marker) throw new Error("R2 write verification returned different bytes");
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

async function optimizePhoto(
  client: S3Client,
  bucket: string,
  photoPath: string,
  dryRun: boolean,
): Promise<ProcessResult> {
  const source = await getObjectBytes(client, bucket, photoPath);
  const metadata = await sharp(source).metadata();
  const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
  if (!sourceWidth) throw new Error(`Could not read image width: ${photoPath}`);

  let variants = 0;
  let outputBytes = 0;

  for (const [width, quality] of VARIANT_QUALITY) {
    if (width >= sourceWidth) continue;

    const output = await sharp(source, { animated: false })
      .rotate()
      .resize({ width, fit: "inside", withoutEnlargement: true })
      .webp({ quality, smartSubsample: true, effort: 6 })
      .toBuffer();
    const outputMetadata = await sharp(output).metadata();
    if (outputMetadata.width !== width || outputMetadata.format !== "webp") {
      throw new Error(`Invalid ${width}w output for ${photoPath}`);
    }

    if (!dryRun) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: variantPath(photoPath, width),
        Body: output,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }));
    }

    variants += 1;
    outputBytes += output.byteLength;
  }

  return {
    path: photoPath,
    variants,
    sourceBytes: source.byteLength,
    outputBytes,
  };
}

async function main(): Promise<void> {
  const accountId = requireEnvironmentVariable("R2_ACCOUNT_ID");
  const accessKeyId = requireEnvironmentVariable("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnvironmentVariable("R2_SECRET_ACCESS_KEY");
  const bucket = process.env.R2_BUCKET_NAME?.trim() || "victopress-content";
  const concurrency = readIntegerArgument("concurrency", DEFAULT_CONCURRENCY)!;
  const limit = readIntegerArgument("limit");
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`R2 image optimization: bucket=${bucket}, profile=${OPTIMIZATION_PROFILE}`);
  console.log(`concurrency=${concurrency}, force=${force}, dryRun=${dryRun}`);

  if (!dryRun) {
    await verifyReversibleWrite(client, bucket);
    console.log("R2 reversible write verification: OK");
  }

  const contentIndex = await getJson<ContentIndex>(client, bucket, CONTENT_INDEX_KEY);
  if (!contentIndex) throw new Error(`Missing ${CONTENT_INDEX_KEY}`);

  const uniquePhotos = new Map<string, ContentPhoto>();
  for (const gallery of contentIndex.galleryData ?? []) {
    for (const photo of gallery.photos ?? []) {
      if (photo.path && isSourceImage(photo.path)) uniquePhotos.set(photo.path, photo);
    }
  }

  const storedIndex = await getJson<OptimizationIndex>(client, bucket, OPTIMIZATION_INDEX_KEY);
  const profileMatches =
    !force &&
    storedIndex?.version === OPTIMIZATION_INDEX_VERSION &&
    storedIndex.profile === OPTIMIZATION_PROFILE &&
    JSON.stringify(storedIndex.variantWidths) === JSON.stringify([...VARIANT_QUALITY.keys()]);
  const optimized = new Set(profileMatches ? storedIndex!.optimizedImages : []);
  const pending = [...uniquePhotos.keys()].filter((path) => !optimized.has(path));
  const selected = limit ? pending.slice(0, limit) : pending;

  console.log(
    `photos=${uniquePhotos.size}, alreadyOptimized=${optimized.size}, selected=${selected.length}`,
  );
  if (selected.length === 0) return;

  let processed = 0;
  let failed = 0;
  let sourceBytes = 0;
  let outputBytes = 0;
  let variants = 0;
  let sinceCheckpoint = 0;

  const saveCheckpoint = async () => {
    if (dryRun) return;
    const index: OptimizationIndex = {
      version: OPTIMIZATION_INDEX_VERSION,
      variantWidths: [...VARIANT_QUALITY.keys()],
      profile: OPTIMIZATION_PROFILE,
      optimizedImages: [...optimized].sort(),
      lastUpdated: new Date().toISOString(),
    };
    await putJson(client, bucket, OPTIMIZATION_INDEX_KEY, index);
    sinceCheckpoint = 0;
  };

  for (let offset = 0; offset < selected.length; offset += concurrency) {
    const batch = selected.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(
      batch.map((photoPath) => optimizePhoto(client, bucket, photoPath, dryRun)),
    );

    results.forEach((result, index) => {
      const photoPath = batch[index];
      if (result.status === "fulfilled") {
        optimized.add(photoPath);
        processed += 1;
        sinceCheckpoint += 1;
        variants += result.value.variants;
        sourceBytes += result.value.sourceBytes;
        outputBytes += result.value.outputBytes;
      } else {
        failed += 1;
        console.error(`FAILED ${photoPath}: ${String(result.reason)}`);
      }
    });

    if (sinceCheckpoint >= CHECKPOINT_SIZE || offset + concurrency >= selected.length) {
      await saveCheckpoint();
    }
    if (processed % 12 < concurrency || offset + concurrency >= selected.length) {
      console.log(
        `progress=${Math.min(offset + concurrency, selected.length)}/${selected.length}, ` +
        `processed=${processed}, failed=${failed}, variants=${variants}`,
      );
    }
  }

  console.log(
    `complete: processed=${processed}, failed=${failed}, variants=${variants}, ` +
    `sourceMiB=${(sourceBytes / 1024 / 1024).toFixed(1)}, ` +
    `outputMiB=${(outputBytes / 1024 / 1024).toFixed(1)}`,
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
