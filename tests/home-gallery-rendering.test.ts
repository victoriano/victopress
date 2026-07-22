import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getHomePhotosFromIndex,
  writeContentIndex,
  type ContentIndex,
} from "../app/lib/content-engine/content-index";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("home gallery rendering data", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-home-gallery-"));
    storage = new LocalStorageAdapter(directory);

    const index: ContentIndex = {
      version: 9,
      updatedAt: "2026-07-21T08:00:00.000Z",
      galleries: [],
      galleryData: [
        {
          slug: "spaces",
          title: "Spaces",
          path: "galleries/spaces",
          photoCount: 1,
          isProtected: false,
          hasChildren: false,
          childCount: 0,
          photos: [
            {
              id: "landscape",
              path: "galleries/spaces/landscape.jpg",
              filename: "landscape.jpg",
              exif: { width: 2400, height: 1600 },
            },
          ],
        },
      ],
      posts: [],
      pages: [],
      parentMetadata: [],
      // Simulate the already-persisted v9 shape, which has no dimensions here.
      featuredPhotos: [
        {
          id: "landscape",
          path: "galleries/spaces/landscape.jpg",
          filename: "landscape.jpg",
          gallerySlug: "spaces",
          galleryTitle: "Spaces",
        },
      ],
      stats: {
        totalGalleries: 1,
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

  test("hydrates featured-photo dimensions from gallery data", async () => {
    const photos = await getHomePhotosFromIndex(storage);

    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      path: "galleries/spaces/landscape.jpg",
      width: 2400,
      height: 1600,
      homeIndex: 0,
    });
  });

  test("keeps dimensions for a hand-picked home configuration", async () => {
    const photos = await getHomePhotosFromIndex(storage, {
      photos: [{ gallery: "spaces", filename: "landscape.jpg" }],
    });

    expect(photos[0]).toMatchObject({ width: 2400, height: 1600 });
  });
});
