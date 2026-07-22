import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";

import { AdminLayout } from "~/components/AdminLayout";
import { MarkdownEditor } from "~/components/MarkdownEditor";
import { getPageBySlug, getStorage } from "~/lib/content-engine";
import {
  localeNames,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from "~/lib/i18n";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { useSiteLanguages } from "~/hooks/useSiteLanguages";

type Edition = { title: string; description: string; content: string };

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  const slug = params.slug;
  if (!slug) throw new Response("Not Found", { status: 404 });
  const storage = getStorage(context);
  const page = await getPageBySlug(storage, slug);
  if (!page) throw new Response("Not Found", { status: 404 });
  return json({ username: await getAdminUser(request, context), page });
}

export default function AdminPageEditor() {
  const { username, page } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const siteLanguages = useSiteLanguages();
  const sourceLocale = siteLanguages.multilingual
    ? normalizeLocale(page.locale) || siteLanguages.defaultLocale
    : siteLanguages.defaultLocale;
  const initialEditions = useMemo(() => {
    const value: Record<Locale, Edition> = {
      es: { title: "", description: "", content: "" },
      en: { title: "", description: "", content: "" },
    };
    value[sourceLocale] = {
      title: page.title,
      description: page.description || "",
      content: page.content,
    };
    for (const locale of SUPPORTED_LOCALES) {
      const translation = page.translations?.[locale];
      if (translation) {
        value[locale] = {
          title: translation.title,
          description: translation.description || "",
          content: translation.content,
        };
      }
    }
    return value;
  }, [page, sourceLocale]);
  const [activeLocale, setActiveLocale] = useState<Locale>(sourceLocale);
  const [editions, setEditions] = useState(initialEditions);
  const [savedEditions, setSavedEditions] = useState(initialEditions);
  const active = editions[activeLocale];
  const hasChanges = JSON.stringify(editions) !== JSON.stringify(savedEditions);

  useEffect(() => {
    if (fetcher.data?.success) setSavedEditions(editions);
  }, [fetcher.data, editions]);

  const update = (field: keyof Edition, value: string) => {
    setEditions((current) => ({
      ...current,
      [activeLocale]: { ...current[activeLocale], [field]: value },
    }));
  };

  const save = () => {
    const formData = new FormData();
    formData.append("slug", page.slug);
    formData.append("sourceLocale", sourceLocale);
    for (const locale of SUPPORTED_LOCALES) {
      formData.append(`title_${locale}`, editions[locale].title);
      formData.append(`description_${locale}`, editions[locale].description);
      formData.append(`content_${locale}`, editions[locale].content);
    }
    fetcher.submit(formData, { method: "POST", action: "/api/admin/pages" });
  };

  return (
    <AdminLayout username={username || undefined}>
      <div className="mx-auto max-w-6xl p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/admin/pages" className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
              Pages / {page.title}
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {siteLanguages.multilingual ? "Multilingual page" : "Page"}
            </h1>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!hasChanges || fetcher.state !== "idle" || !editions[sourceLocale].title}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
          >
            {fetcher.state === "idle" ? (siteLanguages.multilingual ? "Save editions" : "Save page") : "Saving…"}
          </button>
        </div>

        {fetcher.data?.error ? (
          <p className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{fetcher.data.error}</p>
        ) : null}

        {siteLanguages.multilingual && (
        <div className="mb-5 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-950">
          <div className="flex gap-1">
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => setActiveLocale(locale)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${activeLocale === locale ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"}`}
              >
                {locale.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="px-2 text-xs text-gray-500 dark:text-gray-400">{localeNames[activeLocale]}</span>
        </div>
        )}

        <div className="space-y-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Title{siteLanguages.multilingual ? ` · ${activeLocale.toUpperCase()}` : ""}
            <input value={active.title} onChange={(event) => update("title", event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900" />
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Description{siteLanguages.multilingual ? ` · ${activeLocale.toUpperCase()}` : ""}
            <input value={active.description} onChange={(event) => update("description", event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900" />
          </label>
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Content{siteLanguages.multilingual ? ` · ${activeLocale.toUpperCase()}` : ""} ({page.isHtml ? "HTML" : "Markdown"})</p>
            {page.isHtml ? (
              <textarea value={active.content} onChange={(event) => update("content", event.target.value)} rows={24} className="w-full rounded-lg border border-gray-200 bg-white p-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-900" />
            ) : (
              <MarkdownEditor value={active.content} onChange={(value) => update("content", value)} imagePathHint={`pages/${page.slug}`} />
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
