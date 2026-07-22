/**
 * Blog Post Page
 * 
 * GET /blog/:slug
 * Displays a single blog post with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getPostBySlug, getStorage, getNavigationFromIndex, localizeBlogPost } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { BlogPostContent } from "~/components/BlogPostContent";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";
import { photoMessages } from "~/lib/i18n";
import { localizedAlternates, requireRouteLocale } from "~/lib/i18n.server";
import { readSiteLanguageSettings } from "~/lib/site-languages.server";

export { mergeLocalizedRouteHeaders as headers } from "~/lib/i18n.server";

export const meta: MetaFunction<typeof loader> = ({ data, params }) => {
  if (!data?.post) {
    return [{ title: `${params.locale === "es" ? "Artículo no encontrado" : "Post not found"} - VictoPress` }];
  }

  const tags = generateMetaTags({
    title: `${data.post.title} - ${data.siteName}`,
    description: data.post.excerpt || data.post.description,
    url: data.canonicalUrl,
    image: data.ogImage,
    imageAlt: data.post.title,
    type: "article",
    siteName: data.siteName,
    author: data.post.author,
    publishedTime: data.post.date,
    keywords: data.post.tags,
  });
  return [
    ...tags,
    ...(data.alternates.es ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "es", href: data.alternates.es }] : []),
    ...(data.alternates.en ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "en", href: data.alternates.en }] : []),
    ...(data.alternates.xDefault ? [{ tagName: "link" as const, rel: "alternate", hrefLang: "x-default", href: data.alternates.xDefault }] : []),
  ];
};

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const storage = getStorage(context, request);
  const siteLanguages = await readSiteLanguageSettings(storage);
  const locale = requireRouteLocale(request, params.locale, siteLanguages);
  const slug = params.slug || params["*"];
  if (!slug) {
    throw new Response(locale === "es" ? "Artículo no encontrado" : "Post not found", { status: 404 });
  }

  const baseUrl = getBaseUrl(request);
  // Load post and navigation from index in parallel
  const [rawPost, navigation] = await Promise.all([
    getPostBySlug(storage, slug),
    getNavigationFromIndex(storage, locale),
  ]);

  if (!rawPost || rawPost.draft) {
    throw new Response(locale === "es" ? "Artículo no encontrado" : "Post not found", { status: 404 });
  }

  const post = localizeBlogPost(rawPost, locale);

  const siteName = "Victoriano Izquierdo";
  const alternates = localizedAlternates(
    request,
    locale,
    `/blog/${post.slug}`,
    siteLanguages,
  );
  const canonicalUrl = alternates.canonical;
  const ogImage = buildImageUrl(baseUrl, post.cover);

  return json({
    post,
    navigation,
    siteName,
    canonicalUrl,
    ogImage,
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

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

export default function BlogPostPage() {
  const { post, navigation, siteName, socialLinks, locale } = useLoaderData<typeof loader>();
  const messages = photoMessages[locale];

  const handleShare = async () => {
    const url = window.location.href;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.excerpt || post.description,
          url,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(url);
      alert(messages.linkCopied);
    }
  };

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
      locale={locale}
    >
      <article className="blog-page-shell blog-entry">
        {/* Header */}
        <header>
          <h1 className="blog-entry-title">
            {post.title}
          </h1>
          
          <time className="blog-entry-date" dateTime={post.date ? new Date(post.date).toISOString() : undefined}>
            {post.date && new Date(post.date).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
              year: "numeric",
              month: "long",
              day: "2-digit",
            })}
          </time>
        </header>

        {/* Cover Image */}
        {post.cover && !post.coverInBody && (
          <figure className="mb-8">
            <img
              src={`/api/images/${post.cover}`}
              alt={post.title}
              className="w-full rounded-sm"
            />
          </figure>
        )}

        {/* Content */}
        <BlogPostContent post={post} />

        {/* Footer */}
        {!post.sourceUrl && <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            {/* Tags */}
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              {post.tags && post.tags.length > 0 && (
                <>
                  <span>{messages.tags}:</span>
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </>
              )}
            </div>

            {/* Share Button */}
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <ShareIcon className="w-4 h-4" />
              <span>{messages.share}</span>
            </button>
          </div>
        </footer>}
      </article>
    </Layout>
  );
}
