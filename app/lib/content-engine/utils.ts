/**
 * Content Engine Utilities
 */

/**
 * Convert folder name to display title
 * "tokyo-2024" → "Tokyo 2024"
 * "street_photography" → "Street Photography"
 */
export function folderNameToTitle(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * Convert string to URL-friendly slug
 * "Tokyo 2024!" → "tokyo-2024"
 */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

/**
 * Check if filename is a supported image format
 */
export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"].includes(ext || "");
}

/**
 * Check if filename is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ["md", "mdx"].includes(ext || "");
}

/**
 * Get filename without extension
 */
export function getBasename(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

/**
 * Calculate reading time for text content
 */
export function calculateReadingTime(text: string): number {
  const wordsPerMinute = 200;
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
}

/**
 * Generate excerpt from markdown content
 */
export function generateExcerpt(content: string, maxLength = 160): string {
  // Remove frontmatter
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---/, "").trim();
  
  // Remove markdown syntax
  const plainText = withoutFrontmatter
    .replace(/#{1,6}\s+/g, "") // Headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold
    .replace(/\*([^*]+)\*/g, "$1") // Italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links
    .replace(/`([^`]+)`/g, "$1") // Inline code
    .replace(/```[\s\S]*?```/g, "") // Code blocks
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // Images
    .replace(/\n+/g, " ")
    .trim();

  if (plainText.length <= maxLength) {
    return plainText;
  }

  // Truncate at word boundary
  const truncated = plainText.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

/**
 * Sort photos alphabetically by filename
 */
export function sortPhotosAlphabetically<T extends { filename: string }>(
  photos: T[]
): T[] {
  return [...photos].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true })
  );
}

/**
 * Sort by date (most recent first)
 */
export function sortByDateDesc<T extends { date?: Date; lastModified?: Date }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const dateA = a.date || a.lastModified || new Date(0);
    const dateB = b.date || b.lastModified || new Date(0);
    return dateB.getTime() - dateA.getTime();
  });
}

/**
 * Normalize tag for consistent lookup
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim().replace(/\s+/g, "-");
}

/**
 * Format tag for display
 */
export function formatTagLabel(tag: string): string {
  return tag
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Hash password for storage (simple hash, use bcrypt in production)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}
