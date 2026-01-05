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
import { scanGalleries, scanParentMetadata } from "./gallery-scanner";
import { scanBlog } from "./blog-scanner";
import { scanPages } from "./page-scanner";
import { buildNavigation } from "../../utils/navigation";
import type { NavItem } from "../../components/Sidebar";

const INDEX_FILE = "_content-index.json";
const INDEX_VERSION = 1;

/**
 * Parent folder metadata
 */
export interface ParentMetadataEntry {
  slug: string;
  title?: string;
  order?: number;
}

/**
 * Cached content index structure
 */
export interface ContentIndex {
  version: number;
  updatedAt: string;
  galleries: GalleryIndexEntry[];
  posts: PostIndexEntry[];
  pages: PageIndexEntry[];
  parentMetadata: ParentMetadataEntry[];
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
  coverPhoto?: string;
  photoCount: number;
  isProtected: boolean;
  order?: number;
  category?: string;
  tags?: string[];
  path: string;
  hasChildren: boolean;
  childCount: number;
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
 * Rebuild the entire content index from scratch
 * This scans all content and saves a new index
 */
export async function rebuildContentIndex(storage: StorageAdapter): Promise<ContentIndex> {
  console.log("Rebuilding content index...");
  const startTime = Date.now();
  
  // Scan all content in parallel
  const [galleries, posts, pages, parentMeta] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
    scanPages(storage),
    scanParentMetadata(storage),
  ]);
  
  // Convert to index entries (strip heavy data like full photo arrays)
  const galleryEntries: GalleryIndexEntry[] = galleries.map(g => ({
    slug: g.slug,
    title: g.title,
    description: g.description,
    coverPhoto: g.coverPhoto,
    photoCount: g.photoCount,
    isProtected: g.isProtected,
    order: g.order,
    category: g.category,
    tags: g.tags,
    path: g.path,
    hasChildren: (g.children?.length ?? 0) > 0,
    childCount: g.children?.length ?? 0,
  }));
  
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
  
  // Calculate stats
  const totalPhotos = galleries.reduce((acc, g) => acc + g.photoCount, 0);
  
  const index: ContentIndex = {
    version: INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    galleries: galleryEntries,
    posts: postEntries,
    pages: pageEntries,
    parentMetadata: parentMetadataEntries,
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
 */
export async function getContentIndex(storage: StorageAdapter, forceRebuild = false): Promise<ContentIndex> {
  if (!forceRebuild) {
    const cached = await readContentIndex(storage);
    if (cached) {
      return cached;
    }
  }
  
  // Index doesn't exist or force rebuild requested
  return rebuildContentIndex(storage);
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
    coverPhoto: gallery.coverPhoto,
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
