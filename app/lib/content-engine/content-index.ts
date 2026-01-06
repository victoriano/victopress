/**
 * Content Index System
 * 
 * Pre-calculated index of all content for fast admin panel navigation.
 * The index is stored as _content-index.json in the storage root.
 * 
 * - Rebuild manually via Settings > Rebuild Index
 * - Auto-updates when content is modified via the CMS
 */

import type { StorageAdapter, Gallery, BlogPost, Page } from "./types";
import { scanGalleries, scanParentMetadata, type PhotoCache, type CachedPhotoData } from "./gallery-scanner";
import { scanBlog } from "./blog-scanner";
import { scanPages } from "./page-scanner";
import { buildNavigation } from "../../utils/navigation";
import type { NavItem } from "../../components/Sidebar";

const INDEX_FILE = "_content-index.json";
const INDEX_VERSION = 6; // Bumped to include EXIF cache and lastModified

/** Number of photos to store per gallery for home page */
const PHOTOS_PER_GALLERY = 6;

/**
 * In-memory lock to prevent concurrent index rebuilds
 * This prevents multiple requests from triggering simultaneous rebuilds
 */
let rebuildInProgress: Promise<ContentIndex> | null = null;
let lastRebuildTime = 0;
const MIN_REBUILD_INTERVAL_MS = 5000; // Don't rebuild more than once per 5 seconds

/**
 * Parent folder metadata
 */
export interface ParentMetadataEntry {
  slug: string;
  title?: string;
  order?: number;
}

/**
 * Photo info for index (used in home page grid and featured view)
 * Includes essential metadata for display without full EXIF
 */
export interface PhotoIndexEntry {
  id: string;
  path: string;
  filename: string;
  title?: string;
  description?: string;
  gallerySlug: string;
  galleryTitle: string;
  hidden?: boolean;
  /** Year the photo was taken (from EXIF or filename) */
  year?: number;
}

/**
 * Full gallery data in index (includes all photos)
 */
export interface GalleryDataEntry {
  slug: string;
  title: string;
  description?: string;
  /** Cover image path (optional for parent galleries without photos) */
  cover?: string;
  path: string;
  photoCount: number;
  isProtected: boolean;
  password?: string;
  order?: number;
  category?: string;
  tags?: string[];
  hasChildren: boolean;
  childCount: number;
  includeNestedPhotos?: boolean;
  /** Whether this is a parent/container gallery (has config but no direct photos) */
  isParentGallery?: boolean;
  /** All photos in this gallery */
  photos: GalleryPhotoEntry[];
}

/**
 * Photo data stored per-gallery in index
 * Includes cached EXIF data to avoid re-reading images
 */
export interface GalleryPhotoEntry {
  id: string;
  path: string;
  filename: string;
  title?: string;
  description?: string;
  hidden?: boolean;
  order?: number;
  year?: number;
  tags?: string[];
  /** File modification time - used to invalidate EXIF cache */
  lastModified?: string;
  /** Cached EXIF data */
  exif?: {
    dateTaken?: string;
    camera?: string;
    lens?: string;
    focalLength?: number;
    aperture?: number;
    shutterSpeed?: string;
    iso?: number;
    width?: number;
    height?: number;
    gps?: { lat: number; lng: number };
  };
}

/**
 * Cached content index structure
 */
export interface ContentIndex {
  version: number;
  updatedAt: string;
  galleries: GalleryIndexEntry[];
  /** Full gallery data including all photos */
  galleryData: GalleryDataEntry[];
  posts: PostIndexEntry[];
  pages: PageIndexEntry[];
  parentMetadata: ParentMetadataEntry[];
  /** First N photos from each gallery for home page grid */
  featuredPhotos: PhotoIndexEntry[];
  stats: {
    totalGalleries: number;
    totalPhotos: number;
    totalPosts: number;
    totalPages: number;
  };
}

/**
 * Minimal gallery info for index (no photos array)
 */
export interface GalleryIndexEntry {
  slug: string;
  title: string;
  description?: string;
  /** Cover image path (relative to content root, e.g., "galleries/asia/japan/photo.jpg") */
  cover?: string;
  photoCount: number;
  isProtected: boolean;
  order?: number;
  category?: string;
  tags?: string[];
  path: string;
  hasChildren: boolean;
  childCount: number;
  /** Whether this is a parent/container gallery (has config but no direct photos) */
  isParentGallery?: boolean;
}

/**
 * Minimal post info for index
 */
export interface PostIndexEntry {
  slug: string;
  title: string;
  excerpt?: string;
  date?: string;
  draft: boolean;
  coverImage?: string;
  tags?: string[];
  readingTime: number;
}

/**
 * Minimal page info for index
 */
export interface PageIndexEntry {
  slug: string;
  title: string;
  description?: string;
  path: string;
  hidden: boolean;
  order?: number;
}

/**
 * Read the content index from storage
 * Returns null if index doesn't exist or is invalid
 */
export async function readContentIndex(storage: StorageAdapter): Promise<ContentIndex | null> {
  try {
    const content = await storage.getText(INDEX_FILE);
    if (!content) return null;
    
    const index = JSON.parse(content) as ContentIndex;
    
    // Validate version
    if (index.version !== INDEX_VERSION) {
      console.log(`Index version mismatch: ${index.version} !== ${INDEX_VERSION}, needs rebuild`);
      return null;
    }
    
    return index;
  } catch (error) {
    console.error("Failed to read content index:", error);
    return null;
  }
}

/**
 * Write the content index to storage
 */
export async function writeContentIndex(storage: StorageAdapter, index: ContentIndex): Promise<void> {
  const content = JSON.stringify(index, null, 2);
  await storage.put(INDEX_FILE, content, "application/json");
}

/**
 * Build a PhotoCache from existing index data
 * This allows reusing EXIF data for unchanged files
 */
function buildPhotoCacheFromIndex(existingIndex: ContentIndex | null): PhotoCache {
  const cache: PhotoCache = new Map();
  
  if (!existingIndex?.galleryData) {
    return cache;
  }
  
  for (const gallery of existingIndex.galleryData) {
    const galleryCache = new Map<string, CachedPhotoData>();
    
    for (const photo of gallery.photos) {
      if (photo.lastModified) {
        galleryCache.set(photo.filename, {
          filename: photo.filename,
          lastModified: photo.lastModified,
          exif: photo.exif,
        });
      }
    }
    
    if (galleryCache.size > 0) {
      cache.set(gallery.path, galleryCache);
    }
  }
  
  return cache;
}

/**
 * Rebuild the entire content index from scratch
 * Uses EXIF cache to avoid re-reading unchanged images (unless skipCache is true)
 * 
 * @param storage - Storage adapter
 * @param skipCache - If true, re-reads all EXIF data from images (slower but thorough)
 */
export async function rebuildContentIndex(storage: StorageAdapter, skipCache = false): Promise<ContentIndex> {
  console.log(`Rebuilding content index... (skipCache=${skipCache})`);
  const startTime = Date.now();
  
  // Try to read existing index for EXIF cache (unless skipCache is true)
  let photoCache: PhotoCache;
  if (skipCache) {
    photoCache = new Map();
    console.log(`[EXIF Cache] Skipping cache - will re-read all EXIF data from images`);
  } else {
    const existingIndex = await readContentIndex(storage);
    photoCache = buildPhotoCacheFromIndex(existingIndex);
    const cacheSize = Array.from(photoCache.values()).reduce((sum, m) => sum + m.size, 0);
    console.log(`[EXIF Cache] Loaded ${cacheSize} cached photos from existing index`);
  }
  
  // Scan all content in parallel (with EXIF cache for galleries)
  const [galleries, posts, pages, parentMeta] = await Promise.all([
    scanGalleries(storage, photoCache),
    scanBlog(storage),
    scanPages(storage),
    scanParentMetadata(storage),
  ]);
  
  // Convert to index entries (light version for navigation)
  const galleryEntries: GalleryIndexEntry[] = galleries.map(g => ({
    slug: g.slug,
    title: g.title,
    description: g.description,
    cover: g.cover,
    photoCount: g.photoCount,
    isProtected: g.isProtected,
    order: g.order,
    category: g.category,
    tags: g.tags,
    path: g.path,
    hasChildren: (g.children?.length ?? 0) > 0,
    childCount: g.children?.length ?? 0,
    isParentGallery: g.isParentGallery,
  }));
  
  // Build full gallery data with all photos (including EXIF cache data)
  const galleryDataEntries: GalleryDataEntry[] = galleries.map(g => {
    // Convert photos to index format with EXIF cache
    const photos: GalleryPhotoEntry[] = g.photos.map(p => {
      // Extract year from date
      let year: number | undefined;
      if (p.dateTaken) {
        const d = new Date(p.dateTaken);
        if (!isNaN(d.getTime())) year = d.getFullYear();
      } else if (p.exif?.dateTimeOriginal) {
        const d = new Date(p.exif.dateTimeOriginal);
        if (!isNaN(d.getTime())) year = d.getFullYear();
      }
      
      // Build EXIF cache data for next rebuild
      const exifCache = p.exif ? {
        dateTaken: p.exif.dateTimeOriginal?.toISOString?.() || 
                   (p.exif.dateTimeOriginal ? String(p.exif.dateTimeOriginal) : undefined),
        camera: [p.exif.make, p.exif.model].filter(Boolean).join(' ') || undefined,
        lens: p.exif.lensModel,
        focalLength: p.exif.focalLength,
        aperture: p.exif.fNumber,
        shutterSpeed: p.exif.exposureTime ? `1/${Math.round(1/p.exif.exposureTime)}` : undefined,
        iso: p.exif.iso,
        width: p.exif.imageWidth,
        height: p.exif.imageHeight,
        gps: (p.exif.latitude && p.exif.longitude) 
          ? { lat: p.exif.latitude, lng: p.exif.longitude } 
          : undefined,
      } : undefined;
      
      return {
        id: p.id,
        path: p.path,
        filename: p.filename,
        title: p.title || p.exif?.title,
        description: p.description || p.exif?.imageDescription,
        hidden: p.hidden,
        order: p.order,
        year,
        tags: p.tags,
        lastModified: p.lastModified,
        exif: exifCache,
      };
    });
    
    return {
      slug: g.slug,
      title: g.title,
      description: g.description,
      cover: g.cover,
      path: g.path,
      photoCount: g.photoCount,
      isProtected: !!g.password,
      password: g.password,
      order: g.order,
      category: g.category,
      tags: g.tags,
      hasChildren: (g.children?.length ?? 0) > 0,
      childCount: g.children?.length ?? 0,
      includeNestedPhotos: g.includeNestedPhotos,
      isParentGallery: g.isParentGallery,
      photos,
    };
  });
  
  const postEntries: PostIndexEntry[] = posts.map(p => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    date: p.date,
    draft: p.draft,
    coverImage: p.coverImage,
    tags: p.tags,
    readingTime: p.readingTime,
  }));
  
  const pageEntries: PageIndexEntry[] = pages.map(p => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    path: p.path,
    hidden: p.hidden,
    order: p.order,
  }));
  
  // Convert parent metadata
  const parentMetadataEntries: ParentMetadataEntry[] = parentMeta.map(p => ({
    slug: p.slug,
    title: p.title,
    order: p.order,
  }));
  
  // Build featured photos: first N non-hidden photos from each public gallery
  // Sort galleries by order first to get featured photos in the right sequence
  const sortedGalleries = [...galleries]
    .filter(g => !g.private)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  
  const featuredPhotos: PhotoIndexEntry[] = [];
  for (const gallery of sortedGalleries) {
    const visiblePhotos = gallery.photos.filter(p => !p.hidden);
    const photosToInclude = visiblePhotos.slice(0, PHOTOS_PER_GALLERY);
    
    for (const photo of photosToInclude) {
      // Extract year from dateTaken or EXIF
      let year: number | undefined;
      if (photo.dateTaken) {
        const d = new Date(photo.dateTaken);
        if (!isNaN(d.getTime())) year = d.getFullYear();
      } else if (photo.exif?.dateTimeOriginal) {
        const d = new Date(photo.exif.dateTimeOriginal);
        if (!isNaN(d.getTime())) year = d.getFullYear();
      }
      
      featuredPhotos.push({
        id: photo.id,
        path: photo.path,
        filename: photo.filename,
        title: photo.title || photo.exif?.title,
        description: photo.description || photo.exif?.imageDescription,
        gallerySlug: gallery.slug,
        galleryTitle: gallery.title,
        hidden: photo.hidden,
        year,
      });
    }
  }
  
  // Calculate stats
  const totalPhotos = galleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  const index: ContentIndex = {
    version: INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    galleries: galleryEntries,
    galleryData: galleryDataEntries,
    posts: postEntries,
    pages: pageEntries,
    parentMetadata: parentMetadataEntries,
    featuredPhotos,
    stats: {
      totalGalleries: galleries.length,
      totalPhotos,
      totalPosts: posts.length,
      totalPages: pages.length,
    },
  };
  
  // Save index
  await writeContentIndex(storage, index);
  
  const elapsed = Date.now() - startTime;
  console.log(`Content index rebuilt in ${elapsed}ms: ${galleries.length} galleries, ${posts.length} posts, ${pages.length} pages`);
  
  return index;
}

/**
 * Get content index, rebuilding if necessary
 * This is the main function to use in loaders
 * 
 * Uses an in-memory lock to prevent concurrent rebuilds when multiple
 * requests hit the server simultaneously after an index invalidation.
 */
export async function getContentIndex(storage: StorageAdapter, forceRebuild = false): Promise<ContentIndex> {
  if (!forceRebuild) {
    const cached = await readContentIndex(storage);
    if (cached) {
      return cached;
    }
  }
  
  // Check if rebuild is already in progress
  if (rebuildInProgress) {
    console.log("[Index] Rebuild already in progress, waiting...");
    return rebuildInProgress;
  }
  
  // Check if we just rebuilt (prevents rapid repeated rebuilds)
  const now = Date.now();
  if (now - lastRebuildTime < MIN_REBUILD_INTERVAL_MS) {
    // Try to read cached index one more time
    const cached = await readContentIndex(storage);
    if (cached) {
      console.log("[Index] Using recently rebuilt index");
      return cached;
    }
  }
  
  // Start rebuild with lock
  console.log("[Index] Starting rebuild with lock");
  rebuildInProgress = rebuildContentIndex(storage);
  
  try {
    const index = await rebuildInProgress;
    lastRebuildTime = Date.now();
    return index;
  } finally {
    rebuildInProgress = null;
  }
}

/**
 * Check if content index exists and is valid
 */
export async function hasValidIndex(storage: StorageAdapter): Promise<boolean> {
  const index = await readContentIndex(storage);
  return index !== null;
}

/**
 * Get index age in milliseconds
 */
export async function getIndexAge(storage: StorageAdapter): Promise<number | null> {
  const index = await readContentIndex(storage);
  if (!index) return null;
  
  return Date.now() - new Date(index.updatedAt).getTime();
}

/**
 * Invalidate the content index (delete it)
 * Next read will trigger a rebuild
 */
export async function invalidateContentIndex(storage: StorageAdapter): Promise<void> {
  try {
    await storage.delete(INDEX_FILE);
  } catch {
    // Ignore errors (file might not exist)
  }
}

/**
 * Update only the YAML-based metadata for photos in a gallery
 * This is MUCH faster than a full rebuild because it doesn't re-read images
 * Use for: reorder, hide/unhide, edit metadata, delete photos
 */
export async function updateGalleryPhotosInIndex(
  storage: StorageAdapter,
  galleryPath: string,
  updateFn: (photos: GalleryPhotoEntry[]) => GalleryPhotoEntry[]
): Promise<{ success: boolean; message: string }> {
  const startTime = Date.now();
  
  try {
    // Read existing index
    const index = await readContentIndex(storage);
    if (!index) {
      // No index exists, do a full rebuild
      await rebuildContentIndex(storage);
      return { success: true, message: "Index rebuilt from scratch" };
    }
    
    // Find the gallery
    const galleryIdx = index.galleryData.findIndex(g => g.path === galleryPath);
    if (galleryIdx === -1) {
      // Gallery not in index, do a full rebuild
      await rebuildContentIndex(storage);
      return { success: true, message: "Index rebuilt (gallery not found)" };
    }
    
    // Apply the update function to the photos
    const gallery = index.galleryData[galleryIdx];
    gallery.photos = updateFn(gallery.photos);
    gallery.photoCount = gallery.photos.filter(p => !p.hidden).length;
    
    // Update the light gallery entry too
    const lightIdx = index.galleries.findIndex(g => g.path === galleryPath);
    if (lightIdx !== -1) {
      index.galleries[lightIdx].photoCount = gallery.photoCount;
    }
    
    // Recalculate stats
    index.stats.totalPhotos = index.galleryData.reduce(
      (sum, g) => sum + g.photos.length, 0
    );
    
    // Update timestamp
    index.updatedAt = new Date().toISOString();
    
    // Save the updated index
    await writeContentIndex(storage, index);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Index] Updated gallery ${galleryPath} in ${elapsed}ms`);
    
    return { success: true, message: `Index updated in ${elapsed}ms` };
  } catch (error) {
    console.error("Failed to update gallery in index:", error);
    // Fall back to full rebuild
    await rebuildContentIndex(storage);
    return { success: true, message: "Index rebuilt due to error" };
  }
}

/**
 * Add new photos to a gallery in the index
 * Only reads EXIF from the new files, not all files in the gallery
 */
export async function addPhotosToGalleryIndex(
  storage: StorageAdapter,
  galleryPath: string,
  newPhotoPaths: string[]
): Promise<{ success: boolean; message: string }> {
  const startTime = Date.now();
  
  try {
    const index = await readContentIndex(storage);
    if (!index) {
      await rebuildContentIndex(storage);
      return { success: true, message: "Index rebuilt from scratch" };
    }
    
    const galleryIdx = index.galleryData.findIndex(g => g.path === galleryPath);
    if (galleryIdx === -1) {
      await rebuildContentIndex(storage);
      return { success: true, message: "Index rebuilt (gallery not found)" };
    }
    
    const gallery = index.galleryData[galleryIdx];
    
    // Import extractExif dynamically
    const { extractExif } = await import("./exif");
    
    // Process only the new photos
    for (const photoPath of newPhotoPaths) {
      const filename = photoPath.split('/').pop() || photoPath;
      
      // Check if already exists
      if (gallery.photos.some(p => p.filename === filename)) {
        continue;
      }
      
      // Extract EXIF from new photo
      let exifCache: GalleryPhotoEntry['exif'] = undefined;
      let year: number | undefined;
      
      if (filename.toLowerCase().match(/\.jpe?g$/)) {
        try {
          const buffer = await storage.get(photoPath);
          if (buffer) {
            const exif = await extractExif(buffer);
            if (exif) {
              if (exif.dateTimeOriginal) {
                const d = new Date(exif.dateTimeOriginal);
                if (!isNaN(d.getTime())) year = d.getFullYear();
              }
              exifCache = {
                dateTaken: exif.dateTimeOriginal?.toISOString?.() || 
                           (exif.dateTimeOriginal ? String(exif.dateTimeOriginal) : undefined),
                camera: [exif.make, exif.model].filter(Boolean).join(' ') || undefined,
                lens: exif.lensModel,
                focalLength: exif.focalLength,
                aperture: exif.fNumber,
                shutterSpeed: exif.exposureTime ? `1/${Math.round(1/exif.exposureTime)}` : undefined,
                iso: exif.iso,
                width: exif.imageWidth,
                height: exif.imageHeight,
                gps: (exif.latitude && exif.longitude) 
                  ? { lat: exif.latitude, lng: exif.longitude } 
                  : undefined,
              };
            }
          }
        } catch (error) {
          console.warn(`Failed to extract EXIF from ${photoPath}:`, error);
        }
      }
      
      // Add the new photo
      gallery.photos.push({
        id: filename.replace(/\.[^.]+$/, ''),
        path: photoPath,
        filename,
        year,
        exif: exifCache,
        lastModified: new Date().toISOString(),
      });
    }
    
    // Update counts
    gallery.photoCount = gallery.photos.filter(p => !p.hidden).length;
    
    const lightIdx = index.galleries.findIndex(g => g.path === galleryPath);
    if (lightIdx !== -1) {
      index.galleries[lightIdx].photoCount = gallery.photoCount;
    }
    
    index.stats.totalPhotos = index.galleryData.reduce(
      (sum, g) => sum + g.photos.length, 0
    );
    
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Index] Added ${newPhotoPaths.length} photos to ${galleryPath} in ${elapsed}ms`);
    
    return { success: true, message: `Added ${newPhotoPaths.length} photos in ${elapsed}ms` };
  } catch (error) {
    console.error("Failed to add photos to index:", error);
    await rebuildContentIndex(storage);
    return { success: true, message: "Index rebuilt due to error" };
  }
}

// ==================== Navigation Helper ====================

/**
 * Get navigation structure directly from the content index
 * This is much faster than scanning galleries for navigation
 */
export async function getNavigationFromIndex(storage: StorageAdapter): Promise<NavItem[]> {
  const index = await getContentIndex(storage);
  
  // Filter public galleries and sort by order
  const publicGalleries = index.galleries
    .filter(g => !g.isProtected || g.photoCount > 0) // Include protected if has photos
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  
  return buildNavigation(publicGalleries, index.parentMetadata);
}

// ==================== Home Page Helper ====================

/**
 * Home photo with index for rendering
 */
export interface HomePhoto extends PhotoIndexEntry {
  homeIndex: number;
}

/**
 * Get photos for the home page from the content index
 * Optionally uses custom selection from home.yaml
 */
export async function getHomePhotosFromIndex(
  storage: StorageAdapter,
  homeConfig?: { photos?: Array<{ gallery: string; filename: string }> }
): Promise<HomePhoto[]> {
  const index = await getContentIndex(storage);
  
  if (homeConfig?.photos && homeConfig.photos.length > 0) {
    // Use handpicked photos from config
    const homePhotos: HomePhoto[] = [];
    homeConfig.photos.forEach((config, idx) => {
      // Find the photo in featuredPhotos (it might not be there if not in top N)
      const photo = index.featuredPhotos.find(
        p => p.gallerySlug === config.gallery && p.filename === config.filename
      );
      
      if (photo && !photo.hidden) {
        homePhotos.push({ ...photo, homeIndex: idx });
      } else {
        // Photo not in featured list - we'd need to scan for it
        // For now, we'll skip if not in the index
        // TODO: Consider storing all configured home photos separately
      }
    });
    return homePhotos;
  }
  
  // Default: use all featured photos in order
  return index.featuredPhotos
    .filter(p => !p.hidden)
    .map((photo, idx) => ({ ...photo, homeIndex: idx }));
}

// ==================== Gallery Data Helpers ====================

/**
 * Get a specific gallery's full data from the index
 * Much faster than scanGalleries for single gallery lookups
 */
export async function getGalleryFromIndex(
  storage: StorageAdapter,
  slug: string
): Promise<GalleryDataEntry | null> {
  const index = await getContentIndex(storage);
  return index.galleryData.find(g => g.slug === slug) || null;
}

/**
 * Get all galleries data from the index
 * Use this instead of scanGalleries for gallery listing pages
 */
export async function getAllGalleriesFromIndex(
  storage: StorageAdapter
): Promise<GalleryDataEntry[]> {
  const index = await getContentIndex(storage);
  return index.galleryData;
}

/**
 * Get gallery data for a path prefix (for virtual parent galleries)
 * Returns all galleries that start with the given slug prefix
 */
export async function getGalleriesByPrefix(
  storage: StorageAdapter,
  slugPrefix: string
): Promise<GalleryDataEntry[]> {
  const index = await getContentIndex(storage);
  return index.galleryData.filter(g => 
    g.slug === slugPrefix || g.slug.startsWith(slugPrefix + "/")
  );
}

/**
 * Find a photo in the index by gallery slug and filename
 */
export async function getPhotoFromIndex(
  storage: StorageAdapter,
  gallerySlug: string,
  filename: string
): Promise<{ gallery: GalleryDataEntry; photo: GalleryPhotoEntry; photoIndex: number } | null> {
  const gallery = await getGalleryFromIndex(storage, gallerySlug);
  if (!gallery) return null;
  
  const photos = gallery.photos.filter(p => !p.hidden);
  const photoIndex = photos.findIndex(
    p => p.filename === filename || p.filename === decodeURIComponent(filename)
  );
  
  if (photoIndex === -1) return null;
  
  return { gallery, photo: photos[photoIndex], photoIndex };
}

// ==================== Incremental Updates ====================

/**
 * Update a single gallery in the index
 * Used when a gallery is modified via the CMS
 */
export async function updateGalleryInIndex(
  storage: StorageAdapter, 
  gallery: Gallery
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) {
    // No index exists, rebuild from scratch
    await rebuildContentIndex(storage);
    return;
  }
  
  const entry: GalleryIndexEntry = {
    slug: gallery.slug,
    title: gallery.title,
    description: gallery.description,
    cover: gallery.cover,
    photoCount: gallery.photoCount,
    isProtected: gallery.isProtected,
    order: gallery.order,
    category: gallery.category,
    tags: gallery.tags,
    path: gallery.path,
    hasChildren: (gallery.children?.length ?? 0) > 0,
    childCount: gallery.children?.length ?? 0,
  };
  
  // Find and update or add
  const existingIdx = index.galleries.findIndex(g => g.slug === gallery.slug);
  if (existingIdx >= 0) {
    const oldPhotoCount = index.galleries[existingIdx].photoCount;
    index.galleries[existingIdx] = entry;
    // Update stats
    index.stats.totalPhotos += (gallery.photoCount - oldPhotoCount);
  } else {
    index.galleries.push(entry);
    index.stats.totalGalleries++;
    index.stats.totalPhotos += gallery.photoCount;
  }
  
  index.updatedAt = new Date().toISOString();
  await writeContentIndex(storage, index);
}

/**
 * Remove a gallery from the index
 */
export async function removeGalleryFromIndex(
  storage: StorageAdapter,
  slug: string
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) return;
  
  const existingIdx = index.galleries.findIndex(g => g.slug === slug);
  if (existingIdx >= 0) {
    const removed = index.galleries[existingIdx];
    index.galleries.splice(existingIdx, 1);
    index.stats.totalGalleries--;
    index.stats.totalPhotos -= removed.photoCount;
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
  }
}

/**
 * Update a single post in the index
 */
export async function updatePostInIndex(
  storage: StorageAdapter,
  post: BlogPost
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) {
    await rebuildContentIndex(storage);
    return;
  }
  
  const entry: PostIndexEntry = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    date: post.date,
    draft: post.draft,
    coverImage: post.coverImage,
    tags: post.tags,
    readingTime: post.readingTime,
  };
  
  const existingIdx = index.posts.findIndex(p => p.slug === post.slug);
  if (existingIdx >= 0) {
    index.posts[existingIdx] = entry;
  } else {
    index.posts.push(entry);
    index.stats.totalPosts++;
  }
  
  index.updatedAt = new Date().toISOString();
  await writeContentIndex(storage, index);
}

/**
 * Remove a post from the index
 */
export async function removePostFromIndex(
  storage: StorageAdapter,
  slug: string
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) return;
  
  const existingIdx = index.posts.findIndex(p => p.slug === slug);
  if (existingIdx >= 0) {
    index.posts.splice(existingIdx, 1);
    index.stats.totalPosts--;
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
  }
}

/**
 * Update a single page in the index
 */
export async function updatePageInIndex(
  storage: StorageAdapter,
  page: Page
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) {
    await rebuildContentIndex(storage);
    return;
  }
  
  const entry: PageIndexEntry = {
    slug: page.slug,
    title: page.title,
    description: page.description,
    path: page.path,
    hidden: page.hidden,
    order: page.order,
  };
  
  const existingIdx = index.pages.findIndex(p => p.slug === page.slug);
  if (existingIdx >= 0) {
    index.pages[existingIdx] = entry;
  } else {
    index.pages.push(entry);
    index.stats.totalPages++;
  }
  
  index.updatedAt = new Date().toISOString();
  await writeContentIndex(storage, index);
}

/**
 * Remove a page from the index
 */
export async function removePageFromIndex(
  storage: StorageAdapter,
  slug: string
): Promise<void> {
  const index = await readContentIndex(storage);
  if (!index) return;
  
  const existingIdx = index.pages.findIndex(p => p.slug === slug);
  if (existingIdx >= 0) {
    index.pages.splice(existingIdx, 1);
    index.stats.totalPages--;
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
  }
}
