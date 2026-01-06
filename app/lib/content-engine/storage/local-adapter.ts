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

  async listRecursive(prefix: string): Promise<FileInfo[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const fullPath = this.resolvePath(prefix);
    const files: FileInfo[] = [];

    async function walkDir(dirPath: string, relativePath: string): Promise<void> {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip hidden files
          if (entry.name.startsWith(".")) continue;
          
          const entryFullPath = path.join(dirPath, entry.name);
          const entryRelativePath = path.join(relativePath, entry.name);
          
          if (entry.isDirectory()) {
            // Recursively walk subdirectories
            await walkDir(entryFullPath, entryRelativePath);
          } else {
            const stat = await fs.stat(entryFullPath);
            files.push({
              name: entry.name,
              path: entryRelativePath,
              size: stat.size,
              lastModified: stat.mtime,
              isDirectory: false,
            });
          }
        }
      } catch {
        // Directory doesn't exist or is inaccessible
      }
    }

    await walkDir(fullPath, prefix);
    return files;
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
    const size = typeof data === "string" ? data.length : data.byteLength;
    console.log(`[LocalStorage] 📁 PUT ${key} (${(size / 1024).toFixed(1)} KB) → ${fullPath}`);
    
    if (typeof data === "string") {
      await fs.writeFile(fullPath, data, "utf-8");
    } else {
      await fs.writeFile(fullPath, Buffer.from(data));
    }
  }

  async delete(key: string): Promise<void> {
    const fs = await import("node:fs/promises");
    
    console.log(`[LocalStorage] 📁 DELETE ${key}`);
    try {
      await fs.unlink(this.resolvePath(key));
    } catch {
      // File doesn't exist, ignore
    }
  }

  async deleteDirectory(prefix: string): Promise<{ deleted: number }> {
    const fs = await import("node:fs/promises");
    
    const fullPath = this.resolvePath(prefix);
    
    try {
      // Count files before deletion for return value
      const files = await this.listRecursive(prefix);
      const fileCount = files.length;
      
      // Use recursive rm to delete directory and all contents
      await fs.rm(fullPath, { recursive: true, force: true });
      
      return { deleted: fileCount };
    } catch {
      return { deleted: 0 };
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

  async move(from: string, to: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    
    // Rename/move the file
    await fs.rename(fromPath, toPath);
  }

  async copy(from: string, to: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    
    // Copy the file
    await fs.copyFile(fromPath, toPath);
  }

  async getSignedUrl(key: string): Promise<string> {
    // Use unified /api/images/ route which works with any storage adapter
    // Encode each path segment separately to preserve slashes
    const encodedPath = key.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `/api/images/${encodedPath}`;
  }
}
