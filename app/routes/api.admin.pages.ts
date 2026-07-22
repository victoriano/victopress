import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import matter from "gray-matter";
import * as yaml from "yaml";

import { getPageBySlug, getStorage, scanPages, updatePageInIndex } from "~/lib/content-engine";
import { normalizeLocale, SUPPORTED_LOCALES, type Locale } from "~/lib/i18n";
import { checkAdminAuth } from "~/utils/admin-auth";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function action({ request, context }: ActionFunctionArgs) {
  await checkAdminAuth(request, context);
  const formData = await request.formData();
  const slug = value(formData, "slug");
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return json({ success: false, error: "Invalid page slug" }, { status: 400 });
  }

  const storage = getStorage(context);
  const page = await getPageBySlug(storage, slug);
  if (!page) return json({ success: false, error: "Page not found" }, { status: 404 });
  const sourceLocale = normalizeLocale(formData.get("sourceLocale")) || normalizeLocale(page.locale) || "en";
  const extension = page.isHtml ? "html" : "md";
  const basePath = `pages/${slug}/index.${extension}`;
  const existing = await storage.getText(basePath);
  const shared = existing?.startsWith("---") ? matter(existing).data : {};

  for (const locale of SUPPORTED_LOCALES) {
    const title = value(formData, `title_${locale}`);
    const description = value(formData, `description_${locale}`);
    const content = value(formData, `content_${locale}`);
    const path = locale === sourceLocale
      ? basePath
      : `pages/${slug}/index.${locale}.${extension}`;

    if (!title || !content) {
      if (locale !== sourceLocale && await storage.exists(path)) await storage.delete(path);
      continue;
    }

    const frontmatter: Record<string, unknown> = {
      ...shared,
      title,
      locale,
    };
    if (description) frontmatter.description = description;
    else delete frontmatter.description;
    await storage.put(
      path,
      `---\n${yaml.stringify(frontmatter)}---\n${content}\n`,
      "text/plain; charset=utf-8",
    );
  }

  const pageConfigPath = `pages/${slug}/page.yaml`;
  let pageConfig: Record<string, unknown> = {};
  const existingPageConfig = await storage.getText(pageConfigPath);
  if (existingPageConfig) {
    try {
      pageConfig = yaml.parse(existingPageConfig) || {};
    } catch {
      pageConfig = {};
    }
  }
  pageConfig.sourceLocale = sourceLocale;
  await storage.put(pageConfigPath, yaml.stringify(pageConfig), "text/yaml");

  const updated = (await scanPages(storage)).find((candidate) => candidate.slug === slug);
  if (updated) await updatePageInIndex(storage, updated);
  return json({ success: true, message: "Page editions updated" });
}
