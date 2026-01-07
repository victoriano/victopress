/**
 * API - Admin Photos CRUD
 * 
 * DELETE /api/admin/photos - Delete photo(s)
 * PATCH /api/admin/photos - Update photo metadata
 * POST /api/admin/photos (action: move) - Move photos between galleries
 * POST /api/admin/photos (action: reorder) - Reorder photos in gallery
 * POST /api/admin/photos (action: toggle-visibility) - Toggle hidden status
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { 
  getStorage, 
  invalidateContentIndex,
  updateGalleryPhotosInIndex,
  addPhotosToGalleryIndex,
  type GalleryPhotoEntry,
} from "~/lib/content-engine";
// Helper functions that don't need Jimp
function isVariantFile(filename: string): boolean {
  return /_\d+w\.webp$/.test(filename);
}

function getAllVariantFilenames(originalFilename: string): string[] {
  // Must match VARIANT_WIDTHS in image-optimizer.server.ts
  const widths = [800, 1600, 2400];
  const dotIndex = originalFilename.lastIndexOf(".");
  const nameWithoutExt = dotIndex >= 0 
    ? originalFilename.substring(0, dotIndex) 
    : originalFilename;
  return widths.map(w => `${nameWithoutExt}_${w}w.webp`);
}
import * as yaml from "yaml";

// Must match PhotoYamlEntry in gallery-scanner.ts
interface PhotoMetadata {
  filename: string;  // NOT "file" - scanner expects "filename"
  title?: string;
  description?: string;
  tags?: string[];
  order?: number;
  hidden?: boolean;
  featured?: boolean;
  date?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  
  switch (actionType) {
    case "delete":
      return handleDelete(formData, context);
    case "update":
      return handleUpdate(formData, context);
    case "move":
      return handleMove(formData, context);
    case "reorder":
      return handleReorder(formData, context);
    case "toggle-visibility":
      return handleToggleVisibility(formData, context);
    case "bulk-update":
      return handleBulkUpdate(formData, context);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

/**
 * Delete one or more photos (and their WebP variants)
 */
async function handleDelete(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const galleryPath = formData.get("galleryPath") as string;
  const photoPaths = formData.getAll("photoPaths") as string[];
  
  if (!galleryPath || photoPaths.length === 0) {
    return json({ 
      success: false, 
      error: "Gallery path and photo paths are required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  // Delete each photo and its variants
  const results: Array<{ path: string; success: boolean; error?: string; variantsDeleted?: number }> = [];
  
  for (const photoPath of photoPaths) {
    try {
      // Ensure the photo is within the gallery (security check)
      if (!photoPath.startsWith(galleryPath)) {
        results.push({ path: photoPath, success: false, error: "Invalid path" });
        continue;
      }
      
      // Delete the original
      await storage.delete(photoPath);
      
      // Delete WebP variants (photo_400w.webp, photo_800w.webp, etc.)
      const filename = photoPath.split("/").pop()!;
      
      // Skip if this is already a variant file
      if (!isVariantFile(filename)) {
        const variantFilenames = getAllVariantFilenames(filename);
        const dir = photoPath.substring(0, photoPath.lastIndexOf("/"));
        let variantsDeleted = 0;
        
        for (const variantFilename of variantFilenames) {
          const variantPath = `${dir}/${variantFilename}`;
          try {
            await storage.delete(variantPath);
            variantsDeleted++;
          } catch {
            // Variant might not exist, that's fine
          }
        }
        
        results.push({ path: photoPath, success: true, variantsDeleted });
      } else {
        results.push({ path: photoPath, success: true });
      }
    } catch (err) {
      results.push({ 
        path: photoPath, 
        success: false, 
        error: err instanceof Error ? err.message : "Failed to delete" 
      });
    }
  }
  
  // Update photos.yaml if it exists
  await removePhotosFromYaml(storage, galleryPath, photoPaths);
  
  // Update content index (fast partial update - remove deleted photos)
  const deletedFilenames = new Set(
    results.filter(r => r.success).map(r => r.path.split("/").pop()!)
  );
  await updateGalleryPhotosInIndex(storage, galleryPath, (photos) => {
    return photos.filter(p => !deletedFilenames.has(p.filename));
  });
  
  const successCount = results.filter(r => r.success).length;
  const totalVariantsDeleted = results.reduce((sum, r) => sum + (r.variantsDeleted || 0), 0);
  
  return json({
    success: successCount > 0,
    message: `Deleted ${successCount} photo${successCount !== 1 ? 's' : ''}${totalVariantsDeleted > 0 ? ` (+ ${totalVariantsDeleted} variants)` : ''}`,
    results,
  });
}

/**
 * Update photo metadata
 */
async function handleUpdate(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const galleryPath = formData.get("galleryPath") as string;
  const photoPath = formData.get("photoPath") as string;
  const filename = formData.get("filename") as string;
  
  if (!galleryPath || !photoPath || !filename) {
    return json({ 
      success: false, 
      error: "Gallery path, photo path, and filename are required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  // Parse update fields
  const updates: Partial<PhotoMetadata> = {};
  
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const tagsStr = formData.get("tags") as string | null;
  const orderStr = formData.get("order") as string | null;
  const hidden = formData.get("hidden");
  const featured = formData.get("featured");
  const date = formData.get("date") as string | null;
  
  if (title !== null) updates.title = title || undefined;
  if (description !== null) updates.description = description || undefined;
  if (tagsStr !== null) {
    const tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
    updates.tags = tags.length > 0 ? tags : undefined;
  }
  if (orderStr !== null) {
    const order = parseInt(orderStr, 10);
    updates.order = !isNaN(order) ? order : undefined;
  }
  if (hidden !== null) updates.hidden = hidden === "true";
  if (featured !== null) updates.featured = featured === "true";
  if (date !== null) updates.date = date || undefined;
  
  // Update photos.yaml
  await updatePhotoInYaml(storage, galleryPath, filename, updates);
  
  // Update content index (fast partial update)
  await updateGalleryPhotosInIndex(storage, galleryPath, (photos) => {
    return photos.map(p => {
      if (p.filename !== filename) return p;
      return {
        ...p,
        title: updates.title ?? p.title,
        description: updates.description ?? p.description,
        tags: updates.tags ?? p.tags,
        order: updates.order ?? p.order,
        hidden: updates.hidden ?? p.hidden,
      };
    });
  });
  
  return json({
    success: true,
    message: "Photo updated successfully",
    filename,
  });
}

/**
 * Move photos between galleries
 */
async function handleMove(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const fromPath = formData.get("fromGalleryPath") as string;
  const toPath = formData.get("toGalleryPath") as string;
  const photoPaths = formData.getAll("photoPaths") as string[];
  
  if (!fromPath || !toPath || photoPaths.length === 0) {
    return json({ 
      success: false, 
      error: "Source gallery path, destination gallery path, and photo paths are required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  // Check destination exists
  const destFiles = await storage.list(toPath);
  if (destFiles.length === 0) {
    return json({ success: false, error: "Destination gallery not found" }, { status: 404 });
  }
  
  // Move each photo
  const results: Array<{ path: string; success: boolean; newPath?: string; error?: string }> = [];
  
  for (const photoPath of photoPaths) {
    try {
      // Security check
      if (!photoPath.startsWith(fromPath)) {
        results.push({ path: photoPath, success: false, error: "Invalid path" });
        continue;
      }
      
      const filename = photoPath.split("/").pop()!;
      const newPath = `${toPath}/${filename}`;
      
      // Check if file exists at destination
      if (await storage.exists(newPath)) {
        results.push({ path: photoPath, success: false, error: "File already exists in destination" });
        continue;
      }
      
      await storage.move(photoPath, newPath);
      results.push({ path: photoPath, success: true, newPath });
    } catch (err) {
      results.push({ 
        path: photoPath, 
        success: false, 
        error: err instanceof Error ? err.message : "Failed to move" 
      });
    }
  }
  
  // Update photos.yaml in both galleries
  const movedPhotos = results.filter(r => r.success).map(r => r.path);
  if (movedPhotos.length > 0) {
    await removePhotosFromYaml(storage, fromPath, movedPhotos);
  }
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  const successCount = results.filter(r => r.success).length;
  
  return json({
    success: successCount > 0,
    message: `Moved ${successCount} of ${photoPaths.length} photos`,
    results,
  });
}

/**
 * Reorder photos in a gallery
 * Note: photos.yaml is a PLAIN ARRAY (not { photos: [...] })
 */
async function handleReorder(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const galleryPath = formData.get("galleryPath") as string;
  const orderJson = formData.get("order") as string;
  
  if (!galleryPath || !orderJson) {
    return json({ 
      success: false, 
      error: "Gallery path and order are required" 
    }, { status: 400 });
  }
  
  let order: string[];
  try {
    order = JSON.parse(orderJson);
    if (!Array.isArray(order)) {
      throw new Error("Order must be an array");
    }
  } catch {
    return json({ success: false, error: "Invalid order format" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const yamlPath = `${galleryPath}/photos.yaml`;
  
  // Get or create photos.yaml (plain array format)
  let photosArray: PhotoMetadata[] = [];
  const existingYaml = await storage.getText(yamlPath);
  
  if (existingYaml) {
    try {
      const parsed = yaml.parse(existingYaml);
      // Handle both formats: plain array or { photos: [...] }
      if (Array.isArray(parsed)) {
        photosArray = parsed;
      } else if (parsed && Array.isArray(parsed.photos)) {
        photosArray = parsed.photos;
      }
    } catch {
      // Invalid YAML, start fresh
    }
  }
  
  // Create a map of existing photo metadata
  const metadataMap = new Map<string, PhotoMetadata>();
  for (const photo of photosArray) {
    metadataMap.set(photo.filename, photo);
  }
  
  // Rebuild photos array in new order with order values
  const newPhotos: PhotoMetadata[] = [];
  
  for (let i = 0; i < order.length; i++) {
    const filename = order[i];
    const existing = metadataMap.get(filename);
    
    newPhotos.push({
      filename,
      ...existing,
      order: i + 1, // 1-indexed order
    });
  }
  
  // Write updated photos.yaml as plain array
  await storage.put(yamlPath, yaml.stringify(newPhotos));
  
  // Update content index (fast partial update, doesn't re-read images)
  await updateGalleryPhotosInIndex(storage, galleryPath, (photos) => {
    // Update order in index based on new YAML
    return photos.map(p => {
      const newOrder = order.indexOf(p.filename);
      return {
        ...p,
        order: newOrder >= 0 ? newOrder + 1 : p.order,
      };
    }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  });
  
  return json({
    success: true,
    message: `Reordered ${order.length} photos`,
    count: order.length,
  });
}

/**
 * Toggle hidden status for photos
 */
async function handleToggleVisibility(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const galleryPath = formData.get("galleryPath") as string;
  const photoPaths = formData.getAll("photoPaths") as string[];
  const hidden = formData.get("hidden") === "true";
  
  if (!galleryPath || photoPaths.length === 0) {
    return json({ 
      success: false, 
      error: "Gallery path and photo paths are required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  // Extract filenames and update photos.yaml
  const filenames = photoPaths.map(p => p.split("/").pop()!);
  const filenameSet = new Set(filenames);
  
  for (const filename of filenames) {
    await updatePhotoInYaml(storage, galleryPath, filename, { hidden });
  }
  
  // Update content index (fast partial update)
  await updateGalleryPhotosInIndex(storage, galleryPath, (photos) => {
    return photos.map(p => ({
      ...p,
      hidden: filenameSet.has(p.filename) ? hidden : p.hidden,
    }));
  });
  
  return json({
    success: true,
    message: `${hidden ? "Hidden" : "Shown"} ${filenames.length} photos`,
    count: filenames.length,
  });
}

/**
 * Bulk update photos (tags, featured, etc.)
 * Note: photos.yaml is a PLAIN ARRAY (not { photos: [...] })
 */
async function handleBulkUpdate(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const galleryPath = formData.get("galleryPath") as string;
  const photoPaths = formData.getAll("photoPaths") as string[];
  
  if (!galleryPath || photoPaths.length === 0) {
    return json({ 
      success: false, 
      error: "Gallery path and photo paths are required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  const addTags = formData.get("addTags") as string | null;
  const removeTags = formData.get("removeTags") as string | null;
  const featured = formData.get("featured");
  
  // Extract filenames
  const filenames = photoPaths.map(p => p.split("/").pop()!);
  
  // Get current photos.yaml (plain array format)
  const yamlPath = `${galleryPath}/photos.yaml`;
  let photosArray: PhotoMetadata[] = [];
  const existingYaml = await storage.getText(yamlPath);
  
  if (existingYaml) {
    try {
      const parsed = yaml.parse(existingYaml);
      // Handle both formats: plain array or { photos: [...] }
      if (Array.isArray(parsed)) {
        photosArray = parsed;
      } else if (parsed && Array.isArray(parsed.photos)) {
        photosArray = parsed.photos;
      }
    } catch {
      // Invalid YAML, start fresh
    }
  }
  
  // Create a map of existing metadata
  const metadataMap = new Map<string, PhotoMetadata>();
  for (const photo of photosArray) {
    metadataMap.set(photo.filename, photo);
  }
  
  // Update each photo
  for (const filename of filenames) {
    const existing = metadataMap.get(filename) || { filename };
    const existingTags = new Set(existing.tags || []);
    
    // Add tags
    if (addTags) {
      const tagsToAdd = addTags.split(",").map(t => t.trim()).filter(Boolean);
      for (const tag of tagsToAdd) {
        existingTags.add(tag);
      }
    }
    
    // Remove tags
    if (removeTags) {
      const tagsToRemove = removeTags.split(",").map(t => t.trim()).filter(Boolean);
      for (const tag of tagsToRemove) {
        existingTags.delete(tag);
      }
    }
    
    // Update tags
    const newTags = Array.from(existingTags);
    existing.tags = newTags.length > 0 ? newTags : undefined;
    
    // Update featured
    if (featured !== null) {
      existing.featured = featured === "true";
    }
    
    metadataMap.set(filename, existing);
  }
  
  // Rebuild photos array
  const newPhotos = Array.from(metadataMap.values());
  
  // Write updated photos.yaml as plain array
  await storage.put(yamlPath, yaml.stringify(newPhotos));
  
  // Update content index (fast partial update)
  const filenameSet = new Set(filenames);
  await updateGalleryPhotosInIndex(storage, galleryPath, (photos) => {
    return photos.map(p => {
      if (!filenameSet.has(p.filename)) return p;
      const meta = metadataMap.get(p.filename);
      return {
        ...p,
        tags: meta?.tags ?? p.tags,
      };
    });
  });
  
  return json({
    success: true,
    message: `Updated ${filenames.length} photos`,
    count: filenames.length,
  });
}

/**
 * Helper: Update a photo in photos.yaml
 * Note: photos.yaml is a PLAIN ARRAY (not { photos: [...] })
 */
async function updatePhotoInYaml(
  storage: ReturnType<typeof getStorage>,
  galleryPath: string,
  filename: string,
  updates: Partial<PhotoMetadata>
) {
  const yamlPath = `${galleryPath}/photos.yaml`;
  
  // Get or create photos.yaml (it's a plain array, not { photos: [...] })
  let photosArray: PhotoMetadata[] = [];
  const existingYaml = await storage.getText(yamlPath);
  
  if (existingYaml) {
    try {
      const parsed = yaml.parse(existingYaml);
      // Handle both formats: plain array or { photos: [...] }
      if (Array.isArray(parsed)) {
        photosArray = parsed;
      } else if (parsed && Array.isArray(parsed.photos)) {
        // Legacy format, convert to array
        photosArray = parsed.photos;
      }
    } catch {
      // Invalid YAML, start fresh
    }
  }
  
  // Find or create photo entry
  let photoIndex = photosArray.findIndex(p => p.filename === filename);
  
  if (photoIndex === -1) {
    // Add new entry
    photosArray.push({ filename, ...updates });
  } else {
    // Update existing entry
    const existing = photosArray[photoIndex];
    photosArray[photoIndex] = { ...existing, ...updates };
    
    // Clean up undefined values
    const cleaned = Object.fromEntries(
      Object.entries(photosArray[photoIndex])
        .filter(([_, v]) => v !== undefined)
    ) as PhotoMetadata;
    photosArray[photoIndex] = cleaned;
  }
  
  // Write updated YAML as plain array
  await storage.put(yamlPath, yaml.stringify(photosArray));
}

/**
 * Helper: Remove photos from photos.yaml
 * Note: photos.yaml is a PLAIN ARRAY (not { photos: [...] })
 */
async function removePhotosFromYaml(
  storage: ReturnType<typeof getStorage>,
  galleryPath: string,
  photoPaths: string[]
) {
  const yamlPath = `${galleryPath}/photos.yaml`;
  const existingYaml = await storage.getText(yamlPath);
  
  if (!existingYaml) return;
  
  try {
    const parsed = yaml.parse(existingYaml);
    
    // Handle both formats: plain array or { photos: [...] }
    let photosArray: PhotoMetadata[] = [];
    if (Array.isArray(parsed)) {
      photosArray = parsed;
    } else if (parsed && Array.isArray(parsed.photos)) {
      photosArray = parsed.photos;
    } else {
      return; // Invalid format
    }
    
    // Extract filenames from paths
    const filenames = new Set(photoPaths.map(p => p.split("/").pop()!));
    
    // Filter out deleted photos
    photosArray = photosArray.filter(p => !filenames.has(p.filename));
    
    // Write updated YAML as plain array
    await storage.put(yamlPath, yaml.stringify(photosArray));
  } catch {
    // YAML parsing failed, ignore
  }
}

export function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
