import { localizedPath, type Locale } from "~/lib/i18n";

function encodePath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join("/");
}

export function buildPublicBlogPostUrl(
  slug: string,
  config: { publicBlogUrl: string },
  locale?: Locale,
): string {
  const baseUrl = locale
    ? buildLocalizedBlogUrl(config.publicBlogUrl, locale)
    : config.publicBlogUrl.replace(/\/$/, "");
  return `${baseUrl}/${encodePath(slug)}`;
}

export function buildLocalizedBlogUrl(publicBlogUrl: string, locale: Locale): string {
  const url = new URL(publicBlogUrl);
  url.pathname = localizedPath(locale, url.pathname).replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
