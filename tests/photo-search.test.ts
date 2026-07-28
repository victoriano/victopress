import { describe, expect, test } from "bun:test";
import { rankPhotoDocumentsLexically } from "../app/lib/ai/photo-ai-service.server";
import type { PhotoAiSearchDocument } from "../app/lib/ai/search-index";

function photo(
  assetId: string,
  caption: string,
  options: Partial<PhotoAiSearchDocument> = {},
): PhotoAiSearchDocument {
  return {
    assetId,
    path: `galleries/humans/${assetId}.jpg`,
    filename: `${assetId}.jpg`,
    gallerySlug: "humans",
    galleryTitle: "Humans",
    caption,
    tags: [],
    hidden: false,
    protected: false,
    vectorId: assetId,
    sourceFingerprint: `sha256:${assetId}`,
    model: "gemini-embedding-2",
    taxonomyVersion: "taxonomy-v1",
    gallerySuggestions: [],
    updatedAt: "2026-07-27T20:00:00.000Z",
    ...options,
  };
}

describe("photo search lexical fallback", () => {
  test("matches whole words and common Spanish-English visual aliases", () => {
    const hat = photo("hat", "Retrato de una mujer con un sombrero elegante.");
    const manhattan = photo("manhattan", "Vista del horizonte de Manhattan.");

    const results = rankPhotoDocumentsLexically([manhattan, hat], "hat");

    expect(results.map((result) => result.document.assetId)).toEqual(["hat"]);
  });

  test("preserves visibility, gallery filters and result limits", () => {
    const accepted = {
      slug: "portraits",
      confidence: 0.9,
      status: "accepted" as const,
      alreadyCurrent: false,
    };
    const visible = photo("visible", "Sombrero rojo", {
      gallerySuggestions: [accepted],
    });
    const hidden = photo("hidden", "Sombrero azul", { hidden: true });
    const protectedPhoto = photo("protected", "Sombrero verde", { protected: true });

    const results = rankPhotoDocumentsLexically(
      [hidden, protectedPhoto, visible],
      "sombrero",
      { gallerySlug: "portraits", limit: 1 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].document.assetId).toBe("visible");
  });
});
