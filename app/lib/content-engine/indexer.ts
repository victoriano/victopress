/**
 * Content Indexer
 * 
 * Main entry point for the content engine.
 * Generates the full content index (index.json).
 */

import type { ContentIndex, StorageAdapter } from "./types";
import { scanGalleries } from "./gallery-scanner";
import { scanBlog, filterPublishedPosts } from "./blog-scanner";
import { buildTagIndex } from "./tag-indexer";
import { sortByDateDesc } from "./utils";

/**
 * Generate the complete content index
 */
export async function generateContentIndex(
  storage: StorageAdapter
): Promise<ContentIndex> {
  // Scan all content
  const [allGalleries, allPosts] = await Promise.all([
    scanGalleries(storage),
    scanBlog(storage),
  ]);

  // Filter for public content
  const publicGalleries = allGalleries.filter((g) => !g.private);
  const publishedPosts = filterPublishedPosts(allPosts);

  // Sort by date (most recent first)
  const sortedGalleries = sortByDateDesc(publicGalleries);
  const sortedPosts = sortByDateDesc(publishedPosts);

  // Build tag index
  const tags = buildTagIndex(allGalleries, allPosts);

  // Calculate stats
  const totalPhotos = allGalleries.reduce(
    (sum, gallery) => sum + gallery.photos.filter((p) => !p.hidden).length,
    0
  );

  const index: ContentIndex = {
    galleries: sortedGalleries,
    posts: sortedPosts,
    tags,
    lastUpdated: new Date(),
    stats: {
      totalGalleries: publicGalleries.length,
      totalPhotos,
      totalPosts: publishedPosts.length,
      totalTags: tags.length,
    },
  };

  return index;
}

/**
 * Get a single gallery by slug
 */
export async function getGalleryBySlug(
  storage: StorageAdapter,
  slug: string
): Promise<Awaited<ReturnType<typeof scanGalleries>>[number] | null> {
  const galleries = await scanGalleries(storage);
  return galleries.find((g) => g.slug === slug) || null;
}

/**
 * Get a single post by slug
 */
export async function getPostBySlug(
  storage: StorageAdapter,
  slug: string
): Promise<Awaited<ReturnType<typeof scanBlog>>[number] | null> {
  const posts = await scanBlog(storage);
  return posts.find((p) => p.slug === slug) || null;
}
