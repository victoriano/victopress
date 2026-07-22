import type { BlogPost } from "~/lib/content-engine";
import { localizeBlogPost } from "~/lib/content-engine";
import { buildLocalizedBlogUrl, buildPublicBlogPostUrl } from "~/lib/blog-urls";
import { renderMarkdown, resolveMarkdownImageUrl } from "~/lib/markdown";
import { type Locale } from "~/lib/i18n";

export { buildPublicBlogPostUrl } from "~/lib/blog-urls";

export const HEADLESS_BLOG_API_VERSION = "1" as const;

export interface HeadlessBlogConfig {
  siteName: string;
  publicBlogUrl: string;
  publicMediaUrl: string;
}

export interface HeadlessBlogSummary {
  slug: string;
  title: string;
  date: string | null;
  excerpt: string;
  readingTime: number;
  tags: string[];
  coverUrl: string | null;
  canonicalUrl: string;
  locale: Locale;
  resolvedLocale: Locale;
  availableLocales: Locale[];
  isFallback: boolean;
  alternateUrls: Record<Locale, string>;
}

export interface HeadlessBlogPost extends HeadlessBlogSummary {
  author: string | null;
  sourceUrl: string | null;
  coverInBody: boolean;
  format: "markdown" | "html";
  contentMarkdown: string;
  contentHtml: string;
  images: string[];
}

export interface HeadlessBlogIndexResponse {
  apiVersion: typeof HEADLESS_BLOG_API_VERSION;
  site: {
    name: string;
    blogUrl: string;
  };
  locale: Locale;
  count: number;
  posts: HeadlessBlogSummary[];
}

export interface HeadlessBlogPostResponse {
  apiVersion: typeof HEADLESS_BLOG_API_VERSION;
  post: HeadlessBlogPost;
  navigation: {
    newer: HeadlessBlogSummary | null;
    older: HeadlessBlogSummary | null;
  };
}

export interface HeadlessBlogErrorResponse {
  apiVersion: typeof HEADLESS_BLOG_API_VERSION;
  error: {
    code: "BAD_SLUG" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL_ERROR";
    message: string;
  };
}

type EnvironmentRecord = Record<string, unknown>;

function readEnvironment(context: unknown): EnvironmentRecord {
  if (!context || typeof context !== "object") return {};
  const cloudflare = (context as { cloudflare?: unknown }).cloudflare;
  if (!cloudflare || typeof cloudflare !== "object") return {};
  const env = (cloudflare as { env?: unknown }).env;
  return env && typeof env === "object" ? env as EnvironmentRecord : {};
}

function setting(env: EnvironmentRecord, name: string): string | null {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeHttpUrl(value: string | null, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function resolveHeadlessBlogConfig(
  context: unknown,
  request: Request,
): HeadlessBlogConfig {
  const env = readEnvironment(context);
  const requestOrigin = new URL(request.url).origin;

  return {
    siteName: setting(env, "BLOG_SITE_NAME") || "Victoriano Izquierdo",
    publicBlogUrl: safeHttpUrl(
      setting(env, "PUBLIC_BLOG_URL"),
      "https://victoriano.me/blog",
    ),
    publicMediaUrl: safeHttpUrl(
      setting(env, "PUBLIC_MEDIA_URL"),
      requestOrigin,
    ),
  };
}

function absoluteMediaUrl(path: string | undefined, config: HeadlessBlogConfig): string | null {
  if (!path) return null;
  return resolveMarkdownImageUrl(path, { imageBaseUrl: config.publicMediaUrl });
}

function isoDate(value: Date | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function summaryFor(
  post: BlogPost,
  config: HeadlessBlogConfig,
  locale?: Locale,
): HeadlessBlogSummary {
  const localizedPost = locale ? localizeBlogPost(post, locale) : localizeBlogPost(post, "en");
  return {
    slug: post.slug,
    title: localizedPost.title,
    date: isoDate(post.date),
    excerpt: localizedPost.excerpt || localizedPost.description || "",
    readingTime: Math.max(1, localizedPost.readingTime || 1),
    tags: [...(localizedPost.tags || [])],
    coverUrl: absoluteMediaUrl(post.cover, config),
    canonicalUrl: buildPublicBlogPostUrl(post.slug, config, locale),
    locale: locale || "en",
    resolvedLocale: localizedPost.resolvedLocale,
    availableLocales: localizedPost.availableLocales,
    isFallback: localizedPost.isFallback,
    alternateUrls: {
      es: buildPublicBlogPostUrl(post.slug, config, "es"),
      en: buildPublicBlogPostUrl(post.slug, config, "en"),
    },
  };
}

export function sortPublishedPosts(posts: readonly BlogPost[]): BlogPost[] {
  return posts
    .filter((post) => !post.draft)
    .sort((left, right) => {
      const leftTime = left.date?.getTime() || 0;
      const rightTime = right.date?.getTime() || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.slug.localeCompare(right.slug);
    });
}

export function buildHeadlessBlogIndex(
  posts: readonly BlogPost[],
  config: HeadlessBlogConfig,
  locale?: Locale,
): HeadlessBlogIndexResponse {
  const requestedLocale = locale || "en";
  const summaries = sortPublishedPosts(posts).map((post) =>
    summaryFor(post, config, locale),
  );

  return {
    apiVersion: HEADLESS_BLOG_API_VERSION,
    site: {
      name: config.siteName,
      blogUrl: locale
        ? buildLocalizedBlogUrl(config.publicBlogUrl, locale)
        : config.publicBlogUrl,
    },
    locale: requestedLocale,
    count: summaries.length,
    posts: summaries,
  };
}

export function normalizeRequestedSlug(value: string | undefined): string | null {
  if (!value) return null;

  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("\\") || normalized.includes("\0")) return null;

  try {
    const segments = normalized.split("/").map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0"))) {
      return null;
    }
    return segments.join("/");
  } catch {
    return null;
  }
}

export function buildHeadlessBlogPost(
  posts: readonly BlogPost[],
  requestedSlug: string,
  config: HeadlessBlogConfig,
  locale?: Locale,
): HeadlessBlogPostResponse | null {
  const publishedPosts = sortPublishedPosts(posts);
  const postIndex = publishedPosts.findIndex((post) => post.slug === requestedSlug);
  if (postIndex < 0) return null;

  const post = publishedPosts[postIndex];
  const localizedPost = localizeBlogPost(post, locale || "en");
  const base = summaryFor(post, config, locale);
  const format = localizedPost.format === "html" ? "html" : "markdown";

  return {
    apiVersion: HEADLESS_BLOG_API_VERSION,
    post: {
      ...base,
      author: post.author || null,
      sourceUrl: post.sourceUrl || null,
      coverInBody: post.coverInBody === true,
      format,
      contentMarkdown: localizedPost.content,
      // Raw HTML is deliberately passed through the Markdown renderer too.
      // Its HTML hook escapes markup, so the public API never returns executable
      // content even for an old installation that still labels a post as HTML.
      contentHtml: renderMarkdown(localizedPost.content, {
        imageBaseUrl: config.publicMediaUrl,
        linkBaseUrl: config.publicMediaUrl,
      }),
      images: post.images
        .map((image) => absoluteMediaUrl(image, config))
        .filter((image): image is string => Boolean(image)),
    },
    navigation: {
      newer: postIndex > 0 ? summaryFor(publishedPosts[postIndex - 1], config, locale) : null,
      older: postIndex < publishedPosts.length - 1
        ? summaryFor(publishedPosts[postIndex + 1], config, locale)
        : null,
    },
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function responseEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${bytesToHex(new Uint8Array(digest)).slice(0, 32)}"`;
}

export async function headlessJsonResponse(
  request: Request,
  payload: HeadlessBlogIndexResponse | HeadlessBlogPostResponse | HeadlessBlogErrorResponse,
  options: {
    status?: number;
    cacheControl?: string;
    conditional?: boolean;
    locale?: Locale;
  } = {},
): Promise<Response> {
  const status = options.status || 200;
  const body = JSON.stringify(payload);
  const etag = await responseEtag(body);
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, X-VictoPress-API-Version",
    "Cache-Control": options.cacheControl || "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    "Content-Type": "application/json; charset=utf-8",
    "ETag": etag,
    "Vary": "Accept-Encoding, Accept-Language",
    "X-Content-Type-Options": "nosniff",
    "X-VictoPress-API-Version": HEADLESS_BLOG_API_VERSION,
  });
  if (options.locale) headers.set("Content-Language", options.locale);

  if (options.conditional !== false && status === 200 && request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { status, headers });
}

export function headlessCorsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
      "X-VictoPress-API-Version": HEADLESS_BLOG_API_VERSION,
    },
  });
}

export function headlessError(
  code: HeadlessBlogErrorResponse["error"]["code"],
  message: string,
): HeadlessBlogErrorResponse {
  return {
    apiVersion: HEADLESS_BLOG_API_VERSION,
    error: { code, message },
  };
}
