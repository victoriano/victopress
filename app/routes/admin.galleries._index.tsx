/**
 * Admin - Galleries Explorer
 * 
 * File explorer-like interface for navigating galleries.
 * Shows folders hierarchically like Finder/Explorer.
 * 
 * GET /admin/galleries
 * GET /admin/galleries?path=geographies/europe
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Link, useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getContentIndex } from "~/lib/content-engine";
import { useState, useEffect, useCallback, useMemo } from "react";

interface GalleryItem {
  slug: string;
  title: string;
  description?: string;
  cover?: string;
  photoCount: number;
  order?: number;
  isParentGallery?: boolean;
  path: string;
  tags?: string[];
  isProtected?: boolean;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  const url = new URL(request.url);
  const currentPath = url.searchParams.get("path") || "";
  
  // Use pre-calculated content index for fast loading
  const contentIndex = await getContentIndex(storage);
  
  // Get all galleries
  const allGalleries = contentIndex.galleries;
  
  // Find the current folder's metadata (if we're in a subfolder)
  const currentFolder = currentPath 
    ? allGalleries.find(g => g.slug === currentPath)
    : null;
  
  // Filter galleries at the current level
  const galleriesAtLevel = allGalleries.filter(gallery => {
    if (!currentPath) {
      // Root level: show galleries without "/" in slug
      return !gallery.slug.includes("/");
    }
    // In a folder: show direct children only
    const prefix = currentPath + "/";
    if (!gallery.slug.startsWith(prefix)) return false;
    // Check it's a direct child (no more "/" after the prefix)
    const remainder = gallery.slug.slice(prefix.length);
    return !remainder.includes("/");
  });
  
  // Sort by order, then by title
  const sortedGalleries = [...galleriesAtLevel].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });
  
  // Calculate stats
  const totalGalleries = allGalleries.length;
  const totalPhotos = allGalleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  return json({ 
    username, 
    galleries: sortedGalleries,
    currentPath,
    currentFolder,
    totalGalleries,
    totalPhotos,
    allGalleries, // for the create modal parent selection
  });
}

export default function AdminGalleries() {
  const { 
    username, 
    galleries, 
    currentPath, 
    currentFolder,
    totalGalleries,
    totalPhotos,
    allGalleries,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fetcher = useFetcher();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  // Build breadcrumb trail
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split("/");
    const crumbs: { label: string; path: string }[] = [];
    let accumulated = "";
    
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      // Find the gallery to get its title
      const gallery = allGalleries.find((g: GalleryItem) => g.slug === accumulated);
      crumbs.push({
        label: gallery?.title || part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, " "),
        path: accumulated,
      });
    }
    return crumbs;
  }, [currentPath, allGalleries]);
  
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

  // Compute parent URL for "go back" navigation
  const parentUrl = useMemo(() => {
    if (!currentPath) return null;
    const lastSlash = currentPath.lastIndexOf("/");
    if (lastSlash === -1) {
      return "/admin/galleries";
    }
    return `/admin/galleries?path=${encodeURIComponent(currentPath.slice(0, lastSlash))}`;
  }, [currentPath]);

  // Separate folders (parent galleries or galleries with children) from leaf galleries
  const { folders, leafGalleries } = useMemo(() => {
    const folders: typeof galleries = [];
    const leafGalleries: typeof galleries = [];
    
    for (const gallery of galleries) {
      // Check if this gallery has children
      const hasChildren = allGalleries.some((g: GalleryItem) => 
        g.slug.startsWith(gallery.slug + "/")
      );
      
      if (gallery.isParentGallery || hasChildren) {
        folders.push({ ...gallery, hasChildren: true });
      } else {
        leafGalleries.push(gallery);
      }
    }
    
    return { folders, leafGalleries };
  }, [galleries, allGalleries]);

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            {parentUrl && (
              <Link
                to={parentUrl}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="Go back"
              >
                <ChevronLeftIcon />
              </Link>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentFolder?.title || "Galleries"}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
                {currentPath 
                  ? `${folders.length} folders, ${leafGalleries.length} galleries`
                  : `${totalGalleries} galleries, ${totalPhotos} photos`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1 sm:mr-2">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded ${viewMode === "grid" ? "bg-white dark:bg-gray-700 shadow-sm" : ""}`}
                title="Grid view"
              >
                <GridIcon />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded ${viewMode === "list" ? "bg-white dark:bg-gray-700 shadow-sm" : ""}`}
                title="List view"
              >
                <ListIcon />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              title="New Gallery"
              className="inline-flex items-center gap-2 px-2 sm:px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
            >
              <PlusIcon />
              <span className="hidden sm:inline">New Gallery</span>
            </button>
            <Link
              to="/admin/upload"
              title="Upload"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <UploadIcon />
              <span>Upload</span>
            </Link>
          </div>
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 mb-6 text-sm overflow-x-auto pb-2">
            <Link 
              to="/admin/galleries"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1"
            >
              <HomeIcon />
              <span>Galleries</span>
            </Link>
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.path} className="flex items-center gap-1">
                <ChevronRightSmallIcon />
                {idx === breadcrumbs.length - 1 ? (
                  <span className="text-gray-900 dark:text-white font-medium">{crumb.label}</span>
                ) : (
                  <Link
                    to={`/admin/galleries?path=${encodeURIComponent(crumb.path)}`}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    {crumb.label}
                  </Link>
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Current folder configuration */}
        {currentFolder && (
          <FolderConfigPanel folder={currentFolder} />
        )}
        
        {/* Create Gallery Modal */}
        {showCreateModal && (
          <CreateGalleryModal
            galleries={allGalleries}
            currentPath={currentPath}
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateGallery}
            isLoading={fetcher.state !== "idle"}
            error={fetcher.data?.error}
          />
        )}

        {/* Empty state */}
        {galleries.length === 0 && !currentFolder ? (
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
          <>
            {/* Folders Section */}
            {folders.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Folders
                </h2>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {folders.map((folder) => (
                      <FolderCard 
                        key={folder.slug} 
                        folder={folder} 
                      />
                    ))}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                    {folders.map((folder, idx) => (
                      <FolderRow 
                        key={folder.slug} 
                        folder={folder}
                        isLast={idx === folders.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Galleries Section (leaf galleries with photos) */}
            {leafGalleries.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  {folders.length > 0 ? "Galleries" : ""}
                </h2>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {leafGalleries.map((gallery) => (
                      <GalleryCard key={gallery.slug} gallery={gallery} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                    {leafGalleries.map((gallery, idx) => (
                      <GalleryRow 
                        key={gallery.slug} 
                        gallery={gallery}
                        isLast={idx === leafGalleries.length - 1}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Empty folder state */}
            {galleries.length === 0 && currentFolder && (
              <div className="text-center py-12 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <FolderOpenIcon />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2 mt-4">
                  This folder is empty
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  Create a new gallery or subfolder inside "{currentFolder.title}"
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
                >
                  <PlusIcon />
                  New Gallery
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// Helper to encode path segments for URLs (preserves slashes)
function encodeImagePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

// Folder Card Component (for grid view)
function FolderCard({ folder }: { folder: GalleryItem }) {
  const coverUrl = folder.cover 
    ? `/api/images/${encodeImagePath(folder.cover)}`
    : null;

  // Get child count from description or calculate
  const childInfo = folder.isParentGallery ? "Container" : `${folder.photoCount} photos`;

  return (
    <Link
      to={`/admin/galleries?path=${encodeURIComponent(folder.slug)}`}
      className="group text-left bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all block"
    >
      {/* Folder Preview */}
      <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 p-4 flex items-center justify-center relative overflow-hidden">
        {coverUrl ? (
          <>
            <img
              src={coverUrl}
              alt={folder.title}
              className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 transition-opacity"
            />
            <div className="relative">
              <FolderIconLarge />
            </div>
          </>
        ) : (
          <FolderIconLarge />
        )}
      </div>
      
      {/* Info */}
      <div className="p-3">
        <h3 className="font-medium text-gray-900 dark:text-white truncate text-sm">
          {folder.title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {childInfo}
        </p>
      </div>
    </Link>
  );
}

// Folder Row Component (for list view)
function FolderRow({ folder, isLast }: { folder: GalleryItem; isLast: boolean }) {
  return (
    <Link
      to={`/admin/galleries?path=${encodeURIComponent(folder.slug)}`}
      className={`w-full flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left block ${
        !isLast ? "border-b border-gray-100 dark:border-gray-800" : ""
      }`}
    >
      <div className="flex-shrink-0 text-amber-500">
        <FolderIconSmall />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-900 dark:text-white truncate">
          {folder.title}
        </h3>
        {folder.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {folder.description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 text-sm text-gray-400 dark:text-gray-500">
        {folder.isParentGallery ? "Folder" : `${folder.photoCount} photos`}
      </div>
      <ChevronRightIcon />
    </Link>
  );
}

// Gallery Card Component (for grid view - leaf galleries)
function GalleryCard({ gallery }: { gallery: GalleryItem }) {
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
      </div>
    </Link>
  );
}

// Gallery Row Component (for list view)
function GalleryRow({ gallery, isLast }: { gallery: GalleryItem; isLast: boolean }) {
  const coverUrl = gallery.cover 
    ? `/api/images/${encodeImagePath(gallery.cover)}`
    : null;

  return (
    <Link
      to={`/admin/galleries/${gallery.slug}`}
      className={`flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors ${
        !isLast ? "border-b border-gray-100 dark:border-gray-800" : ""
      }`}
    >
      <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
        {coverUrl ? (
          <img src={coverUrl} alt={gallery.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <ImageIcon />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-900 dark:text-white truncate">
          {gallery.title}
        </h3>
        {gallery.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {gallery.description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-4">
        {gallery.isProtected && (
          <LockIcon />
        )}
        <span className="text-sm text-gray-400 dark:text-gray-500">
          {gallery.photoCount} photos
        </span>
        <ChevronRightIcon />
      </div>
    </Link>
  );
}

// Folder Configuration Panel
function FolderConfigPanel({ folder }: { folder: GalleryItem }) {
  return (
    <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
          <FolderIconSmall />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {folder.title}
            </h3>
            <Link
              to={`/admin/galleries/${folder.slug}`}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Edit settings →
            </Link>
          </div>
          {folder.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {folder.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
            <span>Path: /{folder.slug}</span>
            {folder.order !== undefined && <span>Order: {folder.order}</span>}
          </div>
        </div>
      </div>
    </div>
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

function ImageIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function FolderIconLarge() {
  return (
    <svg className="w-16 h-16 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19.5 21a3 3 0 003-3v-9a3 3 0 00-3-3h-5.379a1.5 1.5 0 01-1.06-.44l-1.122-1.121A3 3 0 009.879 3H4.5a3 3 0 00-3 3v12a3 3 0 003 3h15z" />
    </svg>
  );
}

function FolderIconSmall() {
  return (
    <svg className="w-6 h-6 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19.5 21a3 3 0 003-3v-9a3 3 0 00-3-3h-5.379a1.5 1.5 0 01-1.06-.44l-1.122-1.121A3 3 0 009.879 3H4.5a3 3 0 00-3 3v12a3 3 0 003 3h15z" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg className="w-12 h-12 text-gray-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l1.122 1.12a3 3 0 002.12.88h5.069A2.25 2.25 0 0121.5 8.25v1.5" />
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

function ChevronLeftIcon() {
  return (
    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function ChevronRightSmallIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

// Create Gallery Modal
function CreateGalleryModal({
  galleries,
  currentPath,
  onClose,
  onCreate,
  isLoading,
  error,
}: {
  galleries: GalleryItem[];
  currentPath: string;
  onClose: () => void;
  onCreate: (data: { slug: string; title: string; description?: string; parentSlug?: string }) => void;
  isLoading: boolean;
  error?: string;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [parentSlug, setParentSlug] = useState(currentPath || "");
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
  
  // Get unique parent options (only parent galleries and galleries that can contain children)
  const parentOptions = galleries
    .filter((g) => g.isParentGallery || !g.slug.includes("/"))
    .sort((a, b) => a.slug.localeCompare(b.slug));

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
                  Parent Folder
                </label>
                <select
                  value={parentSlug}
                  onChange={(e) => setParentSlug(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Root (no parent)</option>
                  {parentOptions.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.slug.split("/").map((_, i) => "  ").join("")}{g.title}
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
