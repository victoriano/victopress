import { describe, expect, test } from "bun:test";

import {
  localeCookie,
  localeResponseHeaders,
  localizedAlternates,
  preferredLocale,
  requireRouteLocale,
} from "../app/lib/i18n.server";

const bilingual = { multilingual: true, defaultLocale: "en" } as const;
const spanishOnly = { multilingual: false, defaultLocale: "es" } as const;

describe("locale request handling", () => {
  test("prefers a manual cookie over the browser language", () => {
    const request = new Request("https://photos.victoriano.me/", {
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "victoriano_locale=es",
      },
    });

    expect(preferredLocale(request)).toBe("es");
  });

  test("serves the canonical English edition without redirecting", () => {
    const request = new Request("https://photos.victoriano.me/gallery/europe?year=2020", {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });

    expect(requireRouteLocale(request, undefined, bilingual)).toBe("en");
  });

  test("redirects a Spanish browser to /es while preserving its query string", () => {
    const request = new Request("https://photos.victoriano.me/gallery/europe?year=2020", {
      headers: { "Accept-Language": "es-ES,es;q=0.9" },
    });

    try {
      requireRouteLocale(request, undefined, bilingual);
      throw new Error("Expected a locale redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        "/es/gallery/europe?year=2020",
      );
      expect((response as Response).headers.get("Set-Cookie")).toContain(
        "victoriano_locale=es",
      );
    }
  });

  test("uses a transient language flag to leave /es and returns a clean URL", () => {
    const request = new Request(
      "https://photos.victoriano.me/es/gallery/europe?year=2020&lang=en",
      { headers: { Cookie: "victoriano_locale=es" } },
    );

    try {
      requireRouteLocale(request, "es", bilingual);
      throw new Error("Expected a locale redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        "/gallery/europe?year=2020",
      );
      expect((response as Response).headers.get("Set-Cookie")).toContain(
        "victoriano_locale=en",
      );
    }
  });

  test("permanently redirects legacy /en URLs to canonical clean URLs", () => {
    const request = new Request("https://photos.victoriano.me/en/about?from=nav");

    try {
      requireRouteLocale(request, "en", bilingual);
      throw new Error("Expected a locale redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(301);
      expect((response as Response).headers.get("Location")).toBe("/about?from=nav");
      expect((response as Response).headers.get("Set-Cookie")).toContain(
        "victoriano_locale=en",
      );
    }
  });

  test("ignores browser negotiation when multilingual support is disabled", () => {
    const request = new Request("https://photos.victoriano.me/gallery/europe", {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    });

    try {
      requireRouteLocale(request, undefined, spanishOnly);
      throw new Error("Expected a locale redirect");
    } catch (response) {
      expect((response as Response).headers.get("Location")).toBe("/es/gallery/europe");
      expect((response as Response).headers.get("Set-Cookie")).toBeNull();
    }
  });

  test("redirects a disabled secondary edition to the configured default", () => {
    const request = new Request("https://photos.victoriano.me/en/about?from=nav");

    try {
      requireRouteLocale(request, "en", spanishOnly);
      throw new Error("Expected a locale redirect");
    } catch (response) {
      expect((response as Response).headers.get("Location")).toBe("/es/about?from=nav");
    }
  });

  test("shares the manual preference across the production subdomains", () => {
    const request = new Request("http://photos.victoriano.me/en", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const cookie = localeCookie(request, "en");

    expect(cookie).toContain("Domain=victoriano.me");
    expect(cookie).toContain("Secure");
  });

  test("does not resend the cookie when the requested edition is already stored", () => {
    const request = new Request("https://photos.victoriano.me/en", {
      headers: { Cookie: "victoriano_locale=en" },
    });
    const headers = localeResponseHeaders(request, "en");

    expect(headers.get("Content-Language")).toBe("en");
    expect(headers.get("Set-Cookie")).toBeNull();
  });

  test("prevents Cloudflare from caching HTML on named development previews", () => {
    const request = new Request("https://victopress-headless.nominao.com/es");
    const headers = localeResponseHeaders(request, "es", bilingual);

    expect(headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  });

  test("uses the forwarded HTTPS origin for canonical and alternate URLs", () => {
    const request = new Request("http://victopress-headless.nominao.com/about", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const values = localizedAlternates(request, "en", "/about", bilingual);

    expect(values.canonical).toBe("https://victopress-headless.nominao.com/about");
    expect(values.es).toBe("https://victopress-headless.nominao.com/es/about");
    expect(values.xDefault).toBe("https://victopress-headless.nominao.com/about");
  });

  test("emits only one canonical URL for a single-language site", () => {
    const request = new Request("https://photos.victoriano.me/es/about");
    expect(localizedAlternates(request, "es", "/about", spanishOnly)).toEqual({
      canonical: "https://photos.victoriano.me/es/about",
    });
  });
});
