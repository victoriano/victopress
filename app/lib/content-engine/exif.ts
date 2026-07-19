/**
 * EXIF Metadata Extraction
 * 
 * Extracts metadata from JPEG files, with special support for
 * Lightroom-exported images (description, keywords, etc.)
 */

import type { ExifData } from "./types";

// We'll use exifr for EXIF extraction
// Import dynamically to handle edge runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exifrParse: ((input: ArrayBuffer, options?: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;

async function getExifrParse() {
  if (!exifrParse) {
    const exifrModule = await import("exifr");
    // Handle ESM default export - the parse function is on exifrModule.default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (exifrModule as any).default || exifrModule;
    exifrParse = mod.parse;
  }
  return exifrParse;
}

/**
 * Extract EXIF data from an image buffer
 */
export async function extractExif(buffer: ArrayBuffer): Promise<ExifData | null> {
  const rasterDimensions = readJpegDimensions(buffer);

  try {
    const parse = await getExifrParse();
    if (!parse) {
      console.warn("EXIF parser not available");
      return rasterDimensions
        ? {
            imageWidth: rasterDimensions.width,
            imageHeight: rasterDimensions.height,
          }
        : null;
    }
    
    const data = await parse(buffer, {
      // Basic EXIF tags
      pick: [
        // Date
        "DateTimeOriginal",
        "CreateDate",
        "ModifyDate",
        
        // Description (Lightroom)
        "ImageDescription",
        "XPTitle",
        "title",
        "Caption-Abstract",
        
        // Keywords/Tags (Lightroom)
        "Keywords",
        "XPKeywords",
        "Subject",
        
        // Author
        "Artist",
        "XPAuthor",
        "Creator",
        "Copyright",
        
        // Camera
        "Make",
        "Model",
        "LensModel",
        "LensInfo",
        "FocalLength",
        "FNumber",
        "ISO",
        "ExposureTime",
        "ShutterSpeedValue",
        
        // GPS
        "GPSLatitude",
        "GPSLongitude",
        "latitude",
        "longitude",
        
        // Dimensions
        "ImageWidth",
        "ImageHeight",
        "ExifImageWidth",
        "ExifImageHeight",
      ],
      // Include XMP data (Lightroom metadata)
      xmp: true,
      // Include IPTC data
      iptc: true,
      // Include ICC profile for color info
      icc: false,
    });

    const exif = data ? parseExifData(data) : {};
    if (!exif.imageWidth && rasterDimensions) {
      exif.imageWidth = rasterDimensions.width;
    }
    if (!exif.imageHeight && rasterDimensions) {
      exif.imageHeight = rasterDimensions.height;
    }

    return Object.keys(exif).length > 0 ? exif : null;
  } catch (error) {
    console.warn("Failed to extract EXIF:", error);
    return rasterDimensions
      ? {
          imageWidth: rasterDimensions.width,
          imageHeight: rasterDimensions.height,
        }
      : null;
  }
}

/** Read JPEG dimensions from a SOF marker when exports omit EXIF dimensions. */
function readJpegDimensions(
  buffer: ArrayBuffer,
): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

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

    // Markers without a length field.
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

/**
 * Parse raw EXIF data into our normalized format
 */
function parseExifData(raw: Record<string, unknown>): ExifData {
  const exif: ExifData = {};

  // Date/Time
  const dateValue = raw.DateTimeOriginal || raw.CreateDate || raw.ModifyDate;
  if (dateValue instanceof Date) {
    exif.dateTimeOriginal = dateValue;
  } else if (typeof dateValue === "string") {
    exif.dateTimeOriginal = new Date(dateValue);
  }

  // Description (check multiple sources)
  exif.imageDescription =
    getString(raw.ImageDescription) ||
    getString(raw["Caption-Abstract"]) ||
    getString(raw.description);
  
  exif.title =
    getString(raw.XPTitle) ||
    getString(raw.title) ||
    getString(raw.ObjectName);

  // Keywords/Tags
  const keywords = 
    raw.Keywords || 
    raw.XPKeywords || 
    raw.Subject ||
    raw.subject;
  
  if (keywords) {
    if (Array.isArray(keywords)) {
      exif.keywords = keywords.map(String).filter(Boolean);
    } else if (typeof keywords === "string") {
      // Some software uses comma or semicolon separated
      exif.keywords = keywords.split(/[,;]/).map((k) => k.trim()).filter(Boolean);
    }
  }

  // Author/Copyright
  exif.artist =
    getString(raw.Artist) ||
    getString(raw.XPAuthor) ||
    getString(raw.Creator);
  
  exif.copyright = getString(raw.Copyright);

  // Camera Info
  exif.make = getString(raw.Make);
  exif.model = getString(raw.Model);
  exif.lensModel = getString(raw.LensModel) || getString(raw.Lens);

  if (typeof raw.FocalLength === "number") {
    exif.focalLength = raw.FocalLength;
  }

  if (typeof raw.FNumber === "number") {
    exif.aperture = raw.FNumber;
  }

  if (typeof raw.ISO === "number") {
    exif.iso = raw.ISO;
  }

  // Shutter speed
  if (raw.ExposureTime) {
    const exposure = raw.ExposureTime as number;
    if (exposure >= 1) {
      exif.shutterSpeed = `${exposure}s`;
    } else {
      exif.shutterSpeed = `1/${Math.round(1 / exposure)}s`;
    }
  }

  // GPS
  const lat = raw.GPSLatitude || raw.latitude;
  const lng = raw.GPSLongitude || raw.longitude;
  
  if (typeof lat === "number" && typeof lng === "number") {
    exif.latitude = lat;
    exif.longitude = lng;
  }

  // Pixel dimensions are required by responsive gallery markup. Reserving the
  // intrinsic ratio before download prevents every lazy image from initially
  // appearing inside the viewport and being fetched at once.
  const width = raw.ExifImageWidth || raw.ImageWidth;
  const height = raw.ExifImageHeight || raw.ImageHeight;
  if (typeof width === "number" && width > 0) {
    exif.imageWidth = width;
  }
  if (typeof height === "number" && height > 0) {
    exif.imageHeight = height;
  }

  return exif;
}

/**
 * Safely get string value from unknown
 */
function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

/**
 * Format EXIF data for display
 */
export function formatExifForDisplay(exif: ExifData): Record<string, string> {
  const result: Record<string, string> = {};

  if (exif.make && exif.model) {
    result["Camera"] = `${exif.make} ${exif.model}`;
  } else if (exif.model) {
    result["Camera"] = exif.model;
  }

  if (exif.lensModel) {
    result["Lens"] = exif.lensModel;
  }

  if (exif.focalLength) {
    result["Focal Length"] = `${exif.focalLength}mm`;
  }

  if (exif.aperture) {
    result["Aperture"] = `f/${exif.aperture}`;
  }

  if (exif.shutterSpeed) {
    result["Shutter Speed"] = exif.shutterSpeed;
  }

  if (exif.iso) {
    result["ISO"] = String(exif.iso);
  }

  if (exif.dateTimeOriginal) {
    result["Date Taken"] = exif.dateTimeOriginal.toLocaleDateString();
  }

  if (exif.latitude && exif.longitude) {
    result["Location"] = `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`;
  }

  return result;
}
