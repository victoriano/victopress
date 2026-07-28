import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  findMarkdownImages,
  setMarkdownImageWidth,
} from "../app/lib/markdown-images";
import { renderMarkdown } from "../app/lib/markdown";

const POSTS = [
  "content/blog/2017/1/22/granada/index.en.md",
  "content/blog/2017/1/31/aos-de-crcel/index.en.md",
  "content/blog/2017/1/31/la-nia-fotgrafa-de-sol/index.en.md",
  "content/blog/2017/1/31/tiendas-de-barrio/index.en.md",
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

  test("renders strong annotations imported from Notion even with edge whitespace", () => {
    const html = renderMarkdown([
      "Understand** why it happens**, then act.",
      "",
      "The **important conclusion. **Next paragraph.",
      "",
      "### **Usage data. **",
      "",
      "***Strong italic***",
    ].join("\n"));

    expect(html).toContain("Understand <strong>why it happens</strong>, then act.");
    expect(html).toContain("<strong>important conclusion.</strong> Next paragraph.");
    expect(html).toContain("<h3><strong>Usage data.</strong> </h3>");
    expect(html).toContain("<em><strong>Strong italic</strong></em>");
    expect(html).not.toContain("**");
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
    expect(html).toContain('src="/api/images/blog/photo.jpg?v=mime-v2"');
    expect(html).not.toContain('class="blog-image-link"');
    expect(html).not.toContain('href="/api/images/blog/photo.jpg?v=mime-v2"');
  });

  test("renders text-column images without leaking layout directives into HTML titles", () => {
    const html = renderMarkdown([
      '![Diagram](/api/images/blog/diagram.png "caption | text-width")',
      "",
      '![Chart](/api/images/blog/chart.png "Source chart | text-width")',
    ].join("\n"));

    expect(html).toContain(
      '<p class="blog-image-row" data-image-width="text">',
    );
    expect(html).toContain(
      '<span class="blog-image-frame" data-image-width="text">',
    );
    expect(html).toContain('<span class="blog-image-caption">Diagram</span>');
    expect(html).toContain('title="Source chart"');
    expect(html).not.toContain('title="caption | text-width"');
    expect(html).not.toContain('title="Source chart | text-width"');
  });

  test("lets the editor switch image width while preserving captions and galleries", () => {
    const source = [
      '![Photo](/api/images/blog/photo.jpg "caption")',
      "",
      '![Pair](/api/images/blog/pair.jpg "gallery-2")',
    ].join("\n");

    const textWidth = setMarkdownImageWidth(source, 0, "text");
    const galleryTextWidth = setMarkdownImageWidth(textWidth, 1, "text");

    expect(textWidth).toContain('"caption | text-width"');
    expect(galleryTextWidth).toContain('"gallery-2 | text-width"');
    expect(findMarkdownImages(galleryTextWidth).map((image) => image.width))
      .toEqual(["text", "text"]);
    expect(setMarkdownImageWidth(galleryTextWidth, 0, "wide")).toContain(
      '"caption"',
    );
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
