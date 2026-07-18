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

  // Scan recursively so imported posts can preserve historical paths such as
  // /blog/2021/10/3/post-slug while remaining editable in the CMS.
  const items = await storage.listRecursive(BLOG_PATH);
  const markdownFiles = items.filter(
    (item) => !item.isDirectory && isMarkdownFile(item.name)
  );
  const filesByDirectory = new Map<string, FileInfo[]>();

  for (const file of markdownFiles) {
    const slash = file.path.lastIndexOf("/");
    const directory = slash >= 0 ? file.path.slice(0, slash) : BLOG_PATH;
    const directoryFiles = filesByDirectory.get(directory) || [];
    directoryFiles.push(file);
    filesByDirectory.set(directory, directoryFiles);
  }

  for (const [directory, files] of filesByDirectory) {
    if (directory === BLOG_PATH) {
      for (const file of files) {
        const post = await scanBlogFile(storage, file);
        if (post) posts.push(post);
      }
      continue;
    }

    const mainMdFile = findMainMarkdownFile(files);
    if (!mainMdFile) continue;

    const post = await scanBlogFolder(storage, directory, mainMdFile, items);
    if (post) posts.push(post);
  }

  return posts;
}

/**
 * Scan a folder-based blog post
 */
async function scanBlogFolder(
  storage: StorageAdapter,
  folderPath: string,
  mainMdFile: FileInfo,
  allItems: FileInfo[]
): Promise<BlogPost | null> {
  const defaultSlug = folderPath.slice(`${BLOG_PATH}/`.length);

  // Find images in the folder
  const images = allItems
    .filter((item) => {
      if (item.isDirectory || !isImageFile(item.name)) return false;
      const slash = item.path.lastIndexOf("/");
      return slash >= 0 && item.path.slice(0, slash) === folderPath;
    })
    .map((item) => item.path);

  // Read markdown content
  const content = await storage.getText(mainMdFile.path);
  
  if (!content) {
    return null;
  }

  return parseMarkdownPost(content, folderPath, defaultSlug, images);
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
    const file = files.find((f) => {
      const basename = f.name.split("/").pop()?.toLowerCase();
      return basename === name;
    });
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
  const slug = frontmatter.slug || (frontmatter.title
    ? toSlug(frontmatter.title)
    : toSlug(defaultSlug));

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
    coverInBody: frontmatter.coverInBody,
    format: frontmatter.format,
    sourceUrl: frontmatter.sourceUrl,
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
