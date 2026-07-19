import { describe, expect, test } from "bun:test";
import { extractExif } from "../app/lib/content-engine/exif";

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
