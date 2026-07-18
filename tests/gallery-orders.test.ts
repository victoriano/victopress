import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GALLERY_ORDERS_KEY,
  readGalleryOrders,
  sortPhotosByGalleryOrder,
} from "../app/lib/content-engine/gallery-orders";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("gallery orders", () => {
  let directory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-gallery-orders-"));
    storage = new LocalStorageAdapter(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("reads and normalizes a persisted gallery order", async () => {
    await storage.put(
      GALLERY_ORDERS_KEY,
      [
        "version: 1",
        "updatedAt: 2026-07-18T20:00:00.000Z",
        "orders:",
        "  spaces/urban:",
        "    - galleries/source/b.jpg",
        "    - galleries/source/a.jpg",
        "    - galleries/source/b.jpg",
        "",
      ].join("\n"),
      "text/yaml",
    );

    expect(await readGalleryOrders(storage)).toEqual({
      "spaces/urban": ["galleries/source/b.jpg", "galleries/source/a.jpg"],
    });
  });

  test("puts Squarespace photos first and leaves CMS-only photos stable", () => {
    const photos = [
      { path: "galleries/urban/extra-1.jpg" },
      { path: "galleries/urban/a.jpg" },
      { path: "galleries/urban/extra-2.jpg" },
      { path: "galleries/source/b.jpg", isReference: true },
    ];

    expect(
      sortPhotosByGalleryOrder(photos, [
        "galleries/source/b.jpg",
        "galleries/urban/a.jpg",
      ]).map((photo) => photo.path),
    ).toEqual([
      "galleries/source/b.jpg",
      "galleries/urban/a.jpg",
      "galleries/urban/extra-1.jpg",
      "galleries/urban/extra-2.jpg",
    ]);
  });
});
