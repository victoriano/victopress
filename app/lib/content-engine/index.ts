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
  PhotoTranslation,
  ExifData,
  Gallery,
  GalleryMetadata,
  GalleryTranslation,
  BlogPost,
  PostFrontmatter,
  BlogPostTranslation,
  Page,
  PageFrontmatter,
  PageTranslation,
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
export { scanBlog, filterPublishedPosts, localizeBlogPost } from "./blog-scanner";
export type { LocalizedBlogPost } from "./blog-scanner";
export { scanPages, filterVisiblePages, getPageBySlug, localizePage } from "./page-scanner";
export type { LocalizedPage } from "./page-scanner";

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
  localizeGalleryDataEntry,
  getHomePhotosFromIndex,
  getGalleryFromIndex,
  getAllGalleriesFromIndex,
  getGalleriesByPrefix,
  getPhotoFromIndex,
  updateGalleryInIndex,
  removeGalleryFromIndex,
  updatePostInIndex,
  removePostFromIndex,
  updatePageInIndex,
  removePageFromIndex,
  // Partial update functions (fast, YAML-only changes)
  updateGalleryMetadataInIndex,
  updateGalleryPhotosInIndex,
  addPhotosToGalleryIndex,
  assignPhotosToGalleryInIndex,
} from "./content-index";
export type {
  ContentIndex as ContentIndexData,
  GalleryIndexEntry,
  GalleryDataEntry,
  GalleryPhotoEntry,
  PostIndexEntry,
  PageIndexEntry,
  ParentMetadataEntry,
  PhotoIndexEntry,
  HomePhoto,
  GalleryMembershipAssignmentResult,
} from "./content-index";

export {
  readGalleryMemberships,
  removeGalleryMembershipsForPhotos,
  moveGalleryMemberships,
} from "./gallery-memberships";

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
  isSourceImage,
  isMarkdownFile,
  calculateReadingTime,
  generateExcerpt,
  hashPassword,
  verifyPassword,
} from "./utils";
