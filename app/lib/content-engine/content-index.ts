/**
 * Content Index System
 * 
 * Pre-calculated index of all content for fast admin panel navigation.
 * The index is stored as _content-index.json in the storage root.
 * 
 * - Rebuild manually via Settings > Rebuild Index
 * - Auto-updates when content is modified via the CMS
 */

import type {
  StorageAdapter,
  Gallery,
  BlogPost,
  Page,
  GalleryTranslation,
  PhotoTranslation,
  BlogPostTranslation,
  PageTranslation,
  ImageMetadataSummary,
} from "./types";
import { scanGalleries, scanParentMetadata, type PhotoCache, type CachedPhotoData } from "./gallery-scanner";
import { scanBlog } from "./blog-scanner";
import { scanPages } from "./page-scanner";
import { addGalleryMemberships, readGalleryMemberships } from "./gallery-memberships";
import { readGalleryOrders, sortPhotosByGalleryOrder } from "./gallery-orders";
import { buildNavigation } from "../../utils/navigation";
import type { NavItem } from "../../components/Sidebar";
import {
  normalizeLocale,
  resolveTranslation,
  type Locale,
  type TranslationMap,
} from "~/lib/i18n";
import { extractImageMetadata, toImageMetadataSummary } from "./exif";
import { writePhotoMetadata } from "./photo-metadata-store";
import { createCanonicalImageSourceFingerprint } from "./victopress-xmp";
import type { GalleryThumbnailAspectRatio } from "./gallery-layout";

const INDEX_FILE = "_content-index.json";
const INDEX_VERSION = 10; // Bilingual metadata; embedded/layout fields remain optional

/** Number of photos to store per gallery for home page */
const PHOTOS_PER_GALLERY = 6;

/**
 * In-memory lock to prevent concurrent index rebuilds
 * This prevents multiple requests from triggering simultaneous rebuilds
 */
let rebuildInProgress: Promise<ContentIndex> | null = null;
const indexReadsInProgress = new WeakMap<
  StorageAdapter,
  Promise<ContentIndex | null>
>();
let lastRebuildTime = 0;
const MIN_REBUILD_INTERVAL_MS = 5000; // Don't rebuild more than once per 5 seconds

/**
 * Parent folder metadata
 */
export interface ParentMetadataEntry {
  slug: string;
  title?: string;
  order?: number;
  locale?: Locale;
  translations?: TranslationMap<GalleryTranslation>;
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
  locale?: Locale;
  translations?: TranslationMap<PhotoTranslation>;
  gallerySlug: string;
  galleryTitle: string;
  galleryLocale?: Locale;
  galleryTranslations?: TranslationMap<GalleryTranslation>;
  hidden?: boolean;
  /** Year the photo was taken (from EXIF or filename) */
  year?: number;
  /** Intrinsic dimensions used to reserve grid space before the image loads. */
  width?: number;
  height?: number;
}

/**
 * Full gallery data in index (includes all photos)
 */
export interface GalleryDataEntry {
  slug: string;
  title: string;
  description?: string;
  locale?: Locale;
  translations?: TranslationMap<GalleryTranslation>;
  /** Editorial inclusion/exclusion criteria for optional AI classification */
  classificationHint?: string;
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
  /** Uniform 3:2 crop by default; `original` preserves each source frame. */
  thumbnailAspectRatio?: GalleryThumbnailAspectRatio;
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
  locale?: Locale;
  translations?: TranslationMap<PhotoTranslation>;
  hidden?: boolean;
  order?: number;
  year?: number;
  /** Normalized capture/editorial date from embedded metadata or photos.yaml. */
  dateTaken?: string;
  tags?: string[];
  /** True when this gallery membership points at a photo stored in another gallery. */
  isReference?: boolean;
  /** Physical gallery that owns the source file for a logical membership. */
  sourceGallerySlug?: string;
  /** File modification time - used to invalidate EXIF cache */
  lastModified?: string;
  /** Stable image identity that excludes VictoPress-owned XMP metadata. */
  sourceFingerprint?: string;
  /** Compact normalized EXIF/IPTC/XMP projection used by the CMS. */
  exif?: ImageMetadataSummary;
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

function applyGalleryMembershipsToEntries(
  galleries: GalleryDataEntry[],
  memberships: Readonly<Record<string, readonly string[]>>,
): void {
  const physicalPhotos = new Map<
    string,
    { gallery: GalleryDataEntry; photo: GalleryPhotoEntry }
  >();
  for (const gallery of galleries) {
    for (const photo of gallery.photos) {
      if (!photo.isReference) physicalPhotos.set(photo.path, { gallery, photo });
    }
  }

  const galleriesBySlug = new Map(galleries.map((gallery) => [gallery.slug, gallery]));
  for (const [photoPath, targetSlugs] of Object.entries(memberships)) {
    const source = physicalPhotos.get(photoPath);
    if (!source) continue;
    for (const targetSlug of targetSlugs) {
      const target = galleriesBySlug.get(targetSlug);
      if (
        !target ||
        (target.isParentGallery && target.hasChildren) ||
        target.slug === source.gallery.slug
      ) continue;
      if (target.photos.some((photo) => photo.path === photoPath)) continue;
      if (target.photos.some((photo) => photo.filename === source.photo.filename)) {
        console.warn(
          `[Gallery Memberships] Skipped ${photoPath} in ${targetSlug}: filename collision`,
        );
        continue;
      }
      target.photos.push({
        ...source.photo,
        isReference: true,
        sourceGallerySlug: source.gallery.slug,
      });
      // An empty leaf gallery is a valid virtual gallery once it receives a
      // logical membership. Keep true container galleries (those with child
      // galleries) protected from direct photo assignment.
      target.isParentGallery = false;
    }
  }

  for (const gallery of galleries) {
    gallery.photoCount = gallery.photos.filter((photo) => !photo.hidden).length;
  }
}

function recoverEmbeddedGalleryOrganization(galleries: readonly Gallery[]): {
  memberships: Record<string, string[]>;
  orders: Record<string, string[]>;
} {
  const memberships: Record<string, string[]> = {};
  const orderEntries = new Map<string, Array<{ path: string; order: number }>>();

  for (const gallery of galleries) {
    for (const photo of gallery.photos) {
      const embedded = photo.victopressMetadata;
      if (!embedded) continue;
      for (const membership of embedded.galleries) {
        if (!membership.physicalSource) {
          memberships[photo.path] = Array.from(
            new Set([...(memberships[photo.path] ?? []), membership.slug]),
          ).sort();
        }
        const entries = orderEntries.get(membership.slug) ?? [];
        if (!entries.some((entry) => entry.path === photo.path)) {
          entries.push({ path: photo.path, order: membership.order });
        }
        orderEntries.set(membership.slug, entries);
      }
    }
  }

  const orders = Object.fromEntries(Array.from(orderEntries, ([slug, entries]) => [
    slug,
    entries
      .sort((left, right) => left.order - right.order || left.path.localeCompare(right.path))
      .map((entry) => entry.path),
  ]));
  return { memberships, orders };
}

/**
 * Minimal gallery info for index (no photos array)
 */
export interface GalleryIndexEntry {
  slug: string;
  title: string;
  description?: string;
  locale?: Locale;
  translations?: TranslationMap<GalleryTranslation>;
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
  locale?: Locale;
  translations?: TranslationMap<BlogPostTranslation>;
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
  locale?: Locale;
  translations?: TranslationMap<PageTranslation>;
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
 * Read an older index only as an EXIF cache during a schema rebuild.
 *
 * A version bump changes derived fields, not the source photos. Discarding the
 * previous index made a public request download every original from R2 again
 * before it could render. Reusing lastModified + EXIF data keeps migrations
 * quick without ever serving the stale schema to a loader.
 */
async function readContentIndexForRebuild(
  storage: StorageAdapter,
): Promise<ContentIndex | null> {
  try {
    const content = await storage.getText(INDEX_FILE);
    if (!content) return null;

    const index = JSON.parse(content) as ContentIndex;
    if (!Array.isArray(index.galleryData)) return null;

    if (index.version !== INDEX_VERSION) {
      console.log(
        `[Index] Reusing EXIF cache from version ${index.version} while rebuilding version ${INDEX_VERSION}`,
      );
    }

    return index;
  } catch (error) {
    console.warn("Could not reuse the previous content index:", error);
    return null;
  }
}

async function readContentIndexOnce(
  storage: StorageAdapter,
): Promise<ContentIndex | null> {
  const activeRead = indexReadsInProgress.get(storage);
  if (activeRead) return activeRead;

  const readPromise = readContentIndex(storage);
  indexReadsInProgress.set(storage, readPromise);
  try {
    return await readPromise;
  } finally {
    if (indexReadsInProgress.get(storage) === readPromise) {
      indexReadsInProgress.delete(storage);
    }
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
        // Older indexes stored title/description/tags only on the photo entry,
        // not in the EXIF cache. Fold them in so a fast rebuild does not erase
        // metadata that originally came from IPTC/XMP.
        const preservedMetadata = photo.exif || photo.title || photo.description || photo.tags
          ? {
              ...photo.exif,
              dateTaken: photo.exif?.dateTaken || photo.dateTaken,
              title: photo.exif?.title || photo.title,
              description: photo.exif?.description || photo.description,
              keywords: photo.exif?.keywords || photo.tags,
            }
          : undefined;
        galleryCache.set(photo.filename, {
          filename: photo.filename,
          lastModified: photo.lastModified,
          exif: preservedMetadata,
          sourceFingerprint: photo.sourceFingerprint,
        });
      }
    }
    
    if (galleryCache.size > 0) {
      cache.set(gallery.path, galleryCache);
    }
  }
  
  return cache;
}

async function persistExtractedPhotoMetadata(
  storage: StorageAdapter,
  galleries: Gallery[],
): Promise<void> {
  const extractedPhotos = galleries.flatMap((gallery) =>
    gallery.photos
      .filter((photo) => photo.exif && photo.embeddedMetadata !== undefined)
      .map((photo) => photo),
  );
  if (extractedPhotos.length === 0) return;

  let failures = 0;
  const concurrency = 4;
  for (let offset = 0; offset < extractedPhotos.length; offset += concurrency) {
    const batch = extractedPhotos.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async (photo) => {
      try {
        await writePhotoMetadata(
          storage,
          photo.path,
          photo.exif!,
          photo.embeddedMetadata!,
          { size: photo.size, lastModified: photo.lastModified },
        );
      } catch (error) {
        failures += 1;
        console.error(`[Metadata] Failed to persist sidecar for ${photo.path}:`, error);
      }
    }));
  }

  console.log(
    `[Metadata] Persisted ${extractedPhotos.length - failures}/${extractedPhotos.length} private sidecars`,
  );
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
    const existingIndex = await readContentIndexForRebuild(storage);
    photoCache = buildPhotoCacheFromIndex(existingIndex);
    const cacheSize = Array.from(photoCache.values()).reduce((sum, m) => sum + m.size, 0);
    console.log(`[EXIF Cache] Loaded ${cacheSize} cached photos from existing index`);
  }
  
  // Scan all content in parallel (with EXIF cache for galleries)
  const [galleries, posts, pages, parentMeta, galleryMemberships, galleryOrders] = await Promise.all([
    scanGalleries(storage, photoCache),
    scanBlog(storage),
    scanPages(storage),
    scanParentMetadata(storage),
    readGalleryMemberships(storage),
    readGalleryOrders(storage),
  ]);
  const embeddedOrganization = recoverEmbeddedGalleryOrganization(galleries);
  const effectiveGalleryMemberships = Object.keys(galleryMemberships).length > 0
    ? galleryMemberships
    : embeddedOrganization.memberships;
  const effectiveGalleryOrders = Object.keys(galleryOrders).length > 0
    ? galleryOrders
    : embeddedOrganization.orders;
  
  // Convert to index entries (light version for navigation)
  const galleryEntries: GalleryIndexEntry[] = galleries.map(g => ({
    slug: g.slug,
    title: g.title,
    description: g.description,
    locale: normalizeLocale(g.locale) || "en",
    translations: g.translations,
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
      
      // Keep a compact normalized projection in the public index. The complete
      // namespaced payload is persisted separately below.
      const exifCache = p.exif ? toImageMetadataSummary(p.exif) : undefined;
      const dateTaken = p.dateTaken && !Number.isNaN(new Date(p.dateTaken).getTime())
        ? new Date(p.dateTaken).toISOString()
        : exifCache?.dateTaken;
      
      return {
        id: p.id,
        path: p.path,
        filename: p.filename,
        title: p.title || p.exif?.title,
        description: p.description || p.exif?.imageDescription,
        locale: normalizeLocale(p.locale) || "en",
        translations: p.translations,
        hidden: p.hidden,
        order: p.order,
        year,
        dateTaken,
        tags: p.tags,
        lastModified: p.lastModified,
        sourceFingerprint: p.sourceFingerprint,
        exif: exifCache,
      };
    });
    
    return {
      slug: g.slug,
      title: g.title,
      description: g.description,
      locale: normalizeLocale(g.locale) || "en",
      translations: g.translations,
      classificationHint: g.classificationHint,
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
      thumbnailAspectRatio: g.thumbnailAspectRatio,
      isParentGallery: g.isParentGallery,
      photos,
    };
  });

  await persistExtractedPhotoMetadata(storage, galleries);

  applyGalleryMembershipsToEntries(galleryDataEntries, effectiveGalleryMemberships);
  for (const gallery of galleryDataEntries) {
    const orderedPaths = effectiveGalleryOrders[gallery.slug];
    if (orderedPaths?.length) {
      gallery.photos = sortPhotosByGalleryOrder(gallery.photos, orderedPaths);
    }
  }
  for (const entry of galleryEntries) {
    const fullGallery = galleryDataEntries.find((gallery) => gallery.slug === entry.slug);
    if (fullGallery) {
      entry.photoCount = fullGallery.photoCount;
      entry.isParentGallery = fullGallery.isParentGallery;
    }
  }
  
  const postEntries: PostIndexEntry[] = posts.map(p => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    date: p.date,
    draft: p.draft,
    coverImage: p.cover,
    tags: p.tags,
    readingTime: p.readingTime,
    locale: normalizeLocale(p.locale) || "en",
    translations: p.translations,
  }));
  
  const pageEntries: PageIndexEntry[] = pages.map(p => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    path: p.path,
    hidden: p.hidden,
    order: p.order,
    locale: normalizeLocale(p.locale) || "en",
    translations: p.translations,
  }));
  
  // Convert parent metadata
  const parentMetadataEntries: ParentMetadataEntry[] = parentMeta.map(p => ({
    slug: p.slug,
    title: p.title,
    order: p.order,
    locale: normalizeLocale(p.locale) || "en",
    translations: p.translations,
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
        locale: normalizeLocale(photo.locale) || "en",
        translations: photo.translations,
        gallerySlug: gallery.slug,
        galleryTitle: gallery.title,
        galleryLocale: normalizeLocale(gallery.locale) || "en",
        galleryTranslations: gallery.translations,
        hidden: photo.hidden,
        year,
        width: photo.exif?.imageWidth,
        height: photo.exif?.imageHeight,
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
    const cached = await readContentIndexOnce(storage);
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
 * Update only the gallery metadata (title, description, order, etc.) in the index
 * This is INSTANT compared to a full rebuild - just updates the JSON file
 * Use for: gallery settings changes (title, description, order, private, etc.)
 */
export async function updateGalleryMetadataInIndex(
  storage: StorageAdapter,
  galleryPath: string,
  updates: {
    title?: string;
    description?: string;
    classificationHint?: string;
    order?: number;
    private?: boolean;
    password?: string;
    tags?: string[];
    includeNestedPhotos?: boolean;
    locale?: Locale;
    translations?: TranslationMap<GalleryTranslation>;
    thumbnailAspectRatio?: GalleryThumbnailAspectRatio;
  }
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
    
    // Find the gallery in galleryData
    const galleryIdx = index.galleryData.findIndex(g => g.path === galleryPath);
    if (galleryIdx === -1) {
      // Gallery not in index - might be new, do a full rebuild
      await rebuildContentIndex(storage);
      return { success: true, message: "Index rebuilt (gallery not found)" };
    }
    
    // Apply updates to galleryData
    const gallery = index.galleryData[galleryIdx];
    if (updates.title !== undefined) gallery.title = updates.title;
    if (updates.description !== undefined) gallery.description = updates.description || undefined;
    if (updates.classificationHint !== undefined) {
      gallery.classificationHint = updates.classificationHint || undefined;
    }
    if (updates.order !== undefined) gallery.order = updates.order;
    if (updates.private !== undefined) gallery.isProtected = updates.private;
    if (updates.password !== undefined) gallery.password = updates.password || undefined;
    if (updates.tags !== undefined) gallery.tags = updates.tags.length > 0 ? updates.tags : undefined;
    if (updates.includeNestedPhotos !== undefined) gallery.includeNestedPhotos = updates.includeNestedPhotos;
    if (updates.locale !== undefined) gallery.locale = updates.locale;
    if (updates.translations !== undefined) gallery.translations = updates.translations;
    if (updates.thumbnailAspectRatio !== undefined) {
      gallery.thumbnailAspectRatio = updates.thumbnailAspectRatio;
    }
    
    // Also update the light gallery entry (for navigation)
    const lightIdx = index.galleries.findIndex(g => g.path === galleryPath);
    if (lightIdx !== -1) {
      const light = index.galleries[lightIdx];
      if (updates.title !== undefined) light.title = updates.title;
      if (updates.description !== undefined) light.description = updates.description || undefined;
      if (updates.order !== undefined) light.order = updates.order;
      if (updates.private !== undefined) light.isProtected = updates.private;
      if (updates.tags !== undefined) light.tags = updates.tags.length > 0 ? updates.tags : undefined;
      if (updates.locale !== undefined) light.locale = updates.locale;
      if (updates.translations !== undefined) light.translations = updates.translations;
    }
    
    // Update timestamp
    index.updatedAt = new Date().toISOString();
    
    // Save the updated index
    await writeContentIndex(storage, index);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Index] Updated gallery metadata for ${galleryPath} in ${elapsed}ms`);
    
    return { success: true, message: `Index updated in ${elapsed}ms` };
  } catch (error) {
    console.error("Failed to update gallery metadata in index:", error);
    // Fall back to full rebuild
    await rebuildContentIndex(storage);
    return { success: true, message: "Index rebuilt due to error" };
  }
}

export interface GalleryMembershipAssignmentResult {
  success: boolean;
  added: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
  message: string;
}

/**
 * Adds existing source photos to another gallery without copying or moving the
 * image file. The durable source of truth is gallery-memberships.yaml.
 */
export async function assignPhotosToGalleryInIndex(
  storage: StorageAdapter,
  photoPaths: readonly string[],
  gallerySlug: string,
): Promise<GalleryMembershipAssignmentResult> {
  const targetSlug = gallerySlug.trim();
  const requestedPaths = Array.from(new Set(photoPaths.map((path) => path.trim()).filter(Boolean)));
  if (!targetSlug || requestedPaths.length === 0) {
    return {
      success: false,
      added: 0,
      skipped: requestedPaths.length,
      errors: [],
      message: "Choose at least one photo and a destination gallery.",
    };
  }

  const index = await getContentIndex(storage);
  const target = index.galleryData.find((gallery) => gallery.slug === targetSlug);
  if (!target) throw new Error("Destination gallery was not found");
  if (target.isParentGallery && target.hasChildren) {
    throw new Error("Container galleries cannot receive photos directly");
  }

  const physicalPhotos = new Map<string, { gallery: GalleryDataEntry; photo: GalleryPhotoEntry }>();
  for (const gallery of index.galleryData) {
    for (const photo of gallery.photos) {
      if (!photo.isReference) physicalPhotos.set(photo.path, { gallery, photo });
    }
  }

  const additions: Array<{ path: string; source: GalleryDataEntry; photo: GalleryPhotoEntry }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  let skipped = 0;
  for (const path of requestedPaths) {
    const source = physicalPhotos.get(path);
    if (!source) {
      errors.push({ path, error: "Photo was not found in the content index" });
      continue;
    }
    if (source.gallery.slug === targetSlug || target.photos.some((photo) => photo.path === path)) {
      skipped += 1;
      continue;
    }
    if (target.photos.some((photo) => photo.filename === source.photo.filename)) {
      errors.push({ path, error: "A different photo with the same filename already exists there" });
      continue;
    }
    additions.push({ path, source: source.gallery, photo: source.photo });
  }

  if (additions.length > 0) {
    await addGalleryMemberships(storage, additions.map((addition) => addition.path), targetSlug);
    target.photos.push(
      ...additions.map(({ source, photo }) => ({
        ...photo,
        isReference: true,
        sourceGallerySlug: source.slug,
      })),
    );
    target.isParentGallery = false;
    target.photoCount = target.photos.filter((photo) => !photo.hidden).length;
    const light = index.galleries.find((gallery) => gallery.slug === targetSlug);
    if (light) {
      light.photoCount = target.photoCount;
      light.isParentGallery = false;
    }
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
  }

  const added = additions.length;
  const failed = errors.length;
  const fragments = [`Added ${added} photo${added === 1 ? "" : "s"} to ${target.title}.`];
  if (skipped > 0) fragments.push(`${skipped} already belonged there.`);
  if (failed > 0) fragments.push(`${failed} could not be added.`);
  return {
    success: added > 0 || (failed === 0 && skipped > 0),
    added,
    skipped,
    errors,
    message: fragments.join(" "),
  };
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
      (sum, g) => sum + g.photos.filter((photo) => !photo.isReference).length, 0
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
    
    // Process only the new photos
    let addedPhotos = 0;
    for (const photoPath of newPhotoPaths) {
      const filename = photoPath.split('/').pop() || photoPath;
      
      // Check if already exists
      if (gallery.photos.some(p => p.filename === filename)) {
        continue;
      }
      
      // Extract normalized fields plus the complete EXIF/IPTC/XMP/ICC payload.
      let exifCache: GalleryPhotoEntry['exif'] = undefined;
      let year: number | undefined;
      let sourceFingerprint: string | undefined;
      const lastModified = new Date().toISOString();
      
      try {
        const buffer = await storage.get(photoPath);
        if (buffer) {
          const [extracted, fingerprint] = await Promise.all([
            extractImageMetadata(buffer),
            createCanonicalImageSourceFingerprint(buffer),
          ]);
          sourceFingerprint = fingerprint;
          if (extracted) {
            exifCache = toImageMetadataSummary(extracted.exif);
            if (exifCache.dateTaken) {
              const date = new Date(exifCache.dateTaken);
              if (!Number.isNaN(date.getTime())) year = date.getFullYear();
            }

            try {
              await writePhotoMetadata(
                storage,
                photoPath,
                extracted.exif,
                extracted.embedded,
                { size: buffer.byteLength, lastModified },
              );
            } catch (error) {
              // The source image and compact index projection still preserve
              // the data; a full metadata rebuild can retry later.
              console.error(`[Metadata] Failed to persist sidecar for ${photoPath}:`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to extract embedded metadata from ${photoPath}:`, error);
      }
      
      // Add the new photo
      gallery.photos.push({
        id: filename.replace(/\.[^.]+$/, ''),
        path: photoPath,
        filename,
        title: exifCache?.title || exifCache?.description,
        description: exifCache?.description,
        tags: exifCache?.keywords,
        year,
        dateTaken: exifCache?.dateTaken,
        exif: exifCache,
        lastModified,
        sourceFingerprint,
      });
      addedPhotos += 1;
    }
    
    // Update counts
    gallery.photoCount = gallery.photos.filter(p => !p.hidden).length;
    
    const lightIdx = index.galleries.findIndex(g => g.path === galleryPath);
    if (lightIdx !== -1) {
      index.galleries[lightIdx].photoCount = gallery.photoCount;
    }
    
    index.stats.totalPhotos = index.galleryData.reduce(
      (sum, g) => sum + g.photos.filter((photo) => !photo.isReference).length, 0
    );
    
    index.updatedAt = new Date().toISOString();
    await writeContentIndex(storage, index);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Index] Added ${addedPhotos} photos to ${galleryPath} in ${elapsed}ms`);
    
    return { success: true, message: `Added ${addedPhotos} photos in ${elapsed}ms` };
  } catch (error) {
    console.error("Failed to add photos to index:", error);
    await rebuildContentIndex(storage);
    return { success: true, message: "Index rebuilt due to error" };
  }
}

// ==================== Navigation Helper ====================

function localizedText<T extends {
  title?: string;
  description?: string;
  tags?: string[];
  locale?: Locale;
  translations?: TranslationMap<{ title?: string; description?: string; tags?: string[] }>;
}>(entry: T, locale: Locale): T {
  const sourceLocale = normalizeLocale(entry.locale) || "en";
  const base = {
    title: entry.title,
    description: entry.description,
    tags: entry.tags,
  };
  const resolution = resolveTranslation(base, sourceLocale, entry.translations, locale);
  const translated = resolution.value;

  return {
    ...entry,
    title: translated.title || entry.title,
    description: translated.description ?? entry.description,
    tags: translated.tags || entry.tags,
  };
}

export function localizeGalleryDataEntry(
  gallery: GalleryDataEntry,
  locale: Locale,
): GalleryDataEntry {
  const localizedGallery = localizedText(gallery, locale);
  return {
    ...localizedGallery,
    photos: gallery.photos.map((photo) => localizedText(photo, locale)),
  };
}

function localizePhotoIndexEntry(photo: PhotoIndexEntry, locale: Locale): PhotoIndexEntry {
  const localizedPhoto = localizedText(photo, locale);
  const localizedGallery = localizedText(
    {
      title: photo.galleryTitle,
      locale: photo.galleryLocale,
      translations: photo.galleryTranslations,
    },
    locale,
  );
  return {
    ...localizedPhoto,
    galleryTitle: localizedGallery.title || photo.galleryTitle,
  };
}

/**
 * Get navigation structure directly from the content index
 * This is much faster than scanning galleries for navigation
 */
export async function getNavigationFromIndex(
  storage: StorageAdapter,
  locale?: Locale,
): Promise<NavItem[]> {
  const index = await getContentIndex(storage);
  
  // Filter public galleries and sort by order
  const publicGalleries = index.galleries
    .filter(g => !g.isProtected || g.photoCount > 0) // Include protected if has photos
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  
  const galleries = locale
    ? publicGalleries.map((gallery) => localizedText(gallery, locale))
    : publicGalleries;
  const parentMetadata = locale
    ? index.parentMetadata.map((parent) => localizedText(parent, locale))
    : index.parentMetadata;

  return buildNavigation(galleries, parentMetadata, locale);
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
  homeConfig?: { photos?: Array<{ gallery: string; filename: string }> },
  locale?: Locale,
): Promise<HomePhoto[]> {
  const index = await getContentIndex(storage);

  // Older indexes may lack dimensions on featuredPhotos while the same values
  // already live in galleryData. Enrich at read time so the home grid is stable
  // immediately, without forcing an expensive R2 index rebuild.
  const dimensionsByPath = new Map<string, { width?: number; height?: number }>();
  for (const gallery of index.galleryData) {
    for (const photo of gallery.photos) {
      if (dimensionsByPath.has(photo.path)) continue;
      const width = photo.exif?.width;
      const height = photo.exif?.height;
      if (width || height) dimensionsByPath.set(photo.path, { width, height });
    }
  }
  
  if (homeConfig?.photos && homeConfig.photos.length > 0) {
    // Use handpicked photos from config
    const homePhotos: HomePhoto[] = [];
    homeConfig.photos.forEach((config, idx) => {
      const gallery = index.galleryData.find((entry) => entry.slug === config.gallery);
      const photo = gallery?.photos.find((entry) => entry.filename === config.filename);

      if (gallery && photo && !photo.hidden) {
        const homePhoto: HomePhoto = {
          id: photo.id,
          path: photo.path,
          filename: photo.filename,
          title: photo.title,
          description: photo.description,
          gallerySlug: gallery.slug,
          galleryTitle: gallery.title,
          galleryLocale: gallery.locale,
          galleryTranslations: gallery.translations,
          locale: photo.locale,
          translations: photo.translations,
          hidden: photo.hidden,
          year: photo.year,
          width: photo.exif?.width,
          height: photo.exif?.height,
          homeIndex: idx,
        };
        homePhotos.push(locale ? localizePhotoIndexEntry(homePhoto, locale) as HomePhoto : homePhoto);
      }
    });
    return homePhotos;
  }
  
  // Default: use all featured photos in order
  const photos = index.featuredPhotos
    .filter(p => !p.hidden)
    .map((photo, idx) => ({
      ...photo,
      width: photo.width ?? dimensionsByPath.get(photo.path)?.width,
      height: photo.height ?? dimensionsByPath.get(photo.path)?.height,
      homeIndex: idx,
    }));
  return locale
    ? photos.map((photo) => localizePhotoIndexEntry(photo, locale) as HomePhoto)
    : photos;
}

// ==================== Gallery Data Helpers ====================

/**
 * Get a specific gallery's full data from the index
 * Much faster than scanGalleries for single gallery lookups
 */
export async function getGalleryFromIndex(
  storage: StorageAdapter,
  slug: string,
  locale?: Locale,
): Promise<GalleryDataEntry | null> {
  const index = await getContentIndex(storage);
  const gallery = index.galleryData.find(g => g.slug === slug) || null;
  return gallery && locale ? localizeGalleryDataEntry(gallery, locale) : gallery;
}

/**
 * Get all galleries data from the index
 * Use this instead of scanGalleries for gallery listing pages
 */
export async function getAllGalleriesFromIndex(
  storage: StorageAdapter,
  locale?: Locale,
): Promise<GalleryDataEntry[]> {
  const index = await getContentIndex(storage);
  return locale
    ? index.galleryData.map((gallery) => localizeGalleryDataEntry(gallery, locale))
    : index.galleryData;
}

/**
 * Get gallery data for a path prefix (for virtual parent galleries)
 * Returns all galleries that start with the given slug prefix
 */
export async function getGalleriesByPrefix(
  storage: StorageAdapter,
  slugPrefix: string,
  locale?: Locale,
): Promise<GalleryDataEntry[]> {
  const index = await getContentIndex(storage);
  const galleries = index.galleryData.filter(g =>
    g.slug === slugPrefix || g.slug.startsWith(slugPrefix + "/")
  );
  return locale
    ? galleries.map((gallery) => localizeGalleryDataEntry(gallery, locale))
    : galleries;
}

/**
 * Find a photo in the index by gallery slug and filename
 */
export async function getPhotoFromIndex(
  storage: StorageAdapter,
  gallerySlug: string,
  filename: string,
  locale?: Locale,
): Promise<{ gallery: GalleryDataEntry; photo: GalleryPhotoEntry; photoIndex: number } | null> {
  const gallery = await getGalleryFromIndex(storage, gallerySlug, locale);
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
    locale: normalizeLocale(gallery.locale) || "en",
    translations: gallery.translations,
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
    coverImage: post.cover,
    tags: post.tags,
    readingTime: post.readingTime,
    locale: normalizeLocale(post.locale) || "en",
    translations: post.translations,
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
    locale: normalizeLocale(page.locale) || "en",
    translations: page.translations,
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
