import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

import {
  BLOG_CATEGORIES,
  filterPostsByBlogCategory,
  normalizeBlogCategories,
  normalizeBlogCategory,
} from "../app/lib/blog-categories";

async function sourcePostFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourcePostFiles(path));
    } else if (entry.name === "index.md") {
      files.push(path);
    }
  }
  return files;
}

describe("blog categories", () => {
  test("normalizes a closed, deterministic vocabulary", () => {
    expect(normalizeBlogCategory(" DATA ")).toBe("data");
    expect(normalizeBlogCategory("writing")).toBeNull();
    expect(normalizeBlogCategories(["business", "DATA", "business", "other"]))
      .toEqual(["data", "business"]);
  });

  test("filters multi-category posts without changing their order", () => {
    const posts = [
      { slug: "first", categories: ["photos", "product"] },
      { slug: "second", categories: ["data"] },
      { slug: "third", categories: ["product", "business"] },
    ];

    expect(filterPostsByBlogCategory(posts, "product").map((post) => post.slug))
      .toEqual(["first", "third"]);
    expect(filterPostsByBlogCategory(posts, null)).toEqual(posts);
  });

  test("classifies every source post with at least one valid category", async () => {
    const files = await sourcePostFiles(join(process.cwd(), "content/blog"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { data } = matter(await readFile(file, "utf8"));
      const categories = normalizeBlogCategories(data.categories);

      expect(categories.length, file).toBeGreaterThan(0);
      expect(categories, file).toEqual(data.categories);
      expect(categories.every((category) => BLOG_CATEGORIES.includes(category)))
        .toBe(true);
    }
  });
});
