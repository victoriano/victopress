#!/usr/bin/env bun
/**
 * Sync Local Content to R2 Bucket
 * 
 * Uploads all files from the local content/ folder to the R2 bucket.
 * Only uploads new or changed files (compares by size).
 * 
 * Usage: bun run scripts/sync-local-to-r2.ts
 * 
 * Requires in .dev.vars:
 *   R2_ACCOUNT_ID=your_account_id
 *   R2_ACCESS_KEY_ID=your_access_key
 *   R2_SECRET_ACCESS_KEY=your_secret_key
 *   R2_BUCKET_NAME=victopress-content (optional, defaults to this)
 */

import { S3Client, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { lookup } from "mime-types";

// Load env vars from .dev.vars
async function loadEnv(): Promise<Record<string, string>> {
  const content = await fs.readFile(".dev.vars", "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        env[key] = valueParts.join("=");
      }
    }
  }
  return env;
}

// Recursively get all files in a directory
async function getAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden directories
      if (!entry.name.startsWith(".")) {
        files.push(...await getAllFiles(fullPath, baseDir));
      }
    } else {
      // Skip hidden files and non-content files
      if (!entry.name.startsWith(".")) {
        files.push(fullPath);
      }
    }
  }
  
  return files;
}

async function main() {
  console.log("🚀 Syncing local content to R2 bucket...\n");
  
  const env = await loadEnv();
  
  const accountId = env.R2_ACCOUNT_ID;
  const bucketName = env.R2_BUCKET_NAME || "victopress-content";
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  
  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("❌ Missing R2 credentials in .dev.vars");
    console.error("   Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    console.error("\n   To get these:");
    console.error("   1. Go to Cloudflare Dashboard → R2 → Overview → Manage R2 API Tokens");
    console.error("   2. Create a token with 'Object Read & Write' permissions");
    console.error("   3. Add to .dev.vars:");
    console.error("      R2_ACCOUNT_ID=your_cloudflare_account_id");
    console.error("      R2_ACCESS_KEY_ID=your_access_key");
    console.error("      R2_SECRET_ACCESS_KEY=your_secret_key");
    process.exit(1);
  }
  
  // R2 uses S3-compatible API
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  
  const localContentPath = path.resolve("content");
  
  console.log(`📦 Bucket: ${bucketName}`);
  console.log(`📁 Local path: ${localContentPath}\n`);
  
  // Check if content directory exists
  try {
    await fs.access(localContentPath);
  } catch {
    console.error("❌ Content directory not found:", localContentPath);
    process.exit(1);
  }
  
  // Get all local files
  const localFiles = await getAllFiles(localContentPath);
  console.log(`📋 Found ${localFiles.length} local files to check\n`);
  
  // Get existing files in R2 for comparison
  console.log("🔍 Checking existing files in R2...");
  const existingFiles = new Map<string, number>(); // key -> size
  
  let continuationToken: string | undefined;
  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    });
    
    try {
      const response = await s3.send(listCommand);
      for (const obj of response.Contents || []) {
        if (obj.Key && obj.Size !== undefined) {
          existingFiles.set(obj.Key, obj.Size);
        }
      }
      continuationToken = response.NextContinuationToken;
    } catch (err: any) {
      if (err.name === "NoSuchBucket") {
        console.error(`❌ Bucket '${bucketName}' does not exist!`);
        console.error("   Create it in Cloudflare Dashboard → R2 → Create bucket");
        process.exit(1);
      }
      throw err;
    }
  } while (continuationToken);
  
  console.log(`   Found ${existingFiles.size} existing files in R2\n`);
  
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const localFile of localFiles) {
    // Calculate the R2 key (relative path from content/)
    const key = path.relative(localContentPath, localFile);
    
    // Get local file size
    const stats = await fs.stat(localFile);
    const localSize = stats.size;
    
    // Check if file exists in R2 with same size
    const existingSize = existingFiles.get(key);
    if (existingSize === localSize) {
      skipped++;
      continue; // File already exists with same size
    }
    
    // Read file content
    const content = await fs.readFile(localFile);
    
    // Detect content type
    const contentType = lookup(localFile) || "application/octet-stream";
    
    // Upload to R2
    const action = existingSize !== undefined ? "🔄 Updating" : "⬆️  Uploading";
    console.log(`${action}: ${key} (${formatSize(localSize)})`);
    
    try {
      const putCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: contentType,
      });
      
      await s3.send(putCommand);
      uploaded++;
    } catch (err) {
      console.error(`❌ Failed to upload ${key}:`, err);
      failed++;
    }
  }
  
  console.log(`\n✅ Sync complete!`);
  console.log(`   Uploaded: ${uploaded} files`);
  console.log(`   Skipped (unchanged): ${skipped} files`);
  if (failed > 0) {
    console.log(`   Failed: ${failed} files`);
  }
  console.log(`\n   Your images should now be available at:`);
  console.log(`   https://victopress.pages.dev/api/images/galleries/...`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(console.error);
