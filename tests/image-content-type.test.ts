import { describe, expect, test } from "bun:test";
import { detectImageContentType } from "../app/lib/image-content-type";

function buffer(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

describe("detectImageContentType", () => {
  test("recognizes WebP bytes even when the filename says JPEG", () => {
    const image = buffer(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"));
    expect(detectImageContentType(image, "photo.jpeg")).toBe("image/webp");
  });

  test("recognizes common raster signatures", () => {
    expect(detectImageContentType(buffer(0xff, 0xd8, 0xff), "photo.webp")).toBe("image/jpeg");
    expect(
      detectImageContentType(
        buffer(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        "photo.jpg",
      ),
    ).toBe("image/png");
    expect(detectImageContentType(buffer(...ascii("GIF89a")), "photo.jpg")).toBe("image/gif");
  });

  test("recognizes AVIF and SVG signatures", () => {
    const avif = buffer(0, 0, 0, 24, ...ascii("ftyp"), ...ascii("avif"), 0, 0, 0, 0);
    expect(detectImageContentType(avif, "photo.jpg")).toBe("image/avif");

    const svg = buffer(...ascii('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1">'));
    expect(detectImageContentType(svg, "photo.jpg")).toBe("image/svg+xml");
  });

  test("uses the extension only when the bytes are inconclusive", () => {
    expect(detectImageContentType(buffer(1, 2, 3), "photo.png")).toBe("image/png");
    expect(detectImageContentType(buffer(1, 2, 3), "photo.bin")).toBe("application/octet-stream");
  });
});
