/**
 * Blog Post Page
 * 
 * GET /blog/:slug
 * Displays a single blog post with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getPostBySlug, scanGalleries, scanParentMetadata, getStorage } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { buildNavigation } from "~/utils/navigation";
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
  const { slug } = params;
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const baseUrl = getBaseUrl(request);
  const storage = getStorage(context);

  const [post, allGalleries, parentMetadata] = await Promise.all([
    getPostBySlug(storage, slug),
    scanGalleries(storage),
    scanParentMetadata(storage),
  ]);

  if (!post || post.draft) {
    throw new Response("Not Found", { status: 404 });
  }

  // Build navigation from galleries
  const publicGalleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const navigation = buildNavigation(publicGalleries, parentMetadata);

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
      <article className="max-w-3xl px-8 py-12">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            {post.title}
          </h1>
          
          <p className="text-gray-500 dark:text-gray-400 mt-3">
            {post.date && new Date(post.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "2-digit",
            })}
          </p>
        </header>

        {/* Cover Image */}
        {post.cover && (
          <figure className="mb-8">
            <img
              src={`/api/local-images/${post.cover}`}
              alt={post.title}
              className="w-full rounded-sm"
            />
          </figure>
        )}

        {/* Content */}
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <MarkdownContent content={post.content} />
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
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
        </footer>
      </article>
    </Layout>
  );
}

/**
 * Simple Markdown to HTML renderer
 * For a production app, use a proper markdown library like marked or remark
 */
function MarkdownContent({ content }: { content: string }) {
  // Process images first to handle local paths
  const processedContent = content.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => {
      // If it's a local path (not http/https), add the API prefix
      const imageSrc = src.startsWith('http') ? src : `/api/local-images/${src}`;
      return `<figure class="my-8"><img src="${imageSrc}" alt="${alt}" class="w-full rounded-sm" />${alt ? `<figcaption class="text-center text-sm text-gray-500 mt-2">${alt}</figcaption>` : ''}</figure>`;
    }
  );

  // Basic markdown conversion
  const html = processedContent
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-xl font-semibold mt-8 mb-4">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-semibold mt-10 mb-4">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold mt-12 mb-6">$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded overflow-x-auto my-6"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">$1</code>')
    // Numbered lists
    .replace(/^\d+\.\s+(.*$)/gim, '<li class="ml-4 list-decimal">$1</li>')
    // Unordered lists
    .replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4">$1</li>')
    // Wrap consecutive list items
    .replace(/(<li class="ml-4 list-decimal">.*<\/li>\n?)+/g, '<ol class="my-4 list-decimal list-inside space-y-2">$&</ol>')
    .replace(/(<li class="ml-4">.*<\/li>\n?)+/g, '<ul class="my-4 list-disc list-inside space-y-2">$&</ul>')
    // Paragraphs (lines that don't start with < and have content)
    .replace(/^(?!<|$)(.+)$/gim, '<p class="my-4 leading-relaxed">$1</p>')
    // Clean up empty paragraphs
    .replace(/<p class="my-4 leading-relaxed"><\/p>/g, '');

  return (
    <div 
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
}
