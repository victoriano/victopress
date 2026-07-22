/**
 * Embedded image metadata extraction.
 *
 * The upload raster and source metadata are preserved. A separate, deliberate
 * writeback may add VictoPress-owned XMP without recompressing the photograph.
 * This module decodes EXIF/TIFF, IPTC, XMP (including Photoshop/Camera Raw
 * namespaces), ICC, JFIF, and PNG headers so they can be indexed and reused.
 */

import type {
  EmbeddedImageMetadata,
  EmbeddedMetadataValue,
  ExifData,
  ImageMetadataSummary,
} from "./types";

export const IMAGE_METADATA_VERSION = 1;

export interface ExtractedImageMetadata {
  /** Compact, normalized fields used by the CMS and search/index code. */
  exif: ExifData;
  /** Complete decoded, JSON-safe metadata grouped by source namespace. */
  embedded: EmbeddedImageMetadata;
}

type UnknownRecord = Record<string, unknown>;

// Import dynamically so Cloudflare's edge bundle only initializes the parser
// when an original image actually needs to be inspected.
let exifrParse:
  | ((input: ArrayBuffer, options?: Record<string, unknown>) => Promise<UnknownRecord | undefined>)
  | null = null;

async function getExifrParse() {
  if (!exifrParse) {
    const exifrModule = await import("exifr");
    // exifr exposes parse through its default export in the full ESM/UMD build.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (exifrModule as any).default || exifrModule;
    exifrParse = mod.parse;
  }
  return exifrParse;
}

/**
 * Decode all useful embedded metadata from an image buffer.
 *
 * MakerNote and embedded thumbnail blobs are deliberately not duplicated in
 * the sidecar: they can be very large, are not decoded by exifr, and remain in
 * the untouched original. Decoded ICC binary values are retained as base64.
 */
export async function extractImageMetadata(
  buffer: ArrayBuffer,
): Promise<ExtractedImageMetadata | null> {
  const rasterDimensions = readJpegDimensions(buffer);

  try {
    const parse = await getExifrParse();
    if (!parse) return dimensionsOnlyExtraction(rasterDimensions);

    const raw = await parse(buffer, {
      tiff: true,
      ifd0: true,
      ifd1: false,
      exif: true,
      gps: true,
      interop: true,
      userComment: true,
      makerNote: false,
      iptc: true,
      xmp: { multiSegment: true },
      icc: { multiSegment: true },
      jfif: true,
      ihdr: true,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
      sanitize: true,
      mergeOutput: false,
      silentErrors: true,
    });

    const exif = normalizeEmbeddedMetadata(raw || {});
    if (!exif.imageWidth && rasterDimensions) exif.imageWidth = rasterDimensions.width;
    if (!exif.imageHeight && rasterDimensions) exif.imageHeight = rasterDimensions.height;

    const embedded = sanitizeEmbeddedMetadata(raw || {});
    if (Object.keys(exif).length === 0 && Object.keys(embedded).length === 0) {
      return null;
    }

    return { exif, embedded };
  } catch (error) {
    // Unsupported/corrupt image formats should not block an upload. JPEG
    // dimensions can still be recovered without relying on metadata blocks.
    console.warn("Failed to extract embedded image metadata:", error);
    return dimensionsOnlyExtraction(rasterDimensions);
  }
}

/** Backwards-compatible normalized EXIF/IPTC/XMP projection. */
export async function extractExif(buffer: ArrayBuffer): Promise<ExifData | null> {
  return (await extractImageMetadata(buffer))?.exif || null;
}

function dimensionsOnlyExtraction(
  dimensions: { width: number; height: number } | null,
): ExtractedImageMetadata | null {
  if (!dimensions) return null;
  return {
    exif: {
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    },
    embedded: {},
  };
}

/** Read JPEG dimensions from a SOF marker when exports omit EXIF dimensions. */
function readJpegDimensions(
  buffer: ArrayBuffer,
): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += segmentLength;
  }

  return null;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function findValue(
  raw: UnknownRecord,
  namespaces: string[],
  keys: string[],
): unknown {
  for (const namespace of namespaces) {
    const source = namespace === "$root" ? raw : asRecord(raw[namespace]);
    if (!source) continue;

    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
      const actualKey = Object.keys(source).find(
        (candidate) => candidate.toLowerCase() === key.toLowerCase(),
      );
      if (actualKey && source[actualKey] !== undefined && source[actualKey] !== null) {
        return source[actualKey];
      }
    }
  }
  return undefined;
}

function findValues(
  raw: UnknownRecord,
  namespaces: string[],
  keys: string[],
): unknown[] {
  const values: unknown[] = [];
  for (const namespace of namespaces) {
    const source = namespace === "$root" ? raw : asRecord(raw[namespace]);
    if (!source) continue;
    for (const key of keys) {
      const actualKey = Object.keys(source).find(
        (candidate) => candidate.toLowerCase() === key.toLowerCase(),
      );
      if (actualKey && source[actualKey] !== undefined && source[actualKey] !== null) {
        values.push(source[actualKey]);
      }
    }
  }
  return values;
}

function unwrapValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  const object = asRecord(value);
  if (!object) return value;

  for (const key of ["value", "x-default", "default", "text"]) {
    if (object[key] !== undefined) return unwrapValue(object[key]);
  }
  return value;
}

function getString(value: unknown): string | undefined {
  const unwrapped = unwrapValue(value);
  if (typeof unwrapped === "string" && unwrapped.trim()) return unwrapped.trim();
  if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) {
      const candidate = getString(item);
      if (candidate) return candidate;
    }
  }
  return undefined;
}

function getNumber(value: unknown): number | undefined {
  const unwrapped = unwrapValue(value);
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) return unwrapped;
  if (typeof unwrapped === "string" && unwrapped.trim()) {
    const parsed = Number(unwrapped);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getStringList(value: unknown): string[] | undefined {
  const unwrapped = unwrapValue(value);
  const result: string[] = [];

  const add = (candidate: unknown) => {
    const nested = unwrapValue(candidate);
    if (Array.isArray(nested)) {
      nested.forEach(add);
      return;
    }
    if (typeof nested !== "string") return;
    for (const item of nested.split(/[,;]/)) {
      const normalized = item.trim();
      if (normalized && !result.includes(normalized)) result.push(normalized);
    }
  };

  add(unwrapped);
  return result.length > 0 ? result : undefined;
}

function getCombinedStringList(values: unknown[]): string[] | undefined {
  const combined: string[] = [];
  for (const value of values) {
    for (const item of getStringList(value) || []) {
      if (!combined.includes(item)) combined.push(item);
    }
  }
  return combined.length > 0 ? combined : undefined;
}

function parseMetadataDate(value: unknown): Date | undefined {
  const unwrapped = unwrapValue(value);
  if (unwrapped instanceof Date) {
    return Number.isNaN(unwrapped.getTime()) ? undefined : unwrapped;
  }
  if (typeof unwrapped !== "string" || !unwrapped.trim()) return undefined;

  const input = unwrapped.trim();
  const compact = input.match(/^(\d{4})(\d{2})(\d{2})$/);
  const exifDate = input.match(
    /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/,
  );
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00Z`
    : exifDate
      ? `${exifDate[1]}-${exifDate[2]}-${exifDate[3]}T${exifDate[4] || "00"}:${exifDate[5] || "00"}:${exifDate[6] || "00"}Z`
      : input;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseIptcDate(raw: UnknownRecord): Date | undefined {
  const dateValue = getString(findValue(raw, ["iptc"], ["DateCreated", "DigitalCreationDate"]));
  if (!dateValue) return undefined;
  const match = dateValue.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return parseMetadataDate(dateValue);

  const timeValue = getString(
    findValue(raw, ["iptc"], ["TimeCreated", "DigitalCreationTime"]),
  ) || "000000";
  const time = timeValue.match(/^(\d{2})(\d{2})(\d{2})([+-]\d{4})?$/);
  if (!time) return parseMetadataDate(dateValue);
  const offset = time[4]
    ? `${time[4].slice(0, 3)}:${time[4].slice(3)}`
    : "Z";
  return parseMetadataDate(
    `${match[1]}-${match[2]}-${match[3]}T${time[1]}:${time[2]}:${time[3]}${offset}`,
  );
}

/**
 * Build a stable, useful projection from namespaced EXIF/IPTC/XMP output.
 * This function is exported to make normalization independently testable.
 */
export function normalizeEmbeddedMetadata(raw: UnknownRecord): ExifData {
  const exif: ExifData = {};

  exif.dateTimeOriginal =
    // XMP usually carries an explicit timezone whereas legacy EXIF
    // DateTimeOriginal does not. Prefer it when available so indexing is
    // deterministic across local development and Cloudflare's UTC runtime.
    parseMetadataDate(findValue(raw, ["xmp", "photoshop"], ["CreateDate", "DateCreated"])) ||
    parseMetadataDate(findValue(raw, ["exif"], ["DateTimeOriginal"])) ||
    parseMetadataDate(findValue(raw, ["exif"], ["CreateDate"])) ||
    parseIptcDate(raw) ||
    parseMetadataDate(findValue(raw, ["ifd0"], ["ModifyDate"]));
  exif.createDate =
    parseMetadataDate(findValue(raw, ["xmp", "photoshop"], ["CreateDate", "DateCreated"])) ||
    parseMetadataDate(findValue(raw, ["exif"], ["CreateDate"])) ||
    parseIptcDate(raw);
  exif.modifyDate = parseMetadataDate(
    findValue(raw, ["xmp", "ifd0"], ["ModifyDate"]),
  );
  exif.metadataDate = parseMetadataDate(
    findValue(raw, ["xmp"], ["MetadataDate"]),
  );

  exif.title = getString(
    findValue(raw, ["iptc", "dc", "photoshop", "xmp", "ifd0", "$root"], [
      "ObjectName", "title", "Headline", "Title", "XPTitle",
    ]),
  );
  exif.imageDescription = getString(
    findValue(raw, ["iptc", "dc", "ifd0", "xmp", "$root"], [
      "Caption", "Caption-Abstract", "description", "ImageDescription", "Description",
    ]),
  );
  exif.keywords = getCombinedStringList(
    findValues(
      raw,
      ["iptc", "dc", "lr", "xmp", "MicrosoftPhoto", "digiKam", "ifd0", "$root"],
      ["Keywords", "subject", "Subject", "hierarchicalSubject", "LastKeywordXMP", "TagsList", "XPKeywords"],
    ),
  );

  exif.artist = getString(
    findValue(raw, ["iptc", "dc", "ifd0", "xmp", "$root"], [
      "Byline", "creator", "Artist", "Creator", "XPAuthor",
    ]),
  );
  exif.copyright = getString(
    findValue(raw, ["iptc", "dc", "ifd0", "xmpRights", "$root"], [
      "CopyrightNotice", "rights", "Copyright", "UsageTerms",
    ]),
  );
  exif.credit = getString(findValue(raw, ["iptc", "photoshop"], ["Credit"]));
  exif.source = getString(findValue(raw, ["iptc", "photoshop"], ["Source"]));
  exif.instructions = getString(
    findValue(raw, ["iptc", "photoshop"], ["SpecialInstructions", "Instructions"]),
  );

  exif.software = getString(findValue(raw, ["ifd0", "$root"], ["Software"]));
  exif.creatorTool = getString(findValue(raw, ["xmp", "$root"], ["CreatorTool"]));
  exif.rating = getNumber(findValue(raw, ["xmp", "$root"], ["Rating"]));
  exif.label = getString(findValue(raw, ["xmp", "$root"], ["Label"]));
  const colorSpace = findValue(raw, ["exif", "icc", "$root"], ["ColorSpace", "ColorSpaceData"]);
  const colorSpaceNumber = getNumber(colorSpace);
  exif.colorSpace = colorSpaceNumber === 1
    ? "sRGB"
    : colorSpaceNumber === 65535
      ? "Uncalibrated"
      : getString(colorSpace);
  exif.colorProfile = getString(
    findValue(raw, ["photoshop", "icc"], ["ICCProfile", "ProfileDescription"]),
  );

  exif.make = getString(findValue(raw, ["ifd0", "$root"], ["Make"]));
  exif.model = getString(findValue(raw, ["ifd0", "$root"], ["Model"]));
  exif.lensModel = getString(
    findValue(raw, ["exif", "aux", "$root"], ["LensModel", "Lens", "LensInfo"]),
  );
  exif.focalLength = getNumber(findValue(raw, ["exif", "$root"], ["FocalLength"]));
  exif.aperture = getNumber(findValue(raw, ["exif", "$root"], ["FNumber"]));
  exif.iso = getNumber(findValue(raw, ["exif", "$root"], ["ISO"]));
  exif.exposureCompensation = getNumber(
    findValue(raw, ["exif", "$root"], ["ExposureCompensation", "ExposureBiasValue"]),
  );
  exif.exposureProgram = getString(
    findValue(raw, ["exif", "$root"], ["ExposureProgram"]),
  );
  exif.meteringMode = getString(findValue(raw, ["exif", "$root"], ["MeteringMode"]));
  exif.flash = getString(findValue(raw, ["exif", "$root"], ["Flash"]));
  exif.whiteBalance = getString(findValue(raw, ["exif", "crs", "$root"], ["WhiteBalance"]));
  exif.orientation = getString(findValue(raw, ["ifd0", "iptc", "$root"], ["Orientation", "ImageOrientation"]));

  const exposureTime = getNumber(findValue(raw, ["exif", "$root"], ["ExposureTime"]));
  if (exposureTime && exposureTime > 0) {
    exif.shutterSpeed = exposureTime >= 1
      ? `${Number(exposureTime.toFixed(3))}s`
      : `1/${Math.round(1 / exposureTime)}s`;
  }

  exif.imageWidth = getNumber(
    findValue(raw, ["exif", "ifd0", "ihdr", "$root"], ["ExifImageWidth", "ImageWidth"]),
  );
  exif.imageHeight = getNumber(
    findValue(raw, ["exif", "ifd0", "ihdr", "$root"], ["ExifImageHeight", "ImageHeight"]),
  );

  exif.latitude = getNumber(
    findValue(raw, ["gps", "$root"], ["latitude", "GPSLatitude"]),
  );
  exif.longitude = getNumber(
    findValue(raw, ["gps", "$root"], ["longitude", "GPSLongitude"]),
  );
  exif.sublocation = getString(
    findValue(raw, ["iptc", "Iptc4xmpCore", "photoshop"], ["Sublocation", "Location"]),
  );
  exif.city = getString(findValue(raw, ["iptc", "Iptc4xmpCore", "photoshop"], ["City"]));
  exif.state = getString(
    findValue(raw, ["iptc", "Iptc4xmpCore", "photoshop"], ["State", "StateProvince"]),
  );
  exif.country = getString(
    findValue(raw, ["iptc", "Iptc4xmpCore", "photoshop"], ["Country"]),
  );
  exif.countryCode = getString(
    findValue(raw, ["iptc", "Iptc4xmpCore", "photoshop"], ["CountryCode"]),
  );

  return Object.fromEntries(
    Object.entries(exif).filter(([, value]) => value !== undefined),
  ) as ExifData;
}

function toIsoString(value: Date | undefined): string | undefined {
  return value && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

function formatCameraName(make: string | undefined, model: string | undefined): string | undefined {
  if (!make) return model;
  if (!model) return make;
  const brand = make.trim().split(/\s+/)[0]?.toLowerCase();
  if (brand && model.toLowerCase().startsWith(`${brand} `)) return model;
  return `${make} ${model}`;
}

/** Convert normalized runtime metadata to the compact content-index format. */
export function toImageMetadataSummary(exif: ExifData): ImageMetadataSummary {
  const camera = formatCameraName(exif.make, exif.model);
  return {
    metadataVersion: IMAGE_METADATA_VERSION,
    dateTaken: toIsoString(exif.dateTimeOriginal),
    createDate: toIsoString(exif.createDate),
    modifyDate: toIsoString(exif.modifyDate),
    metadataDate: toIsoString(exif.metadataDate),
    title: exif.title,
    description: exif.imageDescription,
    keywords: exif.keywords,
    artist: exif.artist,
    copyright: exif.copyright,
    credit: exif.credit,
    source: exif.source,
    instructions: exif.instructions,
    software: exif.software,
    creatorTool: exif.creatorTool,
    rating: exif.rating,
    label: exif.label,
    colorSpace: exif.colorSpace,
    colorProfile: exif.colorProfile,
    make: exif.make,
    model: exif.model,
    camera,
    lens: exif.lensModel,
    focalLength: exif.focalLength,
    aperture: exif.aperture,
    shutterSpeed: exif.shutterSpeed,
    iso: exif.iso,
    exposureCompensation: exif.exposureCompensation,
    exposureProgram: exif.exposureProgram,
    meteringMode: exif.meteringMode,
    flash: exif.flash,
    whiteBalance: exif.whiteBalance,
    orientation: exif.orientation,
    width: exif.imageWidth,
    height: exif.imageHeight,
    gps: exif.latitude !== undefined && exif.longitude !== undefined
      ? { lat: exif.latitude, lng: exif.longitude }
      : undefined,
    sublocation: exif.sublocation,
    city: exif.city,
    state: exif.state,
    country: exif.country,
    countryCode: exif.countryCode,
  };
}

/** Rehydrate compact cached metadata without re-reading the original image. */
export function fromImageMetadataSummary(summary: ImageMetadataSummary): ExifData {
  let make = summary.make;
  let model = summary.model;
  if (!make && !model && summary.camera) {
    const [legacyMake, ...legacyModel] = summary.camera.split(" ");
    make = legacyMake || undefined;
    model = legacyModel.join(" ") || undefined;
  }

  return {
    dateTimeOriginal: parseMetadataDate(summary.dateTaken),
    createDate: parseMetadataDate(summary.createDate),
    modifyDate: parseMetadataDate(summary.modifyDate),
    metadataDate: parseMetadataDate(summary.metadataDate),
    title: summary.title,
    imageDescription: summary.description,
    keywords: summary.keywords,
    artist: summary.artist,
    copyright: summary.copyright,
    credit: summary.credit,
    source: summary.source,
    instructions: summary.instructions,
    software: summary.software,
    creatorTool: summary.creatorTool,
    rating: summary.rating,
    label: summary.label,
    colorSpace: summary.colorSpace,
    colorProfile: summary.colorProfile,
    make,
    model,
    lensModel: summary.lens,
    focalLength: summary.focalLength,
    aperture: summary.aperture,
    shutterSpeed: summary.shutterSpeed,
    iso: summary.iso,
    exposureCompensation: summary.exposureCompensation,
    exposureProgram: summary.exposureProgram,
    meteringMode: summary.meteringMode,
    flash: summary.flash,
    whiteBalance: summary.whiteBalance,
    orientation: summary.orientation,
    imageWidth: summary.width,
    imageHeight: summary.height,
    latitude: summary.gps?.lat,
    longitude: summary.gps?.lng,
    sublocation: summary.sublocation,
    city: summary.city,
    state: summary.state,
    country: summary.country,
    countryCode: summary.countryCode,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sanitizeMetadataValue(
  value: unknown,
  ancestors: Set<object>,
): EmbeddedMetadataValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return {
      _type: "binary",
      encoding: "base64",
      byteLength: bytes.byteLength,
      data: bytesToBase64(bytes),
    };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return {
      _type: value.constructor.name,
      encoding: "base64",
      byteLength: bytes.byteLength,
      data: bytesToBase64(bytes),
    };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value !== "object" || value === undefined) return undefined;
  if (ancestors.has(value)) return "[Circular]";

  ancestors.add(value);
  if (Array.isArray(value)) {
    const result = value
      .map((item) => sanitizeMetadataValue(item, ancestors))
      .filter((item): item is EmbeddedMetadataValue => item !== undefined);
    ancestors.delete(value);
    return result;
  }

  const result: Record<string, EmbeddedMetadataValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeMetadataValue(item, ancestors);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  ancestors.delete(value);
  return result;
}

/** Make exifr output safe and stable for JSON sidecar storage. */
export function sanitizeEmbeddedMetadata(raw: UnknownRecord): EmbeddedImageMetadata {
  const sanitized = sanitizeMetadataValue(raw, new Set());
  return asRecord(sanitized) as EmbeddedImageMetadata || {};
}

/** Format the most useful normalized fields for a compact UI. */
export function formatExifForDisplay(exif: ExifData): Record<string, string> {
  const result: Record<string, string> = {};

  const camera = formatCameraName(exif.make, exif.model);
  if (camera) result.Camera = camera;
  if (exif.lensModel) result.Lens = exif.lensModel;
  if (exif.focalLength) result["Focal Length"] = `${exif.focalLength}mm`;
  if (exif.aperture) result.Aperture = `f/${exif.aperture}`;
  if (exif.shutterSpeed) result["Shutter Speed"] = exif.shutterSpeed;
  if (exif.iso) result.ISO = String(exif.iso);
  if (exif.dateTimeOriginal) result["Date Taken"] = exif.dateTimeOriginal.toLocaleDateString();
  if (exif.artist) result.Author = exif.artist;
  if (exif.copyright) result.Copyright = exif.copyright;
  if (exif.software) result.Software = exif.software;
  if (exif.colorProfile) result["Color Profile"] = exif.colorProfile;
  if (exif.latitude !== undefined && exif.longitude !== undefined) {
    result.Location = `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`;
  }

  return result;
}
