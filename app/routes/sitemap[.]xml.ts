/**
 * Sitemap.xml Generator
 *
 * Generates an XML sitemap for search engines.
 * Includes all public galleries, photos, and blog posts.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  filterPublishedPosts,
  filterVisiblePages,
  getStorage,
  scanBlog,
  scanGalleries,
  scanPages,
} from "~/lib/content-engine";
import { resolveHeadlessBlogConfig } from "~/lib/headless-blog";
import { localizedPath, type Locale } from "~/lib/i18n";
import {
  readSiteLanguageSettings,
  type SiteLanguageSettings,
} from "~/lib/site-languages.server";
import { getBaseUrl } from "~/utils/seo";

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  alternates?: Record<Locale, string>;
  xDefault?: string;
  imageLoc?: string;
}

function imageUrl(baseUrl: string, path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`/api/images/${encodedPath}`, baseUrl).toString();
}

function localizedUrls(
  baseUrl: string,
  pathname: string,
  metadata: Omit<SitemapUrl, "loc" | "alternates">,
  settings: SiteLanguageSettings,
): SitemapUrl[] {
  if (!settings.multilingual) {
    return [{
      ...metadata,
      loc: new URL(localizedPath(settings.defaultLocale, pathname), baseUrl).toString(),
    }];
  }

  const alternates = {
    es: new URL(localizedPath("es", pathname), baseUrl).toString(),
    en: new URL(localizedPath("en", pathname), baseUrl).toString(),
  };
  const xDefault = new URL(pathname, baseUrl).toString();
  return [
    { ...metadata, loc: alternates.es, alternates, xDefault },
    { ...metadata, loc: alternates.en, alternates, xDefault },
  ];
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const blogConfig = resolveHeadlessBlogConfig(context, request);
  const blogLivesHere = new URL(blogConfig.publicBlogUrl).origin === new URL(baseUrl).origin;

  const [allGalleries, allPosts, allPages] = await Promise.all([
    scanGalleries(storage),
    blogLivesHere ? scanBlog(storage) : Promise.resolve([]),
    scanPages(storage),
  ]);

  // Filter public content
  const publicGalleries = allGalleries.filter((g) => !g.private);
  const publishedPosts = filterPublishedPosts(allPosts);
  const publicPages = filterVisiblePages(allPages);

  const urls: SitemapUrl[] = [];

  // Home page
  urls.push(...localizedUrls(baseUrl, "/", {
    changefreq: "daily",
    priority: 1.0,
  }, siteLanguages));

  for (const page of publicPages) {
    urls.push(...localizedUrls(baseUrl, `/${page.slug}`, {
      changefreq: "monthly",
      priority: 0.6,
    }, siteLanguages));
  }

  // Blog index
  if (blogLivesHere && publishedPosts.length > 0) {
    urls.push(...localizedUrls(baseUrl, "/blog", {
      changefreq: "daily",
      priority: 0.8,
    }, siteLanguages));
  }

  // Gallery pages
  for (const gallery of publicGalleries) {
    urls.push(...localizedUrls(baseUrl, `/gallery/${gallery.slug}`, {
      lastmod: formatDate(gallery.lastModified),
      changefreq: "weekly",
      priority: 0.8,
    }, siteLanguages));

    // Every public photo gets an indexable landing page and an explicit image
    // sitemap entry. This archive is well below the 50,000 URL sitemap limit.
    const publicPhotos = gallery.photos.filter((p) => !p.hidden);
    for (const photo of publicPhotos) {
      urls.push(...localizedUrls(
        baseUrl,
        `/photo/${gallery.slug}/${encodeURIComponent(photo.filename)}`,
        {
        lastmod: formatDate(photo.dateTaken || gallery.lastModified),
        changefreq: "monthly",
        priority: 0.5,
        imageLoc: imageUrl(baseUrl, photo.path),
        },
        siteLanguages,
      ));
    }
  }

  // Blog posts
  for (const post of blogLivesHere ? publishedPosts : []) {
    urls.push(...localizedUrls(baseUrl, `/blog/${post.slug}`, {
      lastmod: post.date ? formatDate(post.date) : undefined,
      changefreq: "monthly",
      priority: 0.7,
    }, siteLanguages));
  }

  const xml = generateSitemapXml(urls);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

function formatDate(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().split("T")[0]; // YYYY-MM-DD format
}

function generateSitemapXml(urls: SitemapUrl[]): string {
  const urlElements = urls
    .map((url) => {
      let xml = `  <url>\n    <loc>${escapeXml(url.loc)}</loc>`;
      if (url.alternates) {
        xml += `\n    <xhtml:link rel="alternate" hreflang="es" href="${escapeXml(url.alternates.es)}" />`;
        xml += `\n    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(url.alternates.en)}" />`;
        if (url.xDefault) {
          xml += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(url.xDefault)}" />`;
        }
      }
      if (url.imageLoc) {
        xml += `\n    <image:image><image:loc>${escapeXml(url.imageLoc)}</image:loc></image:image>`;
      }
      if (url.lastmod) {
        xml += `\n    <lastmod>${url.lastmod}</lastmod>`;
      }
      if (url.changefreq) {
        xml += `\n    <changefreq>${url.changefreq}</changefreq>`;
      }
      if (url.priority !== undefined) {
        xml += `\n    <priority>${url.priority.toFixed(1)}</priority>`;
      }
      xml += "\n  </url>";
      return xml;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlElements}
</urlset>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
