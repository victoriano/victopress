/**
 * Blog Scanner
 * 
 * Scans /content/blog/ and creates blog post metadata.
 * Detects folders with *.md files and parses frontmatter.
 */

import matter from "gray-matter";
import type {
  BlogPost,
  BlogPostTranslation,
  PostFrontmatter,
  StorageAdapter,
  FileInfo,
} from "./types";
import {
  normalizeLocale,
  resolveTranslation,
  type Locale,
} from "~/lib/i18n";
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
      for (const file of files.filter((candidate) => !localeFromVariantFilename(candidate.name))) {
        const variants = files.filter((candidate) =>
          localizedVariantBelongsTo(candidate.name, file.name),
        );
        const post = await scanBlogFile(storage, file, variants);
        if (post) posts.push(post);
      }
      continue;
    }

    const mainMdFile = findMainMarkdownFile(files);
    if (!mainMdFile) continue;

    const post = await scanBlogFolder(storage, directory, mainMdFile, files, items);
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
  markdownFiles: FileInfo[],
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

  const post = parseMarkdownPost(content, folderPath, defaultSlug, images);
  const variants = markdownFiles.filter((file) => localeFromVariantFilename(file.name));
  return attachTranslations(storage, post, variants, folderPath, defaultSlug, images);
}

/**
 * Scan a single markdown file post
 */
async function scanBlogFile(
  storage: StorageAdapter,
  file: FileInfo,
  variants: FileInfo[] = [],
): Promise<BlogPost | null> {
  const content = await storage.getText(file.path);
  
  if (!content) {
    return null;
  }

  const slug = getBasename(file.name);
  const post = parseMarkdownPost(content, file.path, slug, []);
  return attachTranslations(storage, post, variants, file.path, slug, []);
}

/**
 * Find the main markdown file in a folder
 */
function findMainMarkdownFile(files: FileInfo[]): FileInfo | null {
  const baseFiles = files.filter((file) => !localeFromVariantFilename(file.name));
  // Priority: index.md > post.md > README.md > first .md file
  const priority = ["index.md", "post.md", "readme.md"];
  
  for (const name of priority) {
    const file = baseFiles.find((f) => {
      const basename = f.name.split("/").pop()?.toLowerCase();
      return basename === name;
    });
    if (file) {
      return file;
    }
  }
  
  // Return first markdown file
  return baseFiles[0] || null;
}

function localeFromVariantFilename(filename: string): Locale | null {
  const basename = filename.split("/").pop() || filename;
  const match = basename.match(/\.(es|en)\.md$/i);
  return normalizeLocale(match?.[1]);
}

function localizedVariantBelongsTo(variantName: string, baseName: string): boolean {
  const locale = localeFromVariantFilename(variantName);
  if (!locale) return false;
  const expected = baseName.replace(/\.md$/i, `.${locale}.md`);
  return variantName.toLowerCase() === expected.toLowerCase();
}

function translationFromPost(post: BlogPost, locale: Locale, path = post.path): BlogPostTranslation {
  return {
    locale,
    title: post.title,
    description: post.description,
    content: post.content,
    excerpt: post.excerpt || post.description || "",
    readingTime: post.readingTime || 1,
    format: post.format === "html" ? "html" : "markdown",
    path,
    tags: post.tags,
  };
}

async function attachTranslations(
  storage: StorageAdapter,
  post: BlogPost,
  variantFiles: FileInfo[],
  postPath: string,
  defaultSlug: string,
  images: string[],
): Promise<BlogPost> {
  const sourceLocale = normalizeLocale(post.locale) || "en";
  const translations: NonNullable<BlogPost["translations"]> = {
    [sourceLocale]: translationFromPost(post, sourceLocale),
  };

  for (const file of variantFiles) {
    const locale = localeFromVariantFilename(file.name);
    if (!locale) continue;
    const content = await storage.getText(file.path);
    if (!content) continue;
    const variant = parseMarkdownPost(content, postPath, defaultSlug, images);
    translations[locale] = translationFromPost(variant, locale, file.path);
  }

  return { ...post, locale: sourceLocale, translations };
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
    locale: normalizeLocale(frontmatter.locale) || "en",
  };

  return post;
}

export type LocalizedBlogPost = BlogPost & {
  requestedLocale: Locale;
  resolvedLocale: Locale;
  availableLocales: Locale[];
  isFallback: boolean;
};

export function localizeBlogPost(post: BlogPost, locale: Locale): LocalizedBlogPost {
  const sourceLocale = normalizeLocale(post.locale) || "en";
  const base = translationFromPost(post, sourceLocale);
  const resolution = resolveTranslation(base, sourceLocale, post.translations, locale);
  const translation = resolution.value;

  return {
    ...post,
    title: translation.title,
    description: translation.description,
    content: translation.content,
    excerpt: translation.excerpt,
    readingTime: translation.readingTime,
    format: translation.format,
    tags: translation.tags || post.tags,
    requestedLocale: resolution.requestedLocale,
    resolvedLocale: resolution.resolvedLocale,
    availableLocales: resolution.availableLocales,
    isFallback: resolution.isFallback,
  };
}

/**
 * Filter out draft posts for public listing
 */
export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter((post) => !post.draft);
}
