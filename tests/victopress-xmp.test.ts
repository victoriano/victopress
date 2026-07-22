import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createSourceFingerprint } from "../app/lib/ai/identity";
import { extractImageMetadata } from "../app/lib/content-engine/exif";
import {
  VICTOPRESS_EMBEDDED_METADATA_VERSION,
  canonicalizeImageBytes,
  readVictoPressEmbeddedMetadata,
  writeVictoPressEmbeddedMetadata,
  type VictoPressEmbeddedMetadata,
} from "../app/lib/content-engine/victopress-xmp";

function fixtureMetadata(): VictoPressEmbeddedMetadata {
  return {
    schemaVersion: VICTOPRESS_EMBEDDED_METADATA_VERSION,
    source: {
      path: "galleries/spaces/urban/DSC_7362.jpg",
      filename: "DSC_7362.jpg",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
      canonicalByteLength: 1_048_576,
    },
    editorial: {
      title: "Título editorial",
      description: "Descripción visible y editada por una persona.",
      tags: ["editorial", "publicado"],
      dateTaken: "2011-06-20T17:52:24.750Z",
      order: 3,
      hidden: false,
    },
    galleries: [
      {
        slug: "spaces/urban",
        title: "Urban",
        path: "galleries/spaces/urban",
        physicalSource: true,
        order: 3,
      },
      {
        slug: "geographies/europe/spain",
        title: "Spain",
        path: "galleries/geographies/europe/spain",
        physicalSource: false,
        order: 12,
      },
    ],
    ai: {
      description: "Descripción independiente generada por IA.",
      tags: ["ciudad", "arquitectura"],
      model: "gemini-3.1-flash-lite",
      promptVersion: "gallery-taxonomy-v1",
      taxonomyVersion: "sha256:taxonomy",
      generatedAt: "2026-07-20T08:00:00.000Z",
      gallerySuggestions: [],
    },
    indexes: {
      contentVersion: 9,
      search: {
        version: 1,
        document: {
          assetId: `asset_${"a".repeat(58)}`,
          caption: "Descripción independiente generada por IA.",
          description: "Descripción visible y editada por una persona.",
          tags: ["arquitectura", "ciudad", "editorial", "publicado"],
        },
      },
      vector: {
        status: "ready",
        model: "gemini-embedding-2",
        dimensions: 3,
        vectorId: `asset_${"a".repeat(58)}`,
        sourceFingerprint: `sha256:${"a".repeat(64)}`,
        encoding: "base64-f32le",
        values: "zczMPc3MTD6amZk+",
      },
    },
  };
}

function expectSameBytes(left: Uint8Array, right: Uint8Array) {
  expect(left.byteLength).toBe(right.byteLength);
  expect(Buffer.compare(Buffer.from(left), Buffer.from(right))).toBe(0);
}

describe("lossless VictoPress XMP", () => {
  test("keeps Photoshop/IPTC metadata and separates editorial fields from AI fields", async () => {
    const samplePath = join(
      import.meta.dir,
      "..",
      "content",
      "galleries",
      "spaces",
      "urban",
      "DSC_7362.jpg",
    );
    const original = new Uint8Array(await Bun.file(samplePath).arrayBuffer());
    const originalExtracted = await extractImageMetadata(original.buffer as ArrayBuffer);
    const originalFingerprint = await createSourceFingerprint(original);

    const first = writeVictoPressEmbeddedMetadata(original, fixtureMetadata());
    expect(first.format).toBe("jpeg");
    expect(first.changed).toBe(true);

    const restored = canonicalizeImageBytes(first.bytes);
    expectSameBytes(restored, original);
    expect(await createSourceFingerprint(first.bytes)).toBe(originalFingerprint);

    const embedded = readVictoPressEmbeddedMetadata(first.bytes);
    expect(embedded?.editorial.description).toBe(
      "Descripción visible y editada por una persona.",
    );
    expect(embedded?.editorial.tags).toEqual(["editorial", "publicado"]);
    expect(embedded?.ai?.description).toBe("Descripción independiente generada por IA.");
    expect(embedded?.ai?.tags).toEqual(["ciudad", "arquitectura"]);
    expect(embedded?.galleries.map((gallery) => gallery.slug)).toEqual([
      "spaces/urban",
      "geographies/europe/spain",
    ]);
    expect(embedded?.indexes.vector?.values).toBe("zczMPc3MTD6amZk+" );

    const afterExtracted = await extractImageMetadata(
      first.bytes.buffer.slice(
        first.bytes.byteOffset,
        first.bytes.byteOffset + first.bytes.byteLength,
      ) as ArrayBuffer,
    );
    expect(afterExtracted?.exif.imageDescription).toBe(
      originalExtracted?.exif.imageDescription,
    );
    expect(afterExtracted?.exif.keywords).toEqual(originalExtracted?.exif.keywords);
    expect(afterExtracted?.embedded).toHaveProperty("xmpMM.History");

    const second = writeVictoPressEmbeddedMetadata(first.bytes, fixtureMetadata());
    expect(second.changed).toBe(false);
    expectSameBytes(second.bytes, first.bytes);
  });

  test("writes and removes a PNG XMP iTXt chunk without changing the source identity", async () => {
    const original = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const originalFingerprint = await createSourceFingerprint(original);
    const written = writeVictoPressEmbeddedMetadata(original, fixtureMetadata());

    expect(written.format).toBe("png");
    expect(readVictoPressEmbeddedMetadata(written.bytes)?.ai?.tags).toEqual([
      "ciudad",
      "arquitectura",
    ]);
    expectSameBytes(canonicalizeImageBytes(written.bytes), original);
    expect(await createSourceFingerprint(written.bytes)).toBe(originalFingerprint);
  });
});
