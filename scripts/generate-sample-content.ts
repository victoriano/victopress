#!/usr/bin/env bun
/**
 * Generate Sample Content JSON
 * 
 * This script scans the content folder and generates a JSON file
 * that can be bundled with the app for demo mode.
 * 
 * Run: bun run scripts/generate-sample-content.ts
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { writeFile } from "fs/promises";

interface BundledFile {
  path: string;
  content: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

const CONTENT_DIR = "./content";
const OUTPUT_FILE = "./app/data/sample-content.json";

// File extensions to include (text files that we can read)
const TEXT_EXTENSIONS = [".yaml", ".yml", ".md", ".json", ".html", ".css", ".txt"];

// Note: Images are NOT bundled (to keep size small for Cloudflare Workers)
// Only image metadata (path, size) is included - actual images served from R2

// Image extensions (for reference/listing only, not bundled)
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];

async function scanDirectory(dir: string, files: BundledFile[], basePath: string = ""): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const stats = await stat(fullPath);
    
    if (entry.isDirectory()) {
      // Add directory entry
      files.push({
        path: relativePath,
        content: "",
        size: 0,
        lastModified: stats.mtime.toISOString(),
        isDirectory: true,
      });
      
      // Recursively scan subdirectory
      await scanDirectory(fullPath, files, relativePath);
    } else {
      const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
      
      if (TEXT_EXTENSIONS.includes(ext)) {
        // Read text file content (YAML, MD, etc.)
        const content = await readFile(fullPath, "utf-8");
        files.push({
          path: relativePath,
          content,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          isDirectory: false,
        });
      } else if (IMAGE_EXTENSIONS.includes(ext)) {
        // For images: only store metadata (path, size), not content
        // This keeps the bundle small - images are served from R2 in production
        files.push({
          path: relativePath,
          content: "", // Empty - no base64 data
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          isDirectory: false,
        });
      }
    }
  }
}

async function main() {
  console.log("🔍 Scanning content directory...");
  
  const files: BundledFile[] = [];
  await scanDirectory(CONTENT_DIR, files);
  
  const output = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    files,
  };
  
  const imageFiles = files.filter(f => IMAGE_EXTENSIONS.some(ext => f.path.toLowerCase().endsWith(ext)));
  
  console.log(`📦 Found ${files.length} files/directories`);
  console.log(`   - Directories: ${files.filter(f => f.isDirectory).length}`);
  console.log(`   - Text files: ${files.filter(f => !f.isDirectory && !IMAGE_EXTENSIONS.some(ext => f.path.toLowerCase().endsWith(ext))).length}`);
  console.log(`   - Images: ${imageFiles.length} (metadata only, no base64)`);
  
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  const outputStats = await stat(OUTPUT_FILE);
  console.log(`✅ Generated ${OUTPUT_FILE} (${(outputStats.size / 1024).toFixed(1)} KB)`);
}

main().catch(console.error);
