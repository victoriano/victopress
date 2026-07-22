import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getStorage, scanBlog } from "~/lib/content-engine";
import {
  buildHeadlessBlogPost,
  headlessCorsPreflight,
  headlessError,
  headlessJsonResponse,
  normalizeRequestedSlug,
  resolveHeadlessBlogConfig,
} from "~/lib/headless-blog";
import { normalizeLocale, parseAcceptLanguage, type Locale } from "~/lib/i18n";
import {
  readSiteLanguageSettings,
  type SiteLanguageSettings,
} from "~/lib/site-languages.server";

function requestLocale(request: Request, settings: SiteLanguageSettings): Locale {
  if (!settings.multilingual) return settings.defaultLocale;
  const url = new URL(request.url);
  return (
    normalizeLocale(url.searchParams.get("locale")) ||
    parseAcceptLanguage(request.headers.get("Accept-Language")) ||
    settings.defaultLocale
  );
}

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return headlessCorsPreflight();

  const slug = normalizeRequestedSlug(params["*"]);
  if (!slug) {
    return headlessJsonResponse(
      request,
      headlessError("BAD_SLUG", "The requested blog slug is invalid."),
      { status: 400, cacheControl: "public, max-age=60", conditional: false },
    );
  }

  try {
    const storage = getStorage(context, request);
    const [posts, siteLanguages] = await Promise.all([
      scanBlog(storage),
      readSiteLanguageSettings(storage),
    ]);
    const locale = requestLocale(request, siteLanguages);
    const payload = buildHeadlessBlogPost(
      posts,
      slug,
      resolveHeadlessBlogConfig(context, request),
      locale,
    );

    if (!payload) {
      return headlessJsonResponse(
        request,
        headlessError("NOT_FOUND", "The requested blog post does not exist."),
        { status: 404, cacheControl: "public, max-age=60", conditional: false },
      );
    }

    return headlessJsonResponse(request, payload, { locale });
  } catch (error) {
    console.error(`[Headless Blog] Failed to load "${slug}".`, error);
    return headlessJsonResponse(
      request,
      headlessError("INTERNAL_ERROR", "The blog is temporarily unavailable."),
      {
        status: 500,
        cacheControl: "no-store",
        conditional: false,
      },
    );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return headlessCorsPreflight();

  const response = await headlessJsonResponse(
    request,
    headlessError("METHOD_NOT_ALLOWED", "Only GET, HEAD and OPTIONS are supported."),
    { status: 405, cacheControl: "no-store", conditional: false },
  );
  response.headers.set("Allow", "GET, HEAD, OPTIONS");
  return response;
}
