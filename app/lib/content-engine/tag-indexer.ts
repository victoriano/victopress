/**
 * Tag Indexer
 * 
 * Collects all tags from galleries, photos, and posts.
 * Generates tag index with counts.
 */

import type { Gallery, BlogPost, Photo, Tag } from "./types";
import { normalizeTag, formatTagLabel } from "./utils";

/**
 * Build tag index from all content
 */
export function buildTagIndex(
  galleries: Gallery[],
  posts: BlogPost[]
): Tag[] {
  const tagMap = new Map<string, TagCounter>();

  // Process gallery tags
  for (const gallery of galleries) {
    if (gallery.private) continue;
    
    // Gallery-level tags
    if (gallery.tags) {
      for (const tag of gallery.tags) {
        const normalized = normalizeTag(tag);
        const counter = getOrCreateTag(tagMap, normalized, tag);
        counter.galleryCount++;
      }
    }
    
    // Photo-level tags
    for (const photo of gallery.photos) {
      if (photo.hidden) continue;
      
      if (photo.tags) {
        for (const tag of photo.tags) {
          const normalized = normalizeTag(tag);
          const counter = getOrCreateTag(tagMap, normalized, tag);
          counter.photoCount++;
        }
      }
    }
  }

  // Process post tags
  for (const post of posts) {
    if (post.draft) continue;
    
    if (post.tags) {
      for (const tag of post.tags) {
        const normalized = normalizeTag(tag);
        const counter = getOrCreateTag(tagMap, normalized, tag);
        counter.postCount++;
      }
    }
  }

  // Convert to array and sort by total count
  const tags: Tag[] = Array.from(tagMap.values())
    .map((counter) => ({
      name: counter.name,
      label: counter.label,
      photoCount: counter.photoCount,
      galleryCount: counter.galleryCount,
      postCount: counter.postCount,
    }))
    .sort((a, b) => {
      const totalA = a.photoCount + a.galleryCount + a.postCount;
      const totalB = b.photoCount + b.galleryCount + b.postCount;
      return totalB - totalA;
    });

  return tags;
}

interface TagCounter {
  name: string;
  label: string;
  photoCount: number;
  galleryCount: number;
  postCount: number;
}

function getOrCreateTag(
  map: Map<string, TagCounter>,
  normalized: string,
  originalTag: string
): TagCounter {
  let counter = map.get(normalized);
  
  if (!counter) {
    counter = {
      name: normalized,
      label: formatTagLabel(originalTag),
      photoCount: 0,
      galleryCount: 0,
      postCount: 0,
    };
    map.set(normalized, counter);
  }
  
  return counter;
}

/**
 * Filter photos by tag
 */
export function filterPhotosByTag(
  galleries: Gallery[],
  tag: string
): Photo[] {
  const normalizedTag = normalizeTag(tag);
  const photos: Photo[] = [];

  for (const gallery of galleries) {
    if (gallery.private) continue;
    
    for (const photo of gallery.photos) {
      if (photo.hidden) continue;
      
      if (photo.tags?.some((t) => normalizeTag(t) === normalizedTag)) {
        photos.push(photo);
      }
    }
  }

  return photos;
}

/**
 * Filter galleries by tag
 */
export function filterGalleriesByTag(
  galleries: Gallery[],
  tag: string
): Gallery[] {
  const normalizedTag = normalizeTag(tag);
  
  return galleries.filter((gallery) => {
    if (gallery.private) return false;
    
    // Check gallery tags
    if (gallery.tags?.some((t) => normalizeTag(t) === normalizedTag)) {
      return true;
    }
    
    // Check if any photo has the tag
    return gallery.photos.some(
      (photo) =>
        !photo.hidden &&
        photo.tags?.some((t) => normalizeTag(t) === normalizedTag)
    );
  });
}

/**
 * Filter galleries by category path
 */
export function filterGalleriesByCategory(
  galleries: Gallery[],
  categoryPath: string
): Gallery[] {
  const normalizedPath = categoryPath.toLowerCase();
  
  return galleries.filter((gallery) => {
    if (gallery.private) return false;
    if (!gallery.category) return false;
    
    const galleryCategory = gallery.category.toLowerCase();
    
    // Exact match or starts with category path
    return (
      galleryCategory === normalizedPath ||
      galleryCategory.startsWith(`${normalizedPath}/`)
    );
  });
}

/**
 * Get all unique categories
 */
export function getCategories(galleries: Gallery[]): string[] {
  const categories = new Set<string>();
  
  for (const gallery of galleries) {
    if (gallery.private) continue;
    if (gallery.category) {
      categories.add(gallery.category.toLowerCase());
      
      // Also add parent categories
      const parts = gallery.category.toLowerCase().split("/");
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        categories.add(path);
      }
    }
  }
  
  return Array.from(categories).sort();
}
