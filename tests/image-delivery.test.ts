import { describe, expect, test } from "bun:test";
import type { FileInfo } from "../app/lib/content-engine";
import { resolveImageAsset } from "../app/lib/image-delivery.server";

function imageBuffer(marker: number): ArrayBuffer {
  return Uint8Array.from([0xff, 0xd8, 0xff, marker]).buffer;
}

function file(name: string, directory = "galleries/travel"): FileInfo {
  return {
    name,
    path: `${directory}/${name}`,
    size: 4,
    lastModified: new Date(0),
    isDirectory: false,
  };
}

describe("image delivery", () => {
  test("serves an existing optimized variant", async () => {
    const variant = imageBuffer(1);
    const result = await resolveImageAsset(
      {
        get: async (path) => path.endsWith("_800w.webp") ? variant : null,
        list: async () => [],
      },
      "galleries/travel/photo_800w.webp",
      "jpg",
    );

    expect(result).toEqual({
      buffer: variant,
      path: "galleries/travel/photo_800w.webp",
      usedOriginalFallback: false,
    });
  });

  test("falls back to the hinted original when a variant is absent", async () => {
    const original = imageBuffer(2);
    let listCalls = 0;
    const result = await resolveImageAsset(
      {
        get: async (path) => path.endsWith("photo.jpg") ? original : null,
        list: async () => {
          listCalls += 1;
          return [];
        },
      },
      "galleries/travel/photo_1600w.webp",
      "jpg",
    );

    expect(result?.path).toBe("galleries/travel/photo.jpg");
    expect(result?.usedOriginalFallback).toBe(true);
    expect(listCalls).toBe(0);
  });

  test("resolves old variant URLs by finding the sibling source image", async () => {
    const original = imageBuffer(3);
    const result = await resolveImageAsset(
      {
        get: async (path) => path.endsWith("photo.jpeg") ? original : null,
        list: async () => [file("photo.jpeg")],
      },
      "galleries/travel/photo_2400w.webp",
      null,
    );

    expect(result?.path).toBe("galleries/travel/photo.jpeg");
    expect(result?.usedOriginalFallback).toBe(true);
  });

  test("does not fall back for an unrelated missing image", async () => {
    const result = await resolveImageAsset(
      { get: async () => null, list: async () => [] },
      "galleries/travel/missing.jpg",
      "jpg",
    );

    expect(result).toBeNull();
  });
});
