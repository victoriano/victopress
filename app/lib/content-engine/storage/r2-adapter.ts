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
    
    console.log(`[R2Storage] 📂 LIST prefix="${normalizedPrefix}"`);
    
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

    console.log(`[R2Storage] 📂 LIST result for "${normalizedPrefix}": ${listed.delimitedPrefixes?.length || 0} dirs, ${listed.objects.length} files → ${files.length} items returned`);
    
    // If looking at galleries/geographies/europe specifically, log all files found
    if (normalizedPrefix.includes("europe") && !normalizedPrefix.includes("spain") && !normalizedPrefix.includes("kingdom")) {
      console.log(`[R2Storage] 📂 EUROPE DEBUG - Raw objects:`, listed.objects.map(o => o.key));
      console.log(`[R2Storage] 📂 EUROPE DEBUG - Parsed files:`, files.map(f => f.name));
    }

    return files;
  }

  async listRecursive(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const files: FileInfo[] = [];
    let cursor: string | undefined;

    // R2 list API returns max 1000 items per call, so we need to paginate
    do {
      const listed = await this.bucket.list({
        prefix: normalizedPrefix,
        cursor,
      });

      for (const object of listed.objects) {
        files.push({
          name: object.key.split("/").pop() || object.key,
          path: object.key,
          size: object.size,
          lastModified: object.uploaded,
          isDirectory: false,
        });
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

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

  async put(key: string, data: ArrayBuffer | string, contentType?: string): Promise<void> {
    const options: R2PutOptions = {};
    
    if (contentType) {
      options.httpMetadata = { contentType };
    } else {
      // Auto-detect content type from key extension
      const ext = key.split('.').pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'avif': 'image/avif',
        'svg': 'image/svg+xml',
        'md': 'text/markdown',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        'json': 'application/json',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
      };
      if (ext && mimeTypes[ext]) {
        options.httpMetadata = { contentType: mimeTypes[ext] };
      }
    }

    const size = typeof data === "string" ? data.length : data.byteLength;
    console.log(`[R2Storage] ☁️  PUT ${key} (${(size / 1024).toFixed(1)} KB)`);
    await this.bucket.put(key, data, options);
  }

  async delete(key: string): Promise<void> {
    console.log(`[R2Storage] ☁️  DELETE ${key}`);
    await this.bucket.delete(key);
  }

  async deleteDirectory(prefix: string): Promise<{ deleted: number }> {
    // List all files in the directory recursively
    const files = await this.listRecursive(prefix);
    
    if (files.length === 0) {
      return { deleted: 0 };
    }

    // R2 supports batch delete up to 1000 keys at a time
    const batchSize = 1000;
    let deleted = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const keys = batch.map(f => f.path);
      
      // Delete files in batch
      await Promise.all(keys.map(key => this.bucket.delete(key)));
      deleted += keys.length;
    }

    return { deleted };
  }

  async exists(key: string): Promise<boolean> {
    // First, check if it's an actual object
    const head = await this.bucket.head(key);
    if (head !== null) {
      return true;
    }
    
    // In S3/R2, directories don't exist as objects - they're just prefixes.
    // Check if any objects exist with this prefix (i.e., it's a "directory")
    const normalizedPrefix = key.endsWith("/") ? key : `${key}/`;
    const listed = await this.bucket.list({
      prefix: normalizedPrefix,
      limit: 1, // We only need to know if at least one exists
    });
    
    return listed.objects.length > 0 || (listed.delimitedPrefixes?.length ?? 0) > 0;
  }

  async move(from: string, to: string): Promise<void> {
    // R2 doesn't have a native move operation
    // We need to copy and then delete
    await this.copy(from, to);
    await this.delete(from);
  }

  async copy(from: string, to: string): Promise<void> {
    // Get the source object
    const object = await this.bucket.get(from);
    if (!object) {
      throw new Error(`Source file not found: ${from}`);
    }

    // Get content type from source
    const contentType = object.httpMetadata?.contentType;
    
    // Read data and write to new location
    const data = await object.arrayBuffer();
    await this.put(to, data, contentType);
  }

  async getSignedUrl(key: string, _expiresIn = 3600): Promise<string> {
    // R2 doesn't support presigned URLs directly in Workers
    // We return the path and handle auth at the route level
    // Encode each path segment separately to preserve slashes
    const encodedPath = key.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `/api/images/${encodedPath}`;
  }
}
