import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getStorage, scanBlog } from "~/lib/content-engine";
import {
  buildHeadlessBlogIndex,
  headlessCorsPreflight,
  headlessError,
  headlessJsonResponse,
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

export async function loader({ context, request }: LoaderFunctionArgs) {
  // Remix/Cloudflare Pages can dispatch OPTIONS through the loader rather
  // than the action, so handle it explicitly on both code paths.
  if (request.method === "OPTIONS") return headlessCorsPreflight();

  try {
    const storage = getStorage(context, request);
    const [posts, siteLanguages] = await Promise.all([
      scanBlog(storage),
      readSiteLanguageSettings(storage),
    ]);
    const locale = requestLocale(request, siteLanguages);
    const payload = buildHeadlessBlogIndex(
      posts,
      resolveHeadlessBlogConfig(context, request),
      locale,
    );

    return headlessJsonResponse(request, payload, { locale });
  } catch (error) {
    console.error("[Headless Blog] Failed to build the public index.", error);
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
