import { describe, expect, test } from "bun:test";
import {
  extractExif,
  normalizeEmbeddedMetadata,
  sanitizeEmbeddedMetadata,
  toImageMetadataSummary,
} from "../app/lib/content-engine/exif";

describe("JPEG dimension fallback", () => {
  test("reads dimensions from a SOF marker when EXIF dimension tags are absent", async () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08,
      0x06, 0x84, // 1668px high
      0x09, 0xc4, // 2500px wide
      0x03,
      0x01, 0x11, 0x00,
      0x02, 0x11, 0x00,
      0x03, 0x11, 0x00,
      0xff, 0xd9,
    ]).buffer;

    const exif = await extractExif(jpeg);

    expect(exif?.imageWidth).toBe(2500);
    expect(exif?.imageHeight).toBe(1668);
  });
});

describe("embedded EXIF/IPTC/XMP normalization", () => {
  test("keeps editorial, authorship, capture, and processing fields", () => {
    const normalized = normalizeEmbeddedMetadata({
      iptc: {
        ObjectName: "Granada at dusk",
        Caption: "A view over the Albaicin",
        Keywords: ["Granada", "night"],
        Byline: "Victoriano Izquierdo",
        CopyrightNotice: "Copyright Victoriano Izquierdo",
        Credit: "Victoriano Studio",
        City: "Granada",
        Country: "Spain",
      },
      dc: {
        subject: ["travel", "Granada"],
      },
      xmp: {
        CreateDate: "2024-05-06T20:15:30+02:00",
        ModifyDate: "2024-05-07T10:00:00+02:00",
        MetadataDate: "2024-05-07T10:01:00+02:00",
        CreatorTool: "Adobe Photoshop 26.0",
        Rating: 5,
      },
      photoshop: {
        ICCProfile: "Adobe RGB (1998)",
      },
      ifd0: {
        Make: "LEICA CAMERA AG",
        Model: "LEICA Q3",
        Software: "Adobe Photoshop 26.0",
        Orientation: "Horizontal (normal)",
      },
      exif: {
        DateTimeOriginal: new Date("2024-05-06T18:15:30.000Z"),
        ExposureTime: 0.008,
        FNumber: 2.8,
        ISO: 400,
        FocalLength: 28,
        ExifImageWidth: 9520,
        ExifImageHeight: 6336,
        WhiteBalance: "Manual",
      },
      aux: {
        Lens: "Summilux 28mm f/1.7 ASPH.",
      },
      gps: {
        latitude: 37.1773,
        longitude: -3.5986,
      },
    });

    expect(normalized).toMatchObject({
      title: "Granada at dusk",
      imageDescription: "A view over the Albaicin",
      keywords: ["Granada", "night", "travel"],
      artist: "Victoriano Izquierdo",
      copyright: "Copyright Victoriano Izquierdo",
      credit: "Victoriano Studio",
      city: "Granada",
      country: "Spain",
      creatorTool: "Adobe Photoshop 26.0",
      software: "Adobe Photoshop 26.0",
      rating: 5,
      colorProfile: "Adobe RGB (1998)",
      make: "LEICA CAMERA AG",
      model: "LEICA Q3",
      lensModel: "Summilux 28mm f/1.7 ASPH.",
      focalLength: 28,
      aperture: 2.8,
      iso: 400,
      shutterSpeed: "1/125s",
      imageWidth: 9520,
      imageHeight: 6336,
      latitude: 37.1773,
      longitude: -3.5986,
    });
    expect(normalized.dateTimeOriginal?.toISOString()).toBe("2024-05-06T18:15:30.000Z");

    const summary = toImageMetadataSummary(normalized);
    expect(summary).toMatchObject({
      metadataVersion: 1,
      dateTaken: "2024-05-06T18:15:30.000Z",
      artist: "Victoriano Izquierdo",
      camera: "LEICA Q3",
      keywords: ["Granada", "night", "travel"],
    });
  });

  test("serializes namespaced processing history and binary ICC values safely", () => {
    const embedded = sanitizeEmbeddedMetadata({
      crs: {
        ProcessVersion: "15.4",
        Exposure2012: 0.35,
      },
      xmpMM: {
        History: [{ action: "saved", softwareAgent: "Adobe Photoshop 26.0" }],
      },
      icc: {
        RedTRC: Uint8Array.from([0, 1, 2, 255]),
      },
    });

    expect(embedded.crs).toEqual({ ProcessVersion: "15.4", Exposure2012: 0.35 });
    expect(embedded.xmpMM).toEqual({
      History: [{ action: "saved", softwareAgent: "Adobe Photoshop 26.0" }],
    });
    expect(embedded.icc).toEqual({
      RedTRC: {
        _type: "Uint8Array",
        encoding: "base64",
        byteLength: 4,
        data: "AAEC/w==",
      },
    });
  });
});
