/**
 * Blog List Page
 * 
 * GET /blog
 * Displays all published blog posts with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getStorage, getNavigationFromIndex, localizeBlogPost } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { BlogPostContent } from "~/components/BlogPostContent";
import { NewsletterSignup } from "~/components/NewsletterSignup";
import { localizedPath, photoMessages } from "~/lib/i18n";
import { localizedAlternates, requireRouteLocale } from "~/lib/i18n.server";
import { isNewsletterConfigured } from "~/lib/newsletter/config.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";
import { loadHeadlessBlogPosts } from "~/lib/headless-blog-storage.server";
import {
  BLOG_CATEGORIES,
  filterPostsByBlogCategory,
  normalizeBlogCategory,
} from "~/lib/blog-categories";

export { mergeLocalizedRouteHeaders as headers } from "~/lib/i18n.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const spanish = data?.locale !== "en";
  return [
    { title: "Blog — Victoriano Izquierdo" },
    { name: "description", content: spanish ? "Blog de Victoriano Izquierdo" : "Blog by Victoriano Izquierdo" },
    ...(data ? [
      { tagName: "link" as const, rel: "canonical", href: data.alternates.canonical },
      ...(data.alternates.es ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "es", href: data.alternates.es }] : []),
      ...(data.alternates.en ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "en", href: data.alternates.en }] : []),
      ...(data.alternates.xDefault ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "x-default", href: data.alternates.xDefault }] : []),
    ] : []),
  ];
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const storage = getStorage(context, request);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const locale = requireRouteLocale(request, params.locale, siteLanguages);

  const [allPosts, navigation] = await Promise.all([
    loadHeadlessBlogPosts(storage),
    getNavigationFromIndex(storage, locale),
  ]);

  const activeCategory = normalizeBlogCategory(
    new URL(request.url).searchParams.get("category"),
  );

  // Filter published posts and sort by date
  const publishedPosts = allPosts
    .filter(p => !p.draft)
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    })
    .map((post) => localizeBlogPost(post, locale));
  const posts = filterPostsByBlogCategory(publishedPosts, activeCategory);
  const categoryCounts = Object.fromEntries(
    BLOG_CATEGORIES.map((category) => [
      category,
      filterPostsByBlogCategory(publishedPosts, category).length,
    ]),
  );

  const alternates = localizedAlternates(request, locale, "/blog", siteLanguages);
  return json({
    posts,
    activeCategory,
    categoryCounts,
    totalPosts: publishedPosts.length,
    navigation,
    siteName: "Victoriano Izquierdo",
    locale,
    alternates,
    newsletterEnabled: isNewsletterConfigured(context, request),
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

export default function BlogIndex() {
  const {
    posts,
    navigation,
    siteName,
    socialLinks,
    locale,
    newsletterEnabled,
    activeCategory,
    categoryCounts,
    totalPosts,
  } = useLoaderData<typeof loader>();
  const messages = photoMessages[locale];
  const blogPath = localizedPath(locale, "/blog");
  const filterLabel = locale === "es" ? "Filtrar entradas por categoría" : "Filter posts by category";
  const emptyCategoryMessage = locale === "es"
    ? "No hay entradas publicadas en esta categoría."
    : "There are no published posts in this category.";

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      locale={locale}
    >
      {/* Mobile Navigation */}
      <GalleryBreadcrumb navigation={navigation} locale={locale} />
      
      <div className="blog-page-shell">
        <nav className="blog-category-filter" aria-label={filterLabel}>
          <Link
            to={blogPath}
            className={`blog-category-filter-link ${activeCategory === null ? "is-active" : ""}`}
            aria-current={activeCategory === null ? "page" : undefined}
            prefetch="intent"
          >
            all <span>{totalPosts}</span>
          </Link>
          {BLOG_CATEGORIES.map((category) => (
            <Link
              key={category}
              to={`${blogPath}?category=${category}`}
              className={`blog-category-filter-link ${activeCategory === category ? "is-active" : ""}`}
              aria-current={activeCategory === category ? "page" : undefined}
              prefetch="intent"
            >
              {category} <span>{categoryCounts[category]}</span>
            </Link>
          ))}
        </nav>
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-4">
              {activeCategory ? emptyCategoryMessage : messages.noPosts}
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-sm">
              {activeCategory ? "" : messages.addPosts}
            </p>
          </div>
        ) : (
          <div>
            {posts.map((post) => (
              <article key={post.id} className="blog-entry">
                <header>
                <Link to={localizedPath(locale, `/blog/${post.slug}`)}>
                  <h2 className="blog-entry-title">
                    {post.title}
                  </h2>
                </Link>

                <time className="blog-entry-date" dateTime={post.date ? new Date(post.date).toISOString() : undefined}>
                  {post.date && new Date(post.date).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
                    year: "numeric",
                    month: "long",
                    day: "2-digit",
                  })}
                </time>
                </header>

                <BlogPostContent post={post} />
              </article>
            ))}
          </div>
        )}
        <NewsletterSignup
          locale={locale}
          enabled={newsletterEnabled}
          source="blog-index-footer"
          className="mt-20"
        />
      </div>
    </Layout>
  );
}
