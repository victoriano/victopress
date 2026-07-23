#!/usr/bin/env bun

/**
 * Make the current victoriano.me display order canonical in VictoPress.
 *
 * The Squarespace media-export CSV is ordered by attachment date, not by the
 * gallery's visual displayIndex. This script reads each live gallery JSON,
 * resolves every source filename to an existing VictoPress photo, and updates
 * only order metadata. VictoPress-only photos are retained afterwards in their
 * existing relative order.
 *
 * Dry run (default):
 *   bun run sync:squarespace-orders
 *
 * Apply to the configured R2 bucket:
 *   bun run sync:squarespace-orders --apply
 */

import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import {
  readContentIndex,
  rebuildContentIndex,
  type ContentIndex,
  type GalleryDataEntry,
} from "../app/lib/content-engine/content-index";
import { GALLERY_ORDERS_KEY } from "../app/lib/content-engine/gallery-orders";
import { R2ApiAdapter } from "../app/lib/content-engine/storage/r2-api-adapter";
import {
  SQUARESPACE_DUPLICATE_PHOTO_COPIES,
  SQUARESPACE_FILENAME_ALIASES_BY_ROUTE,
  SQUARESPACE_GALLERY_SOURCES,
  fetchSquarespaceGallerySnapshot,
  mergeCanonicalPhotoOrder,
  resolveSquarespacePhotoOrder,
  type PhotoCandidate,
  type SquarespaceGallerySnapshot,
} from "./lib/squarespace-gallery-order";

const DEFAULT_BASE_URL = "https://victoriano.me";
const HOME_KEY = "home.yaml";
const CONTENT_INDEX_KEY = "_content-index.json";

interface R2Environment {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

interface HomeEntry {
  gallery: string;
  filename: string;
}

interface GalleryOrderPlan {
  sourceRoute: string;
  sourceTitle: string;
  targetSlug: string;
  sourceCount: number;
  currentCount: number;
  canonicalPaths: string[];
  mergedPaths: string[];
  renderedPaths: string[];
  visibleCanonicalCount: number;
  changed: boolean;
}

function parseArguments(): {
  apply: boolean;
  baseUrl: string;
  verifyUrl?: string;
} {
  const args = process.argv.slice(2);
  const baseUrlIndex = args.indexOf("--base-url");
  const baseUrl =
    baseUrlIndex >= 0 ? args[baseUrlIndex + 1] : DEFAULT_BASE_URL;
  if (!baseUrl) throw new Error("--base-url requires a URL");
  const verifyUrlIndex = args.indexOf("--verify-url");
  const verifyUrl =
    verifyUrlIndex >= 0 ? args[verifyUrlIndex + 1] : undefined;
  if (verifyUrlIndex >= 0 && !verifyUrl) {
    throw new Error("--verify-url requires a URL");
  }
  return {
    apply: args.includes("--apply"),
    baseUrl: new URL(baseUrl).toString(),
    verifyUrl: verifyUrl ? new URL(verifyUrl).toString() : undefined,
  };
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
    throw new Error(
      "Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY in .dev.vars",
    );
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName: values.R2_BUCKET_NAME || "victopress-content",
  };
}

function parseGalleryOrders(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  const payload = parse(raw) as {
    version?: unknown;
    orders?: Record<string, unknown>;
  } | null;
  if (
    payload?.version !== 1 ||
    !payload.orders ||
    typeof payload.orders !== "object"
  ) {
    throw new Error(`Existing ${GALLERY_ORDERS_KEY} is invalid`);
  }
  return Object.fromEntries(
    Object.entries(payload.orders).flatMap(([slug, paths]) => {
      if (!Array.isArray(paths)) return [];
      const validPaths = paths.filter(
        (path): path is string => typeof path === "string" && path.length > 0,
      );
      return [[slug, Array.from(new Set(validPaths))]];
    }),
  );
}

function parseHomeEntries(raw: string | null): HomeEntry[] {
  if (!raw) return [];
  const payload = parse(raw) as { photos?: unknown } | null;
  if (!Array.isArray(payload?.photos)) {
    throw new Error(`Existing ${HOME_KEY} does not contain a photos array`);
  }
  return payload.photos.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as HomeEntry).gallery !== "string" ||
      typeof (entry as HomeEntry).filename !== "string"
    ) {
      return [];
    }
    return [entry as HomeEntry];
  });
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

function homeCandidates(
  index: ContentIndex,
  entries: readonly HomeEntry[],
): Array<PhotoCandidate & { entry: HomeEntry }> {
  return entries.map((entry) => {
    const gallery = index.galleryData.find(
      (candidate) => candidate.slug === entry.gallery,
    );
    if (!gallery) {
      throw new Error(
        `${HOME_KEY} references missing gallery ${entry.gallery}`,
      );
    }
    const matches = gallery.photos.filter(
      (photo) => photo.filename === entry.filename,
    );
    if (matches.length !== 1) {
      throw new Error(
        `${HOME_KEY} could not uniquely resolve ${entry.gallery}/${entry.filename}`,
      );
    }
    return {
      path: matches[0].path,
      filename: matches[0].filename,
      entry,
    };
  });
}

function buildGalleryPlan(
  gallery: GalleryDataEntry,
  snapshot: SquarespaceGallerySnapshot,
): GalleryOrderPlan {
  const duplicateCopies = SQUARESPACE_DUPLICATE_PHOTO_COPIES.filter(
    (copy) => copy.route === snapshot.route,
  );
  const syntheticPhotos = duplicateCopies
    .filter(
      (copy) =>
        !gallery.photos.some((photo) => photo.path === copy.duplicatePath),
    )
    .map((copy) => ({
      path: copy.duplicatePath,
      filename: copy.duplicatePath.split("/").at(-1) ?? copy.filename,
    }));
  const photos = [...gallery.photos, ...syntheticPhotos];
  const occurrencePaths = Object.fromEntries(
    duplicateCopies.map((copy) => [
      copy.filename,
      [copy.sourcePath, copy.duplicatePath],
    ]),
  );
  const resolution = resolveSquarespacePhotoOrder(
    snapshot.filenames,
    photos,
    SQUARESPACE_FILENAME_ALIASES_BY_ROUTE[snapshot.route],
    occurrencePaths,
  );
  if (resolution.missing.length > 0 || resolution.ambiguous.length > 0) {
    const problems = [
      resolution.missing.length > 0
        ? `missing: ${resolution.missing.join(", ")}`
        : "",
      resolution.ambiguous.length > 0
        ? `ambiguous: ${resolution.ambiguous
            .map((match) => `${match.filename} (${match.paths.join(" | ")})`)
            .join(", ")}`
        : "",
    ].filter(Boolean);
    throw new Error(
      `${snapshot.route} -> ${gallery.slug} is not an exact match (${problems.join("; ")})`,
    );
  }
  if (resolution.orderedPaths.length !== snapshot.filenames.length) {
    throw new Error(
      `${snapshot.route} resolved ${resolution.orderedPaths.length}/${snapshot.filenames.length} photos`,
    );
  }

  const mergedPaths = mergeCanonicalPhotoOrder(
    photos,
    resolution.orderedPaths,
  );
  const hiddenPaths = new Set(
    gallery.photos
      .filter((photo) => photo.hidden)
      .map((photo) => photo.path),
  );
  return {
    sourceRoute: snapshot.route,
    sourceTitle: snapshot.title,
    targetSlug: gallery.slug,
    sourceCount: snapshot.filenames.length,
    currentCount: photos.length,
    canonicalPaths: resolution.orderedPaths,
    mergedPaths,
    renderedPaths: mergedPaths.filter((path) => !hiddenPaths.has(path)),
    visibleCanonicalCount: resolution.orderedPaths.filter(
      (path) => !hiddenPaths.has(path),
    ).length,
    changed: !pathsEqual(
      gallery.photos.map((photo) => photo.path),
      mergedPaths,
    ),
  };
}

async function backupIfPresent(
  storage: R2ApiAdapter,
  key: string,
  backupPrefix: string,
): Promise<void> {
  if (await storage.exists(key)) {
    await storage.copy(key, `${backupPrefix}/${key}`);
  }
}

function variantPath(path: string, width: number): string {
  const extensionIndex = path.lastIndexOf(".");
  const stem = extensionIndex >= 0 ? path.slice(0, extensionIndex) : path;
  return `${stem}_${width}w.webp`;
}

async function createDuplicatePhotoCopy(
  storage: R2ApiAdapter,
  copy: (typeof SQUARESPACE_DUPLICATE_PHOTO_COPIES)[number],
): Promise<number> {
  const pairs = [
    { source: copy.sourcePath, target: copy.duplicatePath },
    ...[800, 1600, 2400].map((width) => ({
      source: variantPath(copy.sourcePath, width),
      target: variantPath(copy.duplicatePath, width),
    })),
  ];
  let created = 0;
  for (const pair of pairs) {
    if (await storage.exists(pair.target)) continue;
    if (!(await storage.exists(pair.source))) {
      if (pair.source === copy.sourcePath) {
        throw new Error(`Duplicate source photo is missing: ${pair.source}`);
      }
      continue;
    }
    await storage.copy(pair.source, pair.target);
    created += 1;
  }
  return created;
}

function assertAppliedGalleryOrders(
  index: ContentIndex,
  plans: readonly GalleryOrderPlan[],
): void {
  for (const plan of plans) {
    const gallery = index.galleryData.find(
      (candidate) => candidate.slug === plan.targetSlug,
    );
    const actual = gallery?.photos.map((photo) => photo.path) ?? [];
    if (!pathsEqual(actual, plan.mergedPaths)) {
      throw new Error(
        `Post-apply validation failed for ${plan.targetSlug}: indexed order differs`,
      );
    }
  }
}

function imagePathsFromHtml(html: string, baseUrl: string): string[] {
  return Array.from(html.matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1/gi))
    .map((match) => match[2].replaceAll("&amp;", "&"))
    .flatMap((src) => {
      const pathname = decodeURIComponent(new URL(src, baseUrl).pathname);
      return pathname.startsWith("/api/images/")
        ? [pathname.slice("/api/images/".length)]
        : [];
    });
}

async function fetchRenderedImagePaths(url: URL): Promise<string[]> {
  url.searchParams.set("order-verify", Date.now().toString());
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}`);
  }
  return imagePathsFromHtml(await response.text(), url.toString());
}

async function verifyPublicPreview(
  verifyUrl: string,
  plans: readonly GalleryOrderPlan[],
  expectedHomePaths: readonly string[],
): Promise<void> {
  console.log(`\n[preview] Verifying rendered order at ${verifyUrl}`);
  let verifiedGalleryPhotos = 0;
  for (const plan of plans) {
    const actualPaths: string[] = [];
    const totalPages = Math.max(1, Math.ceil(plan.renderedPaths.length / 50));
    for (let page = 1; page <= totalPages; page += 1) {
      const url = new URL(`/gallery/${plan.targetSlug}`, verifyUrl);
      if (page > 1) url.searchParams.set("page", String(page));
      actualPaths.push(...await fetchRenderedImagePaths(url));
    }
    const renderedPrefix = actualPaths.slice(0, plan.renderedPaths.length);
    if (!pathsEqual(renderedPrefix, plan.renderedPaths)) {
      const mismatchIndex = Math.max(
        0,
        renderedPrefix.findIndex(
          (path, index) => path !== plan.renderedPaths[index],
        ),
      );
      throw new Error(
        `Rendered order mismatch for ${plan.targetSlug} at position ${mismatchIndex + 1}: ` +
        `expected ${plan.renderedPaths[mismatchIndex] ?? "<end>"}, ` +
        `received ${actualPaths[mismatchIndex] ?? "<end>"}`,
      );
    }
    verifiedGalleryPhotos += plan.visibleCanonicalCount;
    console.log(
      `[preview] ${plan.targetSlug}: ${plan.visibleCanonicalCount}/${plan.visibleCanonicalCount}`,
    );
  }

  const actualHomePaths = await fetchRenderedImagePaths(
    new URL("/", verifyUrl),
  );
  if (!pathsEqual(actualHomePaths, expectedHomePaths)) {
    throw new Error(
      `Rendered home order differs: ${actualHomePaths.length}/${expectedHomePaths.length} entries`,
    );
  }
  console.log(
    `[preview] home: ${expectedHomePaths.length}/${expectedHomePaths.length}`,
  );
  console.log(
    `[preview] Exact rendered sequence verified: ${verifiedGalleryPhotos}/${verifiedGalleryPhotos} gallery photos`,
  );
}

async function main(): Promise<void> {
  const { apply, baseUrl, verifyUrl } = parseArguments();
  const env = await loadEnvironment();
  const storage = new R2ApiAdapter(env);

  console.log(`[source] Reading live gallery displayIndex values from ${baseUrl}`);
  const snapshots = await Promise.all(
    SQUARESPACE_GALLERY_SOURCES.map((source) =>
      fetchSquarespaceGallerySnapshot(baseUrl, source.route),
    ),
  );
  const snapshotsByRoute = new Map(
    snapshots.map((snapshot) => [snapshot.route, snapshot]),
  );

  const [index, galleryOrdersRaw, homeRaw] = await Promise.all([
    readContentIndex(storage),
    storage.getText(GALLERY_ORDERS_KEY),
    storage.getText(HOME_KEY),
  ]);
  if (!index) {
    throw new Error(
      `No current version of ${CONTENT_INDEX_KEY} exists in ${env.bucketName}`,
    );
  }

  const existingOrders = parseGalleryOrders(galleryOrdersRaw);
  const plans = SQUARESPACE_GALLERY_SOURCES.flatMap((source) => {
    if (!source.targetGallery) return [];
    const snapshot = snapshotsByRoute.get(source.route);
    const gallery = index.galleryData.find(
      (candidate) => candidate.slug === source.targetGallery,
    );
    if (!snapshot) throw new Error(`Missing source snapshot ${source.route}`);
    if (!gallery) {
      throw new Error(`Missing VictoPress gallery ${source.targetGallery}`);
    }
    return [buildGalleryPlan(gallery, snapshot)];
  });

  const featuredSnapshot = snapshotsByRoute.get("featured");
  if (!featuredSnapshot) throw new Error("Missing Squarespace featured snapshot");
  const currentHomeEntries = parseHomeEntries(homeRaw);
  const currentHomeCandidates = homeCandidates(index, currentHomeEntries);
  const featuredResolution = resolveSquarespacePhotoOrder(
    featuredSnapshot.filenames,
    currentHomeCandidates,
    SQUARESPACE_FILENAME_ALIASES_BY_ROUTE.featured,
  );
  if (
    featuredResolution.missing.length > 0 ||
    featuredResolution.ambiguous.length > 0 ||
    featuredResolution.orderedPaths.length !== featuredSnapshot.filenames.length
  ) {
    throw new Error(
      `featured is not an exact match (missing ${featuredResolution.missing.length}, ambiguous ${featuredResolution.ambiguous.length}, resolved ${featuredResolution.orderedPaths.length}/${featuredSnapshot.filenames.length})`,
    );
  }
  const homeCandidateByPath = new Map(
    currentHomeCandidates.map((candidate) => [candidate.path, candidate]),
  );
  const canonicalHomePaths = featuredResolution.orderedPaths;
  const canonicalHomeSet = new Set(canonicalHomePaths);
  const nextHomeEntries = [
    ...canonicalHomePaths.map((path) => {
      const candidate = homeCandidateByPath.get(path);
      if (!candidate) {
        throw new Error(`Could not map featured path ${path} back to home.yaml`);
      }
      return candidate.entry;
    }),
    ...currentHomeCandidates
      .filter((candidate) => !canonicalHomeSet.has(candidate.path))
      .map((candidate) => candidate.entry),
  ];
  const expectedHomePaths = [
    ...canonicalHomePaths,
    ...currentHomeCandidates
      .filter((candidate) => !canonicalHomeSet.has(candidate.path))
      .map((candidate) => candidate.path),
  ];
  const homeChanged = nextHomeEntries.some(
    (entry, index) =>
      entry.gallery !== currentHomeEntries[index]?.gallery ||
      entry.filename !== currentHomeEntries[index]?.filename,
  );

  const totalSourcePhotos = plans.reduce(
    (sum, plan) => sum + plan.sourceCount,
    0,
  );
  console.log(
    `\nExact matches: ${plans.length}/${plans.length} galleries, ${totalSourcePhotos}/${totalSourcePhotos} gallery photos`,
  );
  for (const plan of plans) {
    const extras = plan.currentCount - plan.sourceCount;
    console.log(
      `- /${plan.sourceRoute} -> ${plan.targetSlug}: ${plan.sourceCount} matching, ${extras} VictoPress-only, ${plan.changed ? "reorder needed" : "already exact"}`,
    );
  }
  console.log(
    `- /featured -> ${HOME_KEY}: ${featuredSnapshot.filenames.length} matching, ${currentHomeEntries.length - featuredSnapshot.filenames.length} VictoPress-only, ${homeChanged ? "reorder needed" : "already exact"}`,
  );
  const duplicateCopiesNeeded = SQUARESPACE_DUPLICATE_PHOTO_COPIES.filter(
    (copy) =>
      !index.galleryData.some((gallery) =>
        gallery.photos.some((photo) => photo.path === copy.duplicatePath),
      ),
  );
  for (const copy of duplicateCopiesNeeded) {
    console.log(
      `- /${copy.route}: one repeated Squarespace item needs a non-destructive R2 alias`,
    );
  }

  const portraitPlan = plans.find(
    (plan) => plan.targetSlug === "humans/portraits",
  );
  if (portraitPlan) {
    console.log("\nPortraits canonical first row:");
    for (const path of portraitPlan.canonicalPaths.slice(0, 4)) {
      console.log(`  ${path}`);
    }
  }

  if (!apply) {
    if (verifyUrl) {
      await verifyPublicPreview(
        verifyUrl,
        plans,
        expectedHomePaths,
      );
    }
    console.log("\nDry run only. No R2 objects were changed.");
    return;
  }

  const nextOrders = { ...existingOrders };
  for (const plan of plans) nextOrders[plan.targetSlug] = plan.mergedPaths;
  const orderedOrders = Object.fromEntries(
    Object.entries(nextOrders).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const nextOrdersRaw = stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    source: baseUrl,
    orders: orderedOrders,
  });
  const nextHomeRaw = [
    "# Current victoriano.me /featured display order first; VictoPress-only selections follow.",
    stringify({ photos: nextHomeEntries }).trimEnd(),
    "",
  ].join("\n");

  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(".", "-");
  const backupPrefix = `_migration-backups/squarespace-live-orders/${timestamp}`;
  console.log(`\n[apply] Backing up order metadata to ${backupPrefix}`);
  await Promise.all([
    backupIfPresent(storage, GALLERY_ORDERS_KEY, backupPrefix),
    backupIfPresent(storage, HOME_KEY, backupPrefix),
    backupIfPresent(storage, CONTENT_INDEX_KEY, backupPrefix),
  ]);

  let duplicateObjectsCreated = 0;
  for (const copy of duplicateCopiesNeeded) {
    duplicateObjectsCreated += await createDuplicatePhotoCopy(storage, copy);
  }
  await storage.put(GALLERY_ORDERS_KEY, nextOrdersRaw, "text/yaml");
  if (homeChanged) {
    await storage.put(HOME_KEY, nextHomeRaw, "text/yaml");
  }
  const rebuiltIndex = await rebuildContentIndex(storage);
  assertAppliedGalleryOrders(rebuiltIndex, plans);
  const rebuiltHomeCandidates = homeCandidates(rebuiltIndex, nextHomeEntries);
  const rebuiltHomePaths = rebuiltHomeCandidates.map(
    (candidate) => candidate.path,
  );
  if (!pathsEqual(rebuiltHomePaths, expectedHomePaths)) {
    throw new Error("Post-apply validation failed for home.yaml");
  }
  if (verifyUrl) {
    await verifyPublicPreview(verifyUrl, plans, expectedHomePaths);
  }

  console.log("\n[verified]");
  console.log(
    `Squarespace gallery display order: ${totalSourcePhotos}/${totalSourcePhotos}`,
  );
  console.log(
    `Squarespace featured display order: ${canonicalHomePaths.length}/${canonicalHomePaths.length}`,
  );
  console.log(
    `VictoPress-only gallery and home photos retained: yes`,
  );
  console.log(
    `Repeated Squarespace photo aliases created: ${duplicateObjectsCreated}`,
  );
  console.log(
    `Index: ${rebuiltIndex.stats.totalGalleries} galleries, ${rebuiltIndex.stats.totalPhotos} gallery appearances`,
  );
}

main().catch((error) => {
  console.error(
    `\nOrder sync failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
