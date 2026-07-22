import type { FileInfo, StorageAdapter } from "~/lib/content-engine";

const VARIANT_PATH_PATTERN = /^(.*)_\d+w\.webp$/i;
const SOURCE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"] as const;

export interface ResolvedImageAsset {
  buffer: ArrayBuffer;
  path: string;
  usedOriginalFallback: boolean;
}

function normalizeSourceExtension(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/^\./, "").toLowerCase();
  return SOURCE_EXTENSIONS.includes(normalized as (typeof SOURCE_EXTENSIONS)[number])
    ? normalized
    : null;
}

function getVariantParts(path: string): { directory: string; sourceStem: string } | null {
  const slashIndex = path.lastIndexOf("/");
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex) : "";
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const match = filename.match(VARIANT_PATH_PATTERN);

  if (!match) return null;
  return { directory, sourceStem: match[1] };
}

function joinPath(directory: string, filename: string): string {
  return directory ? `${directory}/${filename}` : filename;
}

function findSiblingCandidate(
  siblings: FileInfo[],
  sourceStem: string,
): FileInfo | undefined {
  const expectedNames = SOURCE_EXTENSIONS.map(
    (extension) => `${sourceStem}.${extension}`.toLowerCase(),
  );

  return siblings
    .filter((file) => !file.isDirectory)
    .sort((left, right) => {
      const leftIndex = expectedNames.indexOf(left.name.toLowerCase());
      const rightIndex = expectedNames.indexOf(right.name.toLowerCase());
      return leftIndex - rightIndex;
    })
    .find((file) => expectedNames.includes(file.name.toLowerCase()));
}

/**
 * Resolve an image request and gracefully use its source image when a generated
 * responsive variant has not been created yet. The source extension hint keeps
 * the normal path to one storage read; directory listing is only for old URLs.
 */
export async function resolveImageAsset(
  storage: Pick<StorageAdapter, "get" | "list">,
  requestedPath: string,
  sourceExtensionHint: string | null,
): Promise<ResolvedImageAsset | null> {
  const requestedBuffer = await storage.get(requestedPath);
  if (requestedBuffer) {
    return {
      buffer: requestedBuffer,
      path: requestedPath,
      usedOriginalFallback: false,
    };
  }

  const variant = getVariantParts(requestedPath);
  if (!variant) return null;

  const sourceExtension = normalizeSourceExtension(sourceExtensionHint);
  if (sourceExtension) {
    const hintedPath = joinPath(
      variant.directory,
      `${variant.sourceStem}.${sourceExtension}`,
    );
    const hintedBuffer = await storage.get(hintedPath);
    if (hintedBuffer) {
      return {
        buffer: hintedBuffer,
        path: hintedPath,
        usedOriginalFallback: true,
      };
    }
  }

  const siblings = await storage.list(variant.directory);
  const candidate = findSiblingCandidate(siblings, variant.sourceStem);
  if (!candidate) return null;

  const fallbackPath = candidate.path || joinPath(variant.directory, candidate.name);
  const fallbackBuffer = await storage.get(fallbackPath);
  if (!fallbackBuffer) return null;

  return {
    buffer: fallbackBuffer,
    path: fallbackPath,
    usedOriginalFallback: true,
  };
}
