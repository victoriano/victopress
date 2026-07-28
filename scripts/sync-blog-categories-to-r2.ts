#!/usr/bin/env bun
/**
 * Copy only the closed blog category metadata from local source posts to R2.
 *
 * The command is dry-run by default. Pass --apply to write. Unlike the general
 * blog mirror, this migration never deletes objects and never replaces remote
 * article bodies or other frontmatter fields.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

import {
  normalizeBlogCategories,
  type BlogCategory,
} from "../app/lib/blog-categories";

const CONTENT_ROOT = path.resolve("content");
const BLOG_ROOT = path.join(CONTENT_ROOT, "blog");
const INDEX_KEY = "_content-index.json";
const BLOG_CATEGORY_INDEX_VERSION = 11;

async function loadEnv(): Promise<Record<string, string>> {
  const source = await readFile(".dev.vars", "utf8");
  return Object.fromEntries(
    source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function sourcePostFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourcePostFiles(filename));
    } else if (entry.name === "index.md") {
      files.push(filename);
    }
  }
  return files;
}

function setCategories(source: string, categories: BlogCategory[]): string {
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) throw new Error("Post has no YAML frontmatter");

  const document = YAML.parseDocument(frontmatterMatch[1]);
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }
  document.set("categories", categories);

  const nextFrontmatter = document.toString({ lineWidth: 0 }).trimEnd();
  const next = `---\n${nextFrontmatter}\n---${source.slice(frontmatterMatch[0].length)}`;
  const before = matter(source);
  const after = matter(next);
  const beforeShared = { ...before.data };
  const afterShared = { ...after.data };
  delete beforeShared.categories;
  delete afterShared.categories;

  if (
    before.content !== after.content ||
    JSON.stringify(beforeShared) !== JSON.stringify(afterShared)
  ) {
    throw new Error("Category update would alter the post body or unrelated metadata");
  }

  return next;
}

async function getText(client: S3Client, bucket: string, key: string): Promise<string> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`R2 object has no body: ${key}`);
  return response.Body.transformToString();
}

async function putText(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType: string,
) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = await loadEnv();
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_NAME || "victopress-content";
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials in .dev.vars");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const categoriesBySlug = new Map<string, BlogCategory[]>();
  const localPosts = await sourcePostFiles(BLOG_ROOT);
  for (const filename of localPosts) {
    const parsed = matter(await readFile(filename, "utf8"));
    const slug = String(parsed.data.slug || "").trim();
    const categories = normalizeBlogCategories(parsed.data.categories);
    if (!slug || categories.length === 0) {
      throw new Error(`Missing slug or category in ${filename}`);
    }
    categoriesBySlug.set(slug, categories);
  }

  let changedPosts = 0;
  for (const filename of localPosts.sort()) {
    const key = path.relative(CONTENT_ROOT, filename).split(path.sep).join("/");
    const local = matter(await readFile(filename, "utf8"));
    const categories = categoriesBySlug.get(String(local.data.slug));
    if (!categories) throw new Error(`No categories found for ${key}`);

    const remoteSource = await getText(client, bucket, key);
    const current = normalizeBlogCategories(matter(remoteSource).data.categories);
    if (JSON.stringify(current) === JSON.stringify(categories)) continue;

    const nextSource = setCategories(remoteSource, categories);
    console.log(`[post] ${key}: ${categories.join(", ")}`);
    if (apply) {
      await putText(
        client,
        bucket,
        key,
        nextSource,
        "text/markdown; charset=utf-8",
      );
    }
    changedPosts += 1;
  }

  const indexSource = await getText(client, bucket, INDEX_KEY);
  const index = JSON.parse(indexSource) as {
    version?: number;
    updatedAt?: string;
    posts?: Array<{ slug?: string; categories?: BlogCategory[] }>;
  };
  if (!Array.isArray(index.posts)) throw new Error("Remote content index has no posts array");
  if (
    typeof index.version === "number" &&
    index.version > BLOG_CATEGORY_INDEX_VERSION
  ) {
    throw new Error(
      `Refusing to downgrade content index ${index.version} to ${BLOG_CATEGORY_INDEX_VERSION}`,
    );
  }
  const changedIndexVersion = index.version !== BLOG_CATEGORY_INDEX_VERSION;
  index.version = BLOG_CATEGORY_INDEX_VERSION;

  const indexedSlugs = new Set(index.posts.map((post) => post.slug));
  const missing = [...categoriesBySlug.keys()].filter((slug) => !indexedSlugs.has(slug));
  if (missing.length > 0) {
    throw new Error(`Remote content index is missing ${missing.join(", ")}`);
  }

  let changedIndexEntries = 0;
  for (const post of index.posts) {
    if (!post.slug) continue;
    const categories = categoriesBySlug.get(post.slug);
    if (!categories) continue;
    if (JSON.stringify(normalizeBlogCategories(post.categories)) === JSON.stringify(categories)) {
      continue;
    }
    post.categories = categories;
    changedIndexEntries += 1;
  }

  console.log(
    `[index] ${changedIndexEntries} category entries, ` +
    `version ${changedIndexVersion ? `→ ${BLOG_CATEGORY_INDEX_VERSION}` : BLOG_CATEGORY_INDEX_VERSION}`,
  );
  if (apply && (changedIndexEntries > 0 || changedIndexVersion)) {
    index.updatedAt = new Date().toISOString();
    await putText(
      client,
      bucket,
      INDEX_KEY,
      JSON.stringify(index, null, 2),
      "application/json; charset=utf-8",
    );
  }

  console.log(
    `${apply ? "Applied" : "Dry run"}: ${changedPosts} posts, ` +
    `${changedIndexEntries} index entries, 0 deleted`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
