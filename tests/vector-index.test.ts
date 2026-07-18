import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesFirstVectorIndex } from "../app/lib/ai/vector-index-files";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("files-first vector index", () => {
  let directory = "";
  let index: FilesFirstVectorIndex;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "victopress-vectors-"));
    index = new FilesFirstVectorIndex(new LocalStorageAdapter(directory), {
      dimensions: 3,
      defaultModelSpace: "test:3",
      defaultNamespace: "photos",
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("ranks cosine neighbours and does not return vector values by default", async () => {
    await index.upsert([
      { id: "source", values: [1, 0, 0], metadata: { gallerySlug: "a", hidden: false, protected: false } },
      { id: "near", values: [0.9, 0.1, 0], metadata: { gallerySlug: "b", hidden: false, protected: false } },
      { id: "far", values: [0, 1, 0], metadata: { gallerySlug: "b", hidden: false, protected: false } },
    ]);

    const result = await index.queryById("source", { topK: 2 });
    expect(result.matches.map((match) => match.id)).toEqual(["near", "far"]);
    expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
    expect(result.matches[0].values).toBeUndefined();
  });

  test("filters hidden and protected photos", async () => {
    await index.upsert([
      { id: "visible", values: [1, 0, 0], metadata: { hidden: false, protected: false } },
      { id: "hidden", values: [1, 0, 0], metadata: { hidden: true, protected: false } },
      { id: "protected", values: [1, 0, 0], metadata: { hidden: false, protected: true } },
    ]);
    const result = await index.query([1, 0, 0], {
      filter: { hidden: false, protected: false },
    });
    expect(result.matches.map((match) => match.id)).toEqual(["visible"]);
  });

  test("upserts, retrieves and deletes in the active model space", async () => {
    await index.upsert([{ id: "photo", values: [1, 2, 3] }]);
    await index.upsert([{ id: "photo", values: [3, 2, 1] }]);
    const [record] = await index.getByIds(["photo"], { includeValues: true });
    expect(record.values).toEqual([3, 2, 1]);
    expect((await index.describe()).vectorCount).toBe(1);
    expect((await index.delete(["photo"])).count).toBe(1);
    expect(await index.getByIds(["photo"])).toEqual([]);
  });

  test("reads the persisted vector file only once per index instance", async () => {
    await index.upsert([
      { id: "one", values: [1, 0, 0] },
      { id: "two", values: [0, 1, 0] },
    ]);

    const storage = new LocalStorageAdapter(directory);
    const getText = spyOn(storage, "getText");
    const freshIndex = new FilesFirstVectorIndex(storage, {
      dimensions: 3,
      defaultModelSpace: "test:3",
      defaultNamespace: "photos",
    });

    await freshIndex.getByIds(["one"], { includeValues: true });
    await freshIndex.getByIds(["two"], { includeValues: true });
    await freshIndex.describe();

    expect(getText).toHaveBeenCalledTimes(1);
    getText.mockRestore();
  });

  test("rejects vectors with the wrong dimensions", async () => {
    expect(index.upsert([{ id: "bad", values: [1, 2] }])).rejects.toThrow("3-dimension");
  });
});
