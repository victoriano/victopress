import { describe, expect, test } from "bun:test";
import {
  enqueueUploadedPhotosForAi,
  getPhotoAiConfiguration,
  getSimilarPhotoDocuments,
} from "../app/lib/ai/photo-ai-service.server";

function context(env: Record<string, unknown>) {
  return { cloudflare: { env } };
}

describe("optional BYOK Photo AI", () => {
  test("a user-supplied Gemini key enables the feature without exposing it in status", () => {
    const configuration = getPhotoAiConfiguration(context({
      GEMINI_API_KEY: "user-owned-test-key",
    }));

    expect(configuration.enabled).toBe(true);
    expect(configuration.analysisModel).toBe("gemini-3.1-flash-lite");
    expect(configuration.embeddingModel).toBe("gemini-embedding-2");
  });

  test("an explicit off switch wins even when a key exists", () => {
    const configuration = getPhotoAiConfiguration(context({
      PHOTO_AI_ENABLED: "false",
      GEMINI_API_KEY: "user-owned-test-key",
    }));

    expect(configuration.enabled).toBe(false);
  });

  test("an enable flag cannot expose the feature without a BYOK key", () => {
    const configuration = getPhotoAiConfiguration(context({
      PHOTO_AI_ENABLED: "true",
    }));

    expect(configuration.enabled).toBe(false);
  });

  test("disabled mode does not initialize storage or enqueue background work", async () => {
    const disabled = context({ PHOTO_AI_ENABLED: "false" });

    await expect(
      enqueueUploadedPhotosForAi(disabled, ["galleries/example/photo.jpg"]),
    ).resolves.toBeUndefined();
    await expect(
      getSimilarPhotoDocuments(disabled, "galleries/example/photo.jpg"),
    ).resolves.toEqual([]);
  });
});
