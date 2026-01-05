/**
 * Gallery Scanner
 * 
 * Scans /content/galleries/ and creates gallery metadata.
 * Zero-config: folder with images = gallery
 */

import { parse as parseYaml } from "yaml";
import type {
  Gallery,
  GalleryMetadata,
  Photo,
  StorageAdapter,
  FileInfo,
} from "./types";
import {
  folderNameToTitle,
  toSlug,
  isImageFile,
  getBasename,
  sortPhotosAlphabetically,
} from "./utils";
import { extractExif } from "./exif";

const GALLERIES_PATH = "galleries";

/**
 * Scan all galleries in the content folder (including nested)
 */
export async function scanGalleries(
  storage: StorageAdapter
): Promise<Gallery[]> {
  return scanGalleriesRecursive(storage, GALLERIES_PATH, null);
}

/**
 * Recursively scan galleries including nested folders
 */
async function scanGalleriesRecursive(
  storage: StorageAdapter,
  path: string,
  parentCategory: string | null
): Promise<Gallery[]> {
  const galleries: Gallery[] = [];
  
  // List all items in current path
  const items = await storage.list(path);
  const directories = items.filter((f) => f.isDirectory);

  for (const dir of directories) {
    // Try to scan as gallery
    const gallery = await scanGalleryFolder(storage, dir, parentCategory);
    
    if (gallery) {
      galleries.push(gallery);
    }
    
    // Also scan subdirectories recursively
    const subGalleries = await scanGalleriesRecursive(
      storage,
      dir.path,
      parentCategory ? `${parentCategory}/${dir.name}` : dir.name
    );
    galleries.push(...subGalleries);
  }

  return galleries;
}

/**
 * Scan a single gallery folder
 */
async function scanGalleryFolder(
  storage: StorageAdapter,
  dir: FileInfo,
  parentCategory: string | null = null
): Promise<Gallery | null> {
  const folderPath = dir.path;
  const folderName = dir.name;
  
  // List contents of the folder
  const contents = await storage.list(folderPath);
  
  // Find image files
  const imageFiles = contents.filter((f) => !f.isDirectory && isImageFile(f.name));
  
  // Check for gallery.yaml (custom metadata)
  const yamlMetadata = await loadGalleryYaml(storage, folderPath);
  
  // A folder is a gallery if it has:
  // 1. Images (traditional gallery), OR
  // 2. A gallery.yaml file (parent/container gallery with settings)
  const hasImages = imageFiles.length > 0;
  const hasGalleryConfig = yamlMetadata !== null;
  
  if (!hasImages && !hasGalleryConfig) {
    return null;
  }
  
  // Check for photos.yaml (custom photo order/metadata)
  const photosYaml = await loadPhotosYaml(storage, folderPath);
  
  // Generate automatic metadata
  const autoTitle = folderNameToTitle(folderName);
  const autoSlug = toSlug(folderName);
  const lastModified = hasImages ? getLatestModification(imageFiles) : new Date();
  
  // Scan each photo (only if there are images)
  const photos = hasImages 
    ? await scanPhotos(storage, folderPath, imageFiles, photosYaml)
    : [];
  
  // Sort photos (by custom order or alphabetically)
  const sortedPhotos = sortPhotos(photos, photosYaml);
  
  // Determine cover image (may be undefined for parent galleries without photos)
  const cover = yamlMetadata?.cover || sortedPhotos[0]?.filename || (imageFiles[0]?.name ?? null);
  const coverPath = cover ? `${folderPath}/${cover}` : undefined;

  // Derive category from path if not set in YAML
  const derivedCategory = yamlMetadata?.category || parentCategory;
  
  // Create full slug including parent path
  const fullSlug = parentCategory 
    ? `${parentCategory}/${autoSlug}` 
    : autoSlug;

  // Check if this is a parent/container gallery (has config but no direct photos)
  const isParentGallery = hasGalleryConfig && !hasImages;
  
  // Build gallery object
  const gallery: Gallery = {
    id: fullSlug,
    slug: yamlMetadata?.slug || fullSlug,
    title: yamlMetadata?.title || autoTitle,
    description: yamlMetadata?.description,
    path: folderPath,
    cover: coverPath,
    photos: sortedPhotos,
    photoCount: sortedPhotos.filter((p) => !p.hidden).length,
    date: yamlMetadata?.date || lastModified,
    lastModified,
    tags: yamlMetadata?.tags || collectTagsFromPhotos(sortedPhotos),
    category: derivedCategory || undefined,
    private: yamlMetadata?.private || false,
    password: yamlMetadata?.password,
    order: yamlMetadata?.order,
    hasCustomMetadata: !!yamlMetadata,
    includeNestedPhotos: yamlMetadata?.includeNestedPhotos,
    isParentGallery,
  };

  return gallery;
}

/**
 * Load gallery.yaml if it exists
 */
async function loadGalleryYaml(
  storage: StorageAdapter,
  folderPath: string
): Promise<GalleryMetadata | null> {
  const yamlPath = `${folderPath}/gallery.yaml`;
  const content = await storage.getText(yamlPath);
  
  if (!content) {
    return null;
  }

  try {
    const data = parseYaml(content) as GalleryMetadata;
    
    // Parse date if string
    if (typeof data.date === "string") {
      data.date = new Date(data.date);
    }
    
    return data;
  } catch (error) {
    console.warn(`Failed to parse ${yamlPath}:`, error);
    return null;
  }
}

/**
 * Load photos.yaml if it exists (custom photo order/metadata)
 */
async function loadPhotosYaml(
  storage: StorageAdapter,
  folderPath: string
): Promise<PhotoYamlEntry[] | null> {
  const yamlPath = `${folderPath}/photos.yaml`;
  const content = await storage.getText(yamlPath);
  
  if (!content) {
    return null;
  }

  try {
    return parseYaml(content) as PhotoYamlEntry[];
  } catch (error) {
    console.warn(`Failed to parse ${yamlPath}:`, error);
    return null;
  }
}

interface PhotoYamlEntry {
  filename: string;
  title?: string;
  description?: string;
  tags?: string[];
  hidden?: boolean;
  order?: number;
}

/**
 * Scan individual photos and extract metadata
 */
async function scanPhotos(
  storage: StorageAdapter,
  folderPath: string,
  imageFiles: FileInfo[],
  photosYaml: PhotoYamlEntry[] | null
): Promise<Photo[]> {
  const photos: Photo[] = [];
  
  // Create a map of YAML overrides
  const yamlMap = new Map<string, PhotoYamlEntry>();
  if (photosYaml) {
    for (const entry of photosYaml) {
      yamlMap.set(entry.filename, entry);
    }
  }

  for (const file of imageFiles) {
    const photoPath = `${folderPath}/${file.name}`;
    const yamlOverride = yamlMap.get(file.name);
    
    // Try to extract EXIF data
    let exifData = null;
    if (file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg")) {
      try {
        const buffer = await storage.get(photoPath);
        if (buffer) {
          exifData = await extractExif(buffer);
        }
      } catch (error) {
        console.warn(`Failed to extract EXIF from ${photoPath}:`, error);
      }
    }

    // Build photo object with priority: YAML > EXIF > auto-generated
    const photo: Photo = {
      id: getBasename(file.name),
      filename: file.name,
      path: photoPath,
      size: file.size,
      
      // Title: YAML > EXIF title > EXIF description > filename
      title:
        yamlOverride?.title ||
        exifData?.title ||
        exifData?.imageDescription ||
        undefined,
      
      // Description: YAML > EXIF description
      description:
        yamlOverride?.description ||
        exifData?.imageDescription,
      
      // Tags: YAML > EXIF keywords
      tags:
        yamlOverride?.tags ||
        exifData?.keywords,
      
      // Date: EXIF date or file modification
      dateTaken: exifData?.dateTimeOriginal || file.lastModified,
      
      // EXIF data
      exif: exifData || undefined,
      
      // Hidden flag from YAML
      hidden: yamlOverride?.hidden || false,
      
      // Order from YAML
      order: yamlOverride?.order,
    };

    photos.push(photo);
  }

  return photos;
}

/**
 * Sort photos by custom order or alphabetically
 */
function sortPhotos(photos: Photo[], photosYaml: PhotoYamlEntry[] | null): Photo[] {
  if (photosYaml && photosYaml.length > 0) {
    // Use YAML order
    const orderMap = new Map<string, number>();
    photosYaml.forEach((entry, index) => {
      orderMap.set(entry.filename, entry.order ?? index);
    });
    
    return [...photos].sort((a, b) => {
      const orderA = orderMap.get(a.filename) ?? 999999;
      const orderB = orderMap.get(b.filename) ?? 999999;
      if (orderA !== orderB) return orderA - orderB;
      return a.filename.localeCompare(b.filename, undefined, { numeric: true });
    });
  }
  
  // Default: alphabetical
  return sortPhotosAlphabetically(photos);
}

/**
 * Get the most recent modification date from files
 */
function getLatestModification(files: FileInfo[]): Date {
  if (files.length === 0) {
    return new Date();
  }
  
  return files.reduce((latest, file) => {
    return file.lastModified > latest ? file.lastModified : latest;
  }, files[0].lastModified);
}

/**
 * Collect all tags from photos
 */
function collectTagsFromPhotos(photos: Photo[]): string[] {
  const tagSet = new Set<string>();
  
  for (const photo of photos) {
    if (photo.tags) {
      for (const tag of photo.tags) {
        tagSet.add(tag.toLowerCase());
      }
    }
  }
  
  return Array.from(tagSet);
}

/**
 * Parent folder metadata (for folders without images)
 */
export interface ParentGalleryMetadata {
  slug: string;
  title?: string;
  order?: number;
}

/**
 * Scan for parent folder metadata (folders with gallery.yaml but no images)
 * This is used for navigation ordering of parent categories
 */
export async function scanParentMetadata(
  storage: StorageAdapter
): Promise<ParentGalleryMetadata[]> {
  const parents: ParentGalleryMetadata[] = [];
  await scanParentMetadataRecursive(storage, GALLERIES_PATH, "", parents);
  return parents;
}

async function scanParentMetadataRecursive(
  storage: StorageAdapter,
  path: string,
  currentSlug: string,
  results: ParentGalleryMetadata[]
): Promise<void> {
  const items = await storage.list(path);
  const directories = items.filter((f) => f.isDirectory);
  const imageFiles = items.filter((f) => !f.isDirectory && isImageFile(f.name));
  
  // If this folder has no images but has a gallery.yaml, it's a parent category
  if (imageFiles.length === 0 && path !== GALLERIES_PATH && currentSlug) {
    const yamlContent = await storage.getText(`${path}/gallery.yaml`);
    if (yamlContent) {
      try {
        const data = parseYaml(yamlContent) as GalleryMetadata;
        
        results.push({
          slug: currentSlug,
          title: data.title,
          order: data.order,
        });
      } catch {
        // Invalid YAML, skip
      }
    }
  }
  
  // Recursively scan subdirectories
  for (const dir of directories) {
    const folderName = dir.name;
    const childSlug = currentSlug 
      ? `${currentSlug}/${toSlug(folderName)}` 
      : toSlug(folderName);
    
    await scanParentMetadataRecursive(
      storage, 
      `${path}/${folderName}`, 
      childSlug,
      results
    );
  }
}
