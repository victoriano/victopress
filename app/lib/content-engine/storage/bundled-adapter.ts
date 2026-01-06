/**
 * Bundled Storage Adapter
 * 
 * Read-only adapter that serves bundled sample content.
 * Used in demo mode when no R2 bucket is configured.
 */

import type { StorageAdapter, FileInfo } from "../types";
import sampleContent from "~/data/sample-content.json";

interface BundledFile {
  path: string;
  content: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

interface BundledContent {
  version: string;
  generatedAt: string;
  files: BundledFile[];
}

export class BundledStorageAdapter implements StorageAdapter {
  private content: BundledContent;

  constructor() {
    this.content = sampleContent as BundledContent;
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix ? `${prefix}/` : "";
    
    const files: FileInfo[] = [];
    const seenDirs = new Set<string>();

    for (const file of this.content.files) {
      // Check if file is in the requested prefix
      if (!file.path.startsWith(normalizedPrefix)) {
        continue;
      }

      // Get the relative path after the prefix
      const relativePath = file.path.slice(normalizedPrefix.length);
      
      // Skip if it's the prefix itself
      if (!relativePath) {
        continue;
      }

      // Check if this is a direct child or nested
      const parts = relativePath.split("/").filter(Boolean);
      
      if (parts.length === 1) {
        // Direct child file
        if (!file.isDirectory) {
          files.push({
            name: parts[0],
            path: file.path,
            size: file.size,
            lastModified: new Date(file.lastModified),
            isDirectory: false,
          });
        }
      } else if (parts.length > 1) {
        // This is nested, add the directory if not seen
        const dirName = parts[0];
        const dirPath = normalizedPrefix + dirName;
        
        if (!seenDirs.has(dirPath)) {
          seenDirs.add(dirPath);
          files.push({
            name: dirName,
            path: dirPath,
            size: 0,
            lastModified: new Date(),
            isDirectory: true,
          });
        }
      }
    }

    // Also check for explicit directories in the bundled content
    for (const file of this.content.files) {
      if (file.isDirectory && file.path.startsWith(normalizedPrefix)) {
        const relativePath = file.path.slice(normalizedPrefix.length);
        const parts = relativePath.split("/").filter(Boolean);
        
        if (parts.length === 1) {
          const dirName = parts[0];
          const dirPath = normalizedPrefix + dirName;
          
          if (!seenDirs.has(dirPath)) {
            seenDirs.add(dirPath);
            files.push({
              name: dirName,
              path: dirPath,
              size: 0,
              lastModified: new Date(file.lastModified),
              isDirectory: true,
            });
          }
        }
      }
    }

    return files;
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const file = this.content.files.find(f => f.path === key && !f.isDirectory);
    if (!file) {
      return null;
    }
    
    // For binary files (images), the content is base64 encoded
    if (this.isBinaryFile(key)) {
      const binary = atob(file.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    
    // For text files, encode as UTF-8
    const encoder = new TextEncoder();
    return encoder.encode(file.content).buffer;
  }

  async getText(key: string): Promise<string | null> {
    const file = this.content.files.find(f => f.path === key && !f.isDirectory);
    if (!file) {
      return null;
    }
    return file.content;
  }

  async put(_key: string, _data: ArrayBuffer | string, _contentType?: string): Promise<void> {
    throw new Error(
      "Demo mode is read-only. Configure R2 storage to enable uploads and editing."
    );
  }

  async delete(_key: string): Promise<void> {
    throw new Error(
      "Demo mode is read-only. Configure R2 storage to enable uploads and editing."
    );
  }

  async deleteDirectory(_prefix: string): Promise<{ deleted: number }> {
    throw new Error(
      "Demo mode is read-only. Configure R2 storage to enable uploads and editing."
    );
  }

  async move(_from: string, _to: string): Promise<void> {
    throw new Error(
      "Demo mode is read-only. Configure R2 storage to enable uploads and editing."
    );
  }

  async copy(_from: string, _to: string): Promise<void> {
    throw new Error(
      "Demo mode is read-only. Configure R2 storage to enable uploads and editing."
    );
  }

  async listRecursive(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix ? `${prefix}/` : "";
    const files: FileInfo[] = [];

    for (const file of this.content.files) {
      if (file.path.startsWith(normalizedPrefix) && !file.isDirectory) {
        files.push({
          name: file.path.split("/").pop() || file.path,
          path: file.path,
          size: file.size,
          lastModified: new Date(file.lastModified),
          isDirectory: false,
        });
      }
    }

    return files;
  }

  async exists(key: string): Promise<boolean> {
    return this.content.files.some(f => f.path === key);
  }

  async getSignedUrl(key: string, _expiresIn = 3600): Promise<string> {
    // In demo mode, return a path to the bundled content API
    return `/api/demo-content/${encodeURIComponent(key)}`;
  }

  /**
   * Check if the adapter is in demo mode (always true for this adapter)
   */
  isDemoMode(): boolean {
    return true;
  }

  /**
   * Get all bundled content for seeding to R2
   */
  getAllContent(): BundledFile[] {
    return this.content.files;
  }

  private isBinaryFile(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase();
    const binaryExts = ["jpg", "jpeg", "png", "gif", "webp", "avif", "ico", "pdf"];
    return binaryExts.includes(ext || "");
  }
}
