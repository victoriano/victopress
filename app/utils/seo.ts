/**
 * SEO Utilities
 *
 * Generates meta tags including Open Graph for social sharing.
 */

export interface SeoConfig {
  title: string;
  description?: string;
  /** Full URL to the page */
  url?: string;
  /** Full URL to the OG image */
  image?: string;
  /** Image alt text */
  imageAlt?: string;
  /** Open Graph type */
  type?: "website" | "article" | "profile";
  /** Site name */
  siteName?: string;
  /** Twitter card type */
  twitterCard?: "summary" | "summary_large_image";
  /** Author name (for articles) */
  author?: string;
  /** Publication date (for articles) */
  publishedTime?: string;
  /** Tags/keywords */
  keywords?: string[];
  /** Canonical URL (if different from url) */
  canonical?: string;
  /** Don't index this page */
  noIndex?: boolean;
}

/**
 * Generate meta tags for a page
 */
export function generateMetaTags(config: SeoConfig): Array<
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
  | { tagName: string; rel: string; href: string }
> {
  const {
    title,
    description,
    url,
    image,
    imageAlt,
    type = "website",
    siteName = "VictoPress",
    twitterCard = image ? "summary_large_image" : "summary",
    author,
    publishedTime,
    keywords,
    canonical,
    noIndex,
  } = config;

  const meta: Array<
    | { title: string }
    | { name: string; content: string }
    | { property: string; content: string }
    | { tagName: string; rel: string; href: string }
  > = [];

  // Basic title
  meta.push({ title });

  // Description
  if (description) {
    meta.push({ name: "description", content: description });
  }

  // Keywords
  if (keywords && keywords.length > 0) {
    meta.push({ name: "keywords", content: keywords.join(", ") });
  }

  // Robots
  if (noIndex) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  }

  // Open Graph
  meta.push({ property: "og:title", content: title });
  meta.push({ property: "og:type", content: type });
  meta.push({ property: "og:site_name", content: siteName });

  if (description) {
    meta.push({ property: "og:description", content: description });
  }

  if (url) {
    meta.push({ property: "og:url", content: url });
  }

  if (image) {
    meta.push({ property: "og:image", content: image });
    if (imageAlt) {
      meta.push({ property: "og:image:alt", content: imageAlt });
    }
  }

  // Article-specific OG tags
  if (type === "article") {
    if (publishedTime) {
      meta.push({ property: "article:published_time", content: publishedTime });
    }
    if (author) {
      meta.push({ property: "article:author", content: author });
    }
    if (keywords) {
      keywords.forEach((tag) => {
        meta.push({ property: "article:tag", content: tag });
      });
    }
  }

  // Twitter Card
  meta.push({ name: "twitter:card", content: twitterCard });
  meta.push({ name: "twitter:title", content: title });

  if (description) {
    meta.push({ name: "twitter:description", content: description });
  }

  if (image) {
    meta.push({ name: "twitter:image", content: image });
    if (imageAlt) {
      meta.push({ name: "twitter:image:alt", content: imageAlt });
    }
  }

  // Canonical URL
  if (canonical || url) {
    meta.push({
      tagName: "link",
      rel: "canonical",
      href: canonical || url || "",
    });
  }

  return meta;
}

/**
 * Get the base URL from request
 */
export function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Build full image URL for OG image
 */
export function buildImageUrl(
  baseUrl: string,
  imagePath: string | undefined
): string | undefined {
  if (!imagePath) return undefined;

  // If already absolute URL, return as-is
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  // Build full URL using local image API
  const cleanPath = imagePath.startsWith("/") ? imagePath.slice(1) : imagePath;
  return `${baseUrl}/api/local-images/${cleanPath}`;
}
