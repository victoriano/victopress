import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";
import type { GalleryDataEntry } from "../app/lib/content-engine/content-index";
import { AiDataValidationError } from "../app/lib/ai/errors";
import {
  buildGalleryTaxonomyCatalog,
  serializeGalleryTaxonomyForPrompt,
} from "../app/lib/ai/gallery-taxonomy";
import { createPhotoAssetIdentity } from "../app/lib/ai/identity";
import {
  AiRecordStore,
  createPhotoAiRecord,
  galleryAiRecordStorageKey,
} from "../app/lib/ai/record-store";
import type { PhotoAnalysis } from "../app/lib/ai/types";

function gallery(
  input: Partial<GalleryDataEntry> & Pick<GalleryDataEntry, "slug" | "title" | "path">,
): GalleryDataEntry {
  return {
    photoCount: 0,
    isProtected: false,
    hasChildren: false,
    childCount: 0,
    photos: [],
    ...input,
  };
}

describe("AI asset identity", () => {
  test("uses image bytes for a stable asset id and source fingerprint", async () => {
    const input = {
      bytes: new Uint8Array([1, 2, 3, 4]),
      sourcePath: "galleries/travel/photo.jpg",
      filename: "photo.jpg",
      gallerySlug: "travel",
    };
    const first = await createPhotoAssetIdentity(input);
    const second = await createPhotoAssetIdentity({
      ...input,
      sourcePath: "galleries/archive/photo-renamed.jpg",
      filename: "photo-renamed.jpg",
      gallerySlug: "archive",
    });
    const changed = await createPhotoAssetIdentity({
      ...input,
      bytes: new Uint8Array([1, 2, 3, 5]),
    });

    expect(first.assetId).toBe(second.assetId);
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(changed.assetId).not.toBe(first.assetId);
    expect(first.assetId.length).toBeLessThanOrEqual(64);
    expect(first.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("existing gallery taxonomy", () => {
  test("builds a deterministic hierarchy and excludes container galleries from suggestions", async () => {
    const source = [
      gallery({
        slug: "travel/spain",
        title: "España",
        path: "galleries/travel/spain",
        category: "travel",
        tags: ["viaje", " Europa ", "viaje"],
        classificationHint: "  Only suggest when the journey itself is visible.  ",
        photoCount: 12,
      }),
      gallery({
        slug: "travel",
        title: "Viajes",
        path: "galleries/travel",
        isParentGallery: true,
        hasChildren: true,
        childCount: 1,
      }),
      gallery({
        slug: "private",
        title: "Private family archive",
        path: "galleries/private",
        isProtected: true,
        classificationHint: "Never expose this private editorial rule.",
      }),
    ];

    const first = await buildGalleryTaxonomyCatalog(source, "2026-07-18T10:00:00.000Z");
    const second = await buildGalleryTaxonomyCatalog(
      [...source].reverse(),
      "2026-07-19T10:00:00.000Z",
    );

    expect(first.version).toBe(second.version);
    expect(first.entries.map((entry) => entry.slug)).toEqual(["private", "travel", "travel/spain"]);
    expect(first.entries[2].ancestorSlugs).toEqual(["travel"]);
    expect(first.entries[2].parentSlug).toBe("travel");
    expect(first.entries[2].tags).toEqual(["Europa", "viaje"]);
    expect(first.entries[2].classificationHint).toBe(
      "Only suggest when the journey itself is visible.",
    );
    expect(first.entries[1].acceptsDirectPhotos).toBe(false);
    const promptTaxonomy = serializeGalleryTaxonomyForPrompt(first);
    expect(promptTaxonomy).not.toContain("Private family archive");
    expect(promptTaxonomy).not.toContain("Never expose this private editorial rule.");
    expect(promptTaxonomy).not.toContain('"slug":"travel"');
    expect(promptTaxonomy).toContain('"slug":"travel/spain"');
    expect(promptTaxonomy).toContain(
      '"classificationHint":"Only suggest when the journey itself is visible."',
    );
  });

  test("changes the taxonomy version when semantic gallery metadata changes", async () => {
    const first = await buildGalleryTaxonomyCatalog([
      gallery({ slug: "portraits", title: "Retratos", path: "galleries/portraits" }),
    ]);
    const changed = await buildGalleryTaxonomyCatalog([
      gallery({
        slug: "portraits",
        title: "Retratos",
        path: "galleries/portraits",
        classificationHint: "Solo cuando una persona sea el sujeto principal.",
      }),
    ]);
    expect(first.version).not.toBe(changed.version);
  });
});

describe("files-first AI record store", () => {
  let temporaryDirectory = "";
  let storage: LocalStorageAdapter;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "victopress-ai-core-"));
    storage = new LocalStorageAdapter(temporaryDirectory);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test("persists per gallery and preserves reviewed suggestions on reanalysis", async () => {
    let now = "2026-07-18T10:00:00.000Z";
    const store = new AiRecordStore(storage, { now: () => now });
    const asset = await createPhotoAssetIdentity({
      bytes: new Uint8Array([9, 8, 7]),
      sourcePath: "galleries/street/madrid.jpg",
      filename: "madrid.jpg",
      gallerySlug: "street",
    });
    const analysis: PhotoAnalysis = {
      model: "gemini-3.1-flash-lite",
      promptVersion: "gallery-taxonomy-v1",
      taxonomyVersion: "sha256:taxonomy",
      generatedAt: now,
      caption: "Una calle al atardecer.",
      tags: ["calle", "atardecer"],
      gallerySuggestions: [
        {
          gallerySlug: "madrid",
          confidence: 0.91,
          reason: "Arquitectura y ambiente urbano de Madrid.",
          alreadyCurrent: false,
          status: "pending",
        },
      ],
    };
    const record = createPhotoAiRecord({
      asset,
      analysis,
      embedding: {
        status: "ready",
        model: "gemini-embedding-2",
        dimensions: 768,
        vectorId: asset.assetId,
        sourceFingerprint: asset.sourceFingerprint,
        generatedAt: now,
      },
    }, now);

    const first = await store.upsertRecord("street", record);
    expect(first.revision).toBe(1);

    now = "2026-07-18T10:01:00.000Z";
    const reviewed = await store.reviewGallerySuggestion(
      "street",
      asset.assetId,
      "madrid",
      "accepted",
    );
    expect(reviewed.analysis?.gallerySuggestions[0].status).toBe("accepted");

    now = "2026-07-18T10:02:00.000Z";
    const regenerated = createPhotoAiRecord(
      {
        asset,
        analysis: {
          ...analysis,
          generatedAt: now,
          gallerySuggestions: [
            {
              ...analysis.gallerySuggestions[0],
              confidence: 0.96,
              status: "pending",
            },
          ],
        },
        embedding: record.embedding,
      },
      now,
    );
    const stored = await store.upsertRecord("street", regenerated);

    expect(stored.revision).toBe(3);
    expect(stored.analysis?.gallerySuggestions[0]).toMatchObject({
      confidence: 0.96,
      status: "accepted",
      reviewedAt: "2026-07-18T10:01:00.000Z",
    });
    const key = galleryAiRecordStorageKey("street/nested");
    expect(key).toBe(".victopress/ai/galleries/street%2Fnested.json");

    const raw = await storage.getText(galleryAiRecordStorageKey("street"));
    expect(raw).toContain('"vectorId"');
    expect(raw).not.toContain('"values"');
  });

  test("refuses to overwrite a malformed sidecar", async () => {
    const key = galleryAiRecordStorageKey("broken");
    await storage.put(key, "{not-json", "application/json");
    const store = new AiRecordStore(storage);

    expect(store.readGallery("broken")).rejects.toBeInstanceOf(AiDataValidationError);
  });
});
