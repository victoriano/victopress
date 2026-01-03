/**
 * Local Storage Adapter
 * 
 * Implements StorageAdapter for local filesystem.
 * Used for development and testing.
 * 
 * Note: This adapter works in Node.js environments.
 * In Cloudflare Workers, use R2StorageAdapter instead.
 */

import type { StorageAdapter, FileInfo } from "../types";

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private resolvePath(key: string): string {
    // The basePath already points to the content folder
    // Remove "content/" prefix if present to avoid duplication
    let normalizedKey = key;
    if (key.startsWith("content/")) {
      normalizedKey = key.slice("content/".length);
    }
    // Also handle galleries/ and blog/ prefixes when basePath ends with /content
    return `${this.basePath}/${normalizedKey}`;
  }

  async list(prefix: string): Promise<FileInfo[]> {
    // Dynamic import for Node.js fs module
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const fullPath = this.resolvePath(prefix);
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        // Skip hidden files
        if (entry.name.startsWith(".")) continue;

        const entryPath = path.join(prefix, entry.name);
        const stat = await fs.stat(path.join(fullPath, entry.name));

        files.push({
          name: entry.name,
          path: entryPath,
          size: stat.size,
          lastModified: stat.mtime,
          isDirectory: entry.isDirectory(),
        });
      }

      return files;
    } catch {
      // Directory doesn't exist
      return [];
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const fs = await import("node:fs/promises");
    
    try {
      const buffer = await fs.readFile(this.resolvePath(key));
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    } catch {
      return null;
    }
  }

  async getText(key: string): Promise<string | null> {
    const fs = await import("node:fs/promises");
    
    try {
      return await fs.readFile(this.resolvePath(key), "utf-8");
    } catch {
      return null;
    }
  }

  async put(key: string, data: ArrayBuffer | string, _contentType?: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const fullPath = this.resolvePath(key);
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });
    
    // Write file
    if (typeof data === "string") {
      await fs.writeFile(fullPath, data, "utf-8");
    } else {
      await fs.writeFile(fullPath, Buffer.from(data));
    }
  }

  async delete(key: string): Promise<void> {
    const fs = await import("node:fs/promises");
    
    try {
      await fs.unlink(this.resolvePath(key));
    } catch {
      // File doesn't exist, ignore
    }
  }

  async exists(key: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    // For local dev, serve from the static route
    return `/api/local-images/${encodeURIComponent(key)}`;
  }
}
