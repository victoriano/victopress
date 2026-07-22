/**
 * Private per-photo metadata sidecars.
 *
 * Keeping the complete decoded payload outside _content-index.json prevents
 * Lightroom/Photoshop histories and ICC profiles from bloating public gallery
 * loaders while still making them available to future CMS/search features.
 */

import type {
  EmbeddedImageMetadata,
  ExifData,
  ImageMetadataSummary,
  StorageAdapter,
} from "./types";
import { IMAGE_METADATA_VERSION, toImageMetadataSummary } from "./exif";

export const PHOTO_METADATA_PREFIX = "_photo-metadata/v1";
export const PHOTO_METADATA_RECORD_VERSION = 1;

export interface StoredPhotoMetadata {
  version: number;
  photoPath: string;
  extractedAt: string;
  source?: {
    size?: number;
    lastModified?: string;
  };
  summary: ImageMetadataSummary;
  embedded: EmbeddedImageMetadata;
}

export interface PhotoMetadataSourceInfo {
  size?: number;
  lastModified?: string;
}

/** Deterministic private object key for a physical photo path. */
export function getPhotoMetadataStorageKey(photoPath: string): string {
  return `${PHOTO_METADATA_PREFIX}/${encodeURIComponent(photoPath)}.json`;
}

export async function writePhotoMetadata(
  storage: StorageAdapter,
  photoPath: string,
  exif: ExifData,
  embedded: EmbeddedImageMetadata,
  source?: PhotoMetadataSourceInfo,
): Promise<StoredPhotoMetadata> {
  const record: StoredPhotoMetadata = {
    version: PHOTO_METADATA_RECORD_VERSION,
    photoPath,
    extractedAt: new Date().toISOString(),
    source: source && (source.size !== undefined || source.lastModified)
      ? source
      : undefined,
    summary: toImageMetadataSummary(exif),
    embedded,
  };

  await storage.put(
    getPhotoMetadataStorageKey(photoPath),
    JSON.stringify(record),
    "application/json",
  );
  return record;
}

export async function readPhotoMetadata(
  storage: StorageAdapter,
  photoPath: string,
): Promise<StoredPhotoMetadata | null> {
  const content = await storage.getText(getPhotoMetadataStorageKey(photoPath));
  if (!content) return null;

  try {
    const record = JSON.parse(content) as StoredPhotoMetadata;
    if (
      record.version !== PHOTO_METADATA_RECORD_VERSION ||
      record.photoPath !== photoPath ||
      record.summary?.metadataVersion !== IMAGE_METADATA_VERSION ||
      !record.embedded ||
      typeof record.embedded !== "object"
    ) {
      return null;
    }
    return record;
  } catch (error) {
    console.warn(`Failed to parse metadata sidecar for ${photoPath}:`, error);
    return null;
  }
}

export async function deletePhotoMetadata(
  storage: StorageAdapter,
  photoPath: string,
): Promise<void> {
  const key = getPhotoMetadataStorageKey(photoPath);
  if (await storage.exists(key)) await storage.delete(key);
}

export async function movePhotoMetadata(
  storage: StorageAdapter,
  fromPhotoPath: string,
  toPhotoPath: string,
): Promise<boolean> {
  const existing = await readPhotoMetadata(storage, fromPhotoPath);
  if (!existing) return false;

  const moved: StoredPhotoMetadata = {
    ...existing,
    photoPath: toPhotoPath,
  };
  await storage.put(
    getPhotoMetadataStorageKey(toPhotoPath),
    JSON.stringify(moved),
    "application/json",
  );
  await deletePhotoMetadata(storage, fromPhotoPath);
  return true;
}
