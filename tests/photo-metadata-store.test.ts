import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deletePhotoMetadata,
  getPhotoMetadataStorageKey,
  movePhotoMetadata,
  readPhotoMetadata,
  writePhotoMetadata,
} from "../app/lib/content-engine/photo-metadata-store";
import {
  addPhotosToGalleryIndex,
  readContentIndex,
  writeContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";
import { scanGalleries } from "../app/lib/content-engine/gallery-scanner";

describe("private photo metadata sidecars", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-photo-metadata-"));
    storage = new LocalStorageAdapter(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("writes full metadata outside galleries and follows a physical move", async () => {
    const originalPath = "galleries/spaces/granada/photo one.jpg";
    const movedPath = "galleries/geographies/granada/photo one.jpg";

    await writePhotoMetadata(
      storage,
      originalPath,
      {
        dateTimeOriginal: new Date("2024-05-06T18:15:30.000Z"),
        artist: "Victoriano Izquierdo",
        copyright: "Copyright Victoriano Izquierdo",
        software: "Adobe Photoshop 26.0",
        make: "LEICA CAMERA AG",
        model: "LEICA Q3",
      },
      {
        crs: { ProcessVersion: "15.4", Exposure2012: 0.35 },
        xmpMM: {
          History: [{ action: "saved", softwareAgent: "Adobe Photoshop 26.0" }],
        },
      },
      { size: 123456, lastModified: "2024-05-07T10:00:00.000Z" },
    );

    const storageKey = getPhotoMetadataStorageKey(originalPath);
    expect(storageKey.startsWith("_photo-metadata/v1/")).toBe(true);
    expect(storageKey.includes("galleries/")).toBe(false);

    const stored = await readPhotoMetadata(storage, originalPath);
    expect(stored).toMatchObject({
      version: 1,
      photoPath: originalPath,
      source: { size: 123456, lastModified: "2024-05-07T10:00:00.000Z" },
      summary: {
        metadataVersion: 1,
        dateTaken: "2024-05-06T18:15:30.000Z",
        artist: "Victoriano Izquierdo",
        software: "Adobe Photoshop 26.0",
        camera: "LEICA Q3",
      },
      embedded: {
        crs: { ProcessVersion: "15.4", Exposure2012: 0.35 },
      },
    });

    expect(await movePhotoMetadata(storage, originalPath, movedPath)).toBe(true);
    expect(await readPhotoMetadata(storage, originalPath)).toBeNull();
    expect((await readPhotoMetadata(storage, movedPath))?.photoPath).toBe(movedPath);

    await deletePhotoMetadata(storage, movedPath);
    expect(await readPhotoMetadata(storage, movedPath)).toBeNull();
  });

  test("the upload index path imports real Photoshop, IPTC, and EXIF data", async () => {
    const photoPath = "galleries/example/DSC_7362.jpg";
    const samplePath = join(
      import.meta.dir,
      "..",
      "content",
      "galleries",
      "spaces",
      "urban",
      "DSC_7362.jpg",
    );
    await storage.put(photoPath, await Bun.file(samplePath).arrayBuffer(), "image/jpeg");

    const index: ContentIndex = {
      version: 10,
      updatedAt: "2026-07-19T10:00:00.000Z",
      galleries: [{
        slug: "example",
        title: "Example",
        path: "galleries/example",
        photoCount: 0,
        isProtected: false,
        hasChildren: false,
        childCount: 0,
      }],
      galleryData: [{
        slug: "example",
        title: "Example",
        path: "galleries/example",
        photoCount: 0,
        isProtected: false,
        hasChildren: false,
        childCount: 0,
        photos: [],
      }],
      posts: [],
      pages: [],
      parentMetadata: [],
      featuredPhotos: [],
      stats: {
        totalGalleries: 1,
        totalPhotos: 0,
        totalPosts: 0,
        totalPages: 0,
      },
    };
    await writeContentIndex(storage, index);

    await addPhotosToGalleryIndex(storage, "galleries/example", [photoPath]);

    const updated = await readContentIndex(storage);
    const photo = updated?.galleryData[0]?.photos[0];
    expect(photo).toMatchObject({
      filename: "DSC_7362.jpg",
      year: 2011,
      dateTaken: "2011-06-20T17:52:24.750Z",
      exif: {
        artist: "Juan Carlos Castresana",
        copyright: "Copyright by Juan Carlos Castresana - juancarlos.ch",
        software: "Adobe Photoshop CS5 Macintosh",
        camera: "NIKON D700",
        width: 4256,
        height: 2832,
      },
    });

    const sidecar = await readPhotoMetadata(storage, photoPath);
    expect(sidecar?.embedded).toHaveProperty("iptc.Byline", "Juan Carlos Castresana");
    expect(sidecar?.embedded).toHaveProperty("crs.ProcessVersion");
    expect(sidecar?.embedded).toHaveProperty("xmpMM.History");
    expect(JSON.stringify(sidecar?.embedded).length).toBeGreaterThan(10_000);

    const scannedPhoto = (await scanGalleries(storage))[0]?.photos[0];
    expect(scannedPhoto?.embeddedMetadata).toHaveProperty("xmpMM.History");
    expect(JSON.stringify(scannedPhoto)).not.toContain("embeddedMetadata");
  });
});
