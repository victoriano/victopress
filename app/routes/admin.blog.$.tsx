/**
 * Admin - Blog Post Editor
 * 
 * GET /admin/blog/:slug - View/Edit post
 * GET /admin/blog/new - Create new post
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useFetcher, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { scanBlog, getStorage } from "~/lib/content-engine";
import { useState, useEffect, useCallback } from "react";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const slug = params["*"];
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Handle "new" post creation
  if (slug === "new") {
    return json({ 
      username, 
      post: null, 
      isNew: true,
    });
  }
  
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }
  
  const posts = await scanBlog(storage);
  const post = posts.find((p) => p.slug === slug);
  
  if (!post) {
    throw new Response("Post not found", { status: 404 });
  }
  
  return json({ username, post, isNew: false });
}

export default function AdminBlogEditor() {
  const { username, post, isNew } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  
  // Form state
  const [title, setTitle] = useState(post?.title || "");
  const [slug, setSlug] = useState(post?.slug || "");
  const [description, setDescription] = useState(post?.description || "");
  const [content, setContent] = useState(post?.content || "");
  const [tags, setTags] = useState((post?.tags || []).join(", "));
  const [date, setDate] = useState(post?.date ? new Date(post.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]);
  const [draft, setDraft] = useState(post?.draft ?? true);
  const [author, setAuthor] = useState(post?.author || "");
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Track if user has manually edited the slug
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  
  // Auto-generate slug from title for new posts
  useEffect(() => {
    if (isNew && title && !slugManuallyEdited) {
      const generated = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 60);
      setSlug(generated);
    }
  }, [title, isNew, slugManuallyEdited]);
  
  // Track changes
  useEffect(() => {
    if (isNew) {
      setHasChanges(!!title);
    } else if (post) {
      const changed = 
        title !== post.title ||
        description !== (post.description || "") ||
        content !== (post.content || "") ||
        tags !== (post.tags || []).join(", ") ||
        date !== (post.date ? new Date(post.date).toISOString().split("T")[0] : "") ||
        draft !== (post.draft ?? false) ||
        author !== (post.author || "");
      setHasChanges(changed);
    }
  }, [title, description, content, tags, date, draft, author, post, isNew]);
  
  // Handle save success/redirect
  useEffect(() => {
    if (fetcher.data?.success) {
      if (isNew && fetcher.data.slug) {
        // Redirect to the new post
        navigate(`/admin/blog/${fetcher.data.slug}`);
      } else if (fetcher.formData?.get("action") === "delete") {
        // Redirect to blog list after delete
        navigate("/admin/blog");
      } else {
        setHasChanges(false);
      }
    }
  }, [fetcher.data, fetcher.formData, isNew, navigate]);
  
  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("action", isNew ? "create" : "update");
    formData.append("slug", slug);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("content", content);
    formData.append("tags", tags);
    formData.append("date", date);
    formData.append("draft", draft.toString());
    formData.append("author", author);
    
    fetcher.submit(formData, {
      method: "POST",
      action: "/api/admin/blog",
    });
  }, [isNew, slug, title, description, content, tags, date, draft, author, fetcher]);
  
  const handleDelete = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("slug", post?.slug || "");
    
    fetcher.submit(formData, {
      method: "POST",
      action: "/api/admin/blog",
    });
  }, [post?.slug, fetcher]);
  
  const isLoading = fetcher.state !== "idle";
  
  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
              <Link to="/admin/blog" className="hover:text-gray-700 dark:hover:text-gray-300">
                Blog
              </Link>
              <span>/</span>
              <span className="text-gray-900 dark:text-white">
                {isNew ? "New Post" : post?.title}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isNew ? "Create New Post" : "Edit Post"}
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            {!isNew && (
              <Link
                to={`/blog/${post?.slug}`}
                target="_blank"
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
              >
                <ExternalIcon />
                View
              </Link>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || !title || !slug}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {isLoading ? (
                <>
                  <LoadingIcon />
                  Saving...
                </>
              ) : (
                <>
                  <SaveIcon />
                  {isNew ? "Create Post" : "Save Changes"}
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Feedback */}
        {fetcher.data && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${
            fetcher.data.success 
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
          }`}>
            {fetcher.data.message || fetcher.data.error}
          </div>
        )}
        
        {/* Unsaved changes indicator */}
        {hasChanges && !isNew && (
          <div className="mb-6 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded-lg text-sm flex items-center gap-2">
            <WarningIcon />
            You have unsaved changes
          </div>
        )}
        
        {/* Editor Form */}
        <div className="space-y-6">
          {/* Title & Slug */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter post title..."
                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Slug <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-r-0 border-gray-200 dark:border-gray-700 rounded-l-lg text-gray-500 dark:text-gray-400 text-sm">
                  /blog/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugManuallyEdited(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  }}
                  placeholder="post-slug"
                  disabled={!isNew}
                  className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-r-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-500"
                />
              </div>
              {!isNew && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Slug cannot be changed after creation
                </p>
              )}
            </div>
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description for SEO and previews..."
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
            />
          </div>
          
          {/* Date, Author, Tags */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Author
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Author name"
                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="travel, photography (comma-separated)"
                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-white"
              />
            </div>
          </div>
          
          {/* Status Toggle */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={!draft}
                  onChange={(e) => setDraft(!e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {draft ? "Draft" : "Published"}
              </span>
            </label>
            
            {!draft && (
              <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <PublishedIcon />
                This post is live
              </span>
            )}
          </div>
          
          {/* Content Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Content (Markdown)
            </label>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Supports Markdown formatting
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {content.length} characters
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# Your Post Title

Start writing your post content here...

You can use **bold**, *italic*, and other Markdown formatting."
                rows={20}
                className="w-full px-4 py-3 font-mono text-sm bg-transparent focus:outline-none resize-y text-gray-900 dark:text-white"
              />
            </div>
          </div>
          
          {/* Post Info (for existing posts) */}
          {!isNew && post && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Post Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">File Path</span>
                  <p className="text-gray-900 dark:text-white font-mono text-xs mt-1">
                    content/{post.path}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Reading Time</span>
                  <p className="text-gray-900 dark:text-white mt-1">
                    {post.readingTime ? `${post.readingTime} min` : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Images</span>
                  <p className="text-gray-900 dark:text-white mt-1">
                    {post.images?.length || 0}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Cover Image</span>
                  <p className="text-gray-900 dark:text-white mt-1">
                    {post.cover ? "Yes" : "No"}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Delete Section (for existing posts) */}
          {!isNew && (
            <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">Danger Zone</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Deleting a post is permanent and cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
              >
                Delete Post
              </button>
            </div>
          )}
        </div>
        
        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Delete Post?
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Are you sure you want to delete "{post?.title}"? This action cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isLoading}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isLoading}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// Icons
function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function PublishedIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
