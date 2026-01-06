/**
 * Storage Factory
 * 
 * Automatically selects the right storage adapter based on environment.
 * - Development: Local filesystem (default) or REAL R2 if STORAGE_ADAPTER=r2 with credentials
 * - Production: Cloudflare R2 binding (REQUIRED - no fallback)
 */

import type { StorageAdapter } from "../types";
import { R2StorageAdapter } from "./r2-adapter";
import { R2ApiAdapter, type R2ApiConfig } from "./r2-api-adapter";
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

// Singleton for R2 API adapter to avoid creating multiple clients
let r2ApiAdapterInstance: R2ApiAdapter | null = null;

/**
 * Get storage adapter for the current request context
 * In development:
 *   - STORAGE_ADAPTER=local → Local filesystem
 *   - STORAGE_ADAPTER=r2 + R2 credentials → REAL R2 via S3 API (direct connection!)
 *   - STORAGE_ADAPTER=r2 without credentials → Wrangler R2 binding (local emulation)
 * In production: R2 binding is required
 */
export function getStorage(context: {
  cloudflare?: { env?: { 
    CONTENT_BUCKET?: R2Bucket; 
    STORAGE_ADAPTER?: string;
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    R2_BUCKET_NAME?: string;
  } };
}, request?: Request): StorageAdapter {
  const env = context.cloudflare?.env;
  const bucket = env?.CONTENT_BUCKET;
  const localPath = process.cwd() + "/content";
  
  // Extract request info for logging
  const requestUrl = request?.url ? new URL(request.url).pathname : "no-request";
  
  // In development, use STORAGE_ADAPTER from .dev.vars
  if (process.env.NODE_ENV === "development") {
    const adapterPreference = env?.STORAGE_ADAPTER;
    
    // Debug: Check what's available in env vs process.env
    console.log(`[Storage DEBUG] env.R2_ACCESS_KEY_ID: ${env?.R2_ACCESS_KEY_ID ? 'SET' : 'MISSING'}`);
    console.log(`[Storage DEBUG] process.env.R2_ACCESS_KEY_ID: ${process.env.R2_ACCESS_KEY_ID ? 'SET' : 'MISSING'}`);
    
    // If user explicitly wants R2
    if (adapterPreference === "r2") {
      // Check for R2 API credentials - try both env (Cloudflare context) and process.env (.dev.vars)
      const r2Config = getR2ApiConfig(env) || getR2ApiConfigFromProcessEnv();
      
      if (r2Config) {
        // Use direct R2 API connection (REAL bucket, not emulation!)
        if (!r2ApiAdapterInstance) {
          r2ApiAdapterInstance = new R2ApiAdapter(r2Config);
        }
        console.log(`[Storage] 🌐 R2 DIRECT API | route: ${requestUrl} | bucket: ${r2Config.bucketName}`);
        return r2ApiAdapterInstance;
      }
      
      // Fallback to Wrangler binding (local emulation - NOT recommended)
      if (bucket) {
        console.log(`[Storage] ⚠️  R2 EMULATION (add R2_ACCESS_KEY_ID to .dev.vars for real R2) | route: ${requestUrl}`);
        return new R2StorageAdapter(bucket);
      }
      
      // R2 requested but no credentials or binding
      console.warn(`[Storage] ⚠️  R2 requested but not configured. Add R2 credentials to .dev.vars. Falling back to local.`);
    }
    
    // Default to local in development
    const reason = adapterPreference === "local" 
      ? ".dev.vars: STORAGE_ADAPTER=local" 
      : "default (STORAGE_ADAPTER not set or R2 not configured)";
    console.log(`[Storage] 📁 LOCAL adapter | route: ${requestUrl} | ${reason}`);
    return new LocalStorageAdapter(localPath);
  }
  
  // In production, R2 binding is REQUIRED
  if (bucket) {
    console.log(`[Storage] ☁️  R2 adapter | route: ${requestUrl} | production mode`);
    return new R2StorageAdapter(bucket);
  }

  // No R2 in production = error (no demo mode fallback)
  throw new StorageNotConfiguredError();
}

/**
 * Extract R2 API config from Cloudflare context environment
 */
function getR2ApiConfig(env?: {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}): R2ApiConfig | null {
  const accountId = env?.R2_ACCOUNT_ID;
  const accessKeyId = env?.R2_ACCESS_KEY_ID;
  const secretAccessKey = env?.R2_SECRET_ACCESS_KEY;
  const bucketName = env?.R2_BUCKET_NAME || "victopress-content";
  
  if (accountId && accessKeyId && secretAccessKey) {
    return { accountId, accessKeyId, secretAccessKey, bucketName };
  }
  
  return null;
}

/**
 * Extract R2 API config from process.env (for .dev.vars in development)
 * Wrangler loads .dev.vars but sometimes they're in process.env not context.env
 */
function getR2ApiConfigFromProcessEnv(): R2ApiConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || "victopress-content";
  
  if (accountId && accessKeyId && secretAccessKey) {
    return { accountId, accessKeyId, secretAccessKey, bucketName };
  }
  
  return null;
}

/**
 * Detect the current storage mode
 * Uses STORAGE_ADAPTER from .dev.vars in development
 */
export function getStorageMode(context: {
  cloudflare?: { env?: { 
    CONTENT_BUCKET?: R2Bucket; 
    STORAGE_ADAPTER?: string;
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
  } };
}): StorageMode {
  const env = context.cloudflare?.env;
  const bucket = env?.CONTENT_BUCKET;
  
  if (process.env.NODE_ENV === "development") {
    const adapterPreference = env?.STORAGE_ADAPTER;
    
    // If user explicitly wants R2
    if (adapterPreference === "r2") {
      // Check for direct R2 API credentials
      const hasR2Credentials = env?.R2_ACCOUNT_ID && env?.R2_ACCESS_KEY_ID && env?.R2_SECRET_ACCESS_KEY;
      if (hasR2Credentials || bucket) {
        return "r2";
      }
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
 * Get the current adapter preference from .dev.vars
 */
export function getAdapterPreference(context: {
  cloudflare?: { env?: { STORAGE_ADAPTER?: string } };
}): StorageAdapterPreference {
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
export { R2ApiAdapter } from "./r2-api-adapter";
export { LocalStorageAdapter } from "./local-adapter";
