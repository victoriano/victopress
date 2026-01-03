/**
 * Admin Seed API Endpoint
 * 
 * Seeds content from the public GitHub repo to R2.
 * Fetches files listed in the content manifest and uploads them to the user's R2 bucket.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import contentManifest from "~/data/content-manifest.json";

interface Env {
  CONTENT_BUCKET?: R2Bucket;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

// GitHub raw content URL base
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${contentManifest.repo}/${contentManifest.branch}/${contentManifest.contentPath}`;

// MIME types for content
const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  md: "text/markdown",
  yaml: "text/yaml",
  yml: "text/yaml",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  txt: "text/plain",
};

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

// Auth check using same pattern as admin-auth.ts
function isAuthenticated(request: Request, env: Env): boolean {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return false;
  }
  
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/admin_auth=([^;]+)/);
  
  if (!match) {
    return false;
  }
  
  const token = match[1];
  const expectedToken = btoa(`${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`);
  
  return token === expectedToken;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare?.env as Env | undefined;
  
  // Return manifest info for GET requests
  return json({
    manifest: {
      version: contentManifest.version,
      repo: contentManifest.repo,
      branch: contentManifest.branch,
      totalFiles: contentManifest.totalFiles,
      totalSize: contentManifest.totalSize,
      textFiles: contentManifest.files.filter(f => f.type === "text").length,
      binaryFiles: contentManifest.files.filter(f => f.type === "binary").length,
    },
    bucketConfigured: !!env?.CONTENT_BUCKET,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare?.env as Env | undefined;
  
  // Check authentication
  if (!isAuthenticated(request, env!)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Check R2 bucket
  const bucket = env?.CONTENT_BUCKET;
  if (!bucket) {
    return json({ 
      error: "R2 bucket not configured. Please complete the R2 setup first." 
    }, { status: 400 });
  }
  
  const formData = await request.formData();
  const action = formData.get("action");
  
  // Check existing files action
  if (action === "check") {
    try {
      const existingFiles: string[] = [];
      
      // Check a sample of files to see if content already exists
      const samplesToCheck = contentManifest.files.slice(0, 10);
      
      for (const file of samplesToCheck) {
        const head = await bucket.head(file.path);
        if (head) {
          existingFiles.push(file.path);
        }
      }
      
      return json({
        hasExistingContent: existingFiles.length > 0,
        sampledFiles: samplesToCheck.length,
        existingCount: existingFiles.length,
      });
    } catch (error) {
      return json({ 
        error: `Check failed: ${error instanceof Error ? error.message : "Unknown error"}` 
      }, { status: 500 });
    }
  }
  
  // Seed action - fetch from GitHub and upload to R2
  // Supports batching to avoid timeout - processes BATCH_SIZE files per request
  if (action === "seed") {
    const skipExisting = formData.get("skipExisting") !== "false";
    const startIndex = parseInt(formData.get("startIndex") as string || "0", 10);
    const BATCH_SIZE = 20; // Process 20 files per request to avoid timeout
    
    const totalFiles = contentManifest.files.length;
    const endIndex = Math.min(startIndex + BATCH_SIZE, totalFiles);
    const filesToProcess = contentManifest.files.slice(startIndex, endIndex);
    
    const results = {
      total: totalFiles,
      processed: startIndex,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
      hasMore: endIndex < totalFiles,
      nextIndex: endIndex,
    };
    
    try {
      for (const file of filesToProcess) {
        try {
          // Check if file exists (if skipping)
          if (skipExisting) {
            const existing = await bucket.head(file.path);
            if (existing) {
              results.skipped++;
              results.processed++;
              continue;
            }
          }
          
          // Fetch from GitHub
          const githubUrl = `${GITHUB_RAW_BASE}/${encodeURIComponent(file.path).replace(/%2F/g, "/")}`;
          const response = await fetch(githubUrl);
          
          if (!response.ok) {
            results.failed++;
            results.processed++;
            results.errors.push(`Failed to fetch ${file.path}: ${response.status}`);
            continue;
          }
          
          // Get content based on file type
          let content: ArrayBuffer | string;
          if (file.type === "binary") {
            content = await response.arrayBuffer();
          } else {
            content = await response.text();
          }
          
          // Upload to R2
          await bucket.put(file.path, content, {
            httpMetadata: {
              contentType: getMimeType(file.path),
            },
          });
          
          results.uploaded++;
          results.processed++;
        } catch (fileError) {
          results.failed++;
          results.processed++;
          results.errors.push(`Error processing ${file.path}: ${fileError instanceof Error ? fileError.message : "Unknown"}`);
        }
      }
      
      return json({
        success: true,
        results,
        message: results.hasMore 
          ? `Processed ${results.processed}/${totalFiles} files...`
          : `Seeded ${results.uploaded} files to R2 (${results.skipped} skipped, ${results.failed} failed)`,
      });
    } catch (error) {
      return json({
        success: false,
        error: `Seeding failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        results,
      }, { status: 500 });
    }
  }
  
  return json({ error: "Invalid action" }, { status: 400 });
}
