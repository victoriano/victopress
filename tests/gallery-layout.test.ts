import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readContentIndex,
  updateGalleryMetadataInIndex,
  writeContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("gallery thumbnail layout setting", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-gallery-layout-"));
    storage = new LocalStorageAdapter(directory);

    const gallery = {
      slug: "spaces/landscapes",
      title: "Landscapes",
      path: "galleries/spaces/landscapes",
      photoCount: 0,
      isProtected: false,
      hasChildren: false,
      childCount: 0,
    };
    const index: ContentIndex = {
      version: 10,
      updatedAt: "2026-07-22T10:00:00.000Z",
      galleries: [gallery],
      galleryData: [{ ...gallery, photos: [] }],
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
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("persists an original-proportion override in the fast content index", async () => {
    await updateGalleryMetadataInIndex(
      storage,
      "galleries/spaces/landscapes",
      { thumbnailAspectRatio: "original" },
    );

    const updated = await readContentIndex(storage);
    expect(updated?.galleryData[0].thumbnailAspectRatio).toBe("original");
  });
});
