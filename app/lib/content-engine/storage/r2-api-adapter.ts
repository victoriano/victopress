/**
 * R2 API Adapter
 * 
 * Connects DIRECTLY to Cloudflare R2 using the S3-compatible API.
 * Unlike R2StorageAdapter (which uses Wrangler bindings), this adapter
 * uses AWS SDK with R2 credentials to access the REAL R2 bucket.
 * 
 * Use this in development when you want to work with production data.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageAdapter, FileInfo } from "../types";

export interface R2ApiConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export class R2ApiAdapter implements StorageAdapter {
  private client: S3Client;
  private bucketName: string;

  constructor(config: R2ApiConfig) {
    this.bucketName = config.bucketName;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    console.log(`[R2Api] 🌐 Initialized DIRECT connection to R2 bucket: ${config.bucketName}`);
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    
    console.log(`[R2Api] 📂 LIST prefix="${normalizedPrefix}"`);
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: normalizedPrefix,
      Delimiter: "/",
    });

    const response = await this.client.send(command);
    const files: FileInfo[] = [];

    // Add directories (common prefixes)
    for (const prefix of response.CommonPrefixes || []) {
      if (!prefix.Prefix) continue;
      const name = prefix.Prefix.slice(normalizedPrefix.length).replace(/\/$/, "");
      if (name) {
        files.push({
          name,
          path: prefix.Prefix.replace(/\/$/, ""),
          size: 0,
          lastModified: new Date(),
          isDirectory: true,
        });
      }
    }

    // Add files
    for (const object of response.Contents || []) {
      if (!object.Key) continue;
      const name = object.Key.slice(normalizedPrefix.length);
      if (name && !name.includes("/")) {
        files.push({
          name,
          path: object.Key,
          size: object.Size || 0,
          lastModified: object.LastModified || new Date(),
          isDirectory: false,
        });
      }
    }

    console.log(`[R2Api] 📂 LIST result: ${response.CommonPrefixes?.length || 0} dirs, ${response.Contents?.length || 0} objects → ${files.length} items`);

    return files;
  }

  async listRecursive(prefix: string): Promise<FileInfo[]> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const files: FileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      for (const object of response.Contents || []) {
        if (!object.Key) continue;
        const name = object.Key.slice(normalizedPrefix.length);
        if (name) {
          files.push({
            name,
            path: object.Key,
            size: object.Size || 0,
            lastModified: object.LastModified || new Date(),
            isDirectory: false,
          });
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);
      const bytes = await response.Body?.transformToByteArray();
      
      if (!bytes) return null;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } catch (error: unknown) {
      if ((error as { name?: string })?.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async getText(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);
      return await response.Body?.transformToString() || null;
    } catch (error: unknown) {
      if ((error as { name?: string })?.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async put(key: string, data: ArrayBuffer | string, contentType?: string): Promise<void> {
    const body = typeof data === "string" ? data : new Uint8Array(data);
    
    // Auto-detect content type
    if (!contentType) {
      const ext = key.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        svg: "image/svg+xml",
        json: "application/json",
        yaml: "text/yaml",
        yml: "text/yaml",
        md: "text/markdown",
        html: "text/html",
        css: "text/css",
      };
      contentType = mimeTypes[ext || ""] || "application/octet-stream";
    }

    const size = typeof data === "string" ? data.length : data.byteLength;
    console.log(`[R2Api] ☁️  PUT ${key} (${(size / 1024).toFixed(1)} KB)`);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);
  }

  async delete(key: string): Promise<void> {
    console.log(`[R2Api] 🗑️  DELETE ${key}`);
    
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.client.send(command);
  }

  async deleteDirectory(prefix: string): Promise<{ deleted: number }> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const files = await this.listRecursive(normalizedPrefix);
    
    console.log(`[R2Api] 🗑️  DELETE DIR ${normalizedPrefix} (${files.length} files)`);

    let deleted = 0;
    for (const file of files) {
      try {
        await this.delete(file.path);
        deleted++;
      } catch (error) {
        console.error(`[R2Api] Failed to delete ${file.path}:`, error);
      }
    }

    return { deleted };
  }

  async exists(key: string): Promise<boolean> {
    // First, check if it's an actual object
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      // Object doesn't exist, but it might be a "directory" prefix
    }
    
    // In S3/R2, directories don't exist as objects - they're just prefixes.
    // Check if any objects exist with this prefix (i.e., it's a "directory")
    const normalizedPrefix = key.endsWith("/") ? key : `${key}/`;
    const listCommand = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: normalizedPrefix,
      MaxKeys: 1, // We only need to know if at least one exists
    });
    
    try {
      const response = await this.client.send(listCommand);
      return (response.Contents?.length ?? 0) > 0 || (response.CommonPrefixes?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async move(from: string, to: string): Promise<void> {
    console.log(`[R2Api] 📦 MOVE ${from} → ${to}`);
    await this.copy(from, to);
    await this.delete(from);
  }

  async copy(from: string, to: string): Promise<void> {
    console.log(`[R2Api] 📋 COPY ${from} → ${to}`);
    
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${from}`,
      Key: to,
    });

    await this.client.send(command);
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    // R2 doesn't support presigned URLs the same way S3 does
    // Return a placeholder or public URL if configured
    return `/api/images/${encodeURIComponent(key)}`;
  }
}
