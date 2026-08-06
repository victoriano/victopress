import { describe, expect, test } from "bun:test";
import {
  filterPublicPhotoAiMap,
  type PhotoAiMapData,
} from "../app/lib/ai/photo-ai-service.server";
import type {
  PhotoAiSearchDocument,
  PhotoAiSearchIndex,
} from "../app/lib/ai/search-index";

function document(
  assetId: string,
  options: Partial<PhotoAiSearchDocument> = {},
): PhotoAiSearchDocument {
  return {
    assetId,
    path: `galleries/archive/${assetId}.jpg`,
    filename: `${assetId}.jpg`,
    gallerySlug: "archive",
    galleryTitle: "Archive",
    caption: assetId,
    tags: [],
    hidden: false,
    protected: false,
    vectorId: assetId,
    sourceFingerprint: `sha256:${assetId}`,
    model: "gemini-embedding-2",
    taxonomyVersion: "taxonomy-v1",
    gallerySuggestions: [],
    updatedAt: "2026-08-06T10:00:00.000Z",
    ...options,
  };
}

function node(
  assetId: string,
  tags: string[],
  clusterId: number,
): PhotoAiMapData["nodes"][number] {
  return {
    assetId,
    path: `galleries/archive/${assetId}.jpg`,
    filename: `${assetId}.jpg`,
    caption: assetId,
    tags,
    gallerySlug: "archive",
    gallerySlugs: ["archive"],
    x: clusterId === 0 ? 0.25 : 0.75,
    y: 0.5,
    clusterId,
  };
}

describe("public photo exploration map", () => {
  test("removes hidden and protected photos without leaking their cluster labels", () => {
    const map: PhotoAiMapData = {
      nodes: [
        node("public", ["calle", "noche"], 0),
        node("hidden", ["etiqueta-secreta"], 0),
        node("protected", ["privado"], 1),
      ],
      edges: [
        { source: "hidden", target: "public" },
        { source: "protected", target: "public" },
      ],
      clusters: [
        { id: 0, label: "etiqueta-secreta", count: 2, x: 0.5, y: 0.5 },
        { id: 1, label: "privado", count: 1, x: 0.75, y: 0.5 },
      ],
      tags: ["calle", "etiqueta-secreta", "noche", "privado"],
      galleries: [{ slug: "archive", title: "Archive" }],
    };
    map.nodes[0].gallerySlugs.push("secret-gallery");
    const searchIndex: PhotoAiSearchIndex = {
      version: 1,
      updatedAt: "2026-08-06T10:00:00.000Z",
      documents: {
        public: document("public", { tags: ["calle", "noche"] }),
        hidden: document("hidden", { hidden: true, tags: ["etiqueta-secreta"] }),
        protected: document("protected", { protected: true, tags: ["privado"] }),
      },
    };

    const result = filterPublicPhotoAiMap(map, searchIndex);

    expect(result.nodes.map((item) => item.assetId)).toEqual(["public"]);
    expect(result.edges).toEqual([]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      id: 0,
      label: "calle · noche",
      count: 1,
      x: 0.25,
      y: 0.5,
    });
    expect(result.tags).toEqual(["calle", "noche"]);
    expect(result.nodes[0].gallerySlugs).toEqual(["archive"]);
    expect(JSON.stringify(result)).not.toContain("etiqueta-secreta");
    expect(JSON.stringify(result)).not.toContain("privado");
    expect(JSON.stringify(result)).not.toContain("secret-gallery");
  });
});
