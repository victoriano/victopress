import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderMarkdown } from "../app/lib/markdown";

const POSTS = [
  "content/blog/2017/1/22/granada/index.md",
  "content/blog/2017/1/31/aos-de-crcel/index.md",
  "content/blog/2017/1/31/la-nia-fotgrafa-de-sol/index.md",
  "content/blog/2017/1/31/tiendas-de-barrio/index.md",
  "content/blog/2021/10/3/testing-iphone-13-pro-in-granada/index.md",
];

describe("blog Markdown", () => {
  test("renders formatting and treats raw HTML as text", () => {
    const html = renderMarkdown("**Strong** and [safe](https://example.com)\n\n<script>alert(1)</script>");

    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("drops unsafe link protocols", () => {
    const html = renderMarkdown("[do not run](javascript:alert(1))");

    expect(html).toContain("do not run");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
  });

  test("preserves image captions and gallery columns", () => {
    const html = renderMarkdown([
      '![A caption](/api/images/blog/photo.jpg "caption")',
      "",
      '![One](/api/images/blog/one.jpg "gallery-2")',
      '![Two](/api/images/blog/two.jpg "gallery-2")',
    ].join("\n"));

    expect(html).toContain('<span class="blog-image-caption">A caption</span>');
    expect(html).toContain('<p class="blog-image-row" data-gallery-columns="2">');
    expect(html.match(/class="blog-image-frame"/g)).toHaveLength(3);
  });

  test("all migrated posts are HTML-free Markdown with every image referenced", async () => {
    const files = await Promise.all(POSTS.map((path) => readFile(path, "utf8")));
    const imageCount = files.reduce(
      (total, source) => total + (source.match(/!\[[^\]]*\]\([^\n)]+(?:\s+"[^"]+")?\)/g)?.length || 0),
      0,
    );

    expect(files).toHaveLength(5);
    expect(files.every((source) => source.includes("format: markdown"))).toBe(true);
    expect(files.every((source) => !/<\/?(?:div|figure|img|p|span|a)\b/i.test(source))).toBe(true);
    expect(imageCount).toBe(24);
  });
});
