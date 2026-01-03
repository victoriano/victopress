/**
 * Admin - Blog Post Detail/Editor
 * 
 * GET /admin/blog/:slug
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { scanBlog, getStorage } from "~/lib/content-engine";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const slug = params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  const posts = await scanBlog(storage);
  const post = posts.find((p) => p.slug === slug);
  
  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }
  
  return json({ username, post });
}

export default function AdminBlogDetail() {
  const { username, post } = useLoaderData<typeof loader>();

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
              <Link to="/admin/blog" className="hover:text-gray-700 dark:hover:text-gray-300">
                Blog
              </Link>
              <span>/</span>
              <span className="text-gray-900 dark:text-white">{post.title}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{post.title}</h1>
            {post.description && (
              <p className="text-gray-500 dark:text-gray-400 mt-1">{post.description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Link
              to={`/blog/${post.slug}`}
              target="_blank"
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
            >
              <ExternalIcon />
              View
            </Link>
          </div>
        </div>

        {/* Post Info */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <InfoCard 
            label="Status" 
            value={post.draft ? "Draft" : "Published"} 
            variant={post.draft ? "warning" : "success"}
          />
          <InfoCard 
            label="Date" 
            value={post.date ? new Date(post.date).toLocaleDateString() : "No date"} 
          />
          <InfoCard 
            label="Reading Time" 
            value={post.readingTime ? `${post.readingTime} min` : "—"} 
          />
          <InfoCard 
            label="Images" 
            value={post.images?.length?.toString() || "0"} 
          />
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Content Preview */}
        <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h3 className="font-medium text-gray-900 dark:text-white">Content Preview</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {post.content?.length || 0} characters
            </span>
          </div>
          <div className="p-4">
            <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto max-h-96">
              {post.content || "No content"}
            </pre>
          </div>
        </div>

        {/* Edit Instructions */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">How to edit</h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Edit the file at <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">content/{post.path}</code> in your code editor.
            Changes will be reflected automatically when you save.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}

function InfoCard({ 
  label, 
  value, 
  variant = "default",
}: { 
  label: string; 
  value: string; 
  variant?: "default" | "success" | "warning" | "info";
}) {
  const variantColors = {
    default: "text-gray-900 dark:text-white",
    success: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
  };

  return (
    <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
      <p className={`font-semibold text-lg mt-1 ${variantColors[variant]}`}>{value}</p>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
