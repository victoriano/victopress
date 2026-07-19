import { describe, expect, test } from "bun:test";
import {
  generateSrcSet,
  getOptimizedImageUrl,
  getResponsiveVariantWidths,
} from "../app/utils/image-optimization";

describe("responsive image delivery", () => {
  test("does not advertise variants wider than a source image", () => {
    expect(getResponsiveVariantWidths(2500)).toEqual([800, 1600, 2400]);
    expect(getResponsiveVariantWidths(1800)).toEqual([800, 1600]);
    expect(getResponsiveVariantWidths(800)).toEqual([]);
  });

  test("adds the unrecompressed original as the largest responsive candidate", () => {
    const srcSet = generateSrcSet(
      "galleries/new york/photo one.jpg",
      undefined,
      { originalWidth: 2000, includeOriginal: true },
    );

    expect(srcSet).toContain(
      "/api/images/galleries/new%20york/photo%20one_800w.webp?v=webp-q86-v2 800w",
    );
    expect(srcSet).toContain(
      "/api/images/galleries/new%20york/photo%20one_1600w.webp?v=webp-q86-v2 1600w",
    );
    expect(srcSet).not.toContain("2400w.webp");
    expect(srcSet).toContain(
      "/api/images/galleries/new%20york/photo%20one.jpg 2000w",
    );
  });

  test("keeps encoded paths stable for generated variants", () => {
    expect(
      getOptimizedImageUrl("/api/images/galleries/south of spain/a+b.jpg", {
        width: 900,
      }),
    ).toBe(
      "/api/images/galleries/south%20of%20spain/a%2Bb_1600w.webp?v=webp-q86-v2",
    );
  });
});
