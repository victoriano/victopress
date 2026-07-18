/**
 * Blog Post Page
 * 
 * GET /blog/:slug
 * Displays a single blog post with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getPostBySlug, getStorage, getNavigationFromIndex } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { BlogPostContent } from "~/components/BlogPostContent";
import { generateMetaTags, getBaseUrl, buildImageUrl } from "~/utils/seo";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.post) {
    return [{ title: "Post Not Found - VictoPress" }];
  }

  return generateMetaTags({
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
};

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const slug = params.slug || params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);

  // Load post and navigation from index in parallel
  const [post, navigation] = await Promise.all([
    getPostBySlug(storage, slug),
    getNavigationFromIndex(storage),
  ]);

  if (!post || post.draft) {
    throw new Response("Not Found", { status: 404 });
  }

  const siteName = "Victoriano Izquierdo";
  const canonicalUrl = `${baseUrl}/blog/${post.slug}`;
  const ogImage = buildImageUrl(baseUrl, post.cover);

  return json({
    post,
    navigation,
    siteName,
    canonicalUrl,
    ogImage,
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
  const { post, navigation, siteName, socialLinks } = useLoaderData<typeof loader>();

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
      alert("Link copied to clipboard!");
    }
  };

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      <article className="blog-page-shell blog-entry">
        {/* Header */}
        <header>
          <h1 className="blog-entry-title">
            {post.title}
          </h1>
          
          <time className="blog-entry-date" dateTime={post.date ? new Date(post.date).toISOString() : undefined}>
            {post.date && new Date(post.date).toLocaleDateString("en-US", {
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
                  <span>Tags:</span>
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
              <span>Share</span>
            </button>
          </div>
        </footer>}
      </article>
    </Layout>
  );
}
