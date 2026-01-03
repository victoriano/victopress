/**
 * Page Scanner
 * 
 * Scans /content/pages/ for static pages (About, Contact, etc.).
 * 
 * Rules:
 * - Each folder in /pages/ is a page
 * - If folder has page.yaml with type: "blog", treat as blog (skip)
 * - If folder has <= 2 subfolders with markdown, treat as simple page
 * - Supports markdown (index.md) or HTML (index.html)
 * - Custom CSS can be added via style.css in the folder
 */

import matter from "gray-matter";
import type {
  Page,
  PageFrontmatter,
  StorageAdapter,
  FileInfo,
} from "./types";
import {
  folderNameToTitle,
  toSlug,
  isMarkdownFile,
} from "./utils";

const PAGES_PATH = "pages";

/**
 * Check if a file is an HTML file
 */
function isHtmlFile(filename: string): boolean {
  return /\.html?$/i.test(filename);
}

/**
 * Scan all pages in the content folder
 */
export async function scanPages(storage: StorageAdapter): Promise<Page[]> {
  const pages: Page[] = [];
  
  // Check if pages folder exists
  const exists = await storage.exists(PAGES_PATH);
  if (!exists) {
    return pages;
  }
  
  // List all items in /content/pages/
  const items = await storage.list(PAGES_PATH);

  for (const item of items) {
    if (item.isDirectory) {
      // Check if this is a page folder
      const page = await scanPageFolder(storage, item);
      if (page) {
        pages.push(page);
      }
    } else if (isMarkdownFile(item.name) || isHtmlFile(item.name)) {
      // Single file page (e.g., /pages/about.md)
      const page = await scanPageFile(storage, item);
      if (page) {
        pages.push(page);
      }
    }
  }

  return pages;
}

/**
 * Scan a folder-based page
 */
async function scanPageFolder(
  storage: StorageAdapter,
  dir: FileInfo
): Promise<Page | null> {
  const folderPath = dir.path;
  const folderName = dir.name;
  
  // List contents of the folder
  const contents = await storage.list(folderPath);
  
  // Check for page.yaml to determine type
  const pageYaml = contents.find((f) => f.name === "page.yaml");
  if (pageYaml) {
    const yamlContent = await storage.getText(`${folderPath}/page.yaml`);
    if (yamlContent) {
      try {
        const yaml = await import("js-yaml");
        const config = yaml.load(yamlContent) as { type?: string };
        // If type is "blog", skip this folder (it's a blog, not a page)
        if (config.type === "blog") {
          return null;
        }
      } catch {
        // Invalid YAML, continue as page
      }
    }
  }
  
  // Count subfolders with markdown
  const subfolders = contents.filter((f) => f.isDirectory);
  let subfoldersWithMarkdown = 0;
  
  for (const subfolder of subfolders) {
    const subContents = await storage.list(subfolder.path);
    const hasMd = subContents.some((f) => isMarkdownFile(f.name));
    if (hasMd) {
      subfoldersWithMarkdown++;
    }
  }
  
  // If more than 2 subfolders with markdown, this is probably a blog-like structure
  if (subfoldersWithMarkdown > 2) {
    return null;
  }
  
  // Find the main content file
  const htmlFiles = contents.filter((f) => !f.isDirectory && isHtmlFile(f.name));
  const mdFiles = contents.filter((f) => !f.isDirectory && isMarkdownFile(f.name));
  
  // Priority: index.html > index.md > first html > first md
  let mainFile: FileInfo | null = null;
  let isHtml = false;
  
  // Check for index.html first
  mainFile = htmlFiles.find((f) => f.name.toLowerCase() === "index.html") || null;
  if (mainFile) {
    isHtml = true;
  } else {
    // Check for index.md
    mainFile = mdFiles.find((f) => f.name.toLowerCase() === "index.md") || null;
    if (!mainFile) {
      // First HTML file
      if (htmlFiles.length > 0) {
        mainFile = htmlFiles[0];
        isHtml = true;
      } else if (mdFiles.length > 0) {
        // First MD file
        mainFile = mdFiles[0];
      }
    }
  }
  
  if (!mainFile) {
    return null;
  }

  // Read content
  const content = await storage.getText(`${folderPath}/${mainFile.name}`);
  
  if (!content) {
    return null;
  }

  // Check for custom CSS
  const cssFile = contents.find((f) => f.name === "style.css" || f.name === "styles.css");
  let customCss: string | undefined;
  if (cssFile) {
    customCss = await storage.getText(`${folderPath}/${cssFile.name}`) || undefined;
  }

  return parsePageContent(content, folderPath, folderName, isHtml, customCss);
}

/**
 * Scan a single file page
 */
async function scanPageFile(
  storage: StorageAdapter,
  file: FileInfo
): Promise<Page | null> {
  const content = await storage.getText(file.path);
  
  if (!content) {
    return null;
  }

  const isHtml = isHtmlFile(file.name);
  const slug = file.name.replace(/\.(md|html?)$/i, "");
  
  return parsePageContent(content, file.path, slug, isHtml);
}

/**
 * Parse page content (markdown or HTML)
 */
function parsePageContent(
  content: string,
  path: string,
  defaultSlug: string,
  isHtml: boolean,
  customCss?: string
): Page {
  let frontmatter: PageFrontmatter = {};
  let pageContent = content;
  let hasFrontmatter = false;

  // Parse frontmatter (works for both MD and HTML with frontmatter)
  if (content.startsWith("---")) {
    try {
      const { data, content: parsedContent } = matter(content);
      frontmatter = data as PageFrontmatter;
      pageContent = parsedContent;
      hasFrontmatter = Object.keys(data).length > 0;
    } catch {
      // No valid frontmatter, use content as-is
    }
  }

  // Generate slug - prefer folder name over title for URL consistency
  const slug = toSlug(defaultSlug);

  // Generate title from folder name if not in frontmatter
  const title = frontmatter.title || folderNameToTitle(defaultSlug);

  const page: Page = {
    id: slug,
    slug,
    title,
    path,
    content: pageContent.trim(),
    hasFrontmatter,
    isHtml,
    customCss,
    
    // From frontmatter
    description: frontmatter.description,
    css: frontmatter.css,
    layout: frontmatter.layout,
    hidden: frontmatter.hidden,
  };

  return page;
}

/**
 * Filter out hidden pages for public listing
 */
export function filterVisiblePages(pages: Page[]): Page[] {
  return pages.filter((page) => !page.hidden);
}

/**
 * Get a single page by slug
 */
export async function getPageBySlug(
  storage: StorageAdapter,
  slug: string
): Promise<Page | null> {
  const pages = await scanPages(storage);
  return pages.find((p) => p.slug === slug) || null;
}
