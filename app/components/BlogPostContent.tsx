import type { BlogPost } from "~/lib/content-engine";

interface BlogPostContentProps {
  post: Pick<BlogPost, "content" | "format">;
}

/**
 * Render a post in its native serialization.
 *
 * VictoPress-authored posts use Markdown. Migrated Squarespace posts keep a
 * trusted, local HTML snapshot so their image grids, captions, links, and
 * spacing survive the migration without lossy Markdown conversion.
 */
export function BlogPostContent({ post }: BlogPostContentProps) {
  if (post.format === "html") {
    return (
      <div
        className="legacy-squarespace-content"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    );
  }

  return <MarkdownContent content={post.content} />;
}

function MarkdownContent({ content }: { content: string }) {
  const processedContent = content.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => {
      const imageSrc = src.startsWith("http") ? src : `/api/images/${src}`;
      const caption = alt
        ? `<figcaption class="text-center text-sm text-gray-500 mt-2">${alt}</figcaption>`
        : "";
      return `<figure class="my-8"><img src="${imageSrc}" alt="${alt}" class="w-full rounded-sm" />${caption}</figure>`;
    }
  );

  const html = processedContent
    .replace(/^### (.*$)/gim, '<h3 class="text-xl font-semibold mt-8 mb-4">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-semibold mt-10 mb-4">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold mt-12 mb-6">$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    .replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      '<pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded overflow-x-auto my-6"><code>$2</code></pre>'
    )
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">$1</code>'
    )
    .replace(/^\d+\.\s+(.*$)/gim, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4">$1</li>')
    .replace(
      /(<li class="ml-4 list-decimal">.*<\/li>\n?)+/g,
      '<ol class="my-4 list-decimal list-inside space-y-2">$&</ol>'
    )
    .replace(
      /(<li class="ml-4">.*<\/li>\n?)+/g,
      '<ul class="my-4 list-disc list-inside space-y-2">$&</ul>'
    )
    .replace(/^(?!<|$)(.+)$/gim, '<p class="my-4 leading-relaxed">$1</p>')
    .replace(/<p class="my-4 leading-relaxed"><\/p>/g, "");

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
