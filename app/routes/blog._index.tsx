/**
 * Blog List Page
 * 
 * GET /blog
 * Displays all published blog posts with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getStorage, getNavigationFromIndex, scanBlog, localizeBlogPost } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { BlogPostContent } from "~/components/BlogPostContent";
import { localizedPath, photoMessages } from "~/lib/i18n";
import { localizedAlternates, requireRouteLocale } from "~/lib/i18n.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";

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

  // Posts are scanned directly because the public index renders the complete
  // article body, matching the original Squarespace blog.
  const [allPosts, navigation] = await Promise.all([
    scanBlog(storage),
    getNavigationFromIndex(storage, locale),
  ]);

  // Filter published posts and sort by date
  const posts = allPosts
    .filter(p => !p.draft)
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    })
    .map((post) => localizeBlogPost(post, locale));

  const alternates = localizedAlternates(request, locale, "/blog", siteLanguages);
  return json({
    posts,
    navigation,
    siteName: "Victoriano Izquierdo",
    locale,
    alternates,
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

export default function BlogIndex() {
  const { posts, navigation, siteName, socialLinks, locale } = useLoaderData<typeof loader>();
  const messages = photoMessages[locale];

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
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-4">
              {messages.noPosts}
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-sm">
              {messages.addPosts}
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
      </div>
    </Layout>
  );
}
