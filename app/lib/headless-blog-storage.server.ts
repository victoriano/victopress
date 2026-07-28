import {
  blogPostsFromIndexEntries,
  isHydratedBlogPostIndex,
} from "~/lib/content-engine/blog-index";
import { scanBlog } from "~/lib/content-engine/blog-scanner";
import { readContentIndex } from "~/lib/content-engine/content-index";
import type { BlogPost, StorageAdapter } from "~/lib/content-engine/types";

/**
 * Serve the public blog from one cached R2 object instead of listing the
 * directory and downloading every Markdown edition on every request.
 */
export async function loadHeadlessBlogPosts(
  storage: StorageAdapter,
): Promise<BlogPost[]> {
  const index = await readContentIndex(storage);
  if (index && isHydratedBlogPostIndex(index.posts)) {
    return blogPostsFromIndexEntries(index.posts);
  }

  return scanBlog(storage);
}
