import { describe, expect, test } from "bun:test";
import { GeminiRequestError, GeminiResponseError } from "../app/lib/ai/errors";
import { GeminiPhotoAiProvider } from "../app/lib/ai/gemini-provider";
import { buildGalleryTaxonomyCatalog } from "../app/lib/ai/gallery-taxonomy";
import type { GalleryDataEntry } from "../app/lib/content-engine/content-index";

function gallery(
  slug: string,
  title: string,
  classificationHint?: string,
): GalleryDataEntry {
  return {
    slug,
    title,
    path: `galleries/${slug}`,
    photoCount: 1,
    isProtected: false,
    hasChildren: false,
    childCount: 0,
    photos: [],
    classificationHint,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GeminiPhotoAiProvider", () => {
  test("uses structured output and only keeps valid existing-gallery suggestions", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    caption: "Una persona camina por una calle de Madrid.",
                    tags: ["calle", " Calle ", "persona"],
                    gallerySuggestions: [
                      {
                        gallerySlug: "street",
                        confidence: 0.78,
                        reason: "Escena urbana espontánea.",
                      },
                      {
                        gallerySlug: "street",
                        confidence: 0.94,
                        reason: "La calle es el motivo principal.",
                      },
                      {
                        gallerySlug: "portraits",
                        confidence: 0.72,
                        reason: "Hay una figura humana protagonista.",
                      },
                      {
                        gallerySlug: "invented-by-model",
                        confidence: 0.99,
                        reason: "This slug does not exist.",
                      },
                      {
                        gallerySlug: "portraits",
                        confidence: 4,
                        reason: "Invalid confidence.",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 120, totalTokenCount: 150 },
      });
    }) as typeof fetch;
    const taxonomy = await buildGalleryTaxonomyCatalog([
      gallery(
        "street",
        "Calle",
        "Suggest only when the street itself is a main visual subject.",
      ),
      gallery("portraits", "Retratos"),
    ]);
    const provider = new GeminiPhotoAiProvider({
      apiKey: "test-secret",
      fetch: mockFetch,
      now: () => "2026-07-18T12:00:00.000Z",
    });

    const result = await provider.analyzePhoto({
      image: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
      taxonomy,
      currentGallerySlugs: ["street"],
    });

    expect(result.model).toBe("gemini-3.1-flash-lite");
    expect(result.tags).toEqual(["calle", "persona"]);
    expect(result.gallerySuggestions).toHaveLength(2);
    expect(result.gallerySuggestions[0]).toMatchObject({
      gallerySlug: "street",
      confidence: 0.94,
      alreadyCurrent: true,
      status: "pending",
    });
    expect(result.gallerySuggestions[1]).toMatchObject({
      gallerySlug: "portraits",
      alreadyCurrent: false,
    });
    expect(result.usage).toEqual({ promptTokenCount: 120, totalTokenCount: 150 });

    const request = requests[0];
    expect(request.url).toContain("gemini-3.1-flash-lite:generateContent");
    expect(request.url).not.toContain("test-secret");
    expect(new Headers(request.init?.headers).get("x-goog-api-key")).toBe("test-secret");
    const body = JSON.parse(String(request.init?.body));
    const prompt = body.contents[0].parts[0].text as string;
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("minimal");
    expect(
      body.generationConfig.responseJsonSchema.properties.gallerySuggestions.items
        .properties.gallerySlug.enum,
    ).toEqual(["portraits", "street"]);
    expect(prompt).toContain("strict editorial inclusion/exclusion rule");
    expect(prompt).toContain(
      '"classificationHint":"Suggest only when the street itself is a main visual subject."',
    );
    expect(result.promptVersion).toBe("gallery-taxonomy-v2");
  });

  test("generates image and text embeddings with the configured dimensions", async () => {
    const bodies: unknown[] = [];
    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ embedding: { values: [0.1, 0.2, 0.3] } });
    }) as typeof fetch;
    const provider = new GeminiPhotoAiProvider({
      apiKey: "key",
      fetch: mockFetch,
      embeddingDimensions: 3,
    });

    const image = await provider.embedImage({
      image: new Uint8Array([1, 2]),
      mimeType: "image/png",
    });
    const text = await provider.embedText({ text: "noche lluviosa en Madrid" });

    expect(image).toEqual({
      model: "gemini-embedding-2",
      dimensions: 3,
      values: [0.1, 0.2, 0.3],
    });
    expect(text.values).toEqual(image.values);
    expect((bodies[0] as any).output_dimensionality).toBe(3);
    expect((bodies[0] as any).content.parts[0].inline_data.mime_type).toBe("image/png");
    expect((bodies[1] as any).content.parts[0].text).toContain(
      "matching photographs",
    );
    expect((bodies[1] as any).taskType).toBeUndefined();
  });

  test("rejects wrong vector dimensions and exposes retryable HTTP errors", async () => {
    const invalidVectorProvider = new GeminiPhotoAiProvider({
      apiKey: "key",
      embeddingDimensions: 3,
      fetch: (async () =>
        jsonResponse({ embedding: { values: [0.1, 0.2] } })) as typeof fetch,
    });
    expect(
      invalidVectorProvider.embedText({ text: "query" }),
    ).rejects.toBeInstanceOf(GeminiResponseError);

    const throttledProvider = new GeminiPhotoAiProvider({
      apiKey: "key",
      fetch: (async () =>
        jsonResponse({ error: { message: "Quota exhausted" } }, 429)) as typeof fetch,
    });
    try {
      await throttledProvider.embedText({ text: "query" });
      throw new Error("Expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiRequestError);
      expect((error as GeminiRequestError).status).toBe(429);
      expect((error as GeminiRequestError).retryable).toBe(true);
      expect((error as Error).message).toBe("Quota exhausted");
    }
  });
});
