import type { Locale } from "../i18n";
import { normalizeLocale } from "../i18n";
import type { PostIndexEntry } from "./content-index";
import type { BlogPost, BlogPostTranslation } from "./types";
import { normalizeBlogCategories } from "../blog-categories";

function indexDate(value: BlogPost["date"]): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function postDate(value: PostIndexEntry["date"]): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function sourceTranslation(
  entry: PostIndexEntry,
  locale: Locale,
): BlogPostTranslation | undefined {
  return entry.translations?.[locale] ||
    Object.values(entry.translations || {}).find(
      (translation): translation is BlogPostTranslation => Boolean(translation),
    );
}

export function blogPostToIndexEntry(post: BlogPost): PostIndexEntry {
  return {
    slug: post.slug,
    title: post.title,
    description: post.description,
    excerpt: post.excerpt,
    date: indexDate(post.date),
    draft: post.draft === true,
    coverImage: post.cover,
    coverInBody: post.coverInBody === true,
    tags: post.tags,
    categories: normalizeBlogCategories(post.categories),
    readingTime: post.readingTime || 1,
    author: post.author,
    sourceUrl: post.sourceUrl,
    format: post.format === "html" ? "html" : "markdown",
    path: post.path,
    images: post.images,
    hasFrontmatter: post.hasFrontmatter,
    locale: normalizeLocale(post.locale) || "en",
    translations: post.translations,
  };
}

export function buildBlogPostIndexEntries(posts: readonly BlogPost[]): PostIndexEntry[] {
  return posts
    .map(blogPostToIndexEntry)
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}

/**
 * A hydrated post index contains everything required by the public blog API.
 * Older indexes remain valid for the CMS, but the API must fall back to a full
 * scan rather than silently lose article bodies or editorial metadata.
 */
export function isHydratedBlogPostIndex(entries: readonly PostIndexEntry[]): boolean {
  return entries.every((entry) => {
    const locale = normalizeLocale(entry.locale) || "en";
    const translation = sourceTranslation(entry, locale);
    return (
      typeof entry.path === "string" &&
      Array.isArray(entry.images) &&
      Boolean(
        translation &&
        typeof translation.content === "string" &&
        typeof translation.path === "string",
      )
    );
  });
}

export function blogPostFromIndexEntry(entry: PostIndexEntry): BlogPost {
  const locale = normalizeLocale(entry.locale) || "en";
  const translation = sourceTranslation(entry, locale);

  return {
    id: entry.slug,
    slug: entry.slug,
    title: entry.title,
    path: entry.path || translation?.path || `blog/${entry.slug}`,
    content: translation?.content ?? "",
    excerpt: entry.excerpt ?? translation?.excerpt ?? entry.description ?? "",
    readingTime: entry.readingTime || translation?.readingTime || 1,
    images: [...(entry.images || [])],
    hasFrontmatter: entry.hasFrontmatter !== false,
    date: postDate(entry.date),
    description: entry.description ?? translation?.description,
    tags: entry.tags ?? translation?.tags,
    categories: normalizeBlogCategories(entry.categories),
    draft: entry.draft,
    cover: entry.coverImage,
    coverInBody: entry.coverInBody === true,
    format: entry.format || translation?.format || "markdown",
    sourceUrl: entry.sourceUrl,
    author: entry.author,
    locale,
    translations: entry.translations,
  };
}

export function blogPostsFromIndexEntries(
  entries: readonly PostIndexEntry[],
): BlogPost[] {
  return entries.map(blogPostFromIndexEntry);
}
