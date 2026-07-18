/**
 * Blog List Page
 * 
 * GET /blog
 * Displays all published blog posts with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { getStorage, getNavigationFromIndex, scanBlog } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { GalleryBreadcrumb } from "~/components/GalleryBreadcrumb";
import { BlogPostContent } from "~/components/BlogPostContent";

export const meta: MetaFunction = () => {
  return [
    { title: "Blog — Victoriano Izquierdo" },
    { name: "description", content: "Blog by Victoriano Izquierdo" },
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  const storage = getStorage(context);

  // Posts are scanned directly because the public index renders the complete
  // article body, matching the original Squarespace blog.
  const [allPosts, navigation] = await Promise.all([
    scanBlog(storage),
    getNavigationFromIndex(storage),
  ]);

  // Filter published posts and sort by date
  const posts = allPosts
    .filter(p => !p.draft)
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

  return json({
    posts,
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

export default function BlogIndex() {
  const { posts, navigation, siteName, socialLinks } = useLoaderData<typeof loader>();

  return (
    <Layout
      navigation={navigation}
      siteName={siteName}
      socialLinks={socialLinks}
    >
      {/* Mobile Navigation */}
      <GalleryBreadcrumb navigation={navigation} />
      
      <div className="blog-page-shell">
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-4">
              No posts yet
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-sm">
              Add markdown files to <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">content/blog/</code>
            </p>
          </div>
        ) : (
          <div>
            {posts.map((post) => (
              <article key={post.id} className="blog-entry">
                <header>
                <Link to={`/blog/${post.slug}`}>
                  <h2 className="blog-entry-title">
                    {post.title}
                  </h2>
                </Link>

                <time className="blog-entry-date" dateTime={post.date ? new Date(post.date).toISOString() : undefined}>
                  {post.date && new Date(post.date).toLocaleDateString("en-US", {
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
