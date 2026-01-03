/**
 * Blog List Page
 * 
 * GET /blog
 * Displays all published blog posts with sidebar layout
 */

import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { scanBlog, filterPublishedPosts, scanGalleries, scanParentMetadata, getStorage } from "~/lib/content-engine";
import { Layout } from "~/components/Layout";
import { buildNavigation } from "~/utils/navigation";

export const meta: MetaFunction = () => {
  return [
    { title: "Blog - VictoPress" },
    { name: "description", content: "Read the latest posts" },
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  const storage = getStorage(context);

  const [allPosts, allGalleries, parentMetadata] = await Promise.all([
    scanBlog(storage),
    scanGalleries(storage),
    scanParentMetadata(storage),
  ]);

  const posts = filterPublishedPosts(allPosts).sort((a, b) => {
    const dateA = a.date || new Date(0);
    const dateB = b.date || new Date(0);
    return dateB.getTime() - dateA.getTime();
  });

  // Build navigation from galleries
  const publicGalleries = allGalleries
    .filter((g) => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  const navigation = buildNavigation(publicGalleries, parentMetadata);

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

export default function BlogIndex() {
  const { posts, navigation, siteName, socialLinks } = useLoaderData<typeof loader>();

  const handleShare = async (post: typeof posts[0]) => {
    const url = `${window.location.origin}/blog/${post.slug}`;
    
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
      <div className="max-w-3xl px-8 py-12">
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
          <div className="space-y-16">
            {posts.map((post) => (
              <article key={post.id}>
                <Link to={`/blog/${post.slug}`}>
                  <h2 className="text-2xl font-bold tracking-tight hover:underline">
                    {post.title}
                  </h2>
                </Link>

                <p className="text-gray-500 dark:text-gray-400 mt-2">
                  {post.date && new Date(post.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "2-digit",
                  })}
                </p>

                {post.cover && (
                  <Link to={`/blog/${post.slug}`} className="block mt-6">
                    <img
                      src={`/api/local-images/${post.cover}`}
                      alt={post.title}
                      className="w-full rounded-sm"
                      loading="lazy"
                    />
                  </Link>
                )}

                {post.excerpt && (
                  <p className="mt-6 text-gray-700 dark:text-gray-300 leading-relaxed">
                    {post.excerpt}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-6 mt-6">
                  <Link
                    to={`/blog/${post.slug}`}
                    className="text-sm font-medium text-gray-900 dark:text-white hover:underline"
                  >
                    Read more →
                  </Link>
                  
                  <button
                    onClick={() => handleShare(post)}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  >
                    <ShareIcon className="w-4 h-4" />
                    <span>Share</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
