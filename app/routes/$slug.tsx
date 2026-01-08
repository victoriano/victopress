/**
 * Static Page
 * 
 * GET /page/:slug
 * Displays a static page (About, Contact, etc.) with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getPageBySlug, getStorage, getNavigationFromIndex } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.page) {
    return [{ title: "Page Not Found - VictoPress" }];
  }
  return [
    { title: `${data.page.title} - VictoPress` },
    { name: "description", content: data.page.description },
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { slug } = params;
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }

  const storage = getStorage(context);

  // Load page and navigation from index in parallel
  const [page, navigation] = await Promise.all([
    getPageBySlug(storage, slug),
    getNavigationFromIndex(storage),
  ]);

  if (!page || page.hidden) {
    throw new Response("Not Found", { status: 404 });
  }

  return json({
    page,
    navigation,
    siteName: "Victoriano Izquierdo",
    socialLinks: {
      instagram: "https://instagram.com/victoriano",
      twitter: "https://twitter.com/victoriano",
      linkedin: "https://linkedin.com/in/victoriano",
      facebook: "https://facebook.com/victoriano",
    },
  });
}

export default function StaticPage() {
  const { page, navigation, siteName, socialLinks } = useLoaderData<typeof loader>();

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      {/* Mobile Navigation */}
      <GalleryBreadcrumb navigation={navigation} />
      
      {/* Custom CSS if provided */}
      {page.customCss && (
        <style dangerouslySetInnerHTML={{ __html: page.customCss }} />
      )}

      {page.isHtml ? (
        // HTML pages control their own layout
        <article className="w-full py-8">
          <div 
            className="page-content"
            dangerouslySetInnerHTML={{ __html: page.content }} 
          />
        </article>
      ) : (
        // Markdown pages get constrained width
        <article className="max-w-3xl px-8 py-12">
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <MarkdownContent content={page.content} />
          </div>
        </article>
      )}
    </Layout>
  );
}

/**
 * Simple Markdown to HTML renderer
 */
function MarkdownContent({ content }: { content: string }) {
  // Process images first to handle local paths
  const processedContent = content.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => {
      // If it's a local path (not http/https), add the API prefix
      const imageSrc = src.startsWith('http') ? src : `/api/images/${src}`;
      return `<figure class="my-8"><img src="${imageSrc}" alt="${alt}" class="w-full rounded-sm" />${alt ? `<figcaption class="text-center text-sm text-gray-500 mt-2">${alt}</figcaption>` : ''}</figure>`;
    }
  );

  // Basic markdown conversion
  const html = processedContent
    // Blockquotes
    .replace(/^>\s*(.*)$/gim, '<blockquote class="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-4 text-gray-600 dark:text-gray-400">$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gim, '<hr class="my-8 border-gray-200 dark:border-gray-700" />')
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-xl font-semibold mt-8 mb-4">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-semibold mt-10 mb-4">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold mt-12 mb-6">$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      const isExternal = href.startsWith('http');
      return `<a href="${href}" class="text-blue-600 dark:text-blue-400 hover:underline"${isExternal ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    })
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
