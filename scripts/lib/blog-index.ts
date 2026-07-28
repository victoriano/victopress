import type { BlogPost } from "../../app/lib/content-engine/types";
import type { PostIndexEntry } from "../../app/lib/content-engine/content-index";
import { normalizeLocale } from "../../app/lib/i18n";

function indexDate(value: BlogPost["date"]): string | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/**
 * Keep the lightweight post index aligned with the content engine. In
 * particular, every authored language edition must remain attached when the
 * blog is mirrored to R2 so the CMS can report its real translation status.
 */
export function buildBlogPostIndexEntries(posts: BlogPost[]): PostIndexEntry[] {
  return posts
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      date: indexDate(post.date),
      draft: post.draft === true,
      coverImage: post.cover,
      tags: post.tags,
      readingTime: post.readingTime || 1,
      locale: normalizeLocale(post.locale) || "en",
      translations: post.translations,
    }))
    .sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}
