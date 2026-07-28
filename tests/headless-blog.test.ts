import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { BlogPost, StorageAdapter } from "../app/lib/content-engine";
import { LocalStorageAdapter, scanBlog, scanGalleries, scanPages } from "../app/lib/content-engine";
import {
  blogPostsFromIndexEntries,
  buildBlogPostIndexEntries,
} from "../app/lib/content-engine/blog-index";
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
import { loadHeadlessBlogPosts } from "../app/lib/headless-blog-storage.server";

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
  test("serves a hydrated blog index without scanning every Markdown file", async () => {
    const source = post({
      id: "fast-index",
      slug: "fast-index",
      title: "Fast index",
      path: "blog/fast-index",
      content: "English body",
      excerpt: "English excerpt",
      date: new Date("2026-07-28T00:00:00.000Z"),
      author: "Victoriano Izquierdo",
      sourceUrl: "https://example.com/source",
      cover: "blog/fast-index/cover.jpg",
      coverInBody: true,
      images: ["blog/fast-index/cover.jpg"],
      locale: "en",
      translations: {
        en: {
          locale: "en",
          title: "Fast index",
          content: "English body",
          excerpt: "English excerpt",
          readingTime: 1,
          format: "markdown",
          path: "blog/fast-index",
        },
        es: {
          locale: "es",
          title: "Índice rápido",
          content: "Cuerpo español",
          excerpt: "Extracto español",
          readingTime: 1,
          format: "markdown",
          path: "blog/fast-index/index.es.md",
        },
      },
    });
    const indexedPosts = buildBlogPostIndexEntries([source]);
    let scannedFiles = false;
    const storage = {
      getText: async (key: string) => key === "_content-index.json"
        ? JSON.stringify({
            version: 10,
            updatedAt: "2026-07-28T00:00:00.000Z",
            galleries: [],
            galleryData: [],
            posts: indexedPosts,
            pages: [],
            parentMetadata: [],
            featuredPhotos: [],
            stats: {
              totalGalleries: 0,
              totalPhotos: 0,
              totalPosts: 1,
              totalPages: 0,
            },
          })
        : null,
      listRecursive: async () => {
        scannedFiles = true;
        throw new Error("The hydrated index should avoid a recursive scan");
      },
    } as unknown as StorageAdapter;

    const loaded = await loadHeadlessBlogPosts(storage);
    const spanish = buildHeadlessBlogPost(loaded, source.slug, config, "es");

    expect(scannedFiles).toBe(false);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].author).toBe(source.author);
    expect(loaded[0].sourceUrl).toBe(source.sourceUrl);
    expect(loaded[0].coverInBody).toBe(true);
    expect(loaded[0].images).toEqual(source.images);
    expect(spanish?.post.title).toBe("Índice rápido");
    expect(spanish?.post.contentMarkdown).toBe("Cuerpo español");
    expect(spanish?.post.isFallback).toBe(false);
  });

  test("publishes all five Squarespace posts with every localized body image", async () => {
    const storage = new LocalStorageAdapter(`${process.cwd()}/content`);
    const posts = await scanBlog(storage);
    const migration = JSON.parse(
      await readFile(join(process.cwd(), "content/blog/_migration-manifest.json"), "utf8"),
    ) as { posts: Array<{ slug: string }> };
    const migratedSlugs = new Set(migration.posts.map((post) => post.slug));
    for (const locale of ["es", "en"] as const) {
      const index = buildHeadlessBlogIndex(posts, config, locale);
      const migratedPosts = index.posts.filter((summary) => migratedSlugs.has(summary.slug));
      const details = migratedPosts.map((summary) =>
        buildHeadlessBlogPost(posts, summary.slug, config, locale),
      );
      const renderedImages = details.reduce(
        (total, detail) => total + (detail?.post.contentHtml.match(/<img\b/g)?.length || 0),
        0,
      );

      expect(migratedPosts).toHaveLength(5);
      expect(index.locale).toBe(locale);
      expect(migratedPosts.every((item) => item.resolvedLocale === locale)).toBe(true);
      expect(migratedPosts.every((item) => item.isFallback === false)).toBe(true);
      expect(migratedPosts.every((item) =>
        item.availableLocales.includes("es") && item.availableLocales.includes("en"))).toBe(true);
      const canonicalBlogPath = locale === "es" ? "/es/blog/" : "/blog/";
      expect(migratedPosts.every((item) => item.canonicalUrl.includes(canonicalBlogPath))).toBe(true);
      if (locale === "en") {
        expect(migratedPosts.every((item) => !item.canonicalUrl.includes("/en/"))).toBe(true);
      }
      expect(details.every(Boolean)).toBe(true);
      expect(renderedImages).toBe(locale === "es" ? 33 : 24);
      expect(details.every((detail) =>
        !detail?.post.contentHtml.includes('src="/api/images/'))).toBe(true);
      expect(details.every((detail) =>
        !/<script\b/i.test(detail?.post.contentHtml || ""))).toBe(true);
    }
  });

  test("publishes every Notion Posted row on its source date and keeps imported drafts private", async () => {
    const storage = new LocalStorageAdapter(`${process.cwd()}/content`);
    const posts = await scanBlog(storage);
    const published = buildHeadlessBlogIndex(posts, config);
    const postedImport = JSON.parse(
      await readFile(
        join(process.cwd(), "content/blog/_notion-posted-import-manifest.json"),
        "utf8",
      ),
    ) as { posts: Array<{ date: string; target: string; removed?: boolean }> };
    const draftImport = JSON.parse(
      await readFile(join(process.cwd(), "content/blog/_notion-import-manifest.json"), "utf8"),
    ) as { posts: Array<{ target: string }> };
    const bySlug = new Map(published.posts.map((post) => [post.slug, post]));

    expect(postedImport.posts).toHaveLength(20);
    const activePostedImports = postedImport.posts.filter((post) => !post.removed);
    expect(activePostedImports).toHaveLength(19);
    for (const post of activePostedImports) {
      const slug = post.target.replace(/^blog\//, "").replace(/\/index\.md$/, "");
      expect(bySlug.get(slug)?.date).toBe(post.date);
    }
    for (const post of postedImport.posts.filter((candidate) => candidate.removed)) {
      const slug = post.target.replace(/^blog\//, "").replace(/\/index\.md$/, "");
      expect(bySlug.has(slug)).toBe(false);
    }
    for (const post of draftImport.posts) {
      const slug = post.target.replace(/^blog\//, "").replace(/\/index\.md$/, "");
      expect(bySlug.has(slug)).toBe(false);
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

    expect(galleries).toHaveLength(31);
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

  test("has complete Spanish and English editions for every blog post", async () => {
    const storage = new LocalStorageAdapter(join(process.cwd(), "content"));
    const posts = await scanBlog(storage);
    const indexedPosts = buildBlogPostIndexEntries(posts);
    const rehydratedPosts = blogPostsFromIndexEntries(indexedPosts);

    expect(posts).toHaveLength(29);
    expect(indexedPosts).toHaveLength(posts.length);
    expect(rehydratedPosts).toHaveLength(posts.length);
    for (const post of posts) {
      expect(post.translations?.es, `${post.slug} is missing Spanish`).toBeTruthy();
      expect(post.translations?.en, `${post.slug} is missing English`).toBeTruthy();
    }
    for (const post of indexedPosts) {
      expect(post.translations?.es, `${post.slug} lost Spanish in the CMS index`).toBeTruthy();
      expect(post.translations?.en, `${post.slug} lost English in the CMS index`).toBeTruthy();
    }
    for (const rehydrated of rehydratedPosts) {
      const source = posts.find((post) => post.slug === rehydrated.slug);
      expect(rehydrated.author).toBe(source?.author);
      expect(rehydrated.sourceUrl).toBe(source?.sourceUrl);
      expect(rehydrated.coverInBody).toBe(source?.coverInBody === true);
      expect(rehydrated.images).toEqual(source?.images);
      expect(rehydrated.content).toBe(source?.content);
    }

    for (const locale of ["es", "en"] as const) {
      const index = buildHeadlessBlogIndex(posts, config, locale);
      expect(index.posts).toHaveLength(posts.filter((post) => !post.draft).length);
      expect(index.posts.every((post) => post.resolvedLocale === locale)).toBe(true);
      expect(index.posts.every((post) => post.isFallback === false)).toBe(true);
      expect(index.posts.every((post) =>
        post.availableLocales.includes("es") && post.availableLocales.includes("en"))).toBe(true);
    }
  });
});
