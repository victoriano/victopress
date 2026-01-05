/**
 * Storage Factory
 * 
 * Automatically selects the right storage adapter based on environment.
 * - Development: Local filesystem (default) or R2 if STORAGE_ADAPTER=r2
 * - Production: Cloudflare R2 (REQUIRED - no fallback)
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

export type StorageMode = "r2" | "local" | "unconfigured";
export type StorageAdapterPreference = "auto" | "local" | "r2";

/**
 * Error thrown when R2 is not configured in production
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("R2 Storage is not configured. Please connect an R2 bucket to use VictoPress in production.");
    this.name = "StorageNotConfiguredError";
  }
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

  // No storage configured - throw error
  throw new StorageNotConfiguredError();
}

/**
 * Get storage adapter for the current request context
 * In development, checks cookie first for instant switching without restart
 */
export function getStorage(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket; STORAGE_ADAPTER?: string } };
}, request?: Request): StorageAdapter {
  const bucket = context.cloudflare?.env?.CONTENT_BUCKET;
  const localPath = process.cwd() + "/content";
  
  // In development, check cookie first for instant switching
  if (process.env.NODE_ENV === "development") {
    const cookiePreference = request ? getAdapterFromCookie(request) : null;
    const envPreference = context.cloudflare?.env?.STORAGE_ADAPTER;
    const adapterPreference = cookiePreference || envPreference;
    
    // If user explicitly wants R2 and it's available
    if (adapterPreference === "r2" && bucket) {
      return new R2StorageAdapter(bucket);
    }
    // Default to local in development
    return new LocalStorageAdapter(localPath);
  }
  
  // In production, R2 is REQUIRED
  if (bucket) {
    return new R2StorageAdapter(bucket);
  }

  // No R2 in production = error (no demo mode fallback)
  throw new StorageNotConfiguredError();
}

/**
 * Get adapter preference from cookie (for development instant switching)
 */
function getAdapterFromCookie(request: Request): StorageAdapterPreference | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  
  const match = cookieHeader.match(/storage_adapter=(local|r2)/);
  return match ? (match[1] as StorageAdapterPreference) : null;
}

/**
 * Detect the current storage mode
 * In development, checks cookie first for instant switching without restart
 */
export function getStorageMode(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket; STORAGE_ADAPTER?: string } };
}, request?: Request): StorageMode {
  const bucket = context.cloudflare?.env?.CONTENT_BUCKET;
  
  if (process.env.NODE_ENV === "development") {
    const cookiePreference = request ? getAdapterFromCookie(request) : null;
    const envPreference = context.cloudflare?.env?.STORAGE_ADAPTER;
    const adapterPreference = cookiePreference || envPreference;
    
    // If user explicitly wants R2 and it's available
    if (adapterPreference === "r2" && bucket) {
      return "r2";
    }
    return "local";
  }
  
  if (bucket) {
    return "r2";
  }

  // Production without R2 = unconfigured
  return "unconfigured";
}

/**
 * Get the current adapter preference
 * In development, checks cookie first for instant switching
 */
export function getAdapterPreference(context: {
  cloudflare?: { env?: { STORAGE_ADAPTER?: string } };
}, request?: Request): StorageAdapterPreference {
  // Check cookie first (for development instant switching)
  if (request) {
    const cookiePref = getAdapterFromCookie(request);
    if (cookiePref) return cookiePref;
  }
  
  // Fall back to environment variable
  const pref = context.cloudflare?.env?.STORAGE_ADAPTER;
  if (pref === "r2" || pref === "local") {
    return pref;
  }
  return "auto";
}

/**
 * Check if storage is not configured (production without R2)
 * @deprecated Demo mode has been removed. Use isStorageConfigured() instead.
 */
export function isDemoMode(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): boolean {
  // Demo mode has been removed - R2 is required in production
  return false;
}

/**
 * Check if storage is properly configured
 */
export function isStorageConfigured(context: {
  cloudflare?: { env?: { CONTENT_BUCKET?: R2Bucket } };
}): boolean {
  // In development, always configured (uses local)
  if (isDevelopment()) {
    return true;
  }
  // In production, R2 is required
  return !!context.cloudflare?.env?.CONTENT_BUCKET;
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
