/**
 * Sitemap.xml Generator
 *
 * Generates an XML sitemap for search engines.
 * Includes all public galleries, photos, and blog posts.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { scanGalleries, scanBlog, filterPublishedPosts, getStorage } from "~/lib/content-engine";
import { getBaseUrl } from "~/utils/seo";

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);

  const [allGalleries, allPosts] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
  ]);

  // Filter public content
  const publicGalleries = allGalleries.filter((g) => !g.private);
  const publishedPosts = filterPublishedPosts(allPosts);

  const urls: SitemapUrl[] = [];

  // Home page
  urls.push({
    loc: baseUrl,
    changefreq: "daily",
    priority: 1.0,
  });

  // Blog index
  if (publishedPosts.length > 0) {
    urls.push({
      loc: `${baseUrl}/blog`,
      changefreq: "daily",
      priority: 0.8,
    });
  }

  // Gallery pages
  for (const gallery of publicGalleries) {
    urls.push({
      loc: `${baseUrl}/gallery/${gallery.slug}`,
      lastmod: formatDate(gallery.lastModified),
      changefreq: "weekly",
      priority: 0.8,
    });

    // Individual photo pages (optional - can generate many URLs)
    // Only include top photos to avoid massive sitemaps
    const topPhotos = gallery.photos.filter((p) => !p.hidden).slice(0, 20);
    for (const photo of topPhotos) {
      urls.push({
        loc: `${baseUrl}/photo/${gallery.slug}/${encodeURIComponent(photo.filename)}`,
        lastmod: formatDate(photo.dateTaken || gallery.lastModified),
        changefreq: "monthly",
        priority: 0.5,
      });
    }
  }

  // Blog posts
  for (const post of publishedPosts) {
    urls.push({
      loc: `${baseUrl}/blog/${post.slug}`,
      lastmod: post.date ? formatDate(post.date) : undefined,
      changefreq: "monthly",
      priority: 0.7,
    });
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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
