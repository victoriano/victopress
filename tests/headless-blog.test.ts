import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { BlogPost } from "../app/lib/content-engine";
import { LocalStorageAdapter, scanBlog, scanGalleries, scanPages } from "../app/lib/content-engine";
import {
  buildHeadlessBlogIndex,
  buildHeadlessBlogPost,
  headlessCorsPreflight,
  headlessJsonResponse,
  normalizeRequestedSlug,
  type HeadlessBlogConfig,
} from "../app/lib/headless-blog";
import { renderMarkdown } from "../app/lib/markdown";
import { languageSwitchPath, localizedPath, parseAcceptLanguage } from "../app/lib/i18n";

const config: HeadlessBlogConfig = {
  siteName: "Victoriano Izquierdo",
  publicBlogUrl: "https://victoriano.me/blog",
  publicMediaUrl: "https://photos.victoriano.me",
};

function post(overrides: Partial<BlogPost>): BlogPost {
  return {
    id: "post",
    slug: "post",
    title: "Post",
    path: "blog/post",
    content: "A post",
    excerpt: "A post",
    readingTime: 1,
    images: [],
    hasFrontmatter: true,
    format: "markdown",
    ...overrides,
  };
}

describe("headless blog contract", () => {
  const posts = [
    post({
      id: "newest",
      slug: "newest",
      title: "Newest",
      date: new Date("2024-06-20T00:00:00.000Z"),
      content: "![Cover](/api/images/blog/newest/cover.jpg)",
      cover: "blog/newest/cover.jpg",
      tags: ["product"],
    }),
    post({
      id: "nested",
      slug: "2021/10/3/nested",
      title: "Nested",
      date: new Date("2021-10-03T00:00:00.000Z"),
      content: "**Safe**\n\n<script>alert(1)</script>\n\n[Archive](/granada)\n\n![Granada](blog/2021/granada.jpg)",
      images: ["blog/2021/granada.jpg"],
      author: "Victoriano Izquierdo",
      readingTime: 4,
    }),
    post({
      id: "draft",
      slug: "secret-draft",
      title: "Secret Draft",
      date: new Date("2025-01-01T00:00:00.000Z"),
      draft: true,
      content: "Never publish this",
    }),
  ];

  test("lists only published posts in deterministic reverse chronology", () => {
    const payload = buildHeadlessBlogIndex(posts, config);

    expect(payload.apiVersion).toBe("1");
    expect(payload.count).toBe(2);
    expect(payload.posts.map((item) => item.slug)).toEqual([
      "newest",
      "2021/10/3/nested",
    ]);
    expect(payload.posts[0].date).toBe("2024-06-20");
    expect(payload.posts[0].coverUrl).toBe(
      "https://photos.victoriano.me/api/images/blog/newest/cover.jpg?v=mime-v2",
    );
    expect(payload.posts[1].canonicalUrl).toBe(
      "https://victoriano.me/blog/2021/10/3/nested",
    );
    expect(JSON.stringify(payload)).not.toContain("Secret Draft");
    expect(JSON.stringify(payload)).not.toContain("contentMarkdown");
  });

  test("returns safe HTML, absolute assets and explicit older/newer navigation", () => {
    const payload = buildHeadlessBlogPost(posts, "2021/10/3/nested", config);

    expect(payload?.post.contentHtml).toContain("<strong>Safe</strong>");
    expect(payload?.post.contentHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload?.post.contentHtml).not.toContain("<script>");
    expect(payload?.post.contentHtml).toContain(
      'href="https://photos.victoriano.me/granada"',
    );
    expect(payload?.post.contentHtml).toContain(
      'src="https://photos.victoriano.me/api/images/blog/2021/granada.jpg?v=mime-v2"',
    );
    expect(payload?.post.images).toEqual([
      "https://photos.victoriano.me/api/images/blog/2021/granada.jpg?v=mime-v2",
    ]);
    expect(payload?.navigation.newer?.slug).toBe("newest");
    expect(payload?.navigation.older).toBeNull();
  });

  test("never exposes drafts through the detail contract", () => {
    expect(buildHeadlessBlogPost(posts, "secret-draft", config)).toBeNull();
  });

  test("reports an explicit fallback when the requested edition is missing", () => {
    const payload = buildHeadlessBlogIndex([
      post({ slug: "english-only", locale: "en", title: "English only" }),
    ], config, "es");

    expect(payload.locale).toBe("es");
    expect(payload.posts[0]).toMatchObject({
      locale: "es",
      resolvedLocale: "en",
      availableLocales: ["en"],
      isFallback: true,
    });
  });

  test("accepts nested slugs but rejects traversal and malformed encoding", () => {
    expect(normalizeRequestedSlug("/2021/10/3/nested/")).toBe("2021/10/3/nested");
    expect(normalizeRequestedSlug("../private")).toBeNull();
    expect(normalizeRequestedSlug("%2E%2E/private")).toBeNull();
    expect(normalizeRequestedSlug("folder%2Fprivate")).toBeNull();
    expect(normalizeRequestedSlug("folder\\private")).toBeNull();
    expect(normalizeRequestedSlug("bad%ZZslug")).toBeNull();
  });

  test("supports stable ETags, conditional requests and public CORS", async () => {
    const payload = buildHeadlessBlogIndex(posts, config);
    const first = await headlessJsonResponse(
      new Request("https://photos.victoriano.me/api/v1/blog"),
      payload,
    );
    const etag = first.headers.get("ETag");

    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(first.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
    expect(first.headers.get("X-VictoPress-API-Version")).toBe("1");

    const conditional = await headlessJsonResponse(
      new Request("https://photos.victoriano.me/api/v1/blog", {
        headers: { "If-None-Match": etag || "" },
      }),
      payload,
    );

    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });

  test("returns an explicit CORS preflight contract", () => {
    const response = headlessCorsPreflight();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "If-None-Match",
    );
  });

  test("keeps the existing renderer same-origin unless a media origin is requested", () => {
    const local = renderMarkdown("![Photo](blog/photo.jpg)");
    const headless = renderMarkdown("![Photo](blog/photo.jpg)", {
      imageBaseUrl: "https://photos.victoriano.me",
    });

    expect(local).toContain('src="/api/images/blog/photo.jpg?v=mime-v2"');
    expect(headless).toContain(
      'src="https://photos.victoriano.me/api/images/blog/photo.jpg?v=mime-v2"',
    );
  });

  test("negotiates supported browser languages and keeps English URLs clean", () => {
    expect(parseAcceptLanguage("fr;q=1, en-US;q=0.8, es;q=0.6")).toBe("en");
    expect(parseAcceptLanguage("en;q=0.2, es-ES;q=0.9")).toBe("es");
    expect(localizedPath("en", "/es/gallery/europe?year=2024")).toBe(
      "/gallery/europe?year=2024",
    );
    expect(languageSwitchPath("en", "/es/gallery/europe?year=2024")).toBe(
      "/gallery/europe?year=2024&lang=en",
    );
    expect(languageSwitchPath("en", "/gallery/europe?year=2024")).toBe(
      "/gallery/europe?year=2024",
    );
  });
});

describe("migrated blog through the headless contract", () => {
  test("publishes all five real posts and all 24 body images in both editions", async () => {
    const storage = new LocalStorageAdapter(`${process.cwd()}/content`);
    const posts = await scanBlog(storage);
    for (const locale of ["es", "en"] as const) {
      const index = buildHeadlessBlogIndex(posts, config, locale);
      const details = index.posts.map((summary) =>
        buildHeadlessBlogPost(posts, summary.slug, config, locale),
      );
      const renderedImages = details.reduce(
        (total, detail) => total + (detail?.post.contentHtml.match(/<img\b/g)?.length || 0),
        0,
      );

      expect(index.count).toBe(5);
      expect(index.locale).toBe(locale);
      expect(index.posts.every((item) => item.resolvedLocale === locale)).toBe(true);
      expect(index.posts.every((item) => item.isFallback === false)).toBe(true);
      expect(index.posts.every((item) =>
        item.availableLocales.includes("es") && item.availableLocales.includes("en"))).toBe(true);
      const canonicalBlogPath = locale === "es" ? "/es/blog/" : "/blog/";
      expect(index.posts.every((item) => item.canonicalUrl.includes(canonicalBlogPath))).toBe(true);
      if (locale === "en") {
        expect(index.posts.every((item) => !item.canonicalUrl.includes("/en/"))).toBe(true);
      }
      expect(details.every(Boolean)).toBe(true);
      expect(renderedImages).toBe(24);
      expect(details.every((detail) =>
        !detail?.post.contentHtml.includes('src="/api/images/'))).toBe(true);
      expect(details.every((detail) =>
        !/<script\b/i.test(detail?.post.contentHtml || ""))).toBe(true);
    }
  });

  test("has complete Spanish and English editions for pages, galleries and authored photo metadata", async () => {
    const contentRoot = join(process.cwd(), "content");
    const storage = new LocalStorageAdapter(contentRoot);
    const pages = await scanPages(storage);

    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.translations?.es && page.translations?.en)).toBe(true);

    const galleryFiles: string[] = [];
    const photoFiles: string[] = [];
    async function collect(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await collect(path);
        else if (entry.name === "gallery.yaml") galleryFiles.push(path);
        else if (entry.name === "photos.yaml") photoFiles.push(path);
      }
    }
    await collect(join(contentRoot, "galleries"));
    const galleries = await Promise.all(galleryFiles.map(async (path) =>
      YAML.parse(await readFile(path, "utf8")) as {
        locale?: string;
        translations?: { es?: { title?: string } };
      }));

    expect(galleries).toHaveLength(27);
    expect(galleries.every((gallery) => gallery.locale === "en")).toBe(true);
    expect(galleries.every((gallery) => Boolean(gallery.translations?.es?.title))).toBe(true);

    const photoEntries = (await Promise.all(photoFiles.map(async (path) =>
      YAML.parse(await readFile(path, "utf8")) as Array<{
        title?: string;
        description?: string;
        locale?: string;
        translations?: { es?: { title?: string; description?: string } };
      }>))).flat();
    const authoredMetadata = photoEntries.filter((photo) => photo.title || photo.description);

    expect(authoredMetadata).toHaveLength(9);
    expect(authoredMetadata.every((photo) => photo.locale === "en")).toBe(true);
    expect(authoredMetadata.every((photo) =>
      Boolean(photo.translations?.es?.title) && Boolean(photo.translations?.es?.description))).toBe(true);

    const scannedPhotos = (await scanGalleries(storage)).flatMap((gallery) => gallery.photos);
    const photosWithPublicText = scannedPhotos.filter((photo) => photo.title || photo.description);
    expect(photosWithPublicText).toHaveLength(9);
    expect(photosWithPublicText.every((photo) =>
      Boolean(photo.translations?.es?.title) && Boolean(photo.translations?.es?.description))).toBe(true);
  });
});
