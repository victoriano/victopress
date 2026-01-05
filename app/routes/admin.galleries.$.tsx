/**
 * Admin - Gallery Detail
 * 
 * GET /admin/galleries/:slug
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Form, Link, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getGalleryFromIndex, getAllGalleriesFromIndex, getContentIndex } from "~/lib/content-engine";
import { useState } from "react";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const slug = params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Use pre-calculated index for fast loading
  const gallery = await getGalleryFromIndex(storage, slug);
  
  if (!gallery) {
    throw new Response("Gallery not found", { status: 404 });
  }
  
  // Get content index for navigation lookups
  const contentIndex = await getContentIndex(storage);
  
  // Find parent gallery (if this is a nested gallery)
  const slugParts = slug.split("/");
  let parentGallery = null;
  if (slugParts.length > 1) {
    const parentSlug = slugParts.slice(0, -1).join("/");
    const foundParent = contentIndex.galleryData.find((g) => g.slug === parentSlug);
    parentGallery = foundParent || {
      slug: parentSlug,
      title: slugParts[slugParts.length - 2]
        .split("-")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      isVirtual: true,
    };
  }
  
  // Find child galleries from index
  const childGalleries = contentIndex.galleryData
    .filter((g) => g.slug.startsWith(slug + "/") && !g.slug.slice(slug.length + 1).includes("/"))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  
  return json({ username, gallery, parentGallery, childGalleries });
}

export default function AdminGalleryDetail() {
  const { username, gallery, parentGallery, childGalleries } = useLoaderData<typeof loader>();
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const togglePhoto = (photoId: string) => {
    setSelectedPhotos((prev) =>
      prev.includes(photoId)
        ? prev.filter((id) => id !== photoId)
        : [...prev, photoId]
    );
  };

  const toggleAll = () => {
    if (selectedPhotos.length === gallery.photos.length) {
      setSelectedPhotos([]);
    } else {
      setSelectedPhotos(gallery.photos.map((p) => p.id));
    }
  };

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            {/* Breadcrumb with parent galleries */}
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2 flex-wrap">
              <Link to="/admin/galleries" className="hover:text-gray-700 dark:hover:text-gray-300">
                Galleries
              </Link>
              {gallery.slug.split("/").map((part, index, arr) => {
                const partialSlug = arr.slice(0, index + 1).join("/");
                const isLast = index === arr.length - 1;
                return (
                  <span key={partialSlug} className="flex items-center gap-2">
                    <span>/</span>
                    {isLast ? (
                      <span className="text-gray-900 dark:text-white">{gallery.title}</span>
                    ) : (
                      <Link 
                        to={`/admin/galleries/${partialSlug}`}
                        className="hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        {part.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                      </Link>
                    )}
                  </span>
                );
              })}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{gallery.title}</h1>
            {gallery.description && (
              <p className="text-gray-500 dark:text-gray-400 mt-1">{gallery.description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Link
              to={`/gallery/${gallery.slug}`}
              target="_blank"
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
            >
              <ExternalIcon />
              View
            </Link>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-sm ${
                showSettings 
                  ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <SettingsIcon />
              Settings
            </button>
          </div>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && (
          <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6">
            <h3 className="font-medium text-gray-900 dark:text-white mb-4">Gallery Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <label className="block text-gray-500 dark:text-gray-400 mb-1">Title</label>
                <input 
                  type="text" 
                  defaultValue={gallery.title}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-gray-500 dark:text-gray-400 mb-1">Order</label>
                <input 
                  type="number" 
                  defaultValue={gallery.order ?? ""}
                  placeholder="Not set"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
                  readOnly
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-gray-500 dark:text-gray-400 mb-1">Description</label>
                <textarea 
                  defaultValue={gallery.description || ""}
                  placeholder="No description"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
                  rows={2}
                  readOnly
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
              Edit <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/{gallery.path}/gallery.yaml</code> to change settings
            </p>
          </div>
        )}

        {/* Gallery Info Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <InfoCard label="Photos" value={gallery.photoCount.toString()} />
          <InfoCard label="Order" value={gallery.order?.toString() ?? "—"} />
          <InfoCard 
            label="Status" 
            value={gallery.private ? "Private" : gallery.password ? "Protected" : "Public"} 
            variant={gallery.private ? "warning" : gallery.password ? "info" : "success"}
          />
          <InfoCard 
            label="Parent" 
            value={parentGallery ? parentGallery.title : "Root"}
            href={parentGallery ? `/admin/galleries/${parentGallery.slug}` : undefined}
          />
          <InfoCard label="Children" value={childGalleries.length.toString()} />
        </div>

        {/* Child Galleries */}
        {childGalleries.length > 0 && (
          <div className="mb-6">
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">Child Galleries</h3>
            <div className="flex flex-wrap gap-2">
              {childGalleries.map((child: any) => (
                <Link
                  key={child.slug}
                  to={`/admin/galleries/${child.slug}`}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-700 transition-colors text-sm"
                >
                  <FolderIcon />
                  <span className="font-medium text-gray-900 dark:text-white">{child.title}</span>
                  <span className="text-gray-500 dark:text-gray-400">({child.photoCount})</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleAll}
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              {selectedPhotos.length === gallery.photos.length ? "Deselect all" : "Select all"}
            </button>
            {selectedPhotos.length > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {selectedPhotos.length} selected
              </span>
            )}
          </div>
          
          {selectedPhotos.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Hide
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Photos Grid */}
        {gallery.photos.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <PhotoIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No photos</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Upload photos to this gallery
            </p>
            <Link
              to={`/admin/upload?gallery=${gallery.slug}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              <UploadIcon />
              Upload Photos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {gallery.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                gallerySlug={gallery.slug}
                isSelected={selectedPhotos.includes(photo.id)}
                onToggle={() => togglePhoto(photo.id)}
              />
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

function PhotoCard({
  photo,
  gallerySlug,
  isSelected,
  onToggle,
}: {
  photo: any;
  gallerySlug: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  
  // Build image URL with proper encoding for paths with spaces
  const imageUrl = `/api/local-images/${encodeImagePath(photo.path)}`;

  return (
    <div
      className={`group relative aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden ${
        isSelected ? "ring-2 ring-blue-500" : ""
      }`}
    >
      <img
        src={imageUrl}
        alt={photo.title || photo.filename}
        className="w-full h-full object-cover"
      />
      
      {/* Hover overlay - pointer-events-none so clicks pass through */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end pointer-events-none">
        <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-white text-sm truncate">{photo.title || photo.filename}</p>
        </div>
      </div>
      
      {/* Selection checkbox - z-10 to ensure it's above everything */}
      <button
        type="button"
        onClick={onToggle}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
          isSelected
            ? "bg-blue-500 border-blue-500 text-white"
            : "bg-white/80 border-gray-300 text-transparent hover:border-gray-400"
        }`}
      >
        <CheckIcon />
      </button>
      
      {/* Hidden indicator */}
      {photo.hidden && (
        <div className="absolute top-2 right-2 z-10 px-2 py-1 bg-gray-900/70 text-white text-xs rounded">
          Hidden
        </div>
      )}
    </div>
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

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
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

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function InfoCard({ 
  label, 
  value, 
  variant = "default",
  href
}: { 
  label: string; 
  value: string; 
  variant?: "default" | "success" | "warning" | "info";
  href?: string;
}) {
  const variantColors = {
    default: "text-gray-900 dark:text-white",
    success: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    info: "text-blue-600 dark:text-blue-400",
  };

  const content = (
    <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
      <p className={`font-semibold text-lg mt-1 ${variantColors[variant]}`}>{value}</p>
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="block hover:ring-2 hover:ring-blue-500 rounded-xl transition-shadow">
        {content}
      </Link>
    );
  }

  return content;
}
