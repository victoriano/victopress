#!/usr/bin/env bun
/** Mirror only content/blog to R2 and refresh the cached post index. */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { scanBlog } from "../app/lib/content-engine/blog-scanner";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";
import { buildBlogPostIndexEntries } from "./lib/blog-index";

interface RemoteFile {
  key: string;
  size: number;
  etag?: string;
}

const CONTENT_ROOT = path.resolve("content");
const BLOG_ROOT = path.join(CONTENT_ROOT, "blog");

async function loadEnv(): Promise<Record<string, string>> {
  const text = await readFile(".dev.vars", "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
    }
  }
  return env;
}

async function listLocalFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function listRemoteFiles(
  client: S3Client,
  bucket: string
): Promise<Map<string, RemoteFile>> {
  const files = new Map<string, RemoteFile>();
  let continuationToken: string | undefined;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "blog/",
      ContinuationToken: continuationToken,
    }));
    for (const object of response.Contents || []) {
      if (!object.Key) continue;
      files.set(object.Key, {
        key: object.Key,
        size: object.Size || 0,
        etag: object.ETag?.replaceAll('"', ""),
      });
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return files;
}

function contentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  return types[extension] || "application/octet-stream";
}

function md5(data: Buffer): string {
  return createHash("md5").update(data).digest("hex");
}

async function updateRemoteIndex(
  client: S3Client,
  bucket: string,
  posts: ReturnType<typeof buildBlogPostIndexEntries>,
  dryRun: boolean
) {
  let index: Record<string, any>;
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: "_content-index.json",
    }));
    index = JSON.parse(await response.Body!.transformToString());
  } catch (error) {
    console.warn("[index] Existing _content-index.json is unavailable; a runtime rebuild will be required.");
    return;
  }

  index.posts = posts;
  index.stats = { ...(index.stats || {}), totalPosts: posts.length };
  index.updatedAt = new Date().toISOString();
  const body = JSON.stringify(index, null, 2);
  console.log(`[index] ${posts.length} posts (${Buffer.byteLength(body)} bytes)`);
  if (!dryRun) {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "_content-index.json",
      Body: body,
      ContentType: "application/json; charset=utf-8",
    }));
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = await loadEnv();
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_NAME || "victopress-content";
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY in .dev.vars");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const localFiles = await listLocalFiles(BLOG_ROOT);
  const remoteFiles = await listRemoteFiles(client, bucket);
  const localKeys = new Set<string>();
  let uploaded = 0;
  let unchanged = 0;

  for (const filename of localFiles.sort()) {
    const key = path.relative(CONTENT_ROOT, filename).split(path.sep).join("/");
    localKeys.add(key);
    const data = await readFile(filename);
    const remote = remoteFiles.get(key);
    const same = remote?.size === data.byteLength && remote.etag === md5(data);
    if (same) {
      unchanged += 1;
      continue;
    }
    console.log(`[upload] ${key} (${data.byteLength} bytes)`);
    if (!dryRun) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType(filename),
      }));
    }
    uploaded += 1;
  }

  const staleKeys = [...remoteFiles.keys()].filter((key) => !localKeys.has(key)).sort();
  for (const key of staleKeys) {
    console.log(`[delete] ${key}`);
    if (!dryRun) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  }

  const posts = buildBlogPostIndexEntries(
    await scanBlog(new LocalStorageAdapter(CONTENT_ROOT)),
  );
  await updateRemoteIndex(client, bucket, posts, dryRun);
  console.log(
    `${dryRun ? "Dry run" : "Sync complete"}: ${uploaded} uploaded, ` +
    `${unchanged} unchanged, ${staleKeys.length} deleted, ${posts.length} posts indexed`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
