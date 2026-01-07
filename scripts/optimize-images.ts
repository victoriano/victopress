#!/usr/bin/env bun
/**
 * Image Optimization Script
 * 
 * Generates optimized WebP variants of all images in the content folder.
 * Creates 3 sizes for responsive loading (800w, 1600w, 2400w) optimized for
 * 5K displays and Retina MacBooks.
 * 
 * Usage:
 *   bun run scripts/optimize-images.ts              # Process all images
 *   bun run scripts/optimize-images.ts --dry-run    # Preview what would be done
 *   bun run scripts/optimize-images.ts --force      # Regenerate all variants
 * 
 * Output structure:
 *   photo.jpg → photo.jpg (original kept)
 *              photo_800w.webp  (mobile, thumbnails)
 *              photo_1600w.webp (desktop HD)
 *              photo_2400w.webp (Retina, 4K/5K)
 * 
 * Requires: bun add sharp
 */

import sharp from "sharp";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Configuration
const CONTENT_PATH = path.resolve("content");
// Responsive breakpoints optimized for 5K/Retina displays:
// - 800w: mobile, thumbnails, small screens
// - 1600w: desktop HD, tablets
// - 2400w: Retina displays, 4K/5K monitors
const WIDTHS = [800, 1600, 2400];
const QUALITY = 80; // WebP quality (0-100)
const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

interface ProcessResult {
  original: string;
  variants: string[];
  skipped: boolean;
  error?: string;
}

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");

async function getAllImages(dir: string): Promise<string[]> {
  const images: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          images.push(...await getAllImages(fullPath));
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        // Only process original images, skip already-optimized variants
        if (SUPPORTED_EXTENSIONS.includes(ext) && !entry.name.match(/_\d+w\.webp$/)) {
          images.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or not readable
  }
  
  return images;
}

async function variantExists(variantPath: string): Promise<boolean> {
  try {
    await fs.access(variantPath);
    return true;
  } catch {
    return false;
  }
}

async function processImage(imagePath: string): Promise<ProcessResult> {
  const dir = path.dirname(imagePath);
  const ext = path.extname(imagePath);
  const basename = path.basename(imagePath, ext);
  const variants: string[] = [];
  
  // Check if all variants already exist (skip if not forcing)
  if (!FORCE) {
    const allExist = await Promise.all(
      WIDTHS.map(w => variantExists(path.join(dir, `${basename}_${w}w.webp`)))
    );
    if (allExist.every(Boolean)) {
      return { original: imagePath, variants: [], skipped: true };
    }
  }
  
  if (DRY_RUN) {
    return {
      original: imagePath,
      variants: WIDTHS.map(w => path.join(dir, `${basename}_${w}w.webp`)),
      skipped: false,
    };
  }
  
  try {
    // Load the image once
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const originalWidth = metadata.width || 1600;
    
    // Generate each size variant
    for (const width of WIDTHS) {
      // Don't upscale images
      if (width > originalWidth) continue;
      
      const variantPath = path.join(dir, `${basename}_${width}w.webp`);
      
      // Skip if variant exists and not forcing
      if (!FORCE && await variantExists(variantPath)) {
        continue;
      }
      
      await sharp(imagePath)
        .resize(width, null, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: QUALITY })
        .toFile(variantPath);
      
      variants.push(variantPath);
    }
    
    return { original: imagePath, variants, skipped: false };
  } catch (err: any) {
    return { original: imagePath, variants: [], skipped: false, error: err.message };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  console.log("🖼️  Image Optimization Script\n");
  
  if (DRY_RUN) {
    console.log("📋 DRY RUN MODE - No files will be created\n");
  }
  if (FORCE) {
    console.log("🔄 FORCE MODE - Regenerating all variants\n");
  }
  
  console.log(`📁 Scanning: ${CONTENT_PATH}`);
  console.log(`📐 Sizes: ${WIDTHS.join(", ")}px`);
  console.log(`🎨 Quality: ${QUALITY}%\n`);
  
  // Find all images
  const images = await getAllImages(CONTENT_PATH);
  console.log(`Found ${images.length} images to process\n`);
  
  if (images.length === 0) {
    console.log("No images found!");
    return;
  }
  
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let totalVariants = 0;
  
  for (const imagePath of images) {
    const relativePath = path.relative(CONTENT_PATH, imagePath);
    const result = await processImage(imagePath);
    
    if (result.error) {
      console.log(`❌ ${relativePath}: ${result.error}`);
      errors++;
    } else if (result.skipped) {
      skipped++;
    } else if (result.variants.length > 0) {
      console.log(`✅ ${relativePath} → ${result.variants.length} variants`);
      totalVariants += result.variants.length;
      processed++;
    } else {
      skipped++;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("📊 Summary:");
  console.log(`   Images processed: ${processed}`);
  console.log(`   Variants created: ${totalVariants}`);
  console.log(`   Skipped (up-to-date): ${skipped}`);
  if (errors > 0) {
    console.log(`   Errors: ${errors}`);
  }
  
  if (DRY_RUN) {
    console.log("\n💡 Run without --dry-run to actually create the files");
  } else if (totalVariants > 0) {
    console.log("\n✨ Done! Don't forget to sync to R2:");
    console.log("   bun run sync-to-r2");
  }
}

main().catch(console.error);
