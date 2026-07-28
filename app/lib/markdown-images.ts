export type MarkdownImageWidth = "wide" | "text";

const TEXT_WIDTH_DIRECTIVE = "text-width";
const DIRECTIVE_SEPARATOR = " | ";

export interface MarkdownImageDirectives {
  caption: boolean;
  galleryColumns: 2 | 3 | null;
  width: MarkdownImageWidth;
  htmlTitle: string | null;
}

export interface MarkdownImageReference {
  alt: string;
  end: number;
  index: number;
  raw: string;
  src: string;
  start: number;
  title: string | null;
  width: MarkdownImageWidth;
}

const MARKDOWN_IMAGE_PATTERN =
  /!\[([^\]\n]*)\]\((\S+?)(?:\s+"([^"\n]*)")?\)/g;

function titleParts(title: string | null | undefined): string[] {
  return (title ?? "")
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseMarkdownImageDirectives(
  title: string | null | undefined,
): MarkdownImageDirectives {
  const parts = titleParts(title);
  const gallery = parts.find((part) => /^gallery-[23]$/.test(part));
  const unknownParts = parts.filter(
    (part) =>
      part !== "caption" &&
      part !== TEXT_WIDTH_DIRECTIVE &&
      !/^gallery-[23]$/.test(part),
  );

  return {
    caption: parts.includes("caption"),
    galleryColumns: gallery
      ? (Number(gallery.slice(-1)) as 2 | 3)
      : null,
    width: parts.includes(TEXT_WIDTH_DIRECTIVE) ? "text" : "wide",
    htmlTitle: unknownParts.length
      ? unknownParts.join(DIRECTIVE_SEPARATOR)
      : null,
  };
}

export function setMarkdownImageWidthDirective(
  title: string | null | undefined,
  width: MarkdownImageWidth,
): string | null {
  const parts = titleParts(title).filter(
    (part) => part !== TEXT_WIDTH_DIRECTIVE,
  );

  if (width === "text") parts.push(TEXT_WIDTH_DIRECTIVE);
  return parts.length ? parts.join(DIRECTIVE_SEPARATOR) : null;
}

export function findMarkdownImages(content: string): MarkdownImageReference[] {
  const images: MarkdownImageReference[] = [];

  for (const match of content.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    if (match.index === undefined) continue;

    const title = match[3] || null;
    images.push({
      alt: match[1],
      end: match.index + match[0].length,
      index: images.length,
      raw: match[0],
      src: match[2],
      start: match.index,
      title,
      width: parseMarkdownImageDirectives(title).width,
    });
  }

  return images;
}

export function setMarkdownImageWidth(
  content: string,
  imageIndex: number,
  width: MarkdownImageWidth,
): string {
  const image = findMarkdownImages(content)[imageIndex];
  if (!image) return content;

  const title = setMarkdownImageWidthDirective(image.title, width);
  const replacement = `![${image.alt}](${image.src}${
    title ? ` "${title}"` : ""
  })`;

  return (
    content.slice(0, image.start) +
    replacement +
    content.slice(image.end)
  );
}
