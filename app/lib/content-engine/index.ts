/**
 * VictoPress Content Engine
 * 
 * Zero-config content management for photo galleries and blog.
 * Folder with images = gallery. Markdown = post.
 * 
 * @example
 * ```ts
 * import { generateContentIndex, R2StorageAdapter } from "~/lib/content-engine";
 * 
 * const storage = new R2StorageAdapter(env.CONTENT_BUCKET);
 * const index = await generateContentIndex(storage);
 * ```
 */

// Types
export type {
  Photo,
  ExifData,
  Gallery,
  GalleryMetadata,
  BlogPost,
  PostFrontmatter,
  Page,
  PageFrontmatter,
  Tag,
  ContentIndex,
  FileInfo,
  StorageAdapter,
} from "./types";

// Main indexer
export {
  generateContentIndex,
  getGalleryBySlug,
  getPostBySlug,
} from "./indexer";

// Scanners
export { scanGalleries, scanParentMetadata } from "./gallery-scanner";
export type { ParentGalleryMetadata } from "./gallery-scanner";
export { scanBlog, filterPublishedPosts } from "./blog-scanner";
export { scanPages, filterVisiblePages, getPageBySlug } from "./page-scanner";

// Tag system
export {
  buildTagIndex,
  filterPhotosByTag,
  filterGalleriesByTag,
  filterGalleriesByCategory,
  getCategories,
} from "./tag-indexer";

// Content Index (pre-calculated for fast navigation)
export {
  getContentIndex,
  rebuildContentIndex,
  readContentIndex,
  writeContentIndex,
  hasValidIndex,
  getIndexAge,
  invalidateContentIndex,
  getNavigationFromIndex,
  getHomePhotosFromIndex,
  updateGalleryInIndex,
  removeGalleryFromIndex,
  updatePostInIndex,
  removePostFromIndex,
  updatePageInIndex,
  removePageFromIndex,
} from "./content-index";
export type {
  ContentIndex as ContentIndexData,
  GalleryIndexEntry,
  PostIndexEntry,
  PageIndexEntry,
  ParentMetadataEntry,
  PhotoIndexEntry,
  HomePhoto,
} from "./content-index";

// EXIF
export { extractExif, formatExifForDisplay } from "./exif";

// Storage adapters
export { R2StorageAdapter } from "./storage/r2-adapter";
export { LocalStorageAdapter } from "./storage/local-adapter";
export { 
  createStorageAdapter, 
  getStorage, 
  getStorageMode, 
  getAdapterPreference,
  isDemoMode,
  isStorageConfigured,
  isR2Configured,
  isSiteConfigured,
  isDevelopment,
  needsSetup,
  StorageNotConfiguredError,
} from "./storage";
export type { StorageMode, StorageAdapterPreference } from "./storage";

// Utilities
export {
  folderNameToTitle,
  toSlug,
  isImageFile,
  isMarkdownFile,
  calculateReadingTime,
  generateExcerpt,
  hashPassword,
  verifyPassword,
} from "./utils";
