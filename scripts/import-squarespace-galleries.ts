#!/usr/bin/env bun

/**
 * Additively import the Squarespace gallery export into the production R2
 * bucket. The script is deliberately dry-run by default.
 *
 * Guarantees:
 * - never deletes an R2 object;
 * - never overwrites an existing gallery image;
 * - deduplicates byte-identical photos through logical gallery memberships;
 * - preserves existing gallery memberships and home selections;
 * - creates only missing gallery metadata;
 * - backs up mutable metadata before applying the migration.
 *
 * Usage:
 *   bun run scripts/import-squarespace-galleries.ts
 *   bun run scripts/import-squarespace-galleries.ts --apply
 *   bun run scripts/import-squarespace-galleries.ts --source /path/to/export
 */

import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, posix, relative } from "node:path";
import { parse, stringify } from "yaml";
import sharp from "sharp";
import {
  getHomePhotosFromIndex,
  rebuildContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { GALLERY_ORDERS_KEY } from "../app/lib/content-engine/gallery-orders";
import { R2ApiAdapter } from "../app/lib/content-engine/storage/r2-api-adapter";
import { toSlug } from "../app/lib/content-engine/utils";

const DEFAULT_SOURCE = "/Users/victoriano/Desktop/squarespace_photos";
const CONTENT_ROOT = join(process.cwd(), "content");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const VARIANT_PATTERN = /_\d+w\.webp$/i;
const VARIANT_WIDTHS = [800, 1600, 2400] as const;
const VARIANT_QUALITY = 80;

interface GalleryTarget {
  folder: string;
  slug: string;
  priority: number;
}

interface GalleryDefinition {
  folder: string;
  title: string;
  description: string;
  order: number;
}

type AlbumRule =
  | ({ kind: "gallery" } & GalleryTarget)
  | { kind: "featured" }
  | { kind: "page-asset"; page: string }
  | { kind: "unresolved" };

function gallery(folder: string, priority: number): AlbumRule {
  return {
    kind: "gallery",
    folder,
    slug: folder.split("/").map(toSlug).join("/"),
    priority,
  };
}

const ALBUM_RULES: Record<string, AlbumRule> = {
  About_Me: { kind: "page-asset", page: "about" },
  Australia: gallery("geographies/australia", 10),
  Canary_Islands: gallery("geographies/europe/spain/canary islands", 10),
  Central_Europe: gallery("geographies/europe/central europe", 10),
  China: gallery("geographies/asia/china", 10),
  Contact: { kind: "page-asset", page: "contact" },
  Dubai: gallery("geographies/asia/dubai", 10),
  Granada: gallery("geographies/europe/spain/south of spain/granada", 10),
  Japan: gallery("geographies/asia/japan", 10),
  Landscapes: gallery("spaces/landscapes", 30),
  London: gallery("geographies/europe/united kingdom/london", 10),
  Madrid: gallery("geographies/europe/spain/madrid", 10),
  New_York: gallery("geographies/america/usa/new york", 10),
  North_of_Spain: gallery("geographies/europe/spain/north of spain", 10),
  Portraits: gallery("humans/portraits", 20),
  Rituals: gallery("humans/rituals", 20),
  Rome: gallery("geographies/europe/italy/rome", 10),
  San_Francisco_with_iPhone_Xs: gallery("geographies/america/usa/san francisco", 10),
  Social: gallery("humans/social", 20),
  South_of_Spain: gallery("geographies/europe/spain/south of spain", 10),
  Travelling: gallery("spaces/travelling", 30),
  Uncategorized: { kind: "unresolved" },
  Urban: gallery("spaces/urban", 30),
  featured: { kind: "featured" },
};

const NEW_GALLERIES: GalleryDefinition[] = [
  {
    folder: "geographies/europe/italy",
    title: "Italy",
    description: "Photography from Italy",
    order: 3,
  },
  {
    folder: "geographies/europe/italy/rome",
    title: "Rome",
    description: "Photography from Rome, Italy",
    order: 1,
  },
  {
    folder: "geographies/europe/central europe",
    title: "Central Europe",
    description: "Photography from Central Europe",
    order: 4,
  },
  {
    folder: "geographies/europe/united kingdom/london",
    title: "London",
    description: "Photography from London, United Kingdom",
    order: 1,
  },
];

/**
 * Photos that are present only in a special export album need an explicit
 * editorial home. Keep this list intentionally small and review it visually
 * before applying a migration.
 */
const MANUAL_TARGETS: Record<string, string[]> = {
  // The four featured-only images are a 2009 New York street sequence. Give
  // each a geographic home plus the most specific editorial cross-view.
  "featured/9_-_IMG_4013.jpg": [
    "geographies/america/usa/new york",
    "humans/rituals",
  ],
  "featured/IMG_0121b.jpg": [
    "geographies/america/usa/new york",
    "spaces/urban",
  ],
  "featured/IMG_0968.jpg": [
    "geographies/america/usa/new york",
    "humans/social",
  ],
  "featured/IMG_4011recorte.jpg": [
    "geographies/america/usa/new york",
    "humans/social",
  ],
  // Demonstration in Granada: geographic context plus the archive's
  // collective/political-ritual dimension.
  "Uncategorized/DSC01673.jpg": [
    "geographies/europe/spain/south of spain/granada",
    "humans/rituals",
  ],
};

interface SourcePhoto {
  absolutePath: string;
  relativePath: string;
  album: string;
  filename: string;
  size: number;
  order: number;
  sha256: string;
}

interface ExistingPhoto {
  key: string;
  size: number;
  sha256: string;
}

interface UploadPlan {
  key: string;
  sourcePath: string;
  sourceRelativePath: string;
  size: number;
  sha256: string;
  reason: "new" | "filename-collision";
}

interface AppearancePlan {
  hash: string;
  targetFolder: string;
  targetSlug: string;
  photoPath: string;
}

interface MigrationPlan {
  uploads: UploadPlan[];
  memberships: Map<string, Set<string>>;
  appearances: AppearancePlan[];
  ownerByHash: Map<string, string>;
  sourceGroups: Map<string, SourcePhoto[]>;
  sourcePhotos: SourcePhoto[];
  galleryOrders: Map<string, string[]>;
  featuredEntries: Array<{ gallery: string; filename: string }>;
  unresolved: SourcePhoto[];
  skippedPageAssets: SourcePhoto[];
  galleryDefinitions: GalleryDefinition[];
  existingOriginals: ExistingPhoto[];
  albumSummaries: Map<string, { total: number; existing: number; newHashes: Set<string> }>;
  variantSources: Map<string, SourcePhoto>;
}

interface R2Environment {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

function parseArguments(): { apply: boolean; sourceRoot: string } {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf("--source");
  const sourceRoot = sourceIndex >= 0 ? args[sourceIndex + 1] : DEFAULT_SOURCE;
  if (!sourceRoot) throw new Error("--source requires a directory path");
  return { apply: args.includes("--apply"), sourceRoot };
}

async function loadEnvironment(): Promise<R2Environment> {
  const raw = await readFile(".dev.vars", "utf8");
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  const accountId = values.R2_ACCOUNT_ID;
  const accessKeyId = values.R2_ACCESS_KEY_ID;
  const secretAccessKey = values.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY in .dev.vars");
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName: values.R2_BUCKET_NAME || "victopress-content",
  };
}

function makeClient(env: R2Environment): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

function isSourceImage(value: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(value).toLowerCase()) && !VARIANT_PATTERN.test(value);
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function hashFile(path: string): Promise<{ sha256: string; md5: string }> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    md5.update(chunk);
  }
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

async function readAlbumOrder(albumPath: string): Promise<Map<string, number>> {
  const entries = await readdir(albumPath);
  const metadataName = entries.find((name) => name.endsWith("_metadata.csv"));
  if (!metadataName) return new Map();
  const raw = await readFile(join(albumPath, metadataName), "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] || "");
  const filenameIndex = header.indexOf("filename");
  if (filenameIndex < 0) return new Map();
  const order = new Map<string, number>();
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const filename = values[filenameIndex];
    if (filename && !order.has(filename)) order.set(filename, index - 1);
  }
  return order;
}

async function scanSource(sourceRoot: string): Promise<SourcePhoto[]> {
  const rootEntries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const rawPhotos: Omit<SourcePhoto, "sha256">[] = [];
  for (const albumEntry of rootEntries) {
    if (!ALBUM_RULES[albumEntry.name]) {
      throw new Error(`No album rule exists for ${albumEntry.name}`);
    }
    const albumPath = join(sourceRoot, albumEntry.name);
    const order = await readAlbumOrder(albumPath);
    const files = (await readdir(albumPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && isSourceImage(entry.name))
      .sort((left, right) => {
        const leftOrder = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.name.localeCompare(right.name, undefined, { numeric: true });
      });
    for (let index = 0; index < files.length; index += 1) {
      const entry = files[index];
      const absolutePath = join(albumPath, entry.name);
      const details = await stat(absolutePath);
      rawPhotos.push({
        absolutePath,
        relativePath: relative(sourceRoot, absolutePath),
        album: albumEntry.name,
        filename: entry.name,
        size: details.size,
        order: order.get(entry.name) ?? order.size + index,
      });
    }
  }

  let completed = 0;
  const photos = await mapLimit(rawPhotos, 4, async (photo) => {
    const hashes = await hashFile(photo.absolutePath);
    completed += 1;
    if (completed % 100 === 0 || completed === rawPhotos.length) {
      console.log(`[hash] Squarespace photos ${completed}/${rawPhotos.length}`);
    }
    return { ...photo, sha256: hashes.sha256 };
  });
  return photos;
}

async function listAllObjects(client: S3Client, bucketName: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(response.Contents || []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

async function hashExistingOriginals(
  client: S3Client,
  bucketName: string,
  objects: readonly _Object[],
): Promise<ExistingPhoto[]> {
  const originals = objects.filter(
    (object) => object.Key?.startsWith("galleries/") && isSourceImage(object.Key),
  );
  let completed = 0;
  return mapLimit(originals, 4, async (object) => {
    const key = object.Key as string;
    const localPath = join(CONTENT_ROOT, key);
    let sha256: string | null = null;
    try {
      const localStat = await stat(localPath);
      if (localStat.size === object.Size) {
        const hashes = await hashFile(localPath);
        const etag = object.ETag?.replaceAll('"', "").toLowerCase();
        if (!etag || !/^[a-f0-9]{32}$/.test(etag) || hashes.md5 === etag) {
          sha256 = hashes.sha256;
        }
      }
    } catch {
      // The production bucket can contain photos not present in the checkout.
    }

    if (!sha256) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) throw new Error(`Could not read existing R2 object ${key}`);
      sha256 = hashBytes(bytes);
    }

    completed += 1;
    if (completed % 50 === 0 || completed === originals.length) {
      console.log(`[hash] Existing R2 originals ${completed}/${originals.length}`);
    }
    return { key, size: object.Size || 0, sha256 };
  });
}

function immediateGalleryFolder(key: string): string | null {
  if (!key.startsWith("galleries/")) return null;
  const folder = posix.dirname(key).slice("galleries/".length);
  return folder && folder !== "." ? folder : null;
}

function slugForFolder(folder: string): string {
  return folder.split("/").map(toSlug).join("/");
}

function targetForFolder(folder: string, priority = 25): GalleryTarget {
  return { folder, slug: slugForFolder(folder), priority };
}

function targetsForPhoto(photo: SourcePhoto): GalleryTarget[] {
  const manualFolders = MANUAL_TARGETS[photo.relativePath];
  if (manualFolders?.length) return manualFolders.map((folder) => targetForFolder(folder));
  const rule = ALBUM_RULES[photo.album];
  return rule.kind === "gallery" ? [rule] : [];
}

function allocateFilename(
  folder: string,
  filename: string,
  hash: string,
  keyHash: Map<string, string>,
): string {
  const desired = `galleries/${folder}/${filename}`;
  const currentHash = keyHash.get(desired);
  if (!currentHash || currentHash === hash) return desired;

  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let suffix = 0;
  while (true) {
    const qualifier = suffix === 0 ? hash.slice(0, 10) : `${hash.slice(0, 10)}-${suffix + 1}`;
    const candidate = `galleries/${folder}/${stem}--squarespace-${qualifier}${extension}`;
    const candidateHash = keyHash.get(candidate);
    if (!candidateHash || candidateHash === hash) return candidate;
    suffix += 1;
  }
}

function makePlan(
  sourcePhotos: SourcePhoto[],
  existingOriginals: ExistingPhoto[],
  objectKeys: Set<string>,
): MigrationPlan {
  const sourceGroups = new Map<string, SourcePhoto[]>();
  for (const photo of sourcePhotos) {
    const group = sourceGroups.get(photo.sha256) || [];
    group.push(photo);
    sourceGroups.set(photo.sha256, group);
  }

  const existingKeysByHash = new Map<string, string[]>();
  const keyHash = new Map<string, string>();
  const visibleFilenameHash = new Map<string, Map<string, string>>();
  for (const photo of existingOriginals) {
    keyHash.set(photo.key, photo.sha256);
    const keys = existingKeysByHash.get(photo.sha256) || [];
    keys.push(photo.key);
    existingKeysByHash.set(photo.sha256, keys);
    const folder = immediateGalleryFolder(photo.key);
    if (folder) {
      const names = visibleFilenameHash.get(folder) || new Map<string, string>();
      names.set(posix.basename(photo.key), photo.sha256);
      visibleFilenameHash.set(folder, names);
    }
  }

  const albumSummaries = new Map<string, { total: number; existing: number; newHashes: Set<string> }>();
  for (const photo of sourcePhotos) {
    const summary = albumSummaries.get(photo.album) || { total: 0, existing: 0, newHashes: new Set<string>() };
    summary.total += 1;
    if (existingKeysByHash.has(photo.sha256)) summary.existing += 1;
    else summary.newHashes.add(photo.sha256);
    albumSummaries.set(photo.album, summary);
  }

  const uploads: UploadPlan[] = [];
  const memberships = new Map<string, Set<string>>();
  const appearances: AppearancePlan[] = [];
  const ownerByHash = new Map<string, string>();
  const unresolved: SourcePhoto[] = [];
  const skippedPageAssets: SourcePhoto[] = [];

  const orderedGroups = [...sourceGroups.entries()].sort(([, left], [, right]) => {
    const leftPriority = Math.min(...left.flatMap((photo) => targetsForPhoto(photo).map((target) => target.priority)), 999);
    const rightPriority = Math.min(...right.flatMap((photo) => targetsForPhoto(photo).map((target) => target.priority)), 999);
    return leftPriority - rightPriority || left[0].relativePath.localeCompare(right[0].relativePath);
  });

  function registerUpload(
    key: string,
    source: SourcePhoto,
    hash: string,
    reason: UploadPlan["reason"],
  ): void {
    if (keyHash.has(key)) return;
    keyHash.set(key, hash);
    uploads.push({
      key,
      sourcePath: source.absolutePath,
      sourceRelativePath: source.relativePath,
      size: source.size,
      sha256: hash,
      reason,
    });
    const keys = existingKeysByHash.get(hash) || [];
    keys.push(key);
    existingKeysByHash.set(hash, keys);
    const folder = immediateGalleryFolder(key);
    if (folder) {
      const names = visibleFilenameHash.get(folder) || new Map<string, string>();
      names.set(posix.basename(key), hash);
      visibleFilenameHash.set(folder, names);
    }
  }

  for (const [hash, photos] of orderedGroups) {
    for (const photo of photos) {
      const rule = ALBUM_RULES[photo.album];
      if (rule.kind === "page-asset") skippedPageAssets.push(photo);
    }

    const targetsByFolder = new Map<string, GalleryTarget>();
    for (const photo of photos) {
      for (const target of targetsForPhoto(photo)) targetsByFolder.set(target.folder, target);
    }
    const targets = [...targetsByFolder.values()].sort(
      (left, right) => left.priority - right.priority || left.folder.localeCompare(right.folder),
    );

    const relevantPhotos = photos.filter((photo) => {
      const kind = ALBUM_RULES[photo.album].kind;
      return kind !== "page-asset";
    });
    const hasUnresolvedAlbum = relevantPhotos.some(
      (photo) => ALBUM_RULES[photo.album].kind === "unresolved" && !MANUAL_TARGETS[photo.relativePath]?.length,
    );

    let hashKeys = existingKeysByHash.get(hash) || [];
    let owner =
      hashKeys.find((key) => {
        const folder = immediateGalleryFolder(key);
        return folder ? targetsByFolder.has(folder) : false;
      }) || hashKeys[0];

    if (!owner && targets.length > 0) {
      const primaryTarget = targets[0];
      const source =
        photos.find((photo) => targetsForPhoto(photo).some((target) => target.folder === primaryTarget.folder)) || photos[0];
      owner = allocateFilename(primaryTarget.folder, source.filename, hash, keyHash);
      registerUpload(owner, source, hash, "new");
      hashKeys = existingKeysByHash.get(hash) || [];
    }

    if (!owner && relevantPhotos.some((photo) => ALBUM_RULES[photo.album].kind === "featured")) {
      unresolved.push(...relevantPhotos.filter((photo) => ALBUM_RULES[photo.album].kind === "featured"));
      continue;
    }
    if (hasUnresolvedAlbum) {
      unresolved.push(...relevantPhotos.filter((photo) => ALBUM_RULES[photo.album].kind === "unresolved"));
    }
    if (!owner) continue;
    ownerByHash.set(hash, owner);

    for (const target of targets) {
      const exactKey = hashKeys.find((key) => immediateGalleryFolder(key) === target.folder);
      if (exactKey) {
        appearances.push({ hash, targetFolder: target.folder, targetSlug: target.slug, photoPath: exactKey });
        continue;
      }

      const ownerFilename = posix.basename(owner);
      const names = visibleFilenameHash.get(target.folder) || new Map<string, string>();
      const visibleHash = names.get(ownerFilename);
      if (!visibleHash || visibleHash === hash) {
        const targetMemberships = memberships.get(owner) || new Set<string>();
        targetMemberships.add(target.slug);
        memberships.set(owner, targetMemberships);
        names.set(ownerFilename, hash);
        visibleFilenameHash.set(target.folder, names);
        appearances.push({ hash, targetFolder: target.folder, targetSlug: target.slug, photoPath: owner });
        continue;
      }

      const aliasSource = photos.find(
        (photo) => targetsForPhoto(photo).some((candidate) => candidate.folder === target.folder),
      ) || photos[0];
      const aliasKey = allocateFilename(target.folder, aliasSource.filename, hash, keyHash);
      registerUpload(aliasKey, aliasSource, hash, "filename-collision");
      hashKeys = existingKeysByHash.get(hash) || [];
      appearances.push({ hash, targetFolder: target.folder, targetSlug: target.slug, photoPath: aliasKey });
    }
  }

  const appearanceByHashAndSlug = new Map(
    appearances.map((appearance) => [
      `${appearance.hash}\0${appearance.targetSlug}`,
      appearance.photoPath,
    ]),
  );
  const galleryOrders = new Map<string, string[]>();
  const galleryOrderSeen = new Map<string, Set<string>>();
  const sourceOrderRank = (photo: SourcePhoto): number => {
    const kind = ALBUM_RULES[photo.album].kind;
    if (kind === "gallery") return 0;
    if (kind === "unresolved") return 1;
    if (kind === "featured") return 2;
    return 3;
  };
  const sourcePhotosInEditorialOrder = [...sourcePhotos].sort((left, right) =>
    sourceOrderRank(left) - sourceOrderRank(right) ||
    left.album.localeCompare(right.album) ||
    left.order - right.order ||
    left.filename.localeCompare(right.filename, undefined, { numeric: true }),
  );
  for (const photo of sourcePhotosInEditorialOrder) {
    for (const target of targetsForPhoto(photo)) {
      const path = appearanceByHashAndSlug.get(`${photo.sha256}\0${target.slug}`);
      if (!path) continue;
      const seen = galleryOrderSeen.get(target.slug) || new Set<string>();
      if (seen.has(path)) continue;
      seen.add(path);
      galleryOrderSeen.set(target.slug, seen);
      const orderedPaths = galleryOrders.get(target.slug) || [];
      orderedPaths.push(path);
      galleryOrders.set(target.slug, orderedPaths);
    }
  }

  const featuredEntries: Array<{ gallery: string; filename: string }> = [];
  const featuredSeen = new Set<string>();
  for (const photo of sourcePhotos.filter((item) => item.album === "featured").sort((a, b) => a.order - b.order)) {
    const owner = ownerByHash.get(photo.sha256);
    const folder = owner ? immediateGalleryFolder(owner) : null;
    if (!owner || !folder) continue;
    const entry = { gallery: slugForFolder(folder), filename: posix.basename(owner) };
    const identity = `${entry.gallery}\0${entry.filename}`;
    if (!featuredSeen.has(identity)) {
      featuredSeen.add(identity);
      featuredEntries.push(entry);
    }
  }

  const galleryDefinitions = NEW_GALLERIES.filter(
    (definition) => !objectKeys.has(`galleries/${definition.folder}/gallery.yaml`),
  );
  const variantSources = new Map<string, SourcePhoto>();
  for (const [hash, owner] of ownerByHash) {
    const source = sourceGroups.get(hash)?.[0];
    if (source) variantSources.set(owner, source);
  }
  for (const appearance of appearances) {
    const source = sourceGroups.get(appearance.hash)?.[0];
    if (source && immediateGalleryFolder(appearance.photoPath) === appearance.targetFolder) {
      variantSources.set(appearance.photoPath, source);
    }
  }

  return {
    uploads,
    memberships,
    appearances,
    ownerByHash,
    sourceGroups,
    sourcePhotos,
    galleryOrders,
    featuredEntries,
    unresolved,
    skippedPageAssets,
    galleryDefinitions,
    existingOriginals,
    albumSummaries,
    variantSources,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printPlan(plan: MigrationPlan, sourceRoot: string, apply: boolean): void {
  const duplicateFiles = plan.sourcePhotos.length - plan.sourceGroups.size;
  const newBytes = plan.uploads.reduce((sum, upload) => sum + upload.size, 0);
  console.log("\nSquarespace gallery migration plan");
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Source: ${sourceRoot}`);
  console.log(`Source files: ${plan.sourcePhotos.length}`);
  console.log(`Unique source photos: ${plan.sourceGroups.size}`);
  console.log(`Byte-identical duplicate files: ${duplicateFiles}`);
  console.log(`Existing R2 originals: ${plan.existingOriginals.length}`);
  console.log(`New physical uploads: ${plan.uploads.length} (${formatBytes(newBytes)})`);
  console.log(`Logical memberships: ${[...plan.memberships.values()].reduce((sum, set) => sum + set.size, 0)}`);
  console.log(`Collision-safe aliases: ${plan.uploads.filter((upload) => upload.reason === "filename-collision").length}`);
  console.log(`New gallery metadata files: ${plan.galleryDefinitions.length}`);
  console.log(`Gallery orders preserved from Squarespace: ${plan.galleryOrders.size}`);
  console.log(`Featured/home entries: ${plan.featuredEntries.length}`);
  console.log(`Physical photos checked for responsive variants: ${plan.variantSources.size}`);
  console.log(`Page assets intentionally left outside galleries: ${plan.skippedPageAssets.length}`);

  console.log("\nAlbums (exported / already present by hash / new unique hashes / destination)");
  for (const [album, summary] of [...plan.albumSummaries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const rule = ALBUM_RULES[album];
    const destination =
      rule.kind === "gallery" ? rule.slug :
      rule.kind === "featured" ? "home.yaml" :
      rule.kind === "page-asset" ? `page:${rule.page}` :
      "REQUIRES REVIEW";
    console.log(
      `${album.padEnd(36)} ${String(summary.total).padStart(4)} / ${String(summary.existing).padStart(4)} / ${String(summary.newHashes.size).padStart(4)}  ${destination}`,
    );
  }

  if (plan.galleryDefinitions.length > 0) {
    console.log("\nGalleries to create");
    for (const definition of plan.galleryDefinitions) {
      console.log(`- ${definition.title}: ${slugForFolder(definition.folder)} (order ${definition.order})`);
    }
  }

  if (plan.unresolved.length > 0) {
    console.log("\nUNRESOLVED PHOTOS");
    for (const photo of plan.unresolved) console.log(`- ${photo.relativePath}`);
    console.log("Add each photo to MANUAL_TARGETS after visual review before using --apply.");
  }
}

function contentTypeFor(key: string): string {
  switch (extname(key).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".yaml":
    case ".yml":
      return "text/yaml";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

async function objectExists(client: S3Client, bucketName: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NotFound") return false;
    throw error;
  }
}

async function putNewObject(
  client: S3Client,
  bucketName: string,
  key: string,
  body: Uint8Array | string,
  contentType = contentTypeFor(key),
): Promise<void> {
  if (await objectExists(client, bucketName, key)) {
    throw new Error(`Refusing to overwrite existing R2 object: ${key}`);
  }
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    IfNoneMatch: "*",
  }));
}

async function getTextObject(client: S3Client, bucketName: string, key: string): Promise<string | null> {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    return await response.Body?.transformToString() || null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

async function backupMetadata(
  client: S3Client,
  bucketName: string,
  keys: readonly string[],
  backupPrefix: string,
): Promise<void> {
  for (const key of keys) {
    if (!(await objectExists(client, bucketName, key))) continue;
    await client.send(new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${key}`,
      Key: `${backupPrefix}/${key}`,
    }));
  }
}

function variantKey(originalKey: string, width: number): string {
  const extension = posix.extname(originalKey);
  const stem = extension ? originalKey.slice(0, -extension.length) : originalKey;
  return `${stem}_${width}w.webp`;
}

async function generateAndUploadVariants(
  plan: MigrationPlan,
  client: S3Client,
  bucketName: string,
  knownObjectKeys: Set<string>,
): Promise<{ created: number; bytes: number; optimizedImages: string[] }> {
  let created = 0;
  let bytes = 0;
  const optimizedImages: string[] = [];
  const entries = [...plan.variantSources.entries()];

  await mapLimit(entries, 2, async ([originalKey, source]) => {
    const metadata = await sharp(source.absolutePath).metadata();
    const originalWidth = metadata.width || 0;
    const requiredWidths = VARIANT_WIDTHS.filter((width) => width <= originalWidth);
    if (requiredWidths.length === 0) return;

    for (const width of requiredWidths) {
      const key = variantKey(originalKey, width);
      if (knownObjectKeys.has(key)) continue;
      const buffer = await sharp(source.absolutePath)
        .resize(width, undefined, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: VARIANT_QUALITY })
        .toBuffer();
      await putNewObject(client, bucketName, key, buffer, "image/webp");
      knownObjectKeys.add(key);
      created += 1;
      bytes += buffer.byteLength;
      if (created % 100 === 0) console.log(`[apply] Uploaded responsive variants ${created}`);
    }
    optimizedImages.push(originalKey);
  });

  return { created, bytes, optimizedImages };
}

function mergeOptimizationIndex(currentRaw: string | null, additions: readonly string[]): string {
  let current: {
    version?: number;
    variantWidths?: number[];
    optimizedImages?: string[];
    lastUpdated?: string;
  } = {};
  if (currentRaw) {
    try {
      const parsed = JSON.parse(currentRaw) as typeof current;
      if (parsed && typeof parsed === "object") current = parsed;
    } catch {
      throw new Error("Existing .optimization-index.json is invalid; refusing to replace it");
    }
  }
  return JSON.stringify({
    version: current.version || 1,
    variantWidths: [...VARIANT_WIDTHS],
    optimizedImages: [...new Set([...(current.optimizedImages || []), ...additions])].sort(),
    lastUpdated: new Date().toISOString(),
  });
}

function mergeMemberships(
  currentRaw: string | null,
  additions: Map<string, Set<string>>,
): string {
  let current: Record<string, string[]> = {};
  if (currentRaw) {
    try {
      const parsed = parse(currentRaw) as { memberships?: Record<string, string[]> } | null;
      if (parsed?.memberships && typeof parsed.memberships === "object") current = parsed.memberships;
    } catch {
      throw new Error("Existing gallery-memberships.yaml is invalid; refusing to replace it");
    }
  }
  for (const [photoPath, targets] of additions) {
    current[photoPath] = [...new Set([...(current[photoPath] || []), ...targets])].sort();
  }
  const memberships = Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right)));
  return stringify({ version: 1, updatedAt: new Date().toISOString(), memberships });
}

function mergeHomeConfig(
  currentRaw: string | null,
  additions: Array<{ gallery: string; filename: string }>,
): string {
  let current: Array<{ gallery: string; filename: string }> = [];
  if (currentRaw) {
    try {
      const parsed = parse(currentRaw) as { photos?: Array<{ gallery: string; filename: string }> } | null;
      if (Array.isArray(parsed?.photos)) current = parsed.photos;
    } catch {
      throw new Error("Existing home.yaml is invalid; refusing to replace it");
    }
  }
  const ordered: Array<{ gallery: string; filename: string }> = [];
  const seen = new Set<string>();
  for (const entry of [...additions, ...current]) {
    const identity = `${entry.gallery}\0${entry.filename}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      ordered.push(entry);
    }
  }
  return [
    "# Squarespace featured order first; pre-existing CMS selections are retained afterwards.",
    stringify({ photos: ordered }).trimEnd(),
    "",
  ].join("\n");
}

function mergeGalleryOrders(
  currentRaw: string | null,
  additions: ReadonlyMap<string, readonly string[]>,
): string {
  let current: Record<string, string[]> = {};
  if (currentRaw) {
    try {
      const parsed = parse(currentRaw) as {
        version?: number;
        orders?: Record<string, unknown>;
      } | null;
      if (!parsed || parsed.version !== 1 || !parsed.orders || typeof parsed.orders !== "object") {
        throw new Error("expected version 1 with an orders object");
      }
      current = Object.fromEntries(
        Object.entries(parsed.orders).flatMap(([slug, value]) => {
          if (!Array.isArray(value)) return [];
          const paths = Array.from(
            new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)),
          );
          return paths.length > 0 ? [[slug, paths]] : [];
        }),
      );
    } catch (error) {
      throw new Error(
        `Existing ${GALLERY_ORDERS_KEY} is invalid; refusing to replace it: ${error instanceof Error ? error.message : "invalid YAML"}`,
      );
    }
  }

  const merged = { ...current };
  for (const [slug, desiredPaths] of additions) {
    const desired = Array.from(new Set(desiredPaths));
    const desiredSet = new Set(desired);
    merged[slug] = [
      ...desired,
      ...(current[slug] || []).filter((path) => !desiredSet.has(path)),
    ];
  }

  const orderedOrders = Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
  return stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    orders: orderedOrders,
  });
}

async function applyPlan(
  plan: MigrationPlan,
  env: R2Environment,
  client: S3Client,
  objectsBefore: readonly _Object[],
): Promise<ContentIndex> {
  if (plan.unresolved.length > 0) {
    throw new Error(`Refusing to apply with ${plan.unresolved.length} unresolved photo(s)`);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const backupPrefix = `_migration-backups/squarespace-galleries/${timestamp}`;
  console.log(`\n[apply] Backing up mutable metadata to ${backupPrefix}`);
  await backupMetadata(
    client,
    env.bucketName,
    [
      "home.yaml",
      "gallery-memberships.yaml",
      GALLERY_ORDERS_KEY,
      ".optimization-index.json",
      "_content-index.json",
    ],
    backupPrefix,
  );

  let uploaded = 0;
  await mapLimit(plan.uploads, 4, async (upload) => {
    const bytes = await readFile(upload.sourcePath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== upload.sha256) {
      throw new Error(`Source photo changed after planning: ${upload.sourceRelativePath}`);
    }
    await putNewObject(client, env.bucketName, upload.key, bytes, contentTypeFor(upload.key));
    uploaded += 1;
    if (uploaded % 50 === 0 || uploaded === plan.uploads.length) {
      console.log(`[apply] Uploaded originals ${uploaded}/${plan.uploads.length}`);
    }
  });

  const knownObjectKeys = new Set(objectsBefore.flatMap((object) => object.Key ? [object.Key] : []));
  for (const upload of plan.uploads) knownObjectKeys.add(upload.key);
  console.log(`[apply] Generating responsive WebP variants at ${VARIANT_WIDTHS.join(", ")} px`);
  const variantResult = await generateAndUploadVariants(plan, client, env.bucketName, knownObjectKeys);
  console.log(
    `[apply] Responsive variants created: ${variantResult.created} (${formatBytes(variantResult.bytes)})`,
  );

  const currentOptimizationIndex = await getTextObject(client, env.bucketName, ".optimization-index.json");
  const mergedOptimizationIndex = mergeOptimizationIndex(
    currentOptimizationIndex,
    variantResult.optimizedImages,
  );
  await client.send(new PutObjectCommand({
    Bucket: env.bucketName,
    Key: ".optimization-index.json",
    Body: mergedOptimizationIndex,
    ContentType: "application/json",
  }));
  console.log("[apply] Updated .optimization-index.json");

  for (const definition of plan.galleryDefinitions) {
    const key = `galleries/${definition.folder}/gallery.yaml`;
    const yaml = stringify({
      title: definition.title,
      description: definition.description,
      order: definition.order,
    });
    await putNewObject(client, env.bucketName, key, yaml, "text/yaml");
    console.log(`[apply] Created ${key}`);
  }

  const currentMemberships = await getTextObject(client, env.bucketName, "gallery-memberships.yaml");
  const mergedMemberships = mergeMemberships(currentMemberships, plan.memberships);
  await client.send(new PutObjectCommand({
    Bucket: env.bucketName,
    Key: "gallery-memberships.yaml",
    Body: mergedMemberships,
    ContentType: "text/yaml",
  }));
  console.log("[apply] Merged gallery-memberships.yaml");

  const currentGalleryOrders = await getTextObject(client, env.bucketName, GALLERY_ORDERS_KEY);
  const mergedGalleryOrders = mergeGalleryOrders(currentGalleryOrders, plan.galleryOrders);
  await client.send(new PutObjectCommand({
    Bucket: env.bucketName,
    Key: GALLERY_ORDERS_KEY,
    Body: mergedGalleryOrders,
    ContentType: "text/yaml",
  }));
  console.log(`[apply] Preserved Squarespace order in ${GALLERY_ORDERS_KEY}`);

  const currentHome = await getTextObject(client, env.bucketName, "home.yaml");
  const mergedHome = mergeHomeConfig(currentHome, plan.featuredEntries);
  await client.send(new PutObjectCommand({
    Bucket: env.bucketName,
    Key: "home.yaml",
    Body: mergedHome,
    ContentType: "text/yaml",
  }));
  console.log("[apply] Preserved Squarespace featured order in home.yaml");

  const migrationManifest = {
    version: 1,
    appliedAt: new Date().toISOString(),
    sourceFileCount: plan.sourcePhotos.length,
    uniqueSourcePhotos: plan.sourceGroups.size,
    existingOriginalCount: plan.existingOriginals.length,
    uploadedOriginalCount: plan.uploads.length,
    logicalMembershipCount: [...plan.memberships.values()].reduce((sum, values) => sum + values.size, 0),
    orderedGalleryCount: plan.galleryOrders.size,
    orderedGalleryPhotoCount: [...plan.galleryOrders.values()].reduce((sum, values) => sum + values.length, 0),
    galleryOrders: Object.fromEntries(plan.galleryOrders),
    responsiveVariantCount: variantResult.created,
    responsiveVariantBytes: variantResult.bytes,
    galleryDefinitions: plan.galleryDefinitions,
    uploads: plan.uploads.map(({ key, sourceRelativePath, size, sha256, reason }) => ({
      key,
      sourceRelativePath,
      size,
      sha256,
      reason,
    })),
  };
  const manifestKey = `_migrations/squarespace-galleries/${timestamp}.json`;
  await putNewObject(
    client,
    env.bucketName,
    manifestKey,
    JSON.stringify(migrationManifest, null, 2),
    "application/json",
  );
  console.log(`[apply] Wrote audit manifest ${manifestKey}`);

  const adapter = new R2ApiAdapter({
    accountId: env.accountId,
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    bucketName: env.bucketName,
  });
  console.log("[apply] Rebuilding the content index with EXIF cache");
  const index = await rebuildContentIndex(adapter);

  const objectKeysBefore = new Set(objectsBefore.flatMap((object) => object.Key ? [object.Key] : []));
  const objectsAfter = await listAllObjects(client, env.bucketName);
  const objectKeysAfter = new Set(objectsAfter.flatMap((object) => object.Key ? [object.Key] : []));
  const missingOldKeys = [...objectKeysBefore].filter((key) => !objectKeysAfter.has(key));
  if (missingOldKeys.length > 0) {
    throw new Error(`Validation failed: ${missingOldKeys.length} pre-existing R2 object(s) disappeared`);
  }
  const missingUploads = plan.uploads.filter((upload) => !objectKeysAfter.has(upload.key));
  if (missingUploads.length > 0) {
    throw new Error(`Validation failed: ${missingUploads.length} upload(s) are missing from R2`);
  }

  const missingAppearances: AppearancePlan[] = [];
  for (const appearance of plan.appearances) {
    const gallery = index.galleryData.find((entry) => entry.slug === appearance.targetSlug);
    if (!gallery?.photos.some((photo) => photo.path === appearance.photoPath)) {
      missingAppearances.push(appearance);
    }
  }
  if (missingAppearances.length > 0) {
    const examples = missingAppearances.slice(0, 5).map(
      (appearance) => `${appearance.photoPath} -> ${appearance.targetSlug}`,
    );
    throw new Error(
      `Validation failed: ${missingAppearances.length} gallery appearance(s) are missing (${examples.join(", ")})`,
    );
  }

  let orderedPhotosVerified = 0;
  for (const [gallerySlug, expectedPaths] of plan.galleryOrders) {
    const gallery = index.galleryData.find((entry) => entry.slug === gallerySlug);
    if (!gallery) throw new Error(`Validation failed: ordered gallery ${gallerySlug} is missing`);
    const expectedSet = new Set(expectedPaths);
    const actualMigratedOrder = gallery.photos
      .map((photo) => photo.path)
      .filter((path) => expectedSet.has(path));
    if (
      actualMigratedOrder.length !== expectedPaths.length ||
      actualMigratedOrder.some((path, position) => path !== expectedPaths[position])
    ) {
      throw new Error(`Validation failed: ${gallerySlug} does not match the Squarespace photo order`);
    }
    orderedPhotosVerified += expectedPaths.length;
  }

  const persistedHomeRaw = await getTextObject(client, env.bucketName, "home.yaml");
  const persistedHome = persistedHomeRaw
    ? parse(persistedHomeRaw) as { photos?: Array<{ gallery: string; filename: string }> }
    : null;
  const persistedFeaturedPrefix = persistedHome?.photos?.slice(0, plan.featuredEntries.length) || [];
  if (
    persistedFeaturedPrefix.length !== plan.featuredEntries.length ||
    persistedFeaturedPrefix.some((entry, position) => {
      const expected = plan.featuredEntries[position];
      return entry.gallery !== expected.gallery || entry.filename !== expected.filename;
    })
  ) {
    throw new Error("Validation failed: home.yaml does not match the Squarespace featured order");
  }

  const homePhotos = await getHomePhotosFromIndex(adapter, { photos: plan.featuredEntries });
  if (homePhotos.length !== plan.featuredEntries.length) {
    throw new Error(
      `Validation failed: home resolved ${homePhotos.length}/${plan.featuredEntries.length} featured photos`,
    );
  }

  console.log("\n[verified]");
  console.log(`Pre-existing R2 objects preserved: ${objectKeysBefore.size}/${objectKeysBefore.size}`);
  console.log(`Uploaded originals present: ${plan.uploads.length}/${plan.uploads.length}`);
  console.log(`Gallery appearances present: ${plan.appearances.length}/${plan.appearances.length}`);
  console.log(`Squarespace gallery order verified: ${orderedPhotosVerified}/${orderedPhotosVerified}`);
  console.log(`Featured photos resolved: ${homePhotos.length}/${plan.featuredEntries.length}`);
  console.log(`Index: ${index.stats.totalGalleries} galleries, ${index.stats.totalPhotos} gallery appearances`);
  return index;
}

async function main(): Promise<void> {
  const { apply, sourceRoot } = parseArguments();
  const env = await loadEnvironment();
  const client = makeClient(env);

  console.log(`[scan] Reading Squarespace export from ${sourceRoot}`);
  const sourcePhotos = await scanSource(sourceRoot);
  console.log(`[scan] Reading production R2 bucket ${env.bucketName}`);
  const objects = await listAllObjects(client, env.bucketName);
  const existingOriginals = await hashExistingOriginals(client, env.bucketName, objects);
  const objectKeys = new Set(objects.flatMap((object) => object.Key ? [object.Key] : []));
  const plan = makePlan(sourcePhotos, existingOriginals, objectKeys);
  printPlan(plan, sourceRoot, apply);

  if (!apply) {
    console.log("\nDry run only. No R2 objects were changed.");
    return;
  }
  await applyPlan(plan, env, client, objects);
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
