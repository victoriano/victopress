import type { StorageAdapter } from "../content-engine/types";

export const PHOTO_AI_JOB_KEY = ".victopress/ai/job.json";
export const PHOTO_AI_JOB_VERSION = 1 as const;

export type PhotoAiJobStatus = "running" | "paused" | "completed";
export type PhotoAiJobItemStatus = "pending" | "completed" | "failed" | "skipped";

export interface PhotoAiJobItem {
  path: string;
  gallerySlug: string;
  filename: string;
  hidden: boolean;
  protected: boolean;
  status: PhotoAiJobItemStatus;
  attempts: number;
  assetId?: string;
  error?: string;
  updatedAt?: string;
}

export interface PhotoAiJob {
  version: typeof PHOTO_AI_JOB_VERSION;
  id: string;
  status: PhotoAiJobStatus;
  analysisModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  taxonomyVersion: string;
  createdAt: string;
  updatedAt: string;
  items: PhotoAiJobItem[];
}

function isJob(value: unknown): value is PhotoAiJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<PhotoAiJob>;
  return (
    job.version === PHOTO_AI_JOB_VERSION &&
    typeof job.id === "string" &&
    (job.status === "running" || job.status === "paused" || job.status === "completed") &&
    Array.isArray(job.items)
  );
}

export async function readPhotoAiJob(storage: StorageAdapter): Promise<PhotoAiJob | null> {
  const raw = await storage.getText(PHOTO_AI_JOB_KEY);
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    return isJob(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writePhotoAiJob(
  storage: StorageAdapter,
  job: PhotoAiJob,
): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await storage.put(PHOTO_AI_JOB_KEY, JSON.stringify(job, null, 2), "application/json");
}

export function createPhotoAiJob(input: {
  items: Array<Omit<PhotoAiJobItem, "status" | "attempts">>;
  analysisModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  taxonomyVersion: string;
  now?: string;
}): PhotoAiJob {
  const now = input.now ?? new Date().toISOString();
  return {
    version: PHOTO_AI_JOB_VERSION,
    id: crypto.randomUUID(),
    status: input.items.length > 0 ? "running" : "completed",
    analysisModel: input.analysisModel,
    embeddingModel: input.embeddingModel,
    embeddingDimensions: input.embeddingDimensions,
    taxonomyVersion: input.taxonomyVersion,
    createdAt: now,
    updatedAt: now,
    items: input.items.map((item) => ({ ...item, status: "pending", attempts: 0 })),
  };
}

export function summarizePhotoAiJob(job: PhotoAiJob | null): {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  skipped: number;
  done: boolean;
} {
  const items = job?.items ?? [];
  const summary = {
    total: items.length,
    pending: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    done: false,
  };

  for (const item of items) {
    if (item.status === "pending") summary.pending += 1;
    if (item.status === "completed") summary.completed += 1;
    if (item.status === "failed") summary.failed += 1;
    if (item.status === "skipped") summary.skipped += 1;
  }
  summary.done = summary.pending === 0;
  return summary;
}

/** Failed items are retryable on the next explicit start, not in a tight request loop. */
export function nextPendingPhotoAiItems(job: PhotoAiJob, limit: number): PhotoAiJobItem[] {
  return job.items.filter((item) => item.status === "pending").slice(0, Math.max(1, limit));
}

export function enqueuePhotoAiPaths(
  job: PhotoAiJob,
  items: Array<Omit<PhotoAiJobItem, "status" | "attempts">>,
): PhotoAiJob {
  const existing = new Set(job.items.map((item) => item.path));
  for (const item of items) {
    if (!existing.has(item.path)) {
      job.items.push({ ...item, status: "pending", attempts: 0 });
      existing.add(item.path);
    }
  }
  if (job.items.some((item) => item.status === "pending")) job.status = "running";
  return job;
}
