import { AiDataValidationError } from "./errors";
import type {
  AssetId,
  PhotoAssetIdentity,
  SourceFingerprint,
} from "./types";
import { canonicalizeImageBytes } from "../content-engine/victopress-xmp";

const SHA256_PREFIX = "sha256:";
const ASSET_PREFIX = "asset_";
const SHA256_HEX_LENGTH = 64;
// Cloudflare Vectorize IDs are limited to 64 bytes. 232 digest bits remain.
const ASSET_HASH_HEX_LENGTH = 58;

function toDigestBytes(
  value: string | ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }

  return new Uint8Array(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

export async function sha256Hex(
  value: string | ArrayBuffer | ArrayBufferView,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toDigestBytes(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sourceFingerprintFromHex(hex: string): SourceFingerprint {
  const normalized = hex.trim().toLowerCase();
  if (!new RegExp(`^[a-f0-9]{${SHA256_HEX_LENGTH}}$`).test(normalized)) {
    throw new AiDataValidationError("Invalid SHA-256 fingerprint", "fingerprint");
  }
  return `${SHA256_PREFIX}${normalized}` as SourceFingerprint;
}

export function assetIdFromFingerprint(
  fingerprint: SourceFingerprint,
): AssetId {
  const hex = fingerprint.slice(SHA256_PREFIX.length);
  sourceFingerprintFromHex(hex);
  return `${ASSET_PREFIX}${hex.slice(0, ASSET_HASH_HEX_LENGTH)}` as AssetId;
}

export async function createSourceFingerprint(
  bytes: ArrayBuffer | ArrayBufferView,
): Promise<SourceFingerprint> {
  return sourceFingerprintFromHex(await sha256Hex(canonicalizeImageBytes(bytes)));
}

export async function createPhotoAssetIdentity(input: {
  bytes: ArrayBuffer | ArrayBufferView;
  sourcePath: string;
  filename: string;
  gallerySlug: string;
  lastModified?: string;
}): Promise<PhotoAssetIdentity> {
  const sourcePath = input.sourcePath.trim();
  const filename = input.filename.trim();
  const gallerySlug = input.gallerySlug.trim();

  if (!sourcePath) {
    throw new AiDataValidationError("Source path cannot be empty", "sourcePath");
  }
  if (!filename) {
    throw new AiDataValidationError("Filename cannot be empty", "filename");
  }
  if (!gallerySlug) {
    throw new AiDataValidationError("Gallery slug cannot be empty", "gallerySlug");
  }

  const canonicalBytes = canonicalizeImageBytes(input.bytes);
  const sourceFingerprint = sourceFingerprintFromHex(await sha256Hex(canonicalBytes));

  return {
    assetId: assetIdFromFingerprint(sourceFingerprint),
    sourceFingerprint,
    sourcePath,
    filename,
    gallerySlug,
    // VictoPress-owned XMP is excluded so metadata writeback never changes the
    // identity or apparent source size of the underlying photograph.
    byteLength: canonicalBytes.byteLength,
    lastModified: input.lastModified,
  };
}
