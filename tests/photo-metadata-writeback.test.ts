import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enqueuePhotoMetadataWritebacksInStorage,
  processPhotoMetadataWritebackBatchInStorage,
} from "../app/lib/ai/photo-metadata-writeback.server";
import { createPhotoAssetIdentity } from "../app/lib/ai/identity";
import { AiRecordStore, createPhotoAiRecord } from "../app/lib/ai/record-store";
import {
  PHOTO_AI_SEARCH_INDEX_VERSION,
  writePhotoAiSearchIndex,
} from "../app/lib/ai/search-index";
import { createPhotoVectorIndex } from "../app/lib/ai/vector-index";
import {
  rebuildContentIndex,
  writeContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";
import {
  canonicalizeImageBytes,
  readVictoPressEmbeddedMetadata,
} from "../app/lib/content-engine/victopress-xmp";

describe("background photo metadata writeback", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-metadata-writeback-"));
    storage = new LocalStorageAdapter(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("persists separate editorial and AI metadata plus rebuildable indexes", async () => {
    const path = "galleries/spaces/urban/DSC_7362.jpg";
    const samplePath = join(
      import.meta.dir,
      "..",
      "content",
      "galleries",
      "spaces",
      "urban",
      "DSC_7362.jpg",
    );
    const original = new Uint8Array(await Bun.file(samplePath).arrayBuffer());
    await storage.put(path, original.buffer as ArrayBuffer, "image/jpeg");
    const asset = await createPhotoAssetIdentity({
      bytes: original,
      sourcePath: path,
      filename: "DSC_7362.jpg",
      gallerySlug: "spaces/urban",
      lastModified: "2026-07-20T08:00:00.000Z",
    });

    const index: ContentIndex = {
      version: 10,
      updatedAt: "2026-07-20T08:05:00.000Z",
      galleries: [
        {
          slug: "spaces/urban",
          title: "Urban",
          path: "galleries/spaces/urban",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
        },
        {
          slug: "geographies/spain",
          title: "Spain",
          path: "galleries/geographies/spain",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
        },
      ],
      galleryData: [
        {
          slug: "spaces/urban",
          title: "Urban",
          path: "galleries/spaces/urban",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          photos: [{
            id: "DSC_7362",
            path,
            filename: "DSC_7362.jpg",
            title: "Título editorial",
            description: "Descripción editorial visible.",
            tags: ["editorial", "visible"],
            order: 2,
            hidden: false,
            lastModified: asset.lastModified,
            sourceFingerprint: asset.sourceFingerprint,
          }],
        },
        {
          slug: "geographies/spain",
          title: "Spain",
          path: "galleries/geographies/spain",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          photos: [{
            id: "DSC_7362",
            path,
            filename: "DSC_7362.jpg",
            title: "Título editorial",
            description: "Descripción editorial visible.",
            tags: ["editorial", "visible"],
            order: 1,
            hidden: false,
            isReference: true,
            sourceGallerySlug: "spaces/urban",
          }],
        },
      ],
      posts: [],
      pages: [],
      parentMetadata: [],
      featuredPhotos: [],
      stats: { totalGalleries: 2, totalPhotos: 1, totalPosts: 0, totalPages: 0 },
    };
    await writeContentIndex(storage, index);

    const analysis = {
      model: "gemini-3.1-flash-lite",
      promptVersion: "gallery-taxonomy-v1",
      taxonomyVersion: "sha256:taxonomy",
      generatedAt: "2026-07-20T08:10:00.000Z",
      caption: "Descripción generada exclusivamente por IA.",
      tags: ["ciudad", "fachada"],
      gallerySuggestions: [],
    };
    const record = createPhotoAiRecord({
      asset,
      analysis,
      embedding: {
        status: "ready",
        model: "gemini-embedding-2",
        dimensions: 3,
        vectorId: asset.assetId,
        sourceFingerprint: asset.sourceFingerprint,
        generatedAt: "2026-07-20T08:10:00.000Z",
      },
    });
    await new AiRecordStore(storage).upsertRecord("spaces/urban", record);
    await writePhotoAiSearchIndex(storage, {
      version: PHOTO_AI_SEARCH_INDEX_VERSION,
      updatedAt: "2026-07-20T08:10:00.000Z",
      documents: {
        [asset.assetId]: {
          assetId: asset.assetId,
          path,
          filename: "DSC_7362.jpg",
          gallerySlug: "spaces/urban",
          galleryTitle: "Urban",
          title: "Título editorial",
          description: "Descripción editorial visible.",
          aiDescription: analysis.caption,
          caption: analysis.caption,
          editorialTags: ["editorial", "visible"],
          aiTags: analysis.tags,
          tags: ["ciudad", "editorial", "fachada", "visible"],
          hidden: false,
          protected: false,
          vectorId: asset.assetId,
          sourceFingerprint: asset.sourceFingerprint,
          model: "gemini-embedding-2",
          taxonomyVersion: "sha256:taxonomy",
          gallerySuggestions: [],
          updatedAt: "2026-07-20T08:10:00.000Z",
        },
      },
    });
    const vectorIndex = createPhotoVectorIndex(undefined, storage, {
      dimensions: 3,
      defaultModelSpace: "gemini-embedding-2:3",
      defaultNamespace: "photos",
    });
    await vectorIndex.upsert([{
      id: asset.assetId,
      values: [0.1, 0.2, 0.3],
      modelSpace: "gemini-embedding-2:3",
      namespace: "photos",
      metadata: { gallerySlug: "spaces/urban", hidden: false, protected: false },
    }]);

    await enqueuePhotoMetadataWritebacksInStorage(storage, [path], "backfill");
    const result = await processPhotoMetadataWritebackBatchInStorage(
      storage,
      {},
      1,
      [path],
    );
    expect(result).toMatchObject({ written: 1, failed: 0, remaining: 0, done: true });

    const written = new Uint8Array((await storage.get(path))!);
    const embedded = readVictoPressEmbeddedMetadata(written);
    expect(embedded?.editorial).toMatchObject({
      description: "Descripción editorial visible.",
      tags: ["editorial", "visible"],
    });
    expect(embedded?.ai).toMatchObject({
      description: "Descripción generada exclusivamente por IA.",
      tags: ["ciudad", "fachada"],
    });
    expect(embedded?.galleries).toEqual([
      expect.objectContaining({ slug: "spaces/urban", physicalSource: true, order: 1 }),
      expect.objectContaining({ slug: "geographies/spain", physicalSource: false, order: 1 }),
    ]);
    expect(embedded?.indexes.search?.document).toMatchObject({
      description: "Descripción editorial visible.",
      aiDescription: "Descripción generada exclusivamente por IA.",
      editorialTags: ["editorial", "visible"],
      aiTags: ["ciudad", "fachada"],
    });
    expect(embedded?.indexes.vector).toMatchObject({
      encoding: "base64-f32le",
      dimensions: 3,
      model: "gemini-embedding-2",
    });
    expect(embedded?.indexes.vector?.values).toBeTruthy();
    expect(Buffer.compare(Buffer.from(canonicalizeImageBytes(written)), Buffer.from(original))).toBe(0);

    const recoveryDirectory = await mkdtemp(join(tmpdir(), "victopress-xmp-recovery-"));
    try {
      const recoveryStorage = new LocalStorageAdapter(recoveryDirectory);
      await recoveryStorage.put(path, written.buffer as ArrayBuffer, "image/jpeg");
      await recoveryStorage.put(
        "galleries/spaces/urban/gallery.yaml",
        "title: Urban\n",
        "text/yaml",
      );
      await recoveryStorage.put(
        "galleries/geographies/spain/gallery.yaml",
        "title: Spain\n",
        "text/yaml",
      );
      const recovered = await rebuildContentIndex(recoveryStorage, true);
      const recoveredPhysical = recovered.galleryData
        .find((gallery) => gallery.slug === "spaces/urban")
        ?.photos.find((photo) => !photo.isReference);
      const recoveredReference = recovered.galleryData
        .find((gallery) => gallery.slug === "geographies/spain")
        ?.photos[0];
      expect(recoveredPhysical).toMatchObject({
        description: "Descripción editorial visible.",
        tags: ["editorial", "visible"],
      });
      expect(recoveredPhysical?.description).not.toBe(analysis.caption);
      expect(recoveredReference).toMatchObject({
        path,
        isReference: true,
        sourceGallerySlug: "spaces/urban",
      });
    } finally {
      await rm(recoveryDirectory, { recursive: true, force: true });
    }

    await enqueuePhotoMetadataWritebacksInStorage(storage, [path], "editorial-metadata");
    const second = await processPhotoMetadataWritebackBatchInStorage(storage, {}, 1, [path]);
    expect(second).toMatchObject({ unchanged: 1, written: 0, failed: 0 });
  });
});
