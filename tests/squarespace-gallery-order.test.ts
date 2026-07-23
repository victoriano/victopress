import { describe, expect, test } from "bun:test";
import {
  applySquarespaceDisplayOrder,
  filenameFromSquarespaceItem,
  filenamesInSquarespaceDisplayOrder,
  mergeCanonicalPhotoOrder,
  resolveSquarespacePhotoOrder,
} from "../scripts/lib/squarespace-gallery-order";

describe("Squarespace gallery display order", () => {
  test("uses the asset URL filename and displayIndex instead of export chronology", () => {
    const items = [
      {
        filename: "newest-export-row",
        assetUrl: "https://images.example/photo-3.jpg",
        displayIndex: 2,
      },
      {
        filename: "legacy-field-without-extension",
        assetUrl: "https://images.example/IMG_1081bjpg.jpg?format=1500w",
        displayIndex: 0,
      },
      {
        filename: "middle.jpg",
        assetUrl: "https://images.example/folder%20photo.jpg",
        displayIndex: 1,
      },
    ];

    expect(filenameFromSquarespaceItem(items[1])).toBe("IMG_1081bjpg.jpg");
    expect(filenamesInSquarespaceDisplayOrder(items)).toEqual([
      "IMG_1081bjpg.jpg",
      "folder photo.jpg",
      "photo-3.jpg",
    ]);
  });

  test("resolves every old filename to one existing VictoPress path", () => {
    const photos = [
      { path: "galleries/portraits/extra.jpg", filename: "extra.jpg" },
      { path: "galleries/china/shared.jpg", filename: "shared.jpg" },
      { path: "galleries/portraits/first.jpg", filename: "first.jpg" },
    ];

    expect(
      resolveSquarespacePhotoOrder(["first.jpg", "SHARED.JPG"], photos),
    ).toEqual({
      orderedPaths: [
        "galleries/portraits/first.jpg",
        "galleries/china/shared.jpg",
      ],
      missing: [],
      ambiguous: [],
    });
  });

  test("uses proven image-identity aliases for deduplicated imports", () => {
    expect(
      resolveSquarespacePhotoOrder(
        ["old-flickr-name.jpg", "_MG_4009.jpg"],
        [
          { path: "galleries/australia/IMG_4857.jpg", filename: "IMG_4857.jpg" },
          { path: "galleries/social/MG_4009.jpg", filename: "MG_4009.jpg" },
        ],
        {
          "old-flickr-name.jpg": "IMG_4857.jpg",
          "_MG_4009.jpg": "MG_4009.jpg",
        },
      ),
    ).toEqual({
      orderedPaths: [
        "galleries/australia/IMG_4857.jpg",
        "galleries/social/MG_4009.jpg",
      ],
      missing: [],
      ambiguous: [],
    });
  });

  test("maps repeated Squarespace occurrences to deliberate duplicate paths", () => {
    expect(
      resolveSquarespacePhotoOrder(
        ["P1300894.jpg", "middle.jpg", "P1300894.jpg"],
        [
          { path: "rome/P1300894.jpg", filename: "P1300894.jpg" },
          { path: "rome/middle.jpg", filename: "middle.jpg" },
          {
            path: "rome/P1300894--squarespace-duplicate.jpg",
            filename: "P1300894--squarespace-duplicate.jpg",
          },
        ],
        {},
        {
          "P1300894.jpg": [
            "rome/P1300894.jpg",
            "rome/P1300894--squarespace-duplicate.jpg",
          ],
        },
      ),
    ).toEqual({
      orderedPaths: [
        "rome/P1300894.jpg",
        "rome/middle.jpg",
        "rome/P1300894--squarespace-duplicate.jpg",
      ],
      missing: [],
      ambiguous: [],
    });
  });

  test("refuses missing and ambiguous filename matches", () => {
    const result = resolveSquarespacePhotoOrder(
      ["duplicate.jpg", "missing.jpg"],
      [
        { path: "galleries/a/duplicate.jpg", filename: "duplicate.jpg" },
        { path: "galleries/b/duplicate.jpg", filename: "duplicate.jpg" },
      ],
    );

    expect(result.orderedPaths).toEqual([]);
    expect(result.missing).toEqual(["missing.jpg"]);
    expect(result.ambiguous).toEqual([
      {
        filename: "duplicate.jpg",
        paths: [
          "galleries/a/duplicate.jpg",
          "galleries/b/duplicate.jpg",
        ],
      },
    ]);
  });

  test("puts old-site photos first and leaves VictoPress-only photos stable", () => {
    const photos = [
      { path: "extra-1.jpg", filename: "extra-1.jpg" },
      { path: "old-b.jpg", filename: "old-b.jpg" },
      { path: "extra-2.jpg", filename: "extra-2.jpg" },
      { path: "old-a.jpg", filename: "old-a.jpg" },
    ];

    expect(mergeCanonicalPhotoOrder(photos, ["old-a.jpg", "old-b.jpg"])).toEqual([
      "old-a.jpg",
      "old-b.jpg",
      "extra-1.jpg",
      "extra-2.jpg",
    ]);
  });

  test("re-ranks imported files from live display order", () => {
    const photos = [
      { album: "Portraits", filename: "a.jpg", order: 0 },
      { album: "Portraits", filename: "b.jpg", order: 1 },
      { album: "Uncategorized", filename: "other.jpg", order: 7 },
    ];
    const result = applySquarespaceDisplayOrder(
      photos,
      new Map([
        [
          "Portraits",
          {
            route: "portraits",
            title: "Portraits",
            filenames: ["b.jpg", "a.jpg"],
          },
        ],
      ]),
    );

    expect(result.map((photo) => photo.order)).toEqual([1, 0, 7]);
  });
});
