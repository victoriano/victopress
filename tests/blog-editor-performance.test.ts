import { describe, expect, test } from "bun:test";

import {
  getPostBySlug,
  type StorageAdapter,
} from "../app/lib/content-engine";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";

describe("blog editor loading", () => {
  test("loads a nested post directly without scanning the whole blog", async () => {
    const baseStorage = new LocalStorageAdapter(`${process.cwd()}/content`);
    const textReads: string[] = [];
    const listedPaths: string[] = [];
    let recursiveScans = 0;

    const storage = {
      list: async (path: string) => {
        listedPaths.push(path);
        return baseStorage.list(path);
      },
      listRecursive: async () => {
        recursiveScans += 1;
        throw new Error("The editor should not recursively scan the blog");
      },
      getText: async (path: string) => {
        textReads.push(path);
        return baseStorage.getText(path);
      },
    } as unknown as StorageAdapter;

    const slug =
      "2023/8/20/manna-ai-serving-a-dystopian-capitalism-vs-an-utopian-socialism";
    const post = await getPostBySlug(storage, slug);

    expect(post?.slug).toBe(slug);
    expect(post?.title).toContain("Manna");
    expect(post?.translations?.es?.content).toContain("El libro");
    expect(post?.translations?.en?.content).toContain("During these holidays");
    expect(recursiveScans).toBe(0);
    expect(listedPaths).toEqual([`blog/${slug}`]);
    expect(textReads).toHaveLength(3);
    expect(textReads).toContain(`blog/${slug}/index.md`);
    expect(textReads).toContain(`blog/${slug}/index.es.md`);
    expect(textReads).toContain(`blog/${slug}/index.en.md`);
  });

  test("rejects traversal-shaped slugs before touching storage", async () => {
    let storageCalls = 0;
    const storage = {
      list: async () => {
        storageCalls += 1;
        return [];
      },
      listRecursive: async () => {
        storageCalls += 1;
        return [];
      },
      getText: async () => {
        storageCalls += 1;
        return null;
      },
    } as unknown as StorageAdapter;

    expect(await getPostBySlug(storage, "../settings")).toBeNull();
    expect(storageCalls).toBe(0);
  });
});
