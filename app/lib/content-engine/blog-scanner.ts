/**
 * Blog Scanner
 * 
 * Scans /content/blog/ and creates blog post metadata.
 * Detects folders with *.md files and parses frontmatter.
 */

import matter from "gray-matter";
import type {
  BlogPost,
  PostFrontmatter,
  StorageAdapter,
  FileInfo,
} from "./types";
import {
  folderNameToTitle,
  toSlug,
  isMarkdownFile,
  isImageFile,
  getBasename,
  calculateReadingTime,
  generateExcerpt,
} from "./utils";

const BLOG_PATH = "blog";

/**
 * Scan all blog posts in the content folder
 */
export async function scanBlog(storage: StorageAdapter): Promise<BlogPost[]> {
  const posts: BlogPost[] = [];
  
  // List all items in /content/blog/
  const items = await storage.list(BLOG_PATH);

  for (const item of items) {
    if (item.isDirectory) {
      // Folder-based post (e.g., /blog/my-post/index.md)
      const post = await scanBlogFolder(storage, item);
      if (post) {
        posts.push(post);
      }
    } else if (isMarkdownFile(item.name)) {
      // Single file post (e.g., /blog/my-post.md)
      const post = await scanBlogFile(storage, item);
      if (post) {
        posts.push(post);
      }
    }
  }

  return posts;
}

/**
 * Scan a folder-based blog post
 */
async function scanBlogFolder(
  storage: StorageAdapter,
  dir: FileInfo
): Promise<BlogPost | null> {
  const folderPath = dir.path;
  const folderName = dir.name;
  
  // List contents of the folder
  const contents = await storage.list(folderPath);
  
  // Find markdown files
  const mdFiles = contents.filter((f) => !f.isDirectory && isMarkdownFile(f.name));
  
  // Look for index.md, post.md, or the only .md file
  const mainMdFile = findMainMarkdownFile(mdFiles);
  
  if (!mainMdFile) {
    return null;
  }

  // Find images in the folder
  const images = contents
    .filter((f) => !f.isDirectory && isImageFile(f.name))
    .map((f) => `${folderPath}/${f.name}`);

  // Read markdown content
  const content = await storage.getText(`${folderPath}/${mainMdFile.name}`);
  
  if (!content) {
    return null;
  }

  return parseMarkdownPost(content, folderPath, folderName, images);
}

/**
 * Scan a single markdown file post
 */
async function scanBlogFile(
  storage: StorageAdapter,
  file: FileInfo
): Promise<BlogPost | null> {
  const content = await storage.getText(file.path);
  
  if (!content) {
    return null;
  }

  const slug = getBasename(file.name);
  return parseMarkdownPost(content, file.path, slug, []);
}

/**
 * Find the main markdown file in a folder
 */
function findMainMarkdownFile(files: FileInfo[]): FileInfo | null {
  // Priority: index.md > post.md > README.md > first .md file
  const priority = ["index.md", "post.md", "readme.md"];
  
  for (const name of priority) {
    const file = files.find((f) => f.name.toLowerCase() === name);
    if (file) {
      return file;
    }
  }
  
  // Return first markdown file
  return files[0] || null;
}

/**
 * Parse markdown content with frontmatter
 */
function parseMarkdownPost(
  content: string,
  path: string,
  defaultSlug: string,
  images: string[]
): BlogPost {
  // Parse frontmatter
  const { data, content: markdownContent } = matter(content);
  const frontmatter = data as PostFrontmatter;
  const hasFrontmatter = Object.keys(data).length > 0;

  // Generate slug
  const slug = frontmatter.title 
    ? toSlug(frontmatter.title) 
    : toSlug(defaultSlug);

  // Generate title from folder name if not in frontmatter
  const title = frontmatter.title || folderNameToTitle(defaultSlug);

  // Parse date
  let date: Date | undefined;
  if (frontmatter.date) {
    date = frontmatter.date instanceof Date 
      ? frontmatter.date 
      : new Date(frontmatter.date);
  }

  // Generate excerpt
  const excerpt = frontmatter.description || generateExcerpt(markdownContent);

  // Calculate reading time
  const readingTime = calculateReadingTime(markdownContent);

  // Determine cover image
  const cover = frontmatter.cover || (images.length > 0 ? images[0] : undefined);

  const post: BlogPost = {
    id: slug,
    slug,
    title,
    path,
    content: markdownContent,
    excerpt,
    readingTime,
    images,
    hasFrontmatter,
    
    // From frontmatter
    date,
    description: frontmatter.description,
    tags: frontmatter.tags,
    draft: frontmatter.draft || false,
    cover,
    author: frontmatter.author,
  };

  return post;
}

/**
 * Filter out draft posts for public listing
 */
export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => !post.draft);
}
