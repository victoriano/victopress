const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.length < offset + value.length) return false;

  for (let index = 0; index < value.length; index++) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }

  return true;
}

function hasBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function isAvif(bytes: Uint8Array): boolean {
  if (!hasAscii(bytes, 4, "ftyp")) return false;
  if (hasAscii(bytes, 8, "avif") || hasAscii(bytes, 8, "avis")) return true;

  const limit = Math.min(bytes.length, 64);
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) {
      return true;
    }
  }

  return false;
}

function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  return /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(head);
}

/**
 * Detect an image's MIME type from its file signature. The filename is only a
 * fallback because imported/CDN images can contain WebP bytes under .jpg names.
 */
export function detectImageContentType(buffer: ArrayBuffer, filename: string): string {
  const bytes = new Uint8Array(buffer);

  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")) {
    return "image/gif";
  }
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (isAvif(bytes)) return "image/avif";
  if (isSvg(bytes)) return "image/svg+xml";

  const extension = filename.toLowerCase().split(".").pop() || "";
  return CONTENT_TYPES_BY_EXTENSION[extension] || "application/octet-stream";
}
