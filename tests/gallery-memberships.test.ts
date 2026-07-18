import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignPhotosToGalleryInIndex,
  readContentIndex,
  writeContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { readGalleryMemberships } from "../app/lib/content-engine/gallery-memberships";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("logical gallery memberships", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-memberships-"));
    storage = new LocalStorageAdapter(directory);
    const index: ContentIndex = {
      version: 9,
      updatedAt: "2026-07-18T10:00:00.000Z",
      galleries: [
        {
          slug: "source",
          title: "Source",
          path: "galleries/source",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
        },
        {
          slug: "urban",
          title: "Urban",
          path: "galleries/urban",
          photoCount: 0,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          isParentGallery: true,
        },
      ],
      galleryData: [
        {
          slug: "source",
          title: "Source",
          path: "galleries/source",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          photos: [{
            id: "photo",
            path: "galleries/source/photo.jpg",
            filename: "photo.jpg",
            tags: ["city"],
          }],
        },
        {
          slug: "urban",
          title: "Urban",
          path: "galleries/urban",
          photoCount: 0,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          isParentGallery: true,
          photos: [],
        },
      ],
      posts: [],
      pages: [],
      parentMetadata: [],
      featuredPhotos: [],
      stats: {
        totalGalleries: 2,
        totalPhotos: 1,
        totalPosts: 0,
        totalPages: 0,
      },
    };
    await writeContentIndex(storage, index);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("adds one physical photo to another gallery without copying its path", async () => {
    const first = await assignPhotosToGalleryInIndex(
      storage,
      ["galleries/source/photo.jpg"],
      "urban",
    );
    const second = await assignPhotosToGalleryInIndex(
      storage,
      ["galleries/source/photo.jpg"],
      "urban",
    );
    const index = await readContentIndex(storage);
    const urban = index?.galleryData.find((gallery) => gallery.slug === "urban");
    const memberships = await readGalleryMemberships(storage);

    expect(first).toMatchObject({ success: true, added: 1, skipped: 0 });
    expect(second).toMatchObject({ success: true, added: 0, skipped: 1 });
    expect(urban?.photos).toHaveLength(1);
    expect(urban?.isParentGallery).toBe(false);
    expect(index?.galleries.find((gallery) => gallery.slug === "urban")?.isParentGallery).toBe(false);
    expect(urban?.photos[0]).toMatchObject({
      path: "galleries/source/photo.jpg",
      filename: "photo.jpg",
      isReference: true,
      sourceGallerySlug: "source",
    });
    expect(memberships).toEqual({ "galleries/source/photo.jpg": ["urban"] });
    expect(index?.stats.totalPhotos).toBe(1);
  });
});
