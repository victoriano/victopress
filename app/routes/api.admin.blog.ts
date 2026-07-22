/**
 * Bilingual blog CRUD.
 *
 * The source edition remains index.md for backwards compatibility. Additional
 * editions live beside it as index.es.md or index.en.md.
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import matter from "gray-matter";
import * as yaml from "yaml";

import { checkAdminAuth } from "~/utils/admin-auth";
import {
  getStorage,
  removePostFromIndex,
  scanBlog,
  updatePostInIndex,
} from "~/lib/content-engine";
import {
  normalizeLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from "~/lib/i18n";

type BlogActionContext = ActionFunctionArgs["context"];

type EditionInput = {
  title: string;
  description: string;
  content: string;
};

export async function action({ request, context }: ActionFunctionArgs) {
  await checkAdminAuth(request, context);
  const formData = await request.formData();

  switch (formData.get("action")) {
    case "create":
      return handleCreate(formData, context);
    case "update":
      return handleUpdate(formData, context);
    case "delete":
      return handleDelete(formData, context);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function edition(formData: FormData, locale: Locale): EditionInput {
  return {
    title: text(formData, `title_${locale}`),
    description: text(formData, `description_${locale}`),
    content: text(formData, `content_${locale}`),
  };
}

function legacyEdition(formData: FormData): EditionInput {
  return {
    title: text(formData, "title"),
    description: text(formData, "description"),
    content: text(formData, "content"),
  };
}

function sharedFrontmatter(formData: FormData, existing: Record<string, unknown> = {}) {
  const next = { ...existing };
  const date = text(formData, "date");
  const author = text(formData, "author");
  const tags = text(formData, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (date) next.date = date;
  else delete next.date;
  if (author) next.author = author;
  else delete next.author;
  if (tags.length > 0) next.tags = tags;
  else delete next.tags;
  if (formData.get("draft") !== null) next.draft = formData.get("draft") === "true";
  next.format = "markdown";

  return next;
}

function serializeEdition(
  shared: Record<string, unknown>,
  slug: string,
  locale: Locale,
  value: EditionInput,
): string {
  const frontmatter: Record<string, unknown> = {
    ...shared,
    slug,
    title: value.title,
    locale,
    format: "markdown",
  };
  if (value.description) frontmatter.description = value.description;
  else delete frontmatter.description;

  return `---\n${yaml.stringify(frontmatter)}---\n\n${value.content.trim()}\n`;
}

async function updateIndex(context: BlogActionContext, slug: string) {
  const storage = getStorage(context);
  const post = (await scanBlog(storage)).find((candidate) => candidate.slug === slug);
  if (post) await updatePostInIndex(storage, post);
}

async function writeEditions(
  formData: FormData,
  context: BlogActionContext,
  slug: string,
  sourceLocale: Locale,
  shared: Record<string, unknown>,
  fallbackSource?: EditionInput,
) {
  const storage = getStorage(context);
  const postPath = `blog/${slug}`;
  const localizedEditions = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, edition(formData, locale)]),
  ) as Record<Locale, EditionInput>;

  const hasBilingualFields = SUPPORTED_LOCALES.some((locale) =>
    formData.has(`title_${locale}`) || formData.has(`content_${locale}`),
  );
  if (!hasBilingualFields) localizedEditions[sourceLocale] = legacyEdition(formData);
  if (!localizedEditions[sourceLocale].title && fallbackSource) {
    localizedEditions[sourceLocale] = fallbackSource;
  }

  const source = localizedEditions[sourceLocale];
  if (!source.title) throw new Response("The source title is required", { status: 400 });

  await storage.put(
    `${postPath}/index.md`,
    serializeEdition(shared, slug, sourceLocale, source),
    "text/markdown; charset=utf-8",
  );

  for (const locale of SUPPORTED_LOCALES) {
    const variantPath = `${postPath}/index.${locale}.md`;
    if (locale === sourceLocale) {
      if (await storage.exists(variantPath)) await storage.delete(variantPath);
      continue;
    }

    const translated = localizedEditions[locale];
    if (translated.title && translated.content) {
      await storage.put(
        variantPath,
        serializeEdition(shared, slug, locale, translated),
        "text/markdown; charset=utf-8",
      );
    } else if (await storage.exists(variantPath)) {
      await storage.delete(variantPath);
    }
  }
}

async function handleCreate(formData: FormData, context: BlogActionContext) {
  const slug = text(formData, "slug");
  const sourceLocale = normalizeLocale(formData.get("sourceLocale")) || "es";
  const source = edition(formData, sourceLocale);
  const legacy = legacyEdition(formData);

  if (!slug || !(source.title || legacy.title)) {
    return json({ success: false, error: "Slug and source title are required" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return json(
      { success: false, error: "Slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 },
    );
  }

  const storage = getStorage(context);
  const indexPath = `blog/${slug}/index.md`;
  if (await storage.exists(indexPath)) {
    return json({ success: false, error: "A post with this slug already exists" }, { status: 400 });
  }

  const shared = sharedFrontmatter(formData, {
    date: text(formData, "date") || new Date().toISOString().slice(0, 10),
    draft: formData.get("draft") === null ? true : formData.get("draft") === "true",
  });

  await writeEditions(formData, context, slug, sourceLocale, shared, legacy);
  await updateIndex(context, slug);

  return json({ success: true, message: "Blog post created", slug });
}

async function handleUpdate(formData: FormData, context: BlogActionContext) {
  const slug = text(formData, "slug");
  if (!slug) {
    return json({ success: false, error: "Slug is required" }, { status: 400 });
  }

  const storage = getStorage(context);
  const indexPath = `blog/${slug}/index.md`;
  const existingContent = await storage.getText(indexPath);
  if (!existingContent) {
    return json({ success: false, error: "Post not found" }, { status: 404 });
  }

  const parsed = matter(existingContent);
  const sourceLocale =
    normalizeLocale(formData.get("sourceLocale")) ||
    normalizeLocale(parsed.data.locale) ||
    "es";
  const fallbackSource: EditionInput = {
    title: String(parsed.data.title || "Untitled"),
    description: String(parsed.data.description || ""),
    content: parsed.content.trim(),
  };
  const shared = sharedFrontmatter(formData, parsed.data as Record<string, unknown>);

  await writeEditions(formData, context, slug, sourceLocale, shared, fallbackSource);
  await updateIndex(context, slug);

  return json({ success: true, message: "Blog post updated", slug });
}

async function handleDelete(formData: FormData, context: BlogActionContext) {
  const slug = text(formData, "slug");
  if (!slug) {
    return json({ success: false, error: "Slug is required" }, { status: 400 });
  }

  const storage = getStorage(context);
  const postPath = `blog/${slug}`;
  if (!(await storage.exists(`${postPath}/index.md`))) {
    return json({ success: false, error: "Post not found" }, { status: 404 });
  }

  await storage.deleteDirectory(postPath);
  await removePostFromIndex(storage, slug);
  return json({ success: true, message: "Blog post deleted", slug });
}
