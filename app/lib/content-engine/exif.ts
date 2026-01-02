/**
 * EXIF Metadata Extraction
 * 
 * Extracts metadata from JPEG files, with special support for
 * Lightroom-exported images (description, keywords, etc.)
 */

import type { ExifData } from "./types";

// We'll use exifr for EXIF extraction
// Import dynamically to handle edge runtime
let exifr: typeof import("exifr") | null = null;

async function getExifr() {
  if (!exifr) {
    exifr = await import("exifr");
  }
  return exifr;
}

/**
 * Extract EXIF data from an image buffer
 */
export async function extractExif(buffer: ArrayBuffer): Promise<ExifData | null> {
  try {
    const { parse } = await getExifr();
    
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

    if (!data) {
      return null;
    }

    return parseExifData(data);
  } catch (error) {
    console.warn("Failed to extract EXIF:", error);
    return null;
  }
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
