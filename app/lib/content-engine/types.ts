/**
 * VictoPress Content Engine Types
 * 
 * Core types for the zero-config content system.
 * Folder with images = gallery. Markdown = post.
 */

import type { GalleryThumbnailAspectRatio } from "./gallery-layout";

// =============================================================================
// Photo Types
// =============================================================================

export interface ExifData {
  // Date/Time
  dateTimeOriginal?: Date;
  createDate?: Date;
  modifyDate?: Date;
  metadataDate?: Date;
  
  // Description from Lightroom
  imageDescription?: string;
  title?: string;
  
  // Keywords/Tags (from Lightroom)
  keywords?: string[];
  
  // Author
  artist?: string;
  copyright?: string;
  credit?: string;
  source?: string;
  instructions?: string;

  // Editing/application metadata
  software?: string;
  creatorTool?: string;
  rating?: number;
  label?: string;
  colorSpace?: string;
  colorProfile?: string;
  
  // Camera Info
  make?: string;
  model?: string;
  lensModel?: string;
  focalLength?: number;
  aperture?: number;
  iso?: number;
  shutterSpeed?: string;
  exposureCompensation?: number;
  exposureProgram?: string;
  meteringMode?: string;
  flash?: string;
  whiteBalance?: string;
  orientation?: string;

  // Pixel dimensions (EXIF when present, JPEG SOF fallback otherwise)
  imageWidth?: number;
  imageHeight?: number;
  
  // GPS
  latitude?: number;
  longitude?: number;
  sublocation?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
}

/** JSON-safe representation of decoded, embedded image metadata. */
export type EmbeddedMetadataValue =
  | string
  | number
  | boolean
  | null
  | EmbeddedMetadataValue[]
  | { [key: string]: EmbeddedMetadataValue };

/**
 * Decoded metadata grouped by source namespace (EXIF, IPTC, XMP, Photoshop,
 * Camera Raw, ICC, and so on). Opaque binary values are base64 encoded.
 */
export interface EmbeddedImageMetadata {
  [namespace: string]: EmbeddedMetadataValue;
}

/**
 * Compact, JSON-safe projection kept in the content index. The complete
 * decoded payload is stored separately so public page loaders stay small.
 */
export interface ImageMetadataSummary {
  metadataVersion?: number;
  dateTaken?: string;
  createDate?: string;
  modifyDate?: string;
  metadataDate?: string;
  title?: string;
  description?: string;
  keywords?: string[];
  artist?: string;
  copyright?: string;
  credit?: string;
  source?: string;
  instructions?: string;
  software?: string;
  creatorTool?: string;
  rating?: number;
  label?: string;
  colorSpace?: string;
  colorProfile?: string;
  make?: string;
  model?: string;
  camera?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  shutterSpeed?: string;
  iso?: number;
  exposureCompensation?: number;
  exposureProgram?: string;
  meteringMode?: string;
  flash?: string;
  whiteBalance?: string;
  orientation?: string;
  width?: number;
  height?: number;
  gps?: { lat: number; lng: number };
  sublocation?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
}

export interface Photo {
  /** Unique identifier (filename without extension) */
  id: string;
  
  /** Original filename */
  filename: string;
  
  /** Full path relative to content root */
  path: string;
  
  /** Display title (from EXIF, YAML, or filename) */
  title?: string;
  
  /** Photo description/caption */
  description?: string;
  
  /** Tags/keywords */
  tags?: string[];
  
  /** Date taken (from EXIF or file modification) */
  dateTaken?: Date;
  
  /** EXIF metadata */
  exif?: ExifData;

  /**
   * Complete decoded embedded metadata, present only while scanning a newly
   * read source image. It is persisted to a private sidecar, not the public
   * content index.
   */
  embeddedMetadata?: EmbeddedImageMetadata;

  /**
   * Self-contained VictoPress state decoded during a source scan. Like the full
   * embedded payload, this is private/non-enumerable and never sent publicly.
   */
  victopressMetadata?: import("./victopress-xmp").VictoPressEmbeddedMetadata;
  
  /** Sort order (lower = first) */
  order?: number;
  
  /** Hidden from gallery view */
  hidden?: boolean;
  
  /** Image dimensions */
  width?: number;
  height?: number;
  
  /** File size in bytes */
  size?: number;
  
  /** File last modified timestamp (ISO string) for cache invalidation */
  lastModified?: string;

  /** Stable pixel/source identity; excludes VictoPress-owned XMP writeback. */
  sourceFingerprint?: string;
}

// =============================================================================
// Gallery Types
// =============================================================================

export interface GalleryMetadata {
  /** Display title */
  title?: string;
  
  /** URL-friendly slug */
  slug?: string;
  
  /** Gallery description */
  description?: string;

  /** Optional editorial guidance used only by AI gallery classification */
  classificationHint?: string;
  
  /** Cover image filename (defaults to first image) */
  cover?: string;
  
  /** Publication date */
  date?: Date;
  
  /** Tags for the gallery */
  tags?: string[];
  
  /** Category path (e.g., "travel/asia/japan") */
  category?: string;
  
  /** Hidden from public gallery listing */
  private?: boolean;
  
  /** Password protection (hashed) */
  password?: string;
  
  /** Sort order in listings */
  order?: number;
  
  /** Include photos from nested galleries (default: true) */
  includeNestedPhotos?: boolean;

  /** Thumbnail crop used by the public gallery grid (default: uniform 3:2) */
  thumbnailAspectRatio?: GalleryThumbnailAspectRatio;
}

export interface Gallery extends GalleryMetadata {
  /** Unique identifier (folder name as slug) */
  id: string;
  
  /** URL-friendly slug (derived from folder name) */
  slug: string;
  
  /** Display title (from YAML or folder name) */
  title: string;
  
  /** Folder path relative to content root */
  path: string;
  
  /** Cover image path (optional for parent galleries without photos) */
  cover?: string;
  
  /** Gallery photos */
  photos: Photo[];
  
  /** Number of photos */
  photoCount: number;
  
  /** Date of most recent modification */
  lastModified: Date;
  
  /** Whether metadata came from gallery.yaml */
  hasCustomMetadata: boolean;
  
  /** Whether this is a parent/container gallery (has config but no direct photos) */
  isParentGallery?: boolean;
}

// =============================================================================
// Blog Types
// =============================================================================

export interface PostFrontmatter {
  title?: string;
  /** Optional canonical slug. May contain path segments for migrated posts. */
  slug?: string;
  date?: Date;
  description?: string;
  tags?: string[];
  draft?: boolean;
  cover?: string;
  /** The cover already appears in the post body and should not be repeated. */
  coverInBody?: boolean;
  /** Content serialization used by the public renderer. */
  format?: "markdown" | "html";
  /** Original URL retained for migration audits and redirects. */
  sourceUrl?: string;
  author?: string;
}

export interface BlogPost extends PostFrontmatter {
  /** Unique identifier (folder/file name) */
  id: string;
  
  /** URL-friendly slug */
  slug: string;
  
  /** Display title */
  title: string;
  
  /** Folder/file path */
  path: string;
  
  /** Raw markdown content */
  content: string;
  
  /** Rendered HTML content */
  html?: string;
  
  /** Excerpt for listings */
  excerpt?: string;
  
  /** Reading time in minutes */
  readingTime?: number;
  
  /** Images in the post folder */
  images: string[];
  
  /** Whether frontmatter was present */
  hasFrontmatter: boolean;
}

// =============================================================================
// Page Types (Simple static pages like About, Contact)
// =============================================================================

export interface PageFrontmatter {
  title?: string;
  description?: string;
  /** Custom CSS file to include */
  css?: string;
  /** Custom layout template */
  layout?: string;
  /** Hide from navigation */
  hidden?: boolean;
}

export interface Page extends PageFrontmatter {
  /** Unique identifier (folder name) */
  id: string;
  
  /** URL-friendly slug */
  slug: string;
  
  /** Display title */
  title: string;
  
  /** Folder/file path */
  path: string;
  
  /** Raw markdown/HTML content */
  content: string;
  
  /** Rendered HTML content */
  html?: string;
  
  /** Custom CSS content (if css file exists) */
  customCss?: string;
  
  /** Whether frontmatter was present */
  hasFrontmatter: boolean;
  
  /** Whether content is HTML (not markdown) */
  isHtml: boolean;
}

// =============================================================================
// Tag Types
// =============================================================================

export interface Tag {
  /** Tag name (lowercase, normalized) */
  name: string;
  
  /** Display label */
  label: string;
  
  /** Number of photos with this tag */
  photoCount: number;
  
  /** Number of galleries with this tag */
  galleryCount: number;
  
  /** Number of posts with this tag */
  postCount: number;
}

// =============================================================================
// Content Index
// =============================================================================

export interface ContentIndex {
  /** All galleries (excluding private) */
  galleries: Gallery[];
  
  /** All blog posts (excluding drafts) */
  posts: BlogPost[];
  
  /** All tags with counts */
  tags: Tag[];
  
  /** Last time the index was generated */
  lastUpdated: Date;
  
  /** Content statistics */
  stats: {
    totalGalleries: number;
    totalPhotos: number;
    totalPosts: number;
    totalTags: number;
  };
}

// =============================================================================
// File System Abstractions
// =============================================================================

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}

export interface StorageAdapter {
  /** List files/folders in a path */
  list(prefix: string): Promise<FileInfo[]>;
  
  /** List all files recursively in a path */
  listRecursive(prefix: string): Promise<FileInfo[]>;
  
  /** Get file contents */
  get(key: string): Promise<ArrayBuffer | null>;
  
  /** Get file as text */
  getText(key: string): Promise<string | null>;
  
  /** Upload file contents */
  put(key: string, data: ArrayBuffer | string, contentType?: string): Promise<void>;

  /**
   * Replace an existing object's bytes while retaining provider-level HTTP and
   * custom metadata when the storage backend supports it.
   */
  putPreservingMetadata?(
    key: string,
    data: ArrayBuffer | string,
    contentType?: string,
  ): Promise<void>;
  
  /** Delete a file */
  delete(key: string): Promise<void>;
  
  /** Delete a directory and all its contents */
  deleteDirectory(prefix: string): Promise<{ deleted: number }>;
  
  /** Check if file exists */
  exists(key: string): Promise<boolean>;
  
  /** Move/rename a file */
  move(from: string, to: string): Promise<void>;
  
  /** Copy a file */
  copy(from: string, to: string): Promise<void>;
  
  /** Get signed URL for an image */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}
