import { Marked, Renderer } from "marked";

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const ALLOWED_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value: string, allowedProtocols: Set<string>): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;

  const protocolMatch = trimmed.match(/^([a-z][a-z\d+.-]*:)/i);
  if (!protocolMatch) return trimmed;

  return allowedProtocols.has(protocolMatch[1].toLowerCase()) ? trimmed : null;
}

function imageUrl(value: string): string | null {
  const safe = safeUrl(value, ALLOWED_IMAGE_PROTOCOLS);
  if (!safe) return null;
  if (/^https?:/i.test(safe) || safe.startsWith("/")) return safe;

  return `/api/images/${safe.replace(/^\.\//, "")}`;
}

const renderer = new Renderer();

// Blog content is authored by an authenticated editor, but Markdown should
// remain Markdown. Rendering raw HTML as text prevents an accidental paste
// from turning into executable markup in the public site or admin preview.
renderer.html = ({ text }) => escapeHtml(text);

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safeHref = safeUrl(href, ALLOWED_LINK_PROTOCOLS);
  if (!safeHref) return label;

  const external = /^https?:/i.test(safeHref);
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  const externalAttributes = external
    ? ' target="_blank" rel="noopener noreferrer"'
    : "";

  return `<a href="${escapeHtml(safeHref)}"${titleAttribute}${externalAttributes}>${label}</a>`;
};

renderer.paragraph = function ({ tokens }) {
  const imageTokens = tokens.filter((token) => token.type === "image");
  const onlyImages = imageTokens.length > 0 && tokens.every((token) =>
    token.type === "image" || (token.type === "text" && token.text.trim() === "")
  );
  const galleryColumns = imageTokens
    .map((token) => token.type === "image" ? token.title?.match(/^gallery-([23])$/)?.[1] : undefined)
    .find(Boolean);
  const attributes = onlyImages
    ? ` class="blog-image-row"${galleryColumns ? ` data-gallery-columns="${galleryColumns}"` : ""}`
    : "";

  return `<p${attributes}>${this.parser.parseInline(tokens)}</p>\n`;
};

renderer.image = ({ href, title, text }) => {
  const src = imageUrl(href);
  const alt = text.trim();
  if (!src) return alt ? escapeHtml(alt) : "";

  const galleryColumns = title?.match(/^gallery-([23])$/)?.[1];
  const isCaptioned = title === "caption" && alt.length > 0;
  const galleryAttribute = galleryColumns
    ? ` data-gallery-columns="${galleryColumns}"`
    : "";
  const titleAttribute = title && !galleryColumns && title !== "caption"
    ? ` title="${escapeHtml(title)}"`
    : "";
  const caption = isCaptioned
    ? `<span class="blog-image-caption">${escapeHtml(alt)}</span>`
    : "";

  return [
    `<span class="blog-image-frame"${galleryAttribute}>`,
    `<a class="blog-image-link" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">`,
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttribute} loading="lazy" decoding="async">`,
    "</a>",
    caption,
    "</span>",
  ].join("");
};

const markdown = new Marked({
  async: false,
  breaks: false,
  gfm: true,
  renderer,
});

export function renderMarkdown(content: string): string {
  return markdown.parse(content, { async: false });
}
