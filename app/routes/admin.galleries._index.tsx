/**
 * Admin - Galleries List
 * 
 * GET /admin/galleries
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useFetcher, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";
import { useState, useEffect, useCallback } from "react";

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Sort by order, then by title
  const galleries = [...contentIndex.galleries].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });
  
  return json({ username, galleries });
}

export default function AdminGalleries() {
  const { username, galleries } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Handle successful gallery creation - redirect
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.slug) {
      navigate(`/admin/galleries/${fetcher.data.slug}`);
    }
  }, [fetcher.data, navigate]);
  
  const handleCreateGallery = useCallback((data: { slug: string; title: string; description?: string; parentSlug?: string }) => {
    const formData = new FormData();
    formData.append("action", "create");
    formData.append("slug", data.slug);
    formData.append("title", data.title);
    if (data.description) formData.append("description", data.description);
    if (data.parentSlug) formData.append("parentSlug", data.parentSlug);
    fetcher.submit(formData, { method: "POST", action: "/api/admin/galleries" });
  }, [fetcher]);

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Galleries</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {galleries.length} galleries, {galleries.reduce((acc, g) => acc + g.photoCount, 0)} photos
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              <PlusIcon />
              New Gallery
            </button>
            <Link
              to="/admin/upload"
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <UploadIcon />
              Upload
            </Link>
          </div>
        </div>
        
        {/* Create Gallery Modal */}
        {showCreateModal && (
          <CreateGalleryModal
            galleries={galleries}
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateGallery}
            isLoading={fetcher.state !== "idle"}
            error={fetcher.data?.error}
          />
        )}

        {/* Galleries Grid */}
        {galleries.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <GalleryIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No galleries yet</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Create your first gallery by uploading photos
            </p>
            <Link
              to="/admin/upload"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              <UploadIcon />
              Upload Photos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {galleries.map((gallery) => (
              <GalleryCard key={gallery.slug} gallery={gallery} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// Helper to encode path segments for URLs (preserves slashes)
function encodeImagePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function GalleryCard({ gallery }: { gallery: any }) {
  // Build image URL with proper encoding
  const coverUrl = gallery.cover 
    ? `/api/images/${encodeImagePath(gallery.cover)}`
    : null;

  return (
    <Link
      to={`/admin/galleries/${gallery.slug}`}
      className="group bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
    >
      {/* Cover Image */}
      <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={gallery.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <GalleryIcon />
          </div>
        )}
      </div>
      
      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-gray-900 dark:text-white truncate">
              {gallery.title}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {gallery.photoCount} photos
            </p>
          </div>
          {gallery.isProtected && (
            <span className="flex-shrink-0 px-2 py-1 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded">
              Protected
            </span>
          )}
        </div>
        
        {gallery.description && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
            {gallery.description}
          </p>
        )}
        
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span>/{gallery.slug}</span>
          {gallery.order !== undefined && (
            <>
              <span>•</span>
              <span>Order: {gallery.order}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

// Icons
function GalleryIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
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

function UploadIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

// Create Gallery Modal
function CreateGalleryModal({
  galleries,
  onClose,
  onCreate,
  isLoading,
  error,
}: {
  galleries: any[];
  onClose: () => void;
  onCreate: (data: { slug: string; title: string; description?: string; parentSlug?: string }) => void;
  isLoading: boolean;
  error?: string;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [parentSlug, setParentSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  
  // Auto-generate slug from title
  useEffect(() => {
    if (!slugManuallyEdited && title) {
      const generated = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      setSlug(generated);
    }
  }, [title, slugManuallyEdited]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;
    onCreate({
      title: title.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
      parentSlug: parentSlug || undefined,
    });
  };
  
  // Get unique parent options (top-level and parent galleries)
  const parentOptions = galleries
    .filter((g) => !g.slug.includes("/") || g.isParentGallery)
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full">
        <form onSubmit={handleSubmit}>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Create New Gallery
            </h3>
            
            {error && (
              <div className="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Gallery Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Tokyo 2024"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  URL Slug *
                </label>
                <div className="flex items-center">
                  <span className="text-gray-500 dark:text-gray-400 text-sm mr-1">/gallery/</span>
                  {parentSlug && (
                    <span className="text-gray-500 dark:text-gray-400 text-sm">{parentSlug}/</span>
                  )}
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                      setSlugManuallyEdited(true);
                    }}
                    placeholder="tokyo-2024"
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Lowercase letters, numbers, and hyphens only
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Parent Gallery (optional)
                </label>
                <select
                  value={parentSlug}
                  onChange={(e) => setParentSlug(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">No parent (root gallery)</option>
                  {parentOptions.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief description of this gallery..."
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim() || !slug.trim()}
              className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Creating..." : "Create Gallery"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
