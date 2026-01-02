/**
 * R2 Storage Adapter
 * 
 * Implements StorageAdapter for Cloudflare R2.
 */

import type { StorageAdapter, FileInfo } from "../types";

export class R2StorageAdapter implements StorageAdapter {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    
    const listed = await this.bucket.list({
      prefix: normalizedPrefix,
      delimiter: "/",
    });

    const files: FileInfo[] = [];

    // Add directories (common prefixes)
    for (const prefix of listed.delimitedPrefixes || []) {
      const name = prefix.slice(normalizedPrefix.length).replace(/\/$/, "");
      if (name) {
        files.push({
          name,
          path: prefix.replace(/\/$/, ""),
          size: 0,
          lastModified: new Date(),
          isDirectory: true,
        });
      }
    }

    // Add files
    for (const object of listed.objects) {
      const name = object.key.slice(normalizedPrefix.length);
      if (name && !name.includes("/")) {
        files.push({
          name,
          path: object.key,
          size: object.size,
          lastModified: object.uploaded,
          isDirectory: false,
        });
      }
    }

    return files;
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const object = await this.bucket.get(key);
    if (!object) {
      return null;
    }
    return object.arrayBuffer();
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    if (!object) {
      return null;
    }
    return object.text();
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.bucket.head(key);
    return head !== null;
  }

  async getSignedUrl(key: string, _expiresIn = 3600): Promise<string> {
    // R2 doesn't support presigned URLs directly in Workers
    // We return the path and handle auth at the route level
    return `/api/images/${encodeURIComponent(key)}`;
  }
}
