/**
 * Admin Dashboard
 * 
 * GET /admin
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, isDemoMode, getContentIndex } from "~/lib/content-engine";

export async function loader({ request, context }: LoaderFunctionArgs) {
  // Check authentication
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  const demoMode = isDemoMode(context);
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Get recent items from index
  const recentGalleries = [...contentIndex.galleries]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 5);
  
  const recentPosts = [...contentIndex.posts]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 5);
  
  return json({
    username,
    isDemoMode: demoMode,
    stats: {
      galleries: contentIndex.stats.totalGalleries,
      photos: contentIndex.stats.totalPhotos,
      posts: contentIndex.stats.totalPosts,
      drafts: contentIndex.posts.filter(p => p.draft).length,
    },
    recentGalleries,
    recentPosts,
  });
}

export default function AdminDashboard() {
  const { username, isDemoMode: demoMode, stats, recentGalleries, recentPosts } = useLoaderData<typeof loader>();

  return (
    <AdminLayout username={username || undefined} isDemoMode={demoMode}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Welcome back, {username || "Admin"}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Galleries"
            value={stats.galleries}
            href="/admin/galleries"
            icon={<GalleryIcon />}
          />
          <StatCard
            title="Photos"
            value={stats.photos}
            href="/admin/galleries"
            icon={<PhotoIcon />}
          />
          <StatCard
            title="Blog Posts"
            value={stats.posts}
            href="/admin/blog"
            icon={<BlogIcon />}
          />
          <StatCard
            title="Drafts"
            value={stats.drafts}
            href="/admin/blog?filter=drafts"
            icon={<DraftIcon />}
          />
        </div>

        {/* Recent Content */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Recent Galleries */}
          <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-white">Recent Galleries</h2>
              <Link
                to="/admin/galleries"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {recentGalleries.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm">No galleries yet</p>
              ) : (
                recentGalleries.map((gallery) => (
                  <Link
                    key={gallery.slug}
                    to={`/admin/galleries/${gallery.slug}`}
                    className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex-shrink-0">
                      {gallery.cover && (
                        <img
                          src={`/api/images/${encodeImagePath(gallery.cover)}`}
                          alt={gallery.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {gallery.title}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {gallery.photoCount} photos
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Recent Posts */}
          <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-white">Recent Posts</h2>
              <Link
                to="/admin/blog"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {recentPosts.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-sm">No posts yet</p>
              ) : (
                recentPosts.map((post) => (
                  <Link
                    key={post.slug}
                    to={`/admin/blog/${post.slug}`}
                    className="flex items-center justify-between p-2 -mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {post.title}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {post.date ? new Date(post.date).toLocaleDateString() : "No date"}
                      </p>
                    </div>
                    {post.draft && (
                      <span className="px-2 py-1 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded">
                        Draft
                      </span>
                    )}
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/admin/upload"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              <UploadIcon />
              Upload Photos
            </Link>
            <Link
              to="/admin/blog/new"
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <PlusIcon />
              New Post
            </Link>
            <Link
              to="/"
              target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <ExternalIcon />
              View Site
            </Link>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

// Helper to encode path segments for URLs (preserves slashes)
function encodeImagePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

// Components
function StatCard({
  title,
  value,
  href,
  icon,
}: {
  title: string;
  value: number;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
    </Link>
  );
}

// Icons
function GalleryIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
  );
}

function BlogIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function DraftIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
