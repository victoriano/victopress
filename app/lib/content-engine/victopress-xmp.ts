/**
 * Lossless VictoPress metadata packets for source images.
 *
 * JPEG APP1 and PNG iTXt containers are rewritten without decoding the raster,
 * so pixel/compressed-image bytes and pre-existing EXIF/IPTC/XMP data stay
 * untouched. VictoPress owns one marked RDF description inside the XMP packet.
 */

export const VICTOPRESS_EMBEDDED_METADATA_VERSION = 1 as const;
export const VICTOPRESS_XMP_NAMESPACE = "https://victopress.dev/ns/1.0/";

export interface VictoPressEditorialMetadata {
  title?: string;
  description?: string;
  tags: string[];
  dateTaken?: string;
  order?: number;
  hidden: boolean;
}

export interface VictoPressGalleryMembershipMetadata {
  slug: string;
  title: string;
  path: string;
  physicalSource: boolean;
  /** One-based position in the effective gallery index. */
  order: number;
}

export interface VictoPressAiMetadata {
  /** Deliberately independent from the editorial/public description. */
  description: string;
  /** Deliberately independent from editorial/public tags. */
  tags: string[];
  model: string;
  promptVersion: string;
  taxonomyVersion: string;
  generatedAt: string;
  gallerySuggestions: Array<{
    gallerySlug: string;
    confidence: number;
    reason: string;
    alreadyCurrent: boolean;
    status: "pending" | "accepted" | "rejected";
    reviewedAt?: string;
  }>;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface VictoPressEmbeddedVectorIndex {
  status: "pending" | "ready" | "failed";
  model: string;
  dimensions: number;
  vectorId: string;
  sourceFingerprint: string;
  generatedAt?: string;
  error?: string;
  /** Float32 values are stored compactly and can recreate the vector index. */
  encoding?: "base64-f32le";
  values?: string;
  metadata?: {
    gallerySlug?: string;
    hidden?: boolean;
    protected?: boolean;
  };
}

export interface VictoPressEmbeddedMetadata {
  schemaVersion: typeof VICTOPRESS_EMBEDDED_METADATA_VERSION;
  source: {
    path: string;
    filename: string;
    sourceFingerprint: string;
    canonicalByteLength: number;
  };
  editorial: VictoPressEditorialMetadata;
  galleries: VictoPressGalleryMembershipMetadata[];
  ai?: VictoPressAiMetadata;
  indexes: {
    contentVersion: number;
    search?: {
      version: number;
      document: Record<string, unknown>;
    };
    vector?: VictoPressEmbeddedVectorIndex;
  };
}

export type VictoPressMetadataImageFormat = "jpeg" | "png";

export interface EmbeddedMetadataWriteResult {
  bytes: Uint8Array<ArrayBuffer>;
  changed: boolean;
  format: VictoPressMetadataImageFormat;
}

const XMP_APP1_HEADER = "http://ns.adobe.com/xap/1.0/\0";
const PNG_XMP_KEYWORD = "XML:com.adobe.xmp";
const BLOCK_START = "<!--VictoPress:metadata:start-->";
const BLOCK_END = "<!--VictoPress:metadata:end-->";
const GENERATED_PACKET_MARKER = "<!--VictoPress:packet-->";
const JPEG_MAX_SEGMENT_LENGTH = 0xffff;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const xmpHeaderBytes = textEncoder.encode(XMP_APP1_HEADER);

export class UnsupportedEmbeddedMetadataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedEmbeddedMetadataFormatError";
  }
}

function asBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  const view = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return Uint8Array.from(view);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function replaceBytes(
  source: Uint8Array,
  start: number,
  end: number,
  replacement: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return concatBytes(source.subarray(0, start), replacement, source.subarray(end));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderBag(values: readonly string[]): string {
  return `<rdf:Bag>${values.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join("")}</rdf:Bag>`;
}

function renderVictoPressBlock(metadata: VictoPressEmbeddedMetadata): string {
  const payload = bytesToBase64(textEncoder.encode(JSON.stringify(metadata)));
  const editorial = metadata.editorial;
  const ai = metadata.ai;
  return [
    BLOCK_START,
    `<rdf:Description rdf:about="" xmlns:victopress="${VICTOPRESS_XMP_NAMESPACE}">`,
    `<victopress:schemaVersion>${metadata.schemaVersion}</victopress:schemaVersion>`,
    `<victopress:sourcePath>${escapeXml(metadata.source.path)}</victopress:sourcePath>`,
    editorial.title
      ? `<victopress:editorialTitle>${escapeXml(editorial.title)}</victopress:editorialTitle>`
      : "",
    editorial.description
      ? `<victopress:editorialDescription>${escapeXml(editorial.description)}</victopress:editorialDescription>`
      : "",
    editorial.tags.length > 0
      ? `<victopress:editorialTags>${renderBag(editorial.tags)}</victopress:editorialTags>`
      : "",
    ai?.description
      ? `<victopress:aiDescription>${escapeXml(ai.description)}</victopress:aiDescription>`
      : "",
    ai?.tags.length
      ? `<victopress:aiTags>${renderBag(ai.tags)}</victopress:aiTags>`
      : "",
    metadata.galleries.length > 0
      ? `<victopress:galleries>${renderBag(metadata.galleries.map((gallery) => gallery.slug))}</victopress:galleries>`
      : "",
    "<victopress:payloadEncoding>base64-json-utf8</victopress:payloadEncoding>",
    `<victopress:payload>${payload}</victopress:payload>`,
    "</rdf:Description>",
    BLOCK_END,
  ].join("");
}

function generatedXmpPacket(block: string): string {
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    GENERATED_PACKET_MARKER,
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    block,
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
}

function findRdfClosingTag(xml: string): { index: number } | null {
  const exact = xml.lastIndexOf("</rdf:RDF>");
  if (exact >= 0) return { index: exact };
  const matches = Array.from(xml.matchAll(/<\/(?:[A-Za-z_][\w.-]*:)?RDF\s*>/gi));
  const match = matches.at(-1);
  return match?.index === undefined ? null : { index: match.index };
}

function insertBlock(xml: string, block: string): string | null {
  const closing = findRdfClosingTag(xml);
  if (!closing) return null;
  return `${xml.slice(0, closing.index)}${block}${xml.slice(closing.index)}`;
}

function removeVictoPressBlocks(xml: string): { xml: string; removed: boolean } {
  let result = xml;
  let removed = false;
  while (true) {
    const start = result.indexOf(BLOCK_START);
    if (start < 0) break;
    const endStart = result.indexOf(BLOCK_END, start + BLOCK_START.length);
    if (endStart < 0) break;
    result = `${result.slice(0, start)}${result.slice(endStart + BLOCK_END.length)}`;
    removed = true;
  }
  return { xml: result, removed };
}

function readPayloadFromXml(xml: string): VictoPressEmbeddedMetadata | null {
  if (!xml.includes(BLOCK_START)) return null;
  const match = xml.match(/<victopress:payload(?:\s[^>]*)?>([A-Za-z0-9+/=\s]+)<\/victopress:payload>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(textDecoder.decode(base64ToBytes(match[1]))) as Partial<VictoPressEmbeddedMetadata>;
    if (
      parsed.schemaVersion !== VICTOPRESS_EMBEDDED_METADATA_VERSION ||
      !parsed.source ||
      !parsed.editorial ||
      !Array.isArray(parsed.galleries) ||
      !parsed.indexes
    ) {
      return null;
    }
    return parsed as VictoPressEmbeddedMetadata;
  } catch {
    return null;
  }
}

interface JpegSegment {
  start: number;
  end: number;
  marker: number;
  markerCodeOffset: number;
  payloadStart: number;
  payloadEnd: number;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function jpegSegments(bytes: Uint8Array): JpegSegment[] {
  if (!isJpeg(bytes)) return [];
  const segments: JpegSegment[] = [];
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const start = offset;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const markerCodeOffset = offset;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.byteLength) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) break;
    const end = offset + length;
    if (end > bytes.byteLength) break;
    segments.push({
      start,
      end,
      marker,
      markerCodeOffset,
      payloadStart: offset + 2,
      payloadEnd: end,
    });
    offset = end;
  }
  return segments;
}

function startsWithBytes(value: Uint8Array, prefix: Uint8Array): boolean {
  if (value.byteLength < prefix.byteLength) return false;
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  return true;
}

function jpegXmpXml(bytes: Uint8Array, segment: JpegSegment): string | null {
  if (segment.marker !== 0xe1) return null;
  const payload = bytes.subarray(segment.payloadStart, segment.payloadEnd);
  if (!startsWithBytes(payload, xmpHeaderBytes)) return null;
  return textDecoder.decode(payload.subarray(xmpHeaderBytes.byteLength));
}

function buildJpegSegment(
  source: Uint8Array,
  original: JpegSegment | null,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const segmentLength = payload.byteLength + 2;
  if (segmentLength > JPEG_MAX_SEGMENT_LENGTH) {
    throw new RangeError("VictoPress XMP metadata exceeds the JPEG APP1 segment limit");
  }
  const prefix = original
    ? source.slice(original.start, original.payloadStart)
    : Uint8Array.from([0xff, 0xe1, 0, 0]);
  prefix[prefix.byteLength - 2] = (segmentLength >>> 8) & 0xff;
  prefix[prefix.byteLength - 1] = segmentLength & 0xff;
  return concatBytes(prefix, payload);
}

function jpegMetadataInsertionOffset(bytes: Uint8Array): number {
  let insertionOffset = 2;
  for (const segment of jpegSegments(bytes)) {
    if ((segment.marker >= 0xe0 && segment.marker <= 0xef) || segment.marker === 0xfe) {
      insertionOffset = segment.end;
      continue;
    }
    break;
  }
  return insertionOffset;
}

function canonicalizeJpeg(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  let result = Uint8Array.from(bytes);
  const candidates = jpegSegments(result).filter((segment) => jpegXmpXml(result, segment) !== null);
  for (const originalCandidate of candidates.reverse()) {
    const segments = jpegSegments(result);
    const candidate = segments.find((segment) => segment.start === originalCandidate.start);
    if (!candidate) continue;
    const xml = jpegXmpXml(result, candidate);
    if (!xml) continue;
    const cleaned = removeVictoPressBlocks(xml);
    if (!cleaned.removed) continue;
    if (xml.includes(GENERATED_PACKET_MARKER)) {
      result = replaceBytes(result, candidate.start, candidate.end, new Uint8Array());
      continue;
    }
    const payload = concatBytes(xmpHeaderBytes, textEncoder.encode(cleaned.xml));
    result = replaceBytes(
      result,
      candidate.start,
      candidate.end,
      buildJpegSegment(result, candidate, payload),
    );
  }
  return result;
}

function writeJpegMetadata(bytes: Uint8Array, block: string): Uint8Array<ArrayBuffer> {
  const canonical = canonicalizeJpeg(bytes);
  const candidates = jpegSegments(canonical).filter((segment) => jpegXmpXml(canonical, segment) !== null);
  for (const candidate of candidates) {
    const xml = jpegXmpXml(canonical, candidate)!;
    const merged = insertBlock(xml, block);
    if (!merged) continue;
    const payload = concatBytes(xmpHeaderBytes, textEncoder.encode(merged));
    if (payload.byteLength + 2 > JPEG_MAX_SEGMENT_LENGTH) continue;
    return replaceBytes(
      canonical,
      candidate.start,
      candidate.end,
      buildJpegSegment(canonical, candidate, payload),
    );
  }

  const payload = concatBytes(
    xmpHeaderBytes,
    textEncoder.encode(generatedXmpPacket(block)),
  );
  const segment = buildJpegSegment(canonical, null, payload);
  const offset = jpegMetadataInsertionOffset(canonical);
  return replaceBytes(canonical, offset, offset, segment);
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface PngChunk {
  start: number;
  end: number;
  type: string;
  dataStart: number;
  dataEnd: number;
}

function isPng(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, PNG_SIGNATURE);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  ) >>> 0;
}

function writeUint32(value: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function pngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) return [];
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.byteLength;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (end > bytes.byteLength) break;
    const type = textDecoder.decode(bytes.subarray(offset + 4, offset + 8));
    chunks.push({ start: offset, end, type, dataStart, dataEnd });
    offset = end;
    if (type === "IEND") break;
  }
  return chunks;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = textEncoder.encode(type);
  const checksumInput = concatBytes(typeBytes, data);
  return concatBytes(
    writeUint32(data.byteLength),
    typeBytes,
    data,
    writeUint32(crc32(checksumInput)),
  );
}

interface ParsedPngXmp {
  prefix: Uint8Array;
  xml: string;
}

function parsePngXmp(bytes: Uint8Array, chunk: PngChunk): ParsedPngXmp | null {
  if (chunk.type !== "iTXt") return null;
  const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0 || textDecoder.decode(data.subarray(0, keywordEnd)) !== PNG_XMP_KEYWORD) return null;
  let offset = keywordEnd + 1;
  if (offset + 2 > data.byteLength || data[offset] !== 0) return null;
  offset += 2;
  const languageEnd = data.indexOf(0, offset);
  if (languageEnd < 0) return null;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) return null;
  const textStart = translatedEnd + 1;
  return {
    prefix: data.slice(0, textStart),
    xml: textDecoder.decode(data.subarray(textStart)),
  };
}

function generatedPngXmpData(xml: string): Uint8Array<ArrayBuffer> {
  return concatBytes(
    textEncoder.encode(PNG_XMP_KEYWORD),
    // keyword terminator, compression flag/method, language and translated keyword terminators
    Uint8Array.from([0, 0, 0, 0, 0]),
    textEncoder.encode(xml),
  );
}

function canonicalizePng(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  let result = Uint8Array.from(bytes);
  const candidates = pngChunks(result).filter((chunk) => parsePngXmp(result, chunk) !== null);
  for (const originalCandidate of candidates.reverse()) {
    const candidate = pngChunks(result).find((chunk) => chunk.start === originalCandidate.start);
    if (!candidate) continue;
    const parsed = parsePngXmp(result, candidate);
    if (!parsed) continue;
    const cleaned = removeVictoPressBlocks(parsed.xml);
    if (!cleaned.removed) continue;
    if (parsed.xml.includes(GENERATED_PACKET_MARKER)) {
      result = replaceBytes(result, candidate.start, candidate.end, new Uint8Array());
      continue;
    }
    const data = concatBytes(parsed.prefix, textEncoder.encode(cleaned.xml));
    result = replaceBytes(result, candidate.start, candidate.end, buildPngChunk("iTXt", data));
  }
  return result;
}

function writePngMetadata(bytes: Uint8Array, block: string): Uint8Array<ArrayBuffer> {
  const canonical = canonicalizePng(bytes);
  for (const candidate of pngChunks(canonical)) {
    const parsed = parsePngXmp(canonical, candidate);
    if (!parsed) continue;
    const merged = insertBlock(parsed.xml, block);
    if (!merged) continue;
    const data = concatBytes(parsed.prefix, textEncoder.encode(merged));
    return replaceBytes(canonical, candidate.start, candidate.end, buildPngChunk("iTXt", data));
  }
  const chunk = buildPngChunk(
    "iTXt",
    generatedPngXmpData(generatedXmpPacket(block)),
  );
  const iend = pngChunks(canonical).find((candidate) => candidate.type === "IEND");
  if (!iend) throw new Error("PNG image does not contain an IEND chunk");
  return replaceBytes(canonical, iend.start, iend.start, chunk);
}

function xmpXmlPackets(bytes: Uint8Array): string[] {
  if (isJpeg(bytes)) {
    return jpegSegments(bytes).flatMap((segment) => {
      const xml = jpegXmpXml(bytes, segment);
      return xml === null ? [] : [xml];
    });
  }
  if (isPng(bytes)) {
    return pngChunks(bytes).flatMap((chunk) => {
      const parsed = parsePngXmp(bytes, chunk);
      return parsed ? [parsed.xml] : [];
    });
  }
  return [];
}

/** Reads the VictoPress JSON projection without parsing or changing other XMP. */
export function readVictoPressEmbeddedMetadata(
  input: ArrayBuffer | ArrayBufferView,
): VictoPressEmbeddedMetadata | null {
  for (const xml of xmpXmlPackets(asBytes(input))) {
    const metadata = readPayloadFromXml(xml);
    if (metadata) return metadata;
  }
  return null;
}

/**
 * Removes only the VictoPress-owned RDF block. The result exactly matches the
 * bytes that existed before the first writeback and is therefore safe to hash.
 */
export function canonicalizeImageBytes(
  input: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  const bytes = asBytes(input);
  if (isJpeg(bytes)) return canonicalizeJpeg(bytes);
  if (isPng(bytes)) return canonicalizePng(bytes);
  return bytes.slice();
}

/** SHA-256 identity of the image with VictoPress-owned XMP removed. */
export async function createCanonicalImageSourceFingerprint(
  input: ArrayBuffer | ArrayBufferView,
): Promise<string> {
  const canonical = canonicalizeImageBytes(input);
  const digest = await crypto.subtle.digest("SHA-256", canonical);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

/** Embeds/replaces VictoPress XMP without touching compressed raster bytes. */
export function writeVictoPressEmbeddedMetadata(
  input: ArrayBuffer | ArrayBufferView,
  metadata: VictoPressEmbeddedMetadata,
): EmbeddedMetadataWriteResult {
  if (metadata.schemaVersion !== VICTOPRESS_EMBEDDED_METADATA_VERSION) {
    throw new Error(`Unsupported VictoPress metadata schema ${String(metadata.schemaVersion)}`);
  }
  const original = asBytes(input);
  const block = renderVictoPressBlock(metadata);
  if (isJpeg(original)) {
    const bytes = writeJpegMetadata(original, block);
    return { bytes, changed: !bytesEqual(original, bytes), format: "jpeg" };
  }
  if (isPng(original)) {
    const bytes = writePngMetadata(original, block);
    return { bytes, changed: !bytesEqual(original, bytes), format: "png" };
  }
  throw new UnsupportedEmbeddedMetadataFormatError(
    "Lossless VictoPress XMP writeback currently supports JPEG and PNG originals",
  );
}
