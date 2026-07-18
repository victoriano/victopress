import type { BlogPost } from "~/lib/content-engine";
import { renderMarkdown } from "~/lib/markdown";

interface BlogPostContentProps {
  post: Pick<BlogPost, "content" | "format">;
}

/**
 * Render posts with the same Markdown pipeline used by the admin preview.
 * The HTML branch remains only as backwards compatibility for installations
 * that still have an old VictoPress migration on disk.
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

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="markdown-blog-content"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
