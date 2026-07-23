import { posix } from "node:path";

export interface SquarespaceGallerySource {
  album: string;
  route: string;
  targetGallery?: string;
}

export const SQUARESPACE_GALLERY_SOURCES: readonly SquarespaceGallerySource[] = [
  { album: "Australia", route: "australia", targetGallery: "geographies/australia" },
  { album: "New_York", route: "new-york", targetGallery: "geographies/america/usa/new-york" },
  { album: "Central_Europe", route: "central-europe", targetGallery: "geographies/europe/central-europe" },
  { album: "London", route: "london", targetGallery: "geographies/europe/united-kingdom/london" },
  { album: "Rituals", route: "rituals", targetGallery: "humans/rituals" },
  { album: "Social", route: "social", targetGallery: "humans/social" },
  { album: "Rome", route: "rome", targetGallery: "geographies/europe/italy/rome" },
  { album: "Portraits", route: "portraits", targetGallery: "humans/portraits" },
  { album: "Landscapes", route: "landscapes", targetGallery: "spaces/landscapes" },
  {
    album: "Granada",
    route: "granada",
    targetGallery: "geographies/europe/spain/south-of-spain/granada",
  },
  { album: "Madrid", route: "madrid", targetGallery: "geographies/europe/spain/madrid" },
  { album: "Dubai", route: "dubai", targetGallery: "geographies/asia/dubai" },
  { album: "Travelling", route: "travelling", targetGallery: "spaces/travelling" },
  { album: "Urban", route: "urban", targetGallery: "spaces/urban" },
  { album: "Japan", route: "japan", targetGallery: "geographies/asia/japan" },
  {
    album: "San_Francisco_with_iPhone_Xs",
    route: "san-francisco",
    targetGallery: "geographies/america/usa/san-francisco",
  },
  { album: "China", route: "china", targetGallery: "geographies/asia/china" },
  {
    album: "North_of_Spain",
    route: "north-of-spain",
    targetGallery: "geographies/europe/spain/north-of-spain",
  },
  {
    album: "Canary_Islands",
    route: "canary-islands",
    targetGallery: "geographies/europe/spain/canary-islands",
  },
  {
    album: "South_of_Spain",
    route: "south-of-spain",
    targetGallery: "geographies/europe/spain/south-of-spain",
  },
  { album: "featured", route: "featured" },
] as const;

/**
 * Proven image-identity aliases created by the additive import:
 * - Squarespace's `_MG_4009.jpg` was downloaded/imported as `MG_4009.jpg`.
 * - `10727842656_0ec1204868_o.jpg` is byte-identical to Australia's
 *   `IMG_4857.jpg`, so VictoPress correctly stores one original and exposes it
 *   in Social through a logical membership.
 */
export const SQUARESPACE_FILENAME_ALIASES_BY_ROUTE: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  portraits: {
    "IMG_1081bjpg": "IMG_1081bjpg.jpg",
    "IMG_1190jpg": "IMG_1190jpg.jpg",
  },
  madrid: {
    "image-asset.jpeg": "img.jpg",
  },
  "san-francisco": Object.fromEntries(
    [
      "D20776E4-7D86-4DC3-BEC3-0A53F42E9C4A+2.JPG",
      "B6A289B0-80AB-4666-BBC1-F421FC6116A9+2.JPG",
      "9784350D-5CFD-4841-A962-8492523AD7E2+2.JPG",
      "0628268C-A35A-4027-8C9F-6D115177CFF2+2.JPG",
      "BC8B7B7E-292F-48EF-9B34-995EE14AFB4F+2.JPG",
      "0219DFEC-B4B6-49ED-B03E-55F3DAB8A595+2.JPG",
      "318335D9-7049-4D84-877B-078ABAE65E29+2.JPG",
      "14524595-0301-4904-B889-0E29DF0EA5A3+2.JPG",
      "8D0FCA92-20FB-4C04-8DCC-FB65741C905B+2.JPG",
    ].map((filename) => [filename, filename.replace("+2.JPG", "_2.JPG")]),
  ),
  featured: {
    "Polonia_3monja-Best.jpg": "3114435714_b964373dc8_o.jpg",
    "8+-+P1030294.jpg": "P1030294.jpg",
    "9+-+IMG_4013.jpg": "9_-_IMG_4013.jpg",
    "8939154380_fd36931812_o.jpg": "IMG_9254b.jpg",
    "19+-+IMG_7204.jpg": "IMG_7204.jpg",
    "IMG_7588_1b.jpg": "16829268284_d477cb6f9a_o.jpg",
  },
  social: {
    "_MG_4009.jpg": "MG_4009.jpg",
    "10727842656_0ec1204868_o.jpg": "IMG_4857.jpg",
  },
};

export interface SquarespaceDuplicatePhotoCopy {
  route: string;
  filename: string;
  sourcePath: string;
  duplicatePath: string;
}

/**
 * Rome intentionally contains the same Squarespace photograph twice. The
 * export downloader collapsed both occurrences into one local filename, so an
 * R2 alias is required to preserve the visible 38-item sequence exactly.
 */
export const SQUARESPACE_DUPLICATE_PHOTO_COPIES:
  readonly SquarespaceDuplicatePhotoCopy[] = [
  {
    route: "rome",
    filename: "P1300894.jpg",
    sourcePath: "galleries/geographies/europe/italy/rome/P1300894.jpg",
    duplicatePath:
      "galleries/geographies/europe/italy/rome/P1300894--squarespace-duplicate.jpg",
  },
] as const;

export interface SquarespaceGalleryItem {
  filename?: unknown;
  assetUrl?: unknown;
  displayIndex?: unknown;
}

export interface SquarespaceGallerySnapshot {
  route: string;
  title: string;
  filenames: string[];
}

export interface PhotoCandidate {
  path: string;
  filename: string;
}

export interface AmbiguousPhotoMatch {
  filename: string;
  paths: string[];
}

export interface PhotoOrderResolution {
  orderedPaths: string[];
  missing: string[];
  ambiguous: AmbiguousPhotoMatch[];
}

export function normalizePhotoFilename(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

export function filenameFromSquarespaceItem(item: SquarespaceGalleryItem): string {
  if (typeof item.assetUrl === "string" && item.assetUrl.trim()) {
    try {
      const pathname = new URL(item.assetUrl).pathname;
      const encodedFilename = pathname.split("/").at(-1);
      if (encodedFilename) return decodeURIComponent(encodedFilename);
    } catch {
      // Fall through to the filename field for malformed legacy URLs.
    }
  }
  return typeof item.filename === "string" ? item.filename.trim() : "";
}

export function filenamesInSquarespaceDisplayOrder(
  items: readonly SquarespaceGalleryItem[],
): string[] {
  return items
    .map((item, sourceIndex) => ({
      filename: filenameFromSquarespaceItem(item),
      sourceIndex,
      displayIndex:
        typeof item.displayIndex === "number" && Number.isFinite(item.displayIndex)
          ? item.displayIndex
          : sourceIndex,
    }))
    .filter((item) => item.filename.length > 0)
    .sort(
      (left, right) =>
        left.displayIndex - right.displayIndex || left.sourceIndex - right.sourceIndex,
    )
    .map((item) => item.filename);
}

export async function fetchSquarespaceGallerySnapshot(
  baseUrl: string,
  route: string,
): Promise<SquarespaceGallerySnapshot> {
  const url = new URL(`/${route}`, baseUrl);
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Squarespace ${route} returned HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    collection?: { title?: unknown; typeName?: unknown; itemCount?: unknown };
    items?: SquarespaceGalleryItem[];
  };
  if (payload.collection?.typeName !== "gallery" || !Array.isArray(payload.items)) {
    throw new Error(`Squarespace ${route} did not return a gallery payload`);
  }

  const filenames = filenamesInSquarespaceDisplayOrder(payload.items);
  if (filenames.length !== payload.items.length) {
    throw new Error(
      `Squarespace ${route} returned ${payload.items.length} items but only ${filenames.length} filenames`,
    );
  }
  if (
    typeof payload.collection.itemCount === "number" &&
    payload.collection.itemCount !== filenames.length
  ) {
    throw new Error(
      `Squarespace ${route} returned ${filenames.length}/${payload.collection.itemCount} items`,
    );
  }

  return {
    route,
    title:
      typeof payload.collection.title === "string"
        ? payload.collection.title
        : route,
    filenames,
  };
}

export function resolveSquarespacePhotoOrder(
  sourceFilenames: readonly string[],
  photos: readonly PhotoCandidate[],
  filenameAliases: Readonly<Record<string, string>> = {},
  occurrencePaths: Readonly<Record<string, readonly string[]>> = {},
): PhotoOrderResolution {
  const candidatesByFilename = new Map<string, PhotoCandidate[]>();
  for (const photo of photos) {
    const key = normalizePhotoFilename(photo.filename || posix.basename(photo.path));
    if (!key) continue;
    const candidates = candidatesByFilename.get(key) ?? [];
    if (!candidates.some((candidate) => candidate.path === photo.path)) {
      candidates.push(photo);
    }
    candidatesByFilename.set(key, candidates);
  }

  const orderedPaths: string[] = [];
  const missing: string[] = [];
  const ambiguous: AmbiguousPhotoMatch[] = [];
  const usedPaths = new Set<string>();
  const occurrenceCounts = new Map<string, number>();

  for (const filename of sourceFilenames) {
    const normalizedSourceFilename = normalizePhotoFilename(filename);
    const explicitPaths =
      occurrencePaths[filename] ??
      Object.entries(occurrencePaths).find(
        ([sourceFilename]) =>
          normalizePhotoFilename(sourceFilename) === normalizedSourceFilename,
      )?.[1];
    if (explicitPaths) {
      const occurrence = occurrenceCounts.get(normalizedSourceFilename) ?? 0;
      occurrenceCounts.set(normalizedSourceFilename, occurrence + 1);
      const explicitPath = explicitPaths[occurrence];
      const match = photos.find((photo) => photo.path === explicitPath);
      if (!explicitPath || !match || usedPaths.has(explicitPath)) {
        ambiguous.push({
          filename,
          paths: explicitPath ? [explicitPath] : [],
        });
        continue;
      }
      usedPaths.add(explicitPath);
      orderedPaths.push(explicitPath);
      continue;
    }

    const alias =
      filenameAliases[filename] ??
      Object.entries(filenameAliases).find(
        ([sourceFilename]) =>
          normalizePhotoFilename(sourceFilename) ===
          normalizedSourceFilename,
      )?.[1];
    const candidateFilename = alias ?? filename;
    const matches =
      candidatesByFilename.get(normalizePhotoFilename(candidateFilename)) ?? [];
    if (matches.length === 0) {
      missing.push(filename);
      continue;
    }
    if (matches.length > 1 || usedPaths.has(matches[0].path)) {
      ambiguous.push({
        filename,
        paths: matches.map((match) => match.path),
      });
      continue;
    }
    usedPaths.add(matches[0].path);
    orderedPaths.push(matches[0].path);
  }

  return { orderedPaths, missing, ambiguous };
}

export function mergeCanonicalPhotoOrder(
  photosInCurrentOrder: readonly PhotoCandidate[],
  canonicalPaths: readonly string[],
): string[] {
  const canonical = Array.from(new Set(canonicalPaths));
  const canonicalSet = new Set(canonical);
  return [
    ...canonical,
    ...photosInCurrentOrder
      .map((photo) => photo.path)
      .filter((path, index, paths) => !canonicalSet.has(path) && paths.indexOf(path) === index),
  ];
}

export function applySquarespaceDisplayOrder<T extends {
  album: string;
  filename: string;
  order: number;
}>(
  photos: readonly T[],
  snapshotsByAlbum: ReadonlyMap<string, SquarespaceGallerySnapshot>,
  filenameAliasesByAlbum: Readonly<
    Record<string, Readonly<Record<string, string>>>
  > = {},
): T[] {
  const ranksByAlbum = new Map<string, Map<string, number>>();
  for (const [album, snapshot] of snapshotsByAlbum) {
    const ranks = new Map<string, number>();
    snapshot.filenames.forEach((filename, index) => {
      const normalized = normalizePhotoFilename(filename);
      if (!ranks.has(normalized)) ranks.set(normalized, index);
    });
    for (const [sourceFilename, candidateFilename] of Object.entries(
      filenameAliasesByAlbum[album] ?? {},
    )) {
      const rank = ranks.get(normalizePhotoFilename(sourceFilename));
      if (rank !== undefined) {
        ranks.set(normalizePhotoFilename(candidateFilename), rank);
      }
    }
    ranksByAlbum.set(album, ranks);
  }

  return photos.map((photo) => {
    const ranks = ranksByAlbum.get(photo.album);
    const rank = ranks?.get(normalizePhotoFilename(photo.filename));
    return rank === undefined ? photo : { ...photo, order: rank };
  });
}
