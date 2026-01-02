/**
 * Storage Factory
 * 
 * Automatically selects the right storage adapter based on environment.
 * - Development: Local filesystem
 * - Production: Cloudflare R2
 */

import type { StorageAdapter } from "../types";
import { R2StorageAdapter } from "./r2-adapter";
import { LocalStorageAdapter } from "./local-adapter";

export interface StorageConfig {
  /** R2 bucket binding (for Cloudflare Workers) */
  bucket?: R2Bucket;
  /** Local content path (for development) */
  localPath?: string;
  /** Force a specific adapter */
  forceAdapter?: "r2" | "local";
}

/**
 * Create a storage adapter based on the environment
 */
export function createStorageAdapter(config: StorageConfig): StorageAdapter {
  // If forced, use that adapter
  if (config.forceAdapter === "local" && config.localPath) {
    return new LocalStorageAdapter(config.localPath);
  }
  
  if (config.forceAdapter === "r2" && config.bucket) {
    return new R2StorageAdapter(config.bucket);
  }

  // Auto-detect: prefer R2 in production, local in development
  if (config.bucket) {
    return new R2StorageAdapter(config.bucket);
  }
  
  if (config.localPath) {
    return new LocalStorageAdapter(config.localPath);
  }

  throw new Error(
    "No storage configured. Provide either an R2 bucket or a local path."
  );
}

/**
 * Get storage adapter for the current request context
 */
export function getStorage(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): StorageAdapter {
  const bucket = context.cloudflare?.env?.CONTENT_BUCKET;
  
  // In development without R2, use local filesystem
  const isDev = process.env.NODE_ENV === "development" || !bucket;
  
  if (isDev) {
    // Use local content folder
    const localPath = process.cwd() + "/content";
    return new LocalStorageAdapter(localPath);
  }
  
  if (bucket) {
    return new R2StorageAdapter(bucket);
  }

  throw new Error("No storage available");
}

export { R2StorageAdapter } from "./r2-adapter";
export { LocalStorageAdapter } from "./local-adapter";
