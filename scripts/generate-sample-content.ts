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

// File extensions for binary files (images) - these will be base64 encoded
const BINARY_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];

// Maximum file size for images to include (500KB)
const MAX_IMAGE_SIZE = 500 * 1024;

// Maximum number of images per gallery to include
const MAX_IMAGES_PER_GALLERY = 3;

async function scanDirectory(dir: string, files: BundledFile[], basePath: string = ""): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  // Track images per gallery
  let imageCount = 0;
  
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
        // Read text file
        const content = await readFile(fullPath, "utf-8");
        files.push({
          path: relativePath,
          content,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          isDirectory: false,
        });
      } else if (BINARY_EXTENSIONS.includes(ext)) {
        // Include limited images as base64
        if (imageCount < MAX_IMAGES_PER_GALLERY && stats.size <= MAX_IMAGE_SIZE) {
          const buffer = await readFile(fullPath);
          const base64 = buffer.toString("base64");
          files.push({
            path: relativePath,
            content: base64,
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            isDirectory: false,
          });
          imageCount++;
        }
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
  
  console.log(`📦 Found ${files.length} files/directories`);
  console.log(`   - Directories: ${files.filter(f => f.isDirectory).length}`);
  console.log(`   - Text files: ${files.filter(f => !f.isDirectory && !BINARY_EXTENSIONS.some(ext => f.path.toLowerCase().endsWith(ext))).length}`);
  console.log(`   - Images: ${files.filter(f => BINARY_EXTENSIONS.some(ext => f.path.toLowerCase().endsWith(ext))).length}`);
  
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  const outputStats = await stat(OUTPUT_FILE);
  console.log(`✅ Generated ${OUTPUT_FILE} (${(outputStats.size / 1024).toFixed(1)} KB)`);
}

main().catch(console.error);
