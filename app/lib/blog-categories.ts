export const BLOG_CATEGORIES = [
  "photos",
  "data",
  "product",
  "business",
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

const BLOG_CATEGORY_SET = new Set<string>(BLOG_CATEGORIES);

export function normalizeBlogCategory(value: unknown): BlogCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return BLOG_CATEGORY_SET.has(normalized)
    ? (normalized as BlogCategory)
    : null;
}

export function normalizeBlogCategories(value: unknown): BlogCategory[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const selected = new Set(
    candidates
      .map(normalizeBlogCategory)
      .filter((category): category is BlogCategory => Boolean(category)),
  );

  return BLOG_CATEGORIES.filter((category) => selected.has(category));
}

export function filterPostsByBlogCategory<
  T extends { categories?: readonly unknown[] },
>(posts: readonly T[], category: BlogCategory | null): T[] {
  if (!category) return [...posts];
  return posts.filter((post) =>
    normalizeBlogCategories(post.categories).includes(category),
  );
}
