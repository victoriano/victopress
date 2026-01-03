#!/usr/bin/env bun
/**
 * Generate Content Manifest
 * 
 * Creates a manifest of all files in the content folder.
 * This manifest is used by the seed endpoint to fetch files from GitHub.
 * 
 * Run: bun run scripts/generate-content-manifest.ts
 */

import { readdir, stat, writeFile } from "fs/promises";
import { join } from "path";

interface ManifestFile {
  path: string;
  size: number;
  type: "text" | "binary";
}

interface ContentManifest {
  version: string;
  generatedAt: string;
  repo: string;
  branch: string;
  contentPath: string;
  files: ManifestFile[];
  totalSize: number;
  totalFiles: number;
}

const CONTENT_DIR = "./content";
const OUTPUT_FILE = "./app/data/content-manifest.json";
const REPO = "victoriano/victopress";
const BRANCH = "main";

// Text files (will be fetched as text)
const TEXT_EXTENSIONS = [".yaml", ".yml", ".md", ".json", ".html", ".css", ".txt"];

// Binary files (will be fetched as arraybuffer)
const BINARY_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"];

async function scanDirectory(dir: string, files: ManifestFile[], basePath: string = ""): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    // Skip hidden files and directories
    if (entry.name.startsWith(".")) continue;
    
    const fullPath = join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      // Recursively scan subdirectory
      await scanDirectory(fullPath, files, relativePath);
    } else {
      const stats = await stat(fullPath);
      const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
      
      let fileType: "text" | "binary" | null = null;
      
      if (TEXT_EXTENSIONS.includes(ext)) {
        fileType = "text";
      } else if (BINARY_EXTENSIONS.includes(ext)) {
        fileType = "binary";
      }
      
      if (fileType) {
        files.push({
          path: relativePath,
          size: stats.size,
          type: fileType,
        });
      }
    }
  }
}

async function main() {
  console.log("🔍 Scanning content directory...");
  
  const files: ManifestFile[] = [];
  await scanDirectory(CONTENT_DIR, files);
  
  // Sort files for consistent output
  files.sort((a, b) => a.path.localeCompare(b.path));
  
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  
  const manifest: ContentManifest = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    repo: REPO,
    branch: BRANCH,
    contentPath: "content",
    files,
    totalSize,
    totalFiles: files.length,
  };
  
  const textFiles = files.filter(f => f.type === "text");
  const binaryFiles = files.filter(f => f.type === "binary");
  
  console.log(`📦 Found ${files.length} files`);
  console.log(`   - Text files: ${textFiles.length} (${formatBytes(textFiles.reduce((s, f) => s + f.size, 0))})`);
  console.log(`   - Binary files: ${binaryFiles.length} (${formatBytes(binaryFiles.reduce((s, f) => s + f.size, 0))})`);
  console.log(`   - Total size: ${formatBytes(totalSize)}`);
  
  await writeFile(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  
  console.log(`✅ Generated ${OUTPUT_FILE}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main().catch(console.error);
