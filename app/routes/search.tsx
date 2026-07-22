import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { Layout } from "~/components/Layout";
import { getNavigationFromIndex, getStorage } from "~/lib/content-engine";
import { isPhotoAiEnabled } from "~/lib/ai/photo-ai-service.server";
import { localizedPath, photoMessages, type Locale } from "~/lib/i18n";
import { requireRouteLocale } from "~/lib/i18n.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";

export { mergeLocalizedRouteHeaders as headers } from "~/lib/i18n.server";

interface SearchPhoto {
  assetId: string;
  path: string;
  filename: string;
  title?: string;
  caption?: string;
  gallerySlug: string;
  galleryTitle: string;
  score: number;
  thumbnailUrl: string;
  href: string;
  tags?: string[];
}

interface SearchGallery {
  slug: string;
  title: string;
  count?: number;
}

interface SearchResponse {
  query: string;
  photos: SearchPhoto[];
  galleries: SearchGallery[];
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const locale = data?.locale || "es";
  const messages = photoMessages[locale];
  return [
  { title: `${messages.search} — Victoriano Izquierdo` },
  {
    name: "description",
    content: messages.searchMetaDescription,
  },
  { name: "robots", content: "noindex,follow" },
  ];
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  if (!isPhotoAiEnabled(context)) {
    throw new Response("Not Found", { status: 404 });
  }
  const storage = getStorage(context, request);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const locale = requireRouteLocale(request, params.locale, siteLanguages);
  const navigation = await getNavigationFromIndex(storage, locale);

  return json({
    navigation,
    siteName: "Victoriano Izquierdo",
    locale,
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchPhoto(value: unknown): value is SearchPhoto {
  if (!isObject(value)) return false;
  return (
    typeof value.assetId === "string" &&
    typeof value.path === "string" &&
    typeof value.filename === "string" &&
    typeof value.gallerySlug === "string" &&
    typeof value.galleryTitle === "string" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    typeof value.thumbnailUrl === "string" &&
    typeof value.href === "string" &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.caption === undefined || typeof value.caption === "string") &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")))
  );
}

function isSearchGallery(value: unknown): value is SearchGallery {
  return (
    isObject(value) &&
    typeof value.slug === "string" &&
    typeof value.title === "string" &&
    (value.count === undefined ||
      (typeof value.count === "number" && Number.isFinite(value.count)))
  );
}

function parseSearchResponse(value: unknown, locale: Locale): SearchResponse {
  if (
    !isObject(value) ||
    typeof value.query !== "string" ||
    !Array.isArray(value.photos) ||
    !value.photos.every(isSearchPhoto) ||
    !Array.isArray(value.galleries) ||
    !value.galleries.every(isSearchGallery)
  ) {
    throw new Error(photoMessages[locale].unexpectedSearchResponse);
  }

  return {
    query: value.query,
    photos: value.photos,
    galleries: value.galleries,
  };
}

async function readError(response: Response, locale: Locale): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObject(body)) {
      if (typeof body.error === "string" && body.error.trim()) return body.error;
      if (typeof body.message === "string" && body.message.trim()) return body.message;
    }
  } catch {
    // Use the status fallback below.
  }
  return `${photoMessages[locale].searchUnavailable} (${response.status})`;
}

export default function SearchPage() {
  const { navigation, siteName, socialLinks, locale } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const gallery = (searchParams.get("gallery") ?? "").trim();
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const messages = photoMessages[locale];

  useEffect(() => {
    if (!query) {
      setResults(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const parameters = new URLSearchParams({ q: query, limit: "40", locale });
    if (gallery) parameters.set("gallery", gallery);

    setIsLoading(true);
    setError(null);
    setResults(null);

    void fetch(`/api/photos/search?${parameters.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, locale));
        return parseSearchResponse(await response.json(), locale);
      })
      .then((data) => {
        if (!controller.signal.aborted) setResults(data);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : messages.searchUnavailable);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [gallery, locale, messages.searchUnavailable, query, retryCount]);

  const galleryOptions = results?.galleries ?? [];
  const selectedGalleryIsKnown = galleryOptions.some((item) => item.slug === gallery);
  const formKey = `${query}\u0000${gallery}\u0000${galleryOptions
    .map((item) => item.slug)
    .join("\u0001")}`;

  return (
    <Layout navigation={navigation} siteName={siteName} socialLinks={socialLinks} locale={locale}>
      <GalleryBreadcrumb navigation={navigation} locale={locale} />

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-black dark:text-white sm:text-4xl">
            {messages.searchTitle}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400 sm:text-base">
            {messages.searchDescription}
          </p>
        </header>

        <Form
          key={formKey}
          method="get"
          action={localizedPath(locale, "/search")}
          role="search"
          className="mb-10 grid gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto]"
        >
          <div>
            <label htmlFor="photo-search-query" className="sr-only">
              {messages.searchLabel}
            </label>
            <input
              id="photo-search-query"
              name="q"
              type="search"
              required
              maxLength={300}
              defaultValue={query}
              placeholder={messages.searchPlaceholder}
              className="h-11 w-full rounded-md border border-gray-200 bg-white px-4 text-sm text-black outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-gray-500 dark:focus:ring-gray-800"
            />
          </div>

          <div>
            <label htmlFor="photo-search-gallery" className="sr-only">
              {messages.galleryLimit}
            </label>
            <select
              id="photo-search-gallery"
              name="gallery"
              defaultValue={gallery}
              className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:focus:border-gray-500 dark:focus:ring-gray-800"
            >
              <option value="">{messages.allGalleries}</option>
              {gallery && !selectedGalleryIsKnown && (
                <option value={gallery}>{gallery}</option>
              )}
              {galleryOptions.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.title}{item.count === undefined ? "" : ` (${item.count})`}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="h-11 rounded-md bg-black px-6 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:focus:ring-offset-gray-950"
          >
            {messages.search}
          </button>
        </Form>

        <p className="sr-only" aria-live="polite">
          {isLoading
            ? messages.searchingArchive
            : error
              ? `${messages.searchFailed}: ${error}`
              : results
                ? `${results.photos.length} ${results.photos.length === 1 ? messages.photograph : messages.photographs}.`
                : ""}
        </p>

        <div aria-busy={isLoading}>
          {!query && (
            <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">
              {messages.searchPrompt}
            </p>
          )}

          {isLoading && (
            <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
              {messages.searchingArchive}
            </div>
          )}

          {error && !isLoading && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
              <button
                type="button"
                onClick={() => setRetryCount((value) => value + 1)}
                className="mt-4 text-sm font-medium text-black underline underline-offset-4 dark:text-white"
              >
                {messages.tryAgain}
              </button>
            </div>
          )}

          {results && !isLoading && !error && results.photos.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {messages.noMatches} “{query}”.
              </p>
              {gallery && (
                <Link
                  to={`${localizedPath(locale, "/search")}?${new URLSearchParams({ q: query }).toString()}`}
                  className="mt-4 inline-block text-sm font-medium text-black underline underline-offset-4 dark:text-white"
                >
                  {messages.searchAllGalleries}
                </Link>
              )}
            </div>
          )}

          {results && results.photos.length > 0 && !isLoading && !error && (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {results.photos.length} {results.photos.length === 1 ? messages.photograph : messages.photographs}
                  {gallery ? ` ${messages.inThisGallery}` : ""}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {results.photos.map((photo) => (
                  <SearchResultCard key={`${photo.assetId}:${photo.path}`} photo={photo} locale={locale} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}

function SearchResultCard({ photo, locale }: { photo: SearchPhoto; locale: Locale }) {
  const label = photo.title?.trim() || photo.caption?.trim() || photo.filename;
  const visibleTags = photo.tags?.filter(Boolean).slice(0, 3) ?? [];

  return (
    <article className="min-w-0">
      <Link
        to={localizedPath(locale, photo.href)}
        prefetch="intent"
        className="group block overflow-hidden bg-gray-100 dark:bg-gray-900"
      >
        <div className="aspect-[4/3] overflow-hidden">
          <img
            src={photo.thumbnailUrl}
            alt={label}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>
      </Link>

      <div className="pt-3">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h2 className="truncate text-sm font-medium text-black dark:text-white">
            <Link to={localizedPath(locale, photo.href)}>{label}</Link>
          </h2>
          <Link
            to={localizedPath(locale, `/gallery/${photo.gallerySlug}`)}
            className="shrink-0 text-xs text-gray-400 transition hover:text-black dark:hover:text-white"
          >
            {photo.galleryTitle}
          </Link>
        </div>

        {photo.caption && photo.caption.trim() !== label && (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {photo.caption}
          </p>
        )}

        {visibleTags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-2 text-[11px] text-gray-400 dark:text-gray-500" aria-label={photoMessages[locale].tags}>
            {visibleTags.map((tag) => (
              <li key={tag}>#{tag}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
