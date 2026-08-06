import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExplorePhotoGraph,
  type ExploreMapData,
  type ExploreMapNode,
} from "~/components/ExplorePhotoGraph";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { Layout } from "~/components/Layout";
import { captureAnalyticsEvent } from "~/lib/analytics";
import { isPhotoAiEnabled } from "~/lib/ai/photo-ai-service.server";
import { getNavigationFromIndex, getStorage } from "~/lib/content-engine";
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

type ExploreView = "graph" | "grid";

const GRID_PAGE_SIZE = 48;
const COLLAPSED_FILTER_COUNT = 12;
const EXPANDED_FILTER_COUNT = 60;

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const locale = data?.locale || "es";
  const messages = photoMessages[locale];
  return [
    { title: `${messages.explore} — Victoriano Izquierdo` },
    { name: "description", content: messages.exploreMetaDescription },
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
  const url = new URL(request.url);
  if (url.pathname === "/search" || url.pathname.endsWith("/search")) {
    throw redirect(`${localizedPath(locale, "/explore")}${url.search}`, 301);
  }
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
    (value.tags === undefined || isStringArray(value.tags))
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
  return { query: value.query, photos: value.photos, galleries: value.galleries };
}

function isExploreNode(value: unknown): value is ExploreMapNode {
  if (!isObject(value)) return false;
  return (
    typeof value.assetId === "string" &&
    typeof value.path === "string" &&
    typeof value.filename === "string" &&
    typeof value.caption === "string" &&
    isStringArray(value.tags) &&
    typeof value.gallerySlug === "string" &&
    isStringArray(value.gallerySlugs) &&
    (value.title === undefined || typeof value.title === "string") &&
    typeof value.galleryTitle === "string" &&
    isStringArray(value.galleryTitles) &&
    typeof value.thumbnailUrl === "string" &&
    typeof value.href === "string" &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.clusterId === "number" && Number.isFinite(value.clusterId)
  );
}

function parseExploreResponse(value: unknown, locale: Locale): ExploreMapData {
  if (
    !isObject(value) ||
    !Array.isArray(value.nodes) || !value.nodes.every(isExploreNode) ||
    !Array.isArray(value.edges) || !value.edges.every((edge) =>
      isObject(edge) && typeof edge.source === "string" && typeof edge.target === "string") ||
    !Array.isArray(value.clusters) || !value.clusters.every((cluster) =>
      isObject(cluster) &&
      typeof cluster.id === "number" &&
      typeof cluster.label === "string" &&
      typeof cluster.count === "number" &&
      typeof cluster.x === "number" &&
      typeof cluster.y === "number") ||
    !isStringArray(value.tags) ||
    !Array.isArray(value.galleries) || !value.galleries.every(isSearchGallery)
  ) {
    throw new Error(photoMessages[locale].unexpectedExploreResponse);
  }
  return value as unknown as ExploreMapData;
}

async function readError(
  response: Response,
  locale: Locale,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObject(body)) {
      if (typeof body.error === "string" && body.error.trim()) return body.error;
      if (typeof body.message === "string" && body.message.trim()) return body.message;
    }
  } catch {
    // Use the status fallback below.
  }
  return `${fallback} (${response.status})`;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function nodeHasTag(node: ExploreMapNode, tag: string): boolean {
  const target = normalized(tag);
  return node.tags.some((candidate) => normalized(candidate) === target);
}

function photoHasTag(
  photo: SearchPhoto,
  node: ExploreMapNode | undefined,
  tag: string,
): boolean {
  if (node) return nodeHasTag(node, tag);
  const target = normalized(tag);
  return (photo.tags ?? []).some((candidate) => normalized(candidate) === target);
}

export default function ExplorePage() {
  const { navigation, siteName, socialLinks, locale } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const gallery = (searchParams.get("gallery") ?? "").trim();
  const tag = (searchParams.get("tag") ?? "").trim();
  const view: ExploreView = searchParams.get("view") === "grid" ? "grid" : "graph";
  const messages = photoMessages[locale];

  const [draftQuery, setDraftQuery] = useState(query);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetryCount, setSearchRetryCount] = useState(0);
  const [mapData, setMapData] = useState<ExploreMapData | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetryCount, setMapRetryCount] = useState(0);
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [visibleGridCount, setVisibleGridCount] = useState(GRID_PAGE_SIZE);

  useEffect(() => setDraftQuery(query), [query]);

  useEffect(() => {
    const controller = new AbortController();
    setIsMapLoading(true);
    setMapError(null);

    void fetch(`/api/photos/explore?${new URLSearchParams({ locale }).toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response, locale, messages.exploreMapUnavailable));
        }
        return parseExploreResponse(await response.json(), locale);
      })
      .then((data) => {
        if (!controller.signal.aborted) setMapData(data);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMapData(null);
        setMapError(reason instanceof Error ? reason.message : messages.exploreMapUnavailable);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsMapLoading(false);
      });

    return () => controller.abort();
  }, [locale, mapRetryCount, messages.exploreMapUnavailable]);

  useEffect(() => {
    if (!query) {
      setResults(null);
      setSearchError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const startedAt = performance.now();
    const parameters = new URLSearchParams({ q: query, limit: "50", locale });
    if (gallery) parameters.set("gallery", gallery);

    setIsLoading(true);
    setSearchError(null);
    setResults(null);

    void fetch(`/api/photos/search?${parameters.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response, locale, messages.searchUnavailable));
        }
        return parseSearchResponse(await response.json(), locale);
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResults(data);
          captureAnalyticsEvent("photo_search_performed", {
            duration_ms: Math.round(performance.now() - startedAt),
            gallery_filter: gallery || null,
            locale,
            query_length: query.length,
            query_word_count: query.split(/\s+/).filter(Boolean).length,
            result_count: data.photos.length,
          });
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setSearchError(reason instanceof Error ? reason.message : messages.searchUnavailable);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [gallery, locale, messages.searchUnavailable, query, searchRetryCount]);

  const setFilter = useCallback((name: string, value: string, replace = true) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setShowAllFilters(false);
    setVisibleGridCount(GRID_PAGE_SIZE);
  }, [gallery, query, tag]);

  const resultIds = useMemo(() =>
    query && results
      ? new Set(results.photos.map((photo) => photo.assetId))
      : null,
  [query, results]);
  const nodesById = useMemo(
    () => new Map((mapData?.nodes ?? []).map((node) => [node.assetId, node])),
    [mapData],
  );
  const nodesBeforeTag = useMemo(() => {
    if (!mapData) return [];
    if (query && !resultIds) return [];
    return mapData.nodes.filter((node) =>
      (!gallery || node.gallerySlugs.includes(gallery)) &&
      (!resultIds || resultIds.has(node.assetId)),
    );
  }, [gallery, mapData, query, resultIds]);
  const visibleNodes = useMemo(() =>
    tag ? nodesBeforeTag.filter((node) => nodeHasTag(node, tag)) : nodesBeforeTag,
  [nodesBeforeTag, tag]);
  const tagOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const node of nodesBeforeTag) {
      const photoTags = new Map(
        node.tags.map((label) => [normalized(label), label] as const),
      );
      for (const [key, label] of photoTags) {
        const current = counts.get(key);
        counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
      }
    }
    return Array.from(counts.values()).sort((left, right) =>
      right.count - left.count || left.label.localeCompare(right.label, locale),
    );
  }, [locale, nodesBeforeTag]);
  const displayedTagOptions = useMemo(() => {
    const visible = tagOptions.slice(
      0,
      showAllFilters ? EXPANDED_FILTER_COUNT : COLLAPSED_FILTER_COUNT,
    );
    if (tag && !visible.some((option) => normalized(option.label) === normalized(tag))) {
      const active = tagOptions.find((option) => normalized(option.label) === normalized(tag));
      if (active) visible.push(active);
    }
    return visible;
  }, [showAllFilters, tag, tagOptions]);

  const galleryOptions = mapData?.galleries.length
    ? mapData.galleries
    : results?.galleries ?? [];
  const activeGalleryTitle = galleryOptions.find((item) => item.slug === gallery)?.title
    || gallery
    || messages.allGalleries;

  const gridPhotos = useMemo<SearchPhoto[]>(() => {
    if (query) {
      if (!results) return [];
      return results.photos.filter((photo) => {
        const node = nodesById.get(photo.assetId);
        if (mapData && !node) return false;
        return !tag || photoHasTag(photo, node, tag);
      });
    }
    return visibleNodes.map((node) => ({
      assetId: node.assetId,
      path: node.path,
      filename: node.filename,
      title: node.title,
      caption: node.caption,
      gallerySlug: node.gallerySlug,
      galleryTitle: node.galleryTitle,
      score: 0,
      thumbnailUrl: node.thumbnailUrl,
      href: node.href,
      tags: node.tags,
    }));
  }, [mapData, nodesById, query, results, tag, visibleNodes]);
  const visibleGridPhotos = gridPhotos.slice(0, visibleGridCount);
  const visibleCount = view === "graph" ? visibleNodes.length : gridPhotos.length;
  const contentIsLoading = isLoading || (!query && isMapLoading);

  return (
    <Layout navigation={navigation} siteName={siteName} socialLinks={socialLinks} locale={locale}>
      <GalleryBreadcrumb navigation={navigation} locale={locale} />

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 max-w-4xl">
          <h1 className="text-3xl font-bold tracking-tight text-black dark:text-white sm:text-4xl">
            {messages.exploreTitle}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400 sm:text-base">
            {messages.exploreDescription}
          </p>
        </header>

        <Form
          method="get"
          action={localizedPath(locale, "/explore")}
          role="search"
          data-ph-no-capture="true"
          className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto]"
        >
          <label htmlFor="photo-search-query" className="sr-only">
            {messages.searchLabel}
          </label>
          <input
            id="photo-search-query"
            name="q"
            type="search"
            minLength={2}
            maxLength={300}
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={messages.searchPlaceholder}
            className="h-12 w-full rounded-lg border border-gray-200 bg-white px-4 text-sm text-black outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-600 dark:focus:border-gray-500 dark:focus:ring-gray-800"
          />

          <details className="group relative">
            <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 text-sm text-gray-700 outline-none transition hover:border-gray-300 focus-visible:border-gray-500 focus-visible:ring-2 focus-visible:ring-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:focus-visible:border-gray-500 dark:focus-visible:ring-gray-800">
              <span className="truncate">{activeGalleryTitle}</span>
              <ChevronIcon />
            </summary>
            <div className="absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
              <GalleryOption
                title={messages.allGalleries}
                selected={!gallery}
                onSelect={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  setFilter("gallery", "");
                }}
              />
              {gallery && !galleryOptions.some((item) => item.slug === gallery) && (
                <GalleryOption title={gallery} selected onSelect={() => undefined} />
              )}
              {galleryOptions.map((item) => (
                <GalleryOption
                  key={item.slug}
                  title={item.title}
                  count={"count" in item ? item.count : undefined}
                  selected={item.slug === gallery}
                  onSelect={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setFilter("gallery", item.slug);
                  }}
                />
              ))}
            </div>
          </details>

          {gallery && <input type="hidden" name="gallery" value={gallery} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {view === "grid" && <input type="hidden" name="view" value="grid" />}
          <button
            type="submit"
            disabled={draftQuery.trim().length === 1}
            className="h-12 rounded-lg bg-black px-6 text-sm font-medium text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:focus-visible:ring-offset-gray-950"
          >
            {messages.search}
          </button>
        </Form>

        <div className="mt-5 border-b border-gray-100 pb-6 dark:border-gray-900">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              {messages.detectedElements}
            </p>
            {tagOptions.length > COLLAPSED_FILTER_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllFilters((current) => !current)}
                className="text-xs text-gray-500 underline decoration-gray-300 underline-offset-4 transition hover:text-black dark:decoration-gray-700 dark:hover:text-white"
              >
                {showAllFilters ? messages.hideFilters : messages.showAllFilters}
              </button>
            )}
          </div>
          {isMapLoading && !mapData ? (
            <div className="flex gap-2" aria-label={messages.exploreLoadingMap}>
              {[88, 112, 72, 104, 92].map((width) => (
                <span key={width} className="h-8 animate-pulse rounded-full bg-gray-100 dark:bg-gray-900" style={{ width }} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <TagFilter
                label={messages.allDetectedElements}
                count={nodesBeforeTag.length}
                active={!tag}
                onClick={() => setFilter("tag", "")}
              />
              {displayedTagOptions.map((option) => (
                <TagFilter
                  key={option.label}
                  label={option.label}
                  count={option.count}
                  active={normalized(option.label) === normalized(tag)}
                  onClick={() => setFilter("tag", option.label)}
                />
              ))}
            </div>
          )}
        </div>

        <p className="sr-only" aria-live="polite">
          {contentIsLoading
            ? query ? messages.searchingArchive : messages.exploreLoadingMap
            : searchError
              ? `${messages.searchFailed}: ${searchError}`
              : `${visibleCount} ${visibleCount === 1 ? messages.photograph : messages.photographs}.`}
        </p>

        <div className="mb-5 mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {contentIsLoading
              ? query ? messages.searchingArchive : messages.exploreLoadingMap
              : `${visibleCount} ${visibleCount === 1 ? messages.photograph : messages.photographs}`}
          </p>
          <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-900" role="group" aria-label={messages.exploreTitle}>
            <ViewButton
              label={messages.graphView}
              active={view === "graph"}
              onClick={() => setFilter("view", "")}
              icon={<GraphIcon />}
            />
            <ViewButton
              label={messages.gridView}
              active={view === "grid"}
              onClick={() => setFilter("view", "grid")}
              icon={<GridIcon />}
            />
          </div>
        </div>

        {searchError && !isLoading && (
          <ErrorState
            message={searchError}
            retryLabel={messages.tryAgain}
            onRetry={() => setSearchRetryCount((value) => value + 1)}
          />
        )}

        {!searchError && view === "graph" && (
          isMapLoading && !mapData ? (
            <div className="h-[620px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-900" role="status" aria-label={messages.exploreLoadingMap} />
          ) : mapError || !mapData ? (
            <ErrorState
              message={mapError || messages.exploreMapUnavailable}
              retryLabel={messages.tryAgain}
              onRetry={() => setMapRetryCount((value) => value + 1)}
            />
          ) : isLoading ? (
            <div className="h-[620px] animate-pulse rounded-xl bg-gray-100 dark:bg-gray-900" role="status" aria-label={messages.searchingArchive} />
          ) : (
            <ExplorePhotoGraph
              data={mapData}
              nodes={visibleNodes}
              locale={locale}
              onTagSelect={(nextTag) => setFilter("tag", nextTag)}
            />
          )
        )}

        {!searchError && view === "grid" && (
          contentIsLoading ? (
            <PhotoGridSkeleton />
          ) : (!query && (mapError || !mapData)) ? (
            <ErrorState
              message={mapError || messages.exploreMapUnavailable}
              retryLabel={messages.tryAgain}
              onRetry={() => setMapRetryCount((value) => value + 1)}
            />
          ) : gridPhotos.length === 0 ? (
            <div className="py-24 text-center text-sm text-gray-500 dark:text-gray-400">
              <p>{messages.exploreNoMatches}</p>
              {gallery && query && (
                <Link
                  to={`${localizedPath(locale, "/explore")}?${new URLSearchParams({ q: query, view: "grid" }).toString()}`}
                  className="mt-4 inline-block font-medium text-black underline underline-offset-4 dark:text-white"
                >
                  {messages.searchAllGalleries}
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleGridPhotos.map((photo) => (
                  <SearchResultCard
                    key={`${photo.assetId}:${photo.path}`}
                    photo={photo}
                    locale={locale}
                    onTagSelect={(nextTag) => setFilter("tag", nextTag)}
                  />
                ))}
              </div>
              {visibleGridPhotos.length < gridPhotos.length && (
                <div className="mt-12 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleGridCount((count) => count + GRID_PAGE_SIZE)}
                    className="rounded-lg border border-gray-200 px-5 py-3 text-sm font-medium text-gray-800 transition hover:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 dark:border-gray-800 dark:text-gray-200 dark:hover:border-gray-600"
                  >
                    {messages.showMorePhotos}
                  </button>
                </div>
              )}
            </>
          )
        )}
      </section>
    </Layout>
  );
}

function GalleryOption({
  title,
  count,
  selected,
  onSelect,
}: {
  title: string;
  count?: number;
  selected: boolean;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
        selected
          ? "bg-gray-100 font-medium text-black dark:bg-gray-800 dark:text-white"
          : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60"
      }`}
    >
      <span className="truncate">{title}</span>
      {count !== undefined && <span className="text-xs text-gray-400">{count}</span>}
    </button>
  );
}

function TagFilter({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
        active
          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-400 hover:text-black dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-white"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "opacity-60" : "text-gray-400 dark:text-gray-500"}>{count}</span>
    </button>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
        active
          ? "bg-white text-black shadow-sm dark:bg-gray-800 dark:text-white"
          : "text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 px-6 py-24 text-center dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 text-sm font-medium text-black underline underline-offset-4 dark:text-white"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function PhotoGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index}>
          <div className="aspect-[4/3] animate-pulse bg-gray-100 dark:bg-gray-900" />
          <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-900" />
        </div>
      ))}
    </div>
  );
}

function SearchResultCard({
  photo,
  locale,
  onTagSelect,
}: {
  photo: SearchPhoto;
  locale: Locale;
  onTagSelect: (tag: string) => void;
}) {
  const label = photo.title?.trim() || photo.caption?.trim() || photo.filename;
  const visibleTags = photo.tags?.filter(Boolean).slice(0, 4) ?? [];

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
            <Link to={localizedPath(locale, photo.href)} prefetch="intent">{label}</Link>
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
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1" aria-label={photoMessages[locale].detectedElements}>
            {visibleTags.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onTagSelect(item)}
                className="text-[11px] text-gray-400 transition hover:text-black focus:outline-none focus-visible:underline dark:text-gray-500 dark:hover:text-white"
              >
                #{item}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 5 4-2 4 3M4 5l1 6m3-8 3 8M5 11h6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="5" r="1.5" fill="currentColor" />
      <circle cx="8" cy="3" r="1.5" fill="currentColor" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" />
      <circle cx="5" cy="11" r="1.5" fill="currentColor" />
      <circle cx="11" cy="11" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx=".5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2" width="5" height="5" rx=".5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="9" width="5" height="5" rx=".5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="5" height="5" rx=".5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
