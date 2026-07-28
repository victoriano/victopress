import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { renderMarkdown } from "../app/lib/markdown";
import { preserveNotionBlockBoundaries } from "../scripts/repair-notion-blog-markdown";

const MANIFESTS = [
  "content/blog/_notion-import-manifest.json",
  "content/blog/_notion-posted-import-manifest.json",
];

interface ManifestPost {
  title: string;
  status: string;
  date: string;
  target: string;
  contentSha256?: string;
  assets?: Array<{
    path: string;
    sha256?: string;
  }>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function imagesPerRow(html: string): number[] {
  return [...html.matchAll(
    /<p class="blog-image-row"[^>]*>([\s\S]*?)<\/p>/g,
  )].map((match) => match[1].match(/<img\b/g)?.length ?? 0);
}

describe("Notion blog rendering", () => {
  test("the block-boundary repair is idempotent", () => {
    const source = [
      "First paragraph",
      "Second paragraph",
      "- First item",
      "- Second item",
      "![One](/one.jpg)",
      "![Two](/two.jpg)",
    ].join("\n");
    const repaired = preserveNotionBlockBoundaries(source);

    expect(preserveNotionBlockBoundaries(repaired)).toBe(repaired);
    expect(repaired).toContain("First paragraph\n\nSecond paragraph");
    expect(repaired).toContain("- First item\n- Second item");
    expect(repaired).toContain("![One](/one.jpg)\n\n![Two](/two.jpg)");
  });

  test("preserves every imported post's date, publication state, and assets", async () => {
    const posts: ManifestPost[] = [];
    for (const manifestPath of MANIFESTS) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      posts.push(...manifest.posts);
    }

    expect(posts).toHaveLength(25);
    expect(posts.filter((post) => post.status === "Posted")).toHaveLength(20);
    expect(posts.filter((post) => post.status !== "Posted")).toHaveLength(5);

    let importedImageCount = 0;
    for (const post of posts) {
      const document = await readFile(join("content", post.target), "utf8");
      const parsed = matter(document);
      const body = parsed.content.trim();
      const html = renderMarkdown(parsed.content);
      const imageRows = imagesPerRow(html);
      const imageAssets = post.assets?.filter((asset) =>
        /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(asset.path)
      ) ?? [];

      const frontmatterDate =
        parsed.data.date instanceof Date
          ? parsed.data.date.toISOString().slice(0, 10)
          : String(parsed.data.date).slice(0, 10);
      expect(frontmatterDate, post.title).toBe(post.date);
      expect(parsed.data.draft, post.title).toBe(post.status !== "Posted");
      if (post.contentSha256) {
        expect(sha256(body), post.title).toBe(post.contentSha256);
      }

      for (const asset of post.assets ?? []) {
        const contents = await readFile(join("content", asset.path));
        if (asset.sha256) {
          expect(sha256(contents), asset.path).toBe(asset.sha256);
        }
      }

      expect(html, post.title).not.toMatch(/\*\*|__/);
      expect(
        imageRows.every((count) => count === 1),
        `${post.title} contains an unintended inline image strip`,
      ).toBe(true);
      expect(html.match(/<img\b/g)?.length ?? 0, post.title).toBe(
        imageAssets.length,
      );
      importedImageCount += imageAssets.length;
    }

    expect(importedImageCount).toBe(142);
  });

  test("renders the Rome photo essay as 44 full block images", async () => {
    const path =
      "content/blog/2015/8/1/72-hours-in-rome-one-year-after-finishing-my-erasmus-in-by-victoriano-izquierdo-medium/index.md";
    const { content } = matter(await readFile(path, "utf8"));
    const html = renderMarkdown(content);

    expect(html.match(/<img\b/g)).toHaveLength(44);
    expect(imagesPerRow(html)).toHaveLength(44);
    expect(imagesPerRow(html).every((count) => count === 1)).toBe(true);
  });
});
