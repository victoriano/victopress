import {
  AiConfigurationError,
  AiDataValidationError,
  GeminiRequestError,
  GeminiResponseError,
} from "./errors";
import { serializeGalleryTaxonomyForPrompt } from "./gallery-taxonomy";
import {
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type AiUsageMetadata,
  type AnalyzePhotoInput,
  type EmbedImageInput,
  type EmbeddingResult,
  type EmbedTextInput,
  type GallerySuggestion,
  type PhotoAiProvider,
  type PhotoAnalysis,
} from "./types";

const DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_PROMPT_VERSION = "gallery-taxonomy-v2";
const DEFAULT_MAX_GALLERY_SUGGESTIONS = 8;
const MAX_ERROR_BODY_LENGTH = 4_000;
const ANALYSIS_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const EMBEDDING_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

type FetchImplementation = typeof fetch;
type JsonObject = Record<string, unknown>;

export interface GeminiPhotoAiProviderOptions {
  apiKey: string;
  fetch?: FetchImplementation;
  apiBaseUrl?: string;
  analysisModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  promptVersion?: string;
  maxGallerySuggestions?: number;
  now?: () => string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelName(model: string, field: string): string {
  const normalized = model.trim().replace(/^models\//, "");
  if (!normalized) throw new AiConfigurationError(`${field} cannot be empty`);
  return normalized;
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Cloudflare Workers has btoa but not Node's Buffer global. */
export function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = toUint8Array(value);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function buildAnalysisSchema(gallerySlugs: readonly string[], maxItems: number): JsonObject {
  const gallerySlugSchema: JsonObject = { type: "string" };
  if (gallerySlugs.length > 0) gallerySlugSchema.enum = gallerySlugs;

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      caption: {
        type: "string",
        description: "A concise factual caption for the photograph.",
      },
      tags: {
        type: "array",
        maxItems: 24,
        items: { type: "string" },
        description: "Concrete reusable visual search tags.",
      },
      gallerySuggestions: {
        type: "array",
        maxItems: gallerySlugs.length === 0 ? 0 : maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gallerySlug: gallerySlugSchema,
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: {
              type: "string",
              description: "Short visual reason for this classification.",
            },
          },
          required: ["gallerySlug", "confidence", "reason"],
        },
      },
    },
    required: ["caption", "tags", "gallerySuggestions"],
  };
}

function buildAnalysisPrompt(input: AnalyzePhotoInput): string {
  const language = input.language?.trim() || "es";
  const current = Array.from(
    new Set(input.currentGallerySlugs.map((slug) => slug.trim()).filter(Boolean)),
  );

  return [
    "Analyze the attached photograph for a files-first photography CMS.",
    `Write the caption, tags and reasons in language: ${language}.`,
    "Suggest zero, one, or several galleries when the visible content genuinely fits.",
    "Treat each classificationHint as a strict editorial inclusion/exclusion rule, not as optional flavor text.",
    "Only suggest a gallery when the visible photograph satisfies its classificationHint; uncertainty means do not suggest it.",
    "A current physical gallery is context only and never overrides a classificationHint.",
    "A gallery suggestion is editorial advice only: never imply that a file was moved or published.",
    "Use only exact gallery slugs from the supplied taxonomy. Do not invent galleries.",
    "Prefer precise visual evidence over assumptions about identity, location, or intent.",
    `Current physical gallery slugs (context only): ${JSON.stringify(current)}.`,
    `Existing gallery taxonomy: ${serializeGalleryTaxonomyForPrompt(input.taxonomy)}`,
  ].join("\n");
}

function readCandidateText(response: unknown): { text: string; finishReason?: string } {
  if (!isObject(response)) {
    throw new GeminiResponseError("Gemini returned a non-object response");
  }

  const promptFeedback = response.promptFeedback;
  if (isObject(promptFeedback) && typeof promptFeedback.blockReason === "string") {
    throw new GeminiResponseError(
      `Gemini blocked the analysis prompt: ${promptFeedback.blockReason}`,
    );
  }

  const candidates = response.candidates;
  if (!Array.isArray(candidates) || !isObject(candidates[0])) {
    throw new GeminiResponseError("Gemini response did not contain a candidate");
  }

  const candidate = candidates[0];
  const finishReason =
    typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;
  const content = candidate.content;
  const parts = isObject(content) && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter(isObject)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    throw new GeminiResponseError("Gemini candidate did not contain JSON text", {
      finishReason,
    });
  }

  return { text, finishReason };
}

function parseJsonText(text: string, finishReason?: string): unknown {
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch (cause) {
    throw new GeminiResponseError("Gemini returned malformed analysis JSON", {
      finishReason,
      cause,
    });
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new GeminiResponseError("Gemini analysis contained invalid tags");
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of value) {
    const tag = candidate.trim().slice(0, 80);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === 24) break;
  }
  return tags;
}

function normalizeSuggestions(
  value: unknown,
  allowedGallerySlugs: ReadonlySet<string>,
  currentGallerySlugs: ReadonlySet<string>,
  maxSuggestions: number,
): GallerySuggestion[] {
  if (!Array.isArray(value)) {
    throw new GeminiResponseError("Gemini analysis contained invalid gallery suggestions");
  }

  const bySlug = new Map<string, GallerySuggestion>();
  for (const candidate of value) {
    if (!isObject(candidate)) continue;
    const gallerySlug =
      typeof candidate.gallerySlug === "string" ? candidate.gallerySlug.trim() : "";
    const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
    const confidence = candidate.confidence;

    // Unknown slugs and malformed optional entries are ignored, never persisted.
    if (
      !allowedGallerySlugs.has(gallerySlug) ||
      !reason ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      continue;
    }

    const suggestion: GallerySuggestion = {
      gallerySlug,
      confidence,
      reason: reason.slice(0, 500),
      alreadyCurrent: currentGallerySlugs.has(gallerySlug),
      status: "pending",
    };
    const previous = bySlug.get(gallerySlug);
    if (!previous || suggestion.confidence > previous.confidence) {
      bySlug.set(gallerySlug, suggestion);
    }
  }

  return Array.from(bySlug.values())
    .sort((a, b) => b.confidence - a.confidence || a.gallerySlug.localeCompare(b.gallerySlug))
    .slice(0, maxSuggestions);
}

function readUsageMetadata(response: unknown): AiUsageMetadata | undefined {
  if (!isObject(response) || !isObject(response.usageMetadata)) return undefined;
  const source = response.usageMetadata;
  const usage: AiUsageMetadata = {};
  const fields = [
    "promptTokenCount",
    "candidatesTokenCount",
    "thoughtsTokenCount",
    "totalTokenCount",
  ] as const;
  for (const field of fields) {
    if (typeof source[field] === "number" && Number.isFinite(source[field])) {
      usage[field] = source[field];
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function readEmbeddingValues(response: unknown, dimensions: number): number[] {
  if (!isObject(response)) {
    throw new GeminiResponseError("Gemini returned a non-object embedding response");
  }

  let values: unknown;
  if (isObject(response.embedding)) {
    values = response.embedding.values;
  } else if (
    Array.isArray(response.embeddings) &&
    isObject(response.embeddings[0])
  ) {
    values = response.embeddings[0].values;
  }

  if (
    !Array.isArray(values) ||
    values.length !== dimensions ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new GeminiResponseError(
      `Gemini embedding must contain exactly ${dimensions} finite values`,
    );
  }

  const vector = values as number[];
  if (!vector.some((value) => value !== 0)) {
    throw new GeminiResponseError("Gemini returned a zero-magnitude embedding");
  }
  return vector;
}

function extractApiErrorMessage(responseBody: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (
      isObject(parsed) &&
      isObject(parsed.error) &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message;
    }
  } catch {
    // Fall through to the HTTP status text.
  }
  return fallback;
}

export class GeminiPhotoAiProvider implements PhotoAiProvider {
  readonly analysisModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly promptVersion: string;

  private readonly apiKey: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly apiBaseUrl: string;
  private readonly maxGallerySuggestions: number;
  private readonly now: () => string;

  constructor(options: GeminiPhotoAiProviderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new AiConfigurationError("Gemini API key cannot be empty");

    this.fetchImplementation = options.fetch ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
    this.analysisModel = normalizeModelName(
      options.analysisModel ?? DEFAULT_ANALYSIS_MODEL,
      "Analysis model",
    );
    this.embeddingModel = normalizeModelName(
      options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
      "Embedding model",
    );
    this.embeddingDimensions =
      options.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    if (
      !Number.isSafeInteger(this.embeddingDimensions) ||
      this.embeddingDimensions < 1 ||
      this.embeddingDimensions > 3_072
    ) {
      throw new AiConfigurationError(
        "Embedding dimensions must be an integer between 1 and 3072",
      );
    }
    this.promptVersion = options.promptVersion?.trim() || DEFAULT_PROMPT_VERSION;
    this.maxGallerySuggestions =
      options.maxGallerySuggestions ?? DEFAULT_MAX_GALLERY_SUGGESTIONS;
    if (
      !Number.isSafeInteger(this.maxGallerySuggestions) ||
      this.maxGallerySuggestions < 1 ||
      this.maxGallerySuggestions > 25
    ) {
      throw new AiConfigurationError(
        "Maximum gallery suggestions must be an integer between 1 and 25",
      );
    }
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async analyzePhoto(input: AnalyzePhotoInput): Promise<PhotoAnalysis> {
    if (toUint8Array(input.image).byteLength === 0) {
      throw new AiDataValidationError("Image cannot be empty", "image");
    }
    if (!ANALYSIS_IMAGE_MIME_TYPES.has(input.mimeType)) {
      throw new AiDataValidationError(
        `Unsupported analysis image MIME type: ${String(input.mimeType)}`,
        "mimeType",
      );
    }
    if (
      !input.taxonomy ||
      !Array.isArray(input.taxonomy.entries) ||
      typeof input.taxonomy.version !== "string" ||
      !input.taxonomy.version.trim()
    ) {
      throw new AiDataValidationError("Invalid gallery taxonomy catalog", "taxonomy");
    }

    const eligibleGalleries = input.taxonomy.entries.filter(
      (entry) => entry.acceptsDirectPhotos && !entry.isProtected,
    );
    const allowedGallerySlugs = new Set(eligibleGalleries.map((entry) => entry.slug));
    const currentGallerySlugs = new Set(
      input.currentGallerySlugs.map((slug) => slug.trim()).filter(Boolean),
    );
    const body = {
      systemInstruction: {
        parts: [
          {
            text: "You classify photographs using only the supplied VictoPress gallery taxonomy. Return factual, concise JSON and never claim to mutate CMS content.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: buildAnalysisPrompt(input) },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: encodeBase64(input.image),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: buildAnalysisSchema(
          Array.from(allowedGallerySlugs),
          this.maxGallerySuggestions,
        ),
        thinkingConfig: { thinkingLevel: "minimal" },
        temperature: 0.1,
      },
    };

    const response = await this.requestJson(
      `${this.apiBaseUrl}/models/${encodeURIComponent(this.analysisModel)}:generateContent`,
      body,
      input.signal,
    );
    const candidate = readCandidateText(response);
    const payload = parseJsonText(candidate.text, candidate.finishReason);
    if (!isObject(payload)) {
      throw new GeminiResponseError("Gemini analysis JSON must be an object", {
        finishReason: candidate.finishReason,
      });
    }

    const caption = typeof payload.caption === "string" ? payload.caption.trim() : "";
    if (!caption) throw new GeminiResponseError("Gemini analysis did not include a caption");

    return {
      model: this.analysisModel,
      promptVersion: this.promptVersion,
      taxonomyVersion: input.taxonomy.version,
      generatedAt: this.now(),
      caption: caption.slice(0, 2_000),
      tags: normalizeTags(payload.tags),
      gallerySuggestions: normalizeSuggestions(
        payload.gallerySuggestions,
        allowedGallerySlugs,
        currentGallerySlugs,
        this.maxGallerySuggestions,
      ),
      usage: readUsageMetadata(response),
    };
  }

  async embedImage(input: EmbedImageInput): Promise<EmbeddingResult> {
    if (toUint8Array(input.image).byteLength === 0) {
      throw new AiDataValidationError("Image cannot be empty", "image");
    }
    if (!EMBEDDING_IMAGE_MIME_TYPES.has(input.mimeType)) {
      throw new AiDataValidationError(
        `Gemini Embedding 2 only supports JPEG and PNG images, received ${String(input.mimeType)}`,
        "mimeType",
      );
    }

    const response = await this.requestJson(
      `${this.apiBaseUrl}/models/${encodeURIComponent(this.embeddingModel)}:embedContent`,
      {
        model: `models/${this.embeddingModel}`,
        content: {
          parts: [
            {
              inline_data: {
                mime_type: input.mimeType,
                data: encodeBase64(input.image),
              },
            },
          ],
        },
        output_dimensionality: this.embeddingDimensions,
      },
      input.signal,
    );

    return {
      model: this.embeddingModel,
      dimensions: this.embeddingDimensions,
      values: readEmbeddingValues(response, this.embeddingDimensions),
    };
  }

  async embedText(input: EmbedTextInput): Promise<EmbeddingResult> {
    const text = input.text.trim();
    if (!text) throw new AiDataValidationError("Embedding text cannot be empty", "text");
    const instruction =
      input.instruction?.trim() ||
      "Represent this text for matching photographs in cross-modal semantic search.";

    const response = await this.requestJson(
      `${this.apiBaseUrl}/models/${encodeURIComponent(this.embeddingModel)}:embedContent`,
      {
        model: `models/${this.embeddingModel}`,
        content: { parts: [{ text: `${instruction}\n\n${text}` }] },
        output_dimensionality: this.embeddingDimensions,
      },
      input.signal,
    );

    return {
      model: this.embeddingModel,
      dimensions: this.embeddingDimensions,
      values: readEmbeddingValues(response, this.embeddingDimensions),
    };
  }

  private async requestJson(
    url: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      throw new GeminiRequestError("Gemini request could not be completed", {
        status: 0,
        retryable: true,
        cause,
      });
    }

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
      throw new GeminiRequestError(
        extractApiErrorMessage(
          responseBody,
          `Gemini request failed with HTTP ${response.status}`,
        ),
        { status: response.status, responseBody },
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new GeminiResponseError("Gemini returned invalid response JSON", { cause });
    }
  }
}
