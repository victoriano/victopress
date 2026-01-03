/**
 * Storage Factory
 * 
 * Automatically selects the right storage adapter based on environment.
 * - Development: Local filesystem
 * - Production with R2: Cloudflare R2
 * - Production without R2: Demo mode (bundled content)
 */

import type { StorageAdapter } from "../types";
import { R2StorageAdapter } from "./r2-adapter";
import { LocalStorageAdapter } from "./local-adapter";
import { BundledStorageAdapter } from "./bundled-adapter";

export interface StorageConfig {
  /** R2 bucket binding (for Cloudflare Workers) */
  bucket?: R2Bucket;
  /** Local content path (for development) */
  localPath?: string;
  /** Force a specific adapter */
  forceAdapter?: "r2" | "local" | "bundled";
}

export type StorageMode = "r2" | "local" | "demo";

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

  if (config.forceAdapter === "bundled") {
    return new BundledStorageAdapter();
  }

  // Auto-detect: prefer R2 in production, local in development
  if (config.bucket) {
    return new R2StorageAdapter(config.bucket);
  }
  
  if (config.localPath) {
    return new LocalStorageAdapter(config.localPath);
  }

  // Fallback to bundled content (demo mode)
  return new BundledStorageAdapter();
}

/**
 * Get storage adapter for the current request context
 */
export function getStorage(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): StorageAdapter {
  const bucket = context.cloudflare?.env?.CONTENT_BUCKET;
  
  // In development, use local filesystem
  if (process.env.NODE_ENV === "development") {
    const localPath = process.cwd() + "/content";
    return new LocalStorageAdapter(localPath);
  }
  
  // In production with R2 bucket, use R2
  if (bucket) {
    return new R2StorageAdapter(bucket);
  }

  // In production without R2, use demo mode (bundled content)
  return new BundledStorageAdapter();
}

/**
 * Detect the current storage mode
 */
export function getStorageMode(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): StorageMode {
  const bucket = context.cloudflare?.env?.CONTENT_BUCKET;
  
  if (process.env.NODE_ENV === "development") {
    return "local";
  }
  
  if (bucket) {
    return "r2";
  }

  return "demo";
}

/**
 * Check if the current storage is in demo mode (read-only)
 * Set FORCE_DEMO_MODE=true to test demo mode in development
 */
export function isDemoMode(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): boolean {
  // Uncomment the next line to test demo mode banner in development
  // return true;
  return getStorageMode(context) === "demo";
}

/**
 * Check if R2 is configured
 */
export function isR2Configured(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): boolean {
  return !!context.cloudflare?.env?.CONTENT_BUCKET;
}

/**
 * Check if the site is fully configured (R2 + admin credentials)
 * This is used to determine if the user should be redirected to /setup
 */
export function isSiteConfigured(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket; ADMIN_PASSWORD?: string } };
}): boolean {
  const hasR2 = !!context.cloudflare?.env?.CONTENT_BUCKET;
  const hasPassword = !!context.cloudflare?.env?.ADMIN_PASSWORD;
  return hasR2 && hasPassword;
}

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Check if setup is needed (production and not configured)
 */
export function needsSetup(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket; ADMIN_PASSWORD?: string } };
}): boolean {
  // Never need setup in development
  if (isDevelopment()) {
    return false;
  }
  
  // In production, check if configured
  return !isSiteConfigured(context);
}

export { R2StorageAdapter } from "./r2-adapter";
export { LocalStorageAdapter } from "./local-adapter";
export { BundledStorageAdapter } from "./bundled-adapter";
