/**
 * VictoPress Content Engine Types
 * 
 * Core types for the zero-config content system.
 * Folder with images = gallery. Markdown = post.
 */

// =============================================================================
// Photo Types
// =============================================================================

export interface ExifData {
  // Date/Time
  dateTimeOriginal?: Date;
  
  // Description from Lightroom
  imageDescription?: string;
  title?: string;
  
  // Keywords/Tags (from Lightroom)
  keywords?: string[];
  
  // Author
  artist?: string;
  copyright?: string;
  
  // Camera Info
  make?: string;
  model?: string;
  lensModel?: string;
  focalLength?: number;
  aperture?: number;
  iso?: number;
  shutterSpeed?: string;
  
  // GPS
  latitude?: number;
  longitude?: number;
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
  
  /** Sort order (lower = first) */
  order?: number;
  
  /** Hidden from gallery view */
  hidden?: boolean;
  
  /** Image dimensions */
  width?: number;
  height?: number;
  
  /** File size in bytes */
  size?: number;
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
  
  /** Cover image path */
  cover: string;
  
  /** Gallery photos */
  photos: Photo[];
  
  /** Number of photos */
  photoCount: number;
  
  /** Date of most recent modification */
  lastModified: Date;
  
  /** Whether metadata came from gallery.yaml */
  hasCustomMetadata: boolean;
}

// =============================================================================
// Blog Types
// =============================================================================

export interface PostFrontmatter {
  title?: string;
  date?: Date;
  description?: string;
  tags?: string[];
  draft?: boolean;
  cover?: string;
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
  
  /** Get file contents */
  get(key: string): Promise<ArrayBuffer | null>;
  
  /** Get file as text */
  getText(key: string): Promise<string | null>;
  
  /** Check if file exists */
  exists(key: string): Promise<boolean>;
  
  /** Get signed URL for an image */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}
