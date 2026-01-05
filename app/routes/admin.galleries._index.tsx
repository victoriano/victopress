/**
 * Admin - Galleries List
 * 
 * GET /admin/galleries
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";

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
          <Link
            to="/admin/upload"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
          >
            <PlusIcon />
            New Gallery
          </Link>
        </div>

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
