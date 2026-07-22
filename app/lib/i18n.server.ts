import { redirect } from "@remix-run/cloudflare";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAMETER,
  localeFromPathname,
  localizedPath,
  normalizeLocale,
  parseAcceptLanguage,
  stripLocaleFromPathname,
  type Locale,
} from "~/lib/i18n";
import {
  DEFAULT_SITE_LANGUAGE_SETTINGS,
  type SiteLanguageSettings,
} from "~/lib/site-languages.server";

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function externalRequestUrl(request: Request): URL {
  const url = new URL(request.url);
  const forwardedProtocol = request.headers
    .get("X-Forwarded-Proto")
    ?.split(",", 1)[0]
    ?.trim()
    ?.toLowerCase();
  if (forwardedProtocol === "http" || forwardedProtocol === "https") {
    url.protocol = `${forwardedProtocol}:`;
  }
  return url;
}

export function preferredLocale(
  request: Request,
  settings: SiteLanguageSettings = DEFAULT_SITE_LANGUAGE_SETTINGS,
): Locale {
  return (
    normalizeLocale(readCookie(request, LOCALE_COOKIE)) ||
    parseAcceptLanguage(request.headers.get("Accept-Language")) ||
    settings.defaultLocale ||
    DEFAULT_LOCALE
  );
}

export function localeForRequest(
  request: Request,
  settings: SiteLanguageSettings = DEFAULT_SITE_LANGUAGE_SETTINGS,
): Locale {
  if (!settings.multilingual) return settings.defaultLocale;
  return localeFromPathname(new URL(request.url).pathname) || preferredLocale(request, settings);
}

export function requireRouteLocale(
  request: Request,
  value: string | undefined,
  settings: SiteLanguageSettings = DEFAULT_SITE_LANGUAGE_SETTINGS,
): Locale {
  const url = new URL(request.url);
  const manuallySelectedLocale = normalizeLocale(
    url.searchParams.get(LOCALE_QUERY_PARAMETER),
  );

  if (manuallySelectedLocale) {
    url.searchParams.delete(LOCALE_QUERY_PARAMETER);
    const locale = settings.multilingual
      ? manuallySelectedLocale
      : settings.defaultLocale;
    throw redirect(`${localizedPath(locale, url.pathname)}${url.search}`, {
      headers: {
        "Cache-Control": "private, no-store",
        ...(settings.multilingual
          ? {
              "Set-Cookie": localeCookie(request, locale),
              Vary: "Accept-Language, Cookie",
            }
          : {}),
      },
    });
  }

  if (value === undefined) {
    const locale = settings.multilingual
      ? preferredLocale(request, settings)
      : settings.defaultLocale;
    if (locale === DEFAULT_LOCALE) return locale;

    throw redirect(`${localizedPath(locale, url.pathname)}${url.search}`, {
      headers: {
        "Cache-Control": "private, no-store",
        ...(settings.multilingual
          ? {
              "Set-Cookie": localeCookie(request, locale),
              Vary: "Accept-Language, Cookie",
            }
          : {}),
      },
    });
  }

  if (!isLocale(value)) {
    throw new Response("Not Found", { status: 404 });
  }

  // /en and /en/* are legacy aliases. English now owns the clean URL.
  if (value === DEFAULT_LOCALE) {
    const locale = settings.multilingual ? DEFAULT_LOCALE : settings.defaultLocale;
    throw redirect(`${localizedPath(locale, url.pathname)}${url.search}`, {
      status: 301,
      headers: {
        "Cache-Control": "private, no-store",
        ...(settings.multilingual
          ? { "Set-Cookie": localeCookie(request, DEFAULT_LOCALE) }
          : {}),
      },
    });
  }

  if (!settings.multilingual && value !== settings.defaultLocale) {
    throw redirect(
      `${localizedPath(settings.defaultLocale, url.pathname)}${url.search}`,
      { status: 302, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return value;
}

export function localeCookie(request: Request, locale: Locale): string {
  const url = externalRequestUrl(request);
  const parts = [
    `${LOCALE_COOKIE}=${locale}`,
    "Path=/",
    "Max-Age=31536000",
    "SameSite=Lax",
  ];

  if (url.protocol === "https:") parts.push("Secure");
  if (url.hostname === "victoriano.me" || url.hostname.endsWith(".victoriano.me")) {
    parts.push("Domain=victoriano.me");
  }

  return parts.join("; ");
}

export function localeResponseHeaders(
  request: Request,
  locale: Locale,
  settings: SiteLanguageSettings = DEFAULT_SITE_LANGUAGE_SETTINGS,
): Headers {
  const headers = new Headers({ "Content-Language": locale });
  const hostname = externalRequestUrl(request).hostname;

  // Cloudflare treats photo landing-page paths ending in .jpg as static files.
  // Development previews must never cache their HTML, otherwise a live Vite
  // server can be paired with an older document for up to four hours.
  if (hostname.endsWith(".nominao.com")) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  }

  if (
    settings.multilingual &&
    normalizeLocale(readCookie(request, LOCALE_COOKIE)) !== locale
  ) {
    headers.set("Set-Cookie", localeCookie(request, locale));
  }
  return headers;
}

export function mergeLocalizedRouteHeaders({
  loaderHeaders,
  parentHeaders,
}: {
  loaderHeaders: Headers;
  parentHeaders: Headers;
}): Headers {
  const headers = new Headers(parentHeaders);
  loaderHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") headers.append(key, value);
    else headers.set(key, value);
  });
  return headers;
}

export function localizedAlternates(
  request: Request,
  locale: Locale,
  unlocalizedPathname?: string,
  settings: SiteLanguageSettings = DEFAULT_SITE_LANGUAGE_SETTINGS,
): { canonical: string; es?: string; en?: string; xDefault?: string } {
  const url = externalRequestUrl(request);
  const pathname = unlocalizedPathname || url.pathname;
  const defaultUrl = new URL(
    localizedPath(settings.defaultLocale, pathname),
    url.origin,
  ).toString();

  if (!settings.multilingual) {
    return { canonical: defaultUrl };
  }

  const es = new URL(localizedPath("es", pathname), url.origin).toString();
  const en = new URL(localizedPath("en", pathname), url.origin).toString();
  const xDefault = new URL(stripLocaleFromPathname(pathname), url.origin).toString();

  return {
    canonical: locale === "es" ? es : en,
    es,
    en,
    xDefault,
  };
}
