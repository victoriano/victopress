#!/usr/bin/env bun
/**
 * Sync R2 Bucket to Local Wrangler State
 * 
 * Downloads all files from the real R2 bucket to the local Wrangler emulation
 * so you can test with production data locally.
 * 
 * Usage: bun run scripts/sync-r2-to-local.ts
 * 
 * Requires: CLOUDFLARE_API_TOKEN and R2_ACCOUNT_ID in .dev.vars
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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

async function main() {
  console.log("🔄 Syncing R2 bucket to local Wrangler state...\n");
  
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
  
  // Local state path for R2 emulation
  const localStatePath = ".wrangler/state/v3/r2/victopress-content";
  
  console.log(`📦 Bucket: ${bucketName}`);
  console.log(`📁 Local path: ${localStatePath}\n`);
  
  // List all objects in the bucket
  let continuationToken: string | undefined;
  let totalFiles = 0;
  let downloadedFiles = 0;
  
  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    });
    
    const response = await s3.send(listCommand);
    const objects = response.Contents || [];
    totalFiles += objects.length;
    
    for (const obj of objects) {
      if (!obj.Key) continue;
      
      const localPath = path.join(localStatePath, obj.Key);
      
      // Check if file exists and has same size
      try {
        const stats = await fs.stat(localPath);
        if (stats.size === obj.Size) {
          console.log(`⏭️  Skip (unchanged): ${obj.Key}`);
          continue;
        }
      } catch {
        // File doesn't exist, will download
      }
      
      // Download file
      console.log(`⬇️  Downloading: ${obj.Key} (${formatSize(obj.Size || 0)})`);
      
      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: obj.Key,
      });
      
      try {
        const data = await s3.send(getCommand);
        const body = await data.Body?.transformToByteArray();
        
        if (body) {
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await fs.writeFile(localPath, body);
          downloadedFiles++;
        }
      } catch (err) {
        console.error(`❌ Failed to download ${obj.Key}:`, err);
      }
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  console.log(`\n✅ Sync complete!`);
  console.log(`   Total files in bucket: ${totalFiles}`);
  console.log(`   Downloaded: ${downloadedFiles} files`);
  console.log(`\n   Now restart your dev server: bun run dev`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(console.error);
