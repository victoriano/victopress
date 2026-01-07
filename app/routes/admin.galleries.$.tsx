/**
 * Admin - Gallery Detail
 * 
 * GET /admin/galleries/:slug
 * Full CRUD operations for galleries and photos
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, Form, Link, useFetcher, useNavigate } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import { AdminLayout } from "~/components/AdminLayout";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";
import { getStorage, getGalleryFromIndex, getAllGalleriesFromIndex, getContentIndex } from "~/lib/content-engine";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";

// Drag and drop
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const slug = params["*"];
  if (!slug) {
    throw new Response("Not Found", { status: 404 });
  }
  
  const username = getAdminUser(request);
  const storage = getStorage(context);
  
  // Get content index for lookups
  const contentIndex = await getContentIndex(storage);
  
  // Use pre-calculated index for fast loading
  const gallery = await getGalleryFromIndex(storage, slug);
  
  // Find child galleries from index (direct children only)
  const childGalleries = contentIndex.galleryData
    .filter((g) => g.slug.startsWith(slug + "/") && !g.slug.slice(slug.length + 1).includes("/"))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  
  // If gallery not found in index, it might be a virtual parent
  if (!gallery) {
    // Check if there are any child galleries
    if (childGalleries.length > 0) {
      // This is a virtual parent gallery - create a virtual gallery object
      const slugParts = slug.split("/");
      const virtualGallery = {
        slug,
        title: slugParts[slugParts.length - 1]
          .split("-")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
        description: null,
        photos: [],
        photoCount: 0,
        isProtected: false,
        isVirtual: true,
      };
      
      // Find parent gallery for breadcrumbs
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
      
      return json({ username, gallery: virtualGallery, parentGallery, childGalleries, isVirtualParent: true, allGalleries: [] });
    }
    
    // No gallery and no children - truly not found
    throw new Response("Gallery not found", { status: 404 });
  }
  
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
  
  // Get all galleries for move photos modal
  const allGalleries = contentIndex.galleryData
    .filter((g) => g.slug !== slug && !g.isParentGallery)
    .sort((a, b) => a.title.localeCompare(b.title));
  
  return json({ username, gallery, parentGallery, childGalleries, isVirtualParent: false, allGalleries });
}

export default function AdminGalleryDetail() {
  const { username, gallery, parentGallery, childGalleries, isVirtualParent, allGalleries } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMovePhotosModal, setShowMovePhotosModal] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null);
  const [isReorderMode, setIsReorderMode] = useState(false);
  
  // Fetchers for different operations
  const galleryFetcher = useFetcher();
  const photosFetcher = useFetcher();
  const reorderFetcher = useFetcher();
  
  // Track ordered photos (for drag and drop)
  const [orderedPhotos, setOrderedPhotos] = useState(gallery.photos);
  
  // Update ordered photos when gallery changes
  useEffect(() => {
    setOrderedPhotos(gallery.photos);
  }, [gallery.photos]);
  
  // Photo IDs for sortable context (using path for uniqueness across galleries)
  const photoIds = useMemo(() => orderedPhotos.map((p) => p.path), [orderedPhotos]);
  
  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum drag distance before activation
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Handle drag end - reorder photos
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setOrderedPhotos((items) => {
        const oldIndex = items.findIndex((p) => p.path === active.id);
        const newIndex = items.findIndex((p) => p.path === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);
  
  // Save reordered photos
  const savePhotoOrder = useCallback(() => {
    const order = orderedPhotos.map((p) => p.filename);
    const formData = new FormData();
    formData.append("action", "reorder");
    formData.append("galleryPath", gallery.path);
    formData.append("order", JSON.stringify(order));
    
    reorderFetcher.submit(formData, {
      method: "POST",
      action: "/api/admin/photos",
    });
    
    setIsReorderMode(false);
  }, [orderedPhotos, gallery.path, reorderFetcher]);
  
  // Cancel reorder
  const cancelReorder = useCallback(() => {
    setOrderedPhotos(gallery.photos);
    setIsReorderMode(false);
  }, [gallery.photos]);
  
  // Check if order has changed
  const hasOrderChanged = useMemo(() => {
    if (orderedPhotos.length !== gallery.photos.length) return true;
    return orderedPhotos.some((p, i) => p.path !== gallery.photos[i]?.path);
  }, [orderedPhotos, gallery.photos]);
  
  // Handle successful gallery deletion - redirect
  useEffect(() => {
    if (galleryFetcher.data?.success && galleryFetcher.formData?.get("action") === "delete") {
      navigate("/admin/galleries");
    }
  }, [galleryFetcher.data, galleryFetcher.formData, navigate]);
  
  // Handle successful photo operations - clear selection
  useEffect(() => {
    if (photosFetcher.data?.success) {
      setSelectedPhotos([]);
      setShowMovePhotosModal(false);
      setEditingPhoto(null);
    }
  }, [photosFetcher.data]);

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
  
  // Gallery actions
  const handleDeleteGallery = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("slug", gallery.slug);
    formData.append("confirm", "true");
    galleryFetcher.submit(formData, { method: "POST", action: "/api/admin/galleries" });
  }, [gallery.slug, galleryFetcher]);
  
  const handleUpdateGallery = useCallback((updates: Record<string, string>) => {
    const formData = new FormData();
    formData.append("action", "update");
    formData.append("slug", gallery.slug);
    Object.entries(updates).forEach(([key, value]) => {
      formData.append(key, value);
    });
    galleryFetcher.submit(formData, { method: "POST", action: "/api/admin/galleries" });
  }, [gallery.slug, galleryFetcher]);
  
  // Photo actions
  const handleDeletePhotos = useCallback(() => {
    if (selectedPhotos.length === 0) return;
    
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("galleryPath", gallery.path);
    
    // Get photo paths for selected photos
    for (const photoId of selectedPhotos) {
      const photo = gallery.photos.find((p: { id: string }) => p.id === photoId);
      if (photo) {
        formData.append("photoPaths", photo.path);
      }
    }
    
    photosFetcher.submit(formData, { method: "POST", action: "/api/admin/photos" });
  }, [selectedPhotos, gallery, photosFetcher]);
  
  const handleToggleVisibility = useCallback((hidden: boolean) => {
    if (selectedPhotos.length === 0) return;
    
    const formData = new FormData();
    formData.append("action", "toggle-visibility");
    formData.append("galleryPath", gallery.path);
    formData.append("hidden", hidden.toString());
    
    for (const photoId of selectedPhotos) {
      const photo = gallery.photos.find((p: { id: string }) => p.id === photoId);
      if (photo) {
        formData.append("photoPaths", photo.path);
      }
    }
    
    photosFetcher.submit(formData, { method: "POST", action: "/api/admin/photos" });
  }, [selectedPhotos, gallery, photosFetcher]);
  
  const handleMovePhotos = useCallback((toGalleryPath: string) => {
    if (selectedPhotos.length === 0 || !toGalleryPath) return;
    
    const formData = new FormData();
    formData.append("action", "move");
    formData.append("fromGalleryPath", gallery.path);
    formData.append("toGalleryPath", toGalleryPath);
    
    for (const photoId of selectedPhotos) {
      const photo = gallery.photos.find((p: { id: string }) => p.id === photoId);
      if (photo) {
        formData.append("photoPaths", photo.path);
      }
    }
    
    photosFetcher.submit(formData, { method: "POST", action: "/api/admin/photos" });
  }, [selectedPhotos, gallery, photosFetcher]);
  
  const isOperationPending = galleryFetcher.state !== "idle" || photosFetcher.state !== "idle";

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 mb-6 text-sm overflow-x-auto pb-2">
          <Link 
            to="/admin/galleries"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1"
          >
            <HomeIcon />
            <span>Galleries</span>
          </Link>
          {gallery.slug.split("/").map((part, index, arr) => {
            const partialSlug = arr.slice(0, index + 1).join("/");
            const isLast = index === arr.length - 1;
            // Try to get the title from parent gallery or generate from slug
            const partTitle = part.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            const displayTitle = isLast ? gallery.title : partTitle;
            return (
              <div key={partialSlug} className="flex items-center gap-1">
                <ChevronRightSmallIcon />
                {isLast ? (
                  <span className="text-gray-900 dark:text-white font-medium">{displayTitle}</span>
                ) : (
                  <Link
                    to={`/admin/galleries?path=${encodeURIComponent(partialSlug)}`}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    {displayTitle}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-3">
            {/* Status icon - clickable to open settings */}
            {!isVirtualParent && !gallery.isParentGallery && (
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                title={`${gallery.private ? "Private" : gallery.password ? "Protected" : "Public"} - Click to edit`}
                className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {gallery.private ? (
                  <EyeOffIcon className="w-5 h-5 text-yellow-500" />
                ) : gallery.password ? (
                  <LockIcon className="w-5 h-5 text-blue-500" />
                ) : (
                  <GlobeIcon className="w-5 h-5 text-green-500" />
                )}
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{gallery.title}</h1>
              {gallery.description && (
                <p className="text-gray-500 dark:text-gray-400 mt-1">{gallery.description}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isVirtualParent && (
              <Link
                to={`/gallery/${gallery.slug}`}
                target="_blank"
                className="inline-flex items-center gap-2 px-2 sm:px-3 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                title="View"
              >
                <ExternalIcon />
                <span className="hidden sm:inline">View</span>
              </Link>
            )}
            {!isVirtualParent && (
              <Link
                to={`/admin/upload?gallery=${gallery.slug}`}
                className="inline-flex items-center gap-2 px-2 sm:px-3 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
                title="Upload"
              >
                <UploadIcon />
                <span className="hidden sm:inline">Upload</span>
              </Link>
            )}
            {!isVirtualParent && (
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                title="Settings"
                className={`inline-flex items-center gap-2 px-2 sm:px-3 py-2 border rounded-lg transition-colors text-sm ${
                  showSettings 
                    ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <SettingsIcon />
                <span className="hidden sm:inline">Settings</span>
              </button>
            )}
            {isVirtualParent && (
              <span className="px-3 py-1.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
                Virtual Container
              </span>
            )}
          </div>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && (
          <GallerySettingsPanel 
            gallery={gallery}
            onUpdate={handleUpdateGallery}
            onDelete={() => setShowDeleteConfirm(true)}
            isLoading={galleryFetcher.state !== "idle"}
          />
        )}
        
        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <DeleteConfirmModal
            title="Delete Gallery"
            message={`Are you sure you want to delete "${gallery.title}"? This will permanently delete all ${gallery.photoCount} photos in this gallery.`}
            onConfirm={handleDeleteGallery}
            onCancel={() => setShowDeleteConfirm(false)}
            isLoading={galleryFetcher.state !== "idle"}
          />
        )}
        
        {/* Move Photos Modal */}
        {showMovePhotosModal && (
          <MovePhotosModal
            selectedCount={selectedPhotos.length}
            galleries={allGalleries}
            currentGalleryPath={gallery.path}
            onMove={handleMovePhotos}
            onCancel={() => setShowMovePhotosModal(false)}
            isLoading={photosFetcher.state !== "idle"}
          />
        )}
        
        {/* Photo Edit Modal */}
        {editingPhoto && (
          <PhotoEditModal
            photo={gallery.photos.find(p => p.id === editingPhoto)!}
            gallerySlug={gallery.slug}
            onSave={(updates) => {
              const photo = gallery.photos.find(p => p.id === editingPhoto);
              if (!photo) return;
              
              const formData = new FormData();
              formData.append("action", "update");
              formData.append("galleryPath", gallery.path);
              formData.append("photoPath", photo.path);
              formData.append("filename", photo.filename);
              
              if (updates.title !== undefined) formData.append("title", updates.title);
              if (updates.description !== undefined) formData.append("description", updates.description);
              if (updates.tags !== undefined) formData.append("tags", updates.tags.join(","));
              if (updates.hidden !== undefined) formData.append("hidden", updates.hidden.toString());
              if (updates.featured !== undefined) formData.append("featured", updates.featured.toString());
              if (updates.date !== undefined) formData.append("date", updates.date);
              
              photosFetcher.submit(formData, {
                method: "POST",
                action: "/api/admin/photos",
              });
            }}
            onCancel={() => setEditingPhoto(null)}
            isLoading={photosFetcher.state !== "idle"}
          />
        )}

        {/* Child Galleries */}
        {childGalleries.length > 0 && (
          <div className="mb-6">
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">
              {childGalleries.length} {childGalleries.length === 1 ? 'Child Gallery' : 'Child Galleries'}
            </h3>
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

        {/* Virtual Container Notice - no gallery.yaml, just a folder */}
        {isVirtualParent && (
          <div className="text-center py-12 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="w-16 h-16 mx-auto mb-4 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-sm">
              <FolderIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Virtual Container</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-4">
              This folder organizes child galleries but has no configuration. 
              Create a <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm">gallery.yaml</code> to customize it.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Path: <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">content/galleries/{gallery.slug}/gallery.yaml</code>
            </p>
          </div>
        )}

        {/* Parent Gallery Notice - has gallery.yaml but no direct photos */}
        {!isVirtualParent && gallery.isParentGallery && gallery.photos.length === 0 && (
          <div className="text-center py-12 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="w-16 h-16 mx-auto mb-4 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-sm">
              <FolderIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Parent Gallery</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-4">
              This gallery has settings but no direct photos. You can upload photos or configure it to show photos from child galleries.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                to={`/admin/upload?gallery=${gallery.slug}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors text-sm font-medium"
              >
                <UploadIcon />
                Upload Photos
              </Link>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
              >
                <SettingsIcon />
                Configure
              </button>
            </div>
          </div>
        )}

        {/* Toolbar & Photos - for galleries with photos */}
        {!isVirtualParent && gallery.photos.length > 0 && (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                {!isReorderMode ? (
                  <>
                    <button
                      onClick={toggleAll}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      {selectedPhotos.length === gallery.photos.length 
                        ? "Deselect all" 
                        : `Select all (${gallery.photos.length})`}
                    </button>
                    {selectedPhotos.length > 0 && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedPhotos.length} selected
                      </span>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <DragIcon />
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                      Drag to reorder ({gallery.photos.length} photos)
                    </span>
                  </div>
                )}
              </div>
              
              {/* Reorder mode controls */}
              {isReorderMode ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelReorder}
                    className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={savePhotoOrder}
                    disabled={!hasOrderChanged || reorderFetcher.state !== "idle"}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {reorderFetcher.state !== "idle" ? (
                      <>
                        <LoadingSpinner />
                        Saving...
                      </>
                    ) : (
                      "Save Order"
                    )}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* Reorder button - always visible when not in reorder mode */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPhotos([]);
                      setIsReorderMode(true);
                    }}
                    className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <DragIcon />
                    Reorder
                  </button>
                  
                  {/* Selection action buttons */}
                  {selectedPhotos.length > 0 && (
                    <>
                      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
                      <button
                        type="button"
                        onClick={() => handleToggleVisibility(true)}
                        disabled={isOperationPending}
                        className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Hide
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleVisibility(false)}
                        disabled={isOperationPending}
                        className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Show
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMovePhotosModal(true)}
                        disabled={isOperationPending}
                        className="px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        onClick={handleDeletePhotos}
                        disabled={isOperationPending}
                        className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* Operation feedback */}
            {photosFetcher.data && (
              <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                photosFetcher.data.success 
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              }`}>
                {photosFetcher.data.message || photosFetcher.data.error}
              </div>
            )}
            
            {/* Reorder feedback */}
            {reorderFetcher.data && (
              <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
                reorderFetcher.data.success 
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
              }`}>
                {reorderFetcher.data.message || reorderFetcher.data.error}
              </div>
            )}

            {/* Photos Grid - with drag and drop support */}
            {isReorderMode ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={photoIds} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {orderedPhotos.map((photo) => (
                      <SortablePhotoCard
                        key={photo.path}
                        photo={photo}
                        gallerySlug={gallery.slug}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {gallery.photos.map((photo) => (
                  <PhotoCard
                    key={photo.path}
                    photo={photo}
                    gallerySlug={gallery.slug}
                    isSelected={selectedPhotos.includes(photo.id)}
                    onToggle={() => togglePhoto(photo.id)}
                    onEdit={() => setEditingPhoto(photo.id)}
                  />
                ))}
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

function PhotoCard({
  photo,
  gallerySlug,
  isSelected,
  onToggle,
  onEdit,
}: {
  photo: any;
  gallerySlug: string;
  isSelected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  // Build image URL with proper encoding for paths with spaces
  const imageUrl = `/api/images/${encodeImagePath(photo.path)}`;

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
      
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end">
        <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-white text-sm truncate">{photo.title || photo.filename}</p>
        </div>
      </div>
      
      {/* Selection checkbox - top left */}
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
      
      {/* Edit button - top right (shown on hover) */}
      <button
        type="button"
        onClick={onEdit}
        className="absolute top-2 right-2 z-10 w-7 h-7 rounded bg-white/90 dark:bg-gray-800/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white dark:hover:bg-gray-700 shadow-sm"
        title="Edit photo"
      >
        <EditIcon />
      </button>
      
      {/* Hidden indicator - below edit button */}
      {photo.hidden && (
        <div className="absolute top-11 right-2 z-10 px-2 py-1 bg-gray-900/70 text-white text-xs rounded">
          Hidden
        </div>
      )}
      
      {/* Featured indicator */}
      {photo.featured && (
        <div className="absolute bottom-2 right-2 z-10 text-yellow-400">
          <StarIcon />
        </div>
      )}
    </div>
  );
}

// Sortable Photo Card for drag-and-drop reordering
function SortablePhotoCard({
  photo,
  gallerySlug,
}: {
  photo: any;
  gallerySlug: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 1,
  };

  // Build image URL with proper encoding for paths with spaces
  const imageUrl = `/api/images/${encodeImagePath(photo.path)}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing ${
        isDragging ? "ring-2 ring-blue-500 shadow-lg" : ""
      }`}
    >
      <img
        src={imageUrl}
        alt={photo.title || photo.filename}
        className="w-full h-full object-cover pointer-events-none"
        draggable={false}
      />
      
      {/* Drag indicator overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-gray-900/90 rounded-full p-2 shadow-lg">
          <DragIcon />
        </div>
      </div>
      
      {/* Photo info at bottom */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
        <p className="text-white text-sm truncate">{photo.title || photo.filename}</p>
      </div>
      
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
function DragIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
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

function HomeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function ChevronRightSmallIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-5 h-5"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
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

// Gallery Settings Panel Component
function GallerySettingsPanel({
  gallery,
  onUpdate,
  onDelete,
  isLoading,
}: {
  gallery: any;
  onUpdate: (updates: Record<string, string>) => void;
  onDelete: () => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState(gallery.title);
  const [description, setDescription] = useState(gallery.description || "");
  const [order, setOrder] = useState(gallery.order?.toString() || "");
  const [isPrivate, setIsPrivate] = useState(gallery.private || false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Track changes
  useEffect(() => {
    const titleChanged = title !== gallery.title;
    const descChanged = description !== (gallery.description || "");
    const orderChanged = order !== (gallery.order?.toString() || "");
    const privateChanged = isPrivate !== (gallery.private || false);
    setHasChanges(titleChanged || descChanged || orderChanged || privateChanged);
  }, [title, description, order, isPrivate, gallery]);
  
  const handleSave = () => {
    const updates: Record<string, string> = {};
    if (title !== gallery.title) updates.title = title;
    if (description !== (gallery.description || "")) updates.description = description;
    if (order !== (gallery.order?.toString() || "")) updates.order = order;
    if (isPrivate !== (gallery.private || false)) updates.private = isPrivate.toString();
    onUpdate(updates);
  };

  return (
    <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-gray-900 dark:text-white">Gallery Settings</h3>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Saving..." : "Save Changes"}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Delete Gallery
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <label className="block text-gray-500 dark:text-gray-400 mb-1">Title</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-gray-500 dark:text-gray-400 mb-1">Order</label>
          <input 
            type="number" 
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            placeholder="Not set (defaults to 999)"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-gray-500 dark:text-gray-400 mb-1">Description</label>
          <textarea 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description for this gallery..."
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={2}
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-700 dark:text-gray-300">Private (hidden from public listing)</span>
          </label>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          <span className="font-medium">Path:</span>{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">content/{gallery.path}</code>
        </p>
      </div>
    </div>
  );
}

// Delete Confirmation Modal
function DeleteConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  isLoading,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-6">{message}</p>
        
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Move Photos Modal
function MovePhotosModal({
  selectedCount,
  galleries,
  currentGalleryPath,
  onMove,
  onCancel,
  isLoading,
}: {
  selectedCount: number;
  galleries: any[];
  currentGalleryPath: string;
  onMove: (toGalleryPath: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [selectedGalleryPath, setSelectedGalleryPath] = useState("");
  
  // Filter out current gallery from the list
  const availableGalleries = galleries.filter(g => g.path !== currentGalleryPath);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Move {selectedCount} Photo{selectedCount !== 1 ? "s" : ""}
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Select a destination gallery:
        </p>
        
        <select
          value={selectedGalleryPath}
          onChange={(e) => setSelectedGalleryPath(e.target.value)}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-6"
        >
          <option value="">Select a gallery...</option>
          {availableGalleries.map((g) => (
            <option key={g.path} value={g.path}>
              {g.title} ({g.photoCount} photos)
            </option>
          ))}
        </select>
        
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onMove(selectedGalleryPath)}
            disabled={isLoading || !selectedGalleryPath}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Moving..." : "Move Photos"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Photo Edit Modal - Edit individual photo metadata
function PhotoEditModal({
  photo,
  gallerySlug,
  onSave,
  onCancel,
  isLoading,
}: {
  photo: any;
  gallerySlug: string;
  onSave: (updates: {
    title?: string;
    description?: string;
    tags?: string[];
    hidden?: boolean;
    featured?: boolean;
    date?: string;
  }) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState(photo.title || "");
  const [description, setDescription] = useState(photo.description || "");
  const [tags, setTags] = useState((photo.tags || []).join(", "));
  const [hidden, setHidden] = useState(photo.hidden || false);
  const [featured, setFeatured] = useState(photo.featured || false);
  const [date, setDate] = useState(photo.dateTaken ? new Date(photo.dateTaken).toISOString().split("T")[0] : "");
  
  // Variant management state
  interface VariantInfo {
    width: number;
    filename: string;
    path: string;
    exists: boolean;
    size: number | null;
    url: string;
  }
  const [variants, setVariants] = useState<VariantInfo[]>([]);
  const [originalSize, setOriginalSize] = useState<number | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(true);
  const [variantsOperationLoading, setVariantsOperationLoading] = useState(false);
  const [previewVariant, setPreviewVariant] = useState<VariantInfo | null>(null);
  
  const imageUrl = `/api/images/${encodeImagePath(photo.path)}`;
  
  // Fetch variants on mount
  useEffect(() => {
    async function fetchVariants() {
      setVariantsLoading(true);
      try {
        const formData = new FormData();
        formData.append("action", "get-variants");
        formData.append("photoPath", photo.path);
        
        const response = await fetch("/api/admin/photos", {
          method: "POST",
          body: formData,
        });
        
        const data = await response.json();
        if (data.success) {
          setVariants(data.variants || []);
          setOriginalSize(data.originalSize);
        }
      } catch (err) {
        console.error("Failed to fetch variants:", err);
      } finally {
        setVariantsLoading(false);
      }
    }
    
    fetchVariants();
  }, [photo.path]);
  
  // Delete all variants
  const handleDeleteVariants = async () => {
    if (!confirm("Delete all optimized variants? You can regenerate them later.")) return;
    
    setVariantsOperationLoading(true);
    try {
      const formData = new FormData();
      formData.append("action", "delete-variants");
      formData.append("photoPath", photo.path);
      
      const response = await fetch("/api/admin/photos", {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh variants list
        setVariants(variants.map(v => ({ ...v, exists: false, size: null })));
      }
    } catch (err) {
      console.error("Failed to delete variants:", err);
    } finally {
      setVariantsOperationLoading(false);
    }
  };
  
  // Regenerate variants
  const handleRegenerateVariants = async () => {
    setVariantsOperationLoading(true);
    try {
      const formData = new FormData();
      formData.append("action", "regenerate-variants");
      formData.append("photoPath", photo.path);
      
      const response = await fetch("/api/admin/photos", {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh variants list
        const newVariants = variants.map(v => {
          const generated = data.variants?.find((gv: any) => gv.width === v.width);
          if (generated) {
            return { ...v, exists: true, size: generated.size };
          }
          return v;
        });
        setVariants(newVariants);
      }
    } catch (err) {
      console.error("Failed to regenerate variants:", err);
    } finally {
      setVariantsOperationLoading(false);
    }
  };
  
  // Format bytes to human-readable
  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title: title || undefined,
      description: description || undefined,
      tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      hidden,
      featured,
      date: date || undefined,
    });
  };
  
  // Count existing variants
  const existingVariantsCount = variants.filter(v => v.exists).length;
  const totalVariantsCount = variants.length;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header with image preview */}
        <div className="relative h-48 bg-gray-100 dark:bg-gray-800">
          <img
            src={imageUrl}
            alt={photo.filename}
            className="w-full h-full object-contain"
          />
          <button
            type="button"
            onClick={onCancel}
            className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          >
            <CloseIcon />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Edit Photo
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{photo.filename}</p>
          
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a title..."
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter a description..."
                rows={3}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
            
            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="landscape, nature, sunset (comma-separated)"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Separate tags with commas
              </p>
            </div>
            
            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {/* Toggles */}
            <div className="flex items-center gap-6 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Hidden</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Featured</span>
              </label>
            </div>
            
            {/* Optimized Variants Section */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Optimized Variants
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRegenerateVariants}
                    disabled={variantsOperationLoading}
                    className="px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    {variantsOperationLoading ? <LoadingSpinner /> : <RefreshIcon />}
                    Regenerate
                  </button>
                  {existingVariantsCount > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteVariants}
                      disabled={variantsOperationLoading}
                      className="px-2.5 py-1 text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                      <TrashIcon />
                      Delete All
                    </button>
                  )}
                </div>
              </div>
              
              {variantsLoading ? (
                <div className="flex items-center justify-center py-4 text-gray-500 dark:text-gray-400">
                  <LoadingSpinner />
                  <span className="ml-2 text-sm">Loading variants...</span>
                </div>
              ) : (
                <>
                  {/* Original file size */}
                  <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                    Original: <span className="font-medium">{formatBytes(originalSize)}</span>
                    {existingVariantsCount > 0 && (
                      <span className="ml-2 text-green-600 dark:text-green-400">
                        • {existingVariantsCount}/{totalVariantsCount} variants ready
                      </span>
                    )}
                    {existingVariantsCount === 0 && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        • No variants generated
                      </span>
                    )}
                  </div>
                  
                  {/* Variants grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {variants.map((variant) => (
                      <div
                        key={variant.width}
                        className={`relative rounded-lg border overflow-hidden ${
                          variant.exists 
                            ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" 
                            : "border-dashed border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800/50"
                        }`}
                      >
                        {/* Thumbnail preview */}
                        <div className="aspect-video bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          {variant.exists ? (
                            <button
                              type="button"
                              onClick={() => setPreviewVariant(variant)}
                              className="w-full h-full"
                            >
                              <img
                                src={variant.url}
                                alt={`${variant.width}w variant`}
                                className="w-full h-full object-cover hover:opacity-90 transition-opacity"
                              />
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              Not generated
                            </span>
                          )}
                        </div>
                        
                        {/* Info */}
                        <div className="p-2 text-center">
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {variant.width}w
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">
                            {variant.exists ? formatBytes(variant.size) : "—"}
                          </div>
                        </div>
                        
                        {/* Status indicator */}
                        <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                          variant.exists 
                            ? "bg-green-500" 
                            : "bg-gray-400"
                        }`} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            
            {/* EXIF Info (read-only) */}
            {photo.exif && (
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Camera Info (from EXIF)
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {photo.exif.camera && (
                    <div>Camera: {photo.exif.camera}</div>
                  )}
                  {photo.exif.lens && (
                    <div>Lens: {photo.exif.lens}</div>
                  )}
                  {photo.exif.focalLength && (
                    <div>Focal Length: {photo.exif.focalLength}mm</div>
                  )}
                  {photo.exif.aperture && (
                    <div>Aperture: f/{photo.exif.aperture}</div>
                  )}
                  {photo.exif.shutterSpeed && (
                    <div>Shutter: {photo.exif.shutterSpeed}</div>
                  )}
                  {photo.exif.iso && (
                    <div>ISO: {photo.exif.iso}</div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <LoadingSpinner />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
        
        {/* Variant Preview Modal */}
        {previewVariant && (
          <div 
            className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewVariant(null)}
          >
            <div className="relative max-w-4xl w-full max-h-[80vh]">
              <img
                src={previewVariant.url}
                alt={`${previewVariant.width}w variant preview`}
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm">
                {previewVariant.width}w • {formatBytes(previewVariant.size)} • WebP
              </div>
              <button
                type="button"
                onClick={() => setPreviewVariant(null)}
                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Refresh Icon
function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// Trash Icon
function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}
