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

// EXIF
export { extractExif, formatExifForDisplay } from "./exif";

// Storage adapters
export { R2StorageAdapter } from "./storage/r2-adapter";
export { LocalStorageAdapter } from "./storage/local-adapter";
export { BundledStorageAdapter } from "./storage/bundled-adapter";
export { 
  createStorageAdapter, 
  getStorage, 
  getStorageMode, 
  isDemoMode, 
  isR2Configured,
} from "./storage";
export type { StorageMode } from "./storage";

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
