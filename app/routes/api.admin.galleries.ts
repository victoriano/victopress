/**
 * API - Admin Galleries CRUD
 * 
 * POST /api/admin/galleries - Create a new gallery
 * PATCH /api/admin/galleries - Update gallery metadata
 * DELETE /api/admin/galleries - Delete a gallery
 * POST /api/admin/galleries (action: move) - Move/rename a gallery
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage, invalidateContentIndex, updateGalleryMetadataInIndex } from "~/lib/content-engine";
import * as yaml from "yaml";

interface GalleryMetadata {
  title?: string;
  description?: string;
  cover?: string;
  date?: string;
  tags?: string[];
  order?: number;
  private?: boolean;
  password?: string;
  includeNestedPhotos?: boolean;
}

export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const actionType = formData.get("action") as string;
  
  switch (actionType) {
    case "create":
      return handleCreate(formData, context);
    case "update":
      return handleUpdate(formData, context);
    case "delete":
      return handleDelete(formData, context);
    case "move":
      return handleMove(formData, context);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

/**
 * Create a new gallery
 */
async function handleCreate(
  formData: FormData, 
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string | null;
  const parentSlug = formData.get("parentSlug") as string | null;
  
  if (!slug || !title) {
    return json({ success: false, error: "Slug and title are required" }, { status: 400 });
  }
  
  // Validate slug format (lowercase, alphanumeric, hyphens only)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return json({ 
      success: false, 
      error: "Slug must contain only lowercase letters, numbers, and hyphens" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  
  // Build the full path
  const galleryPath = parentSlug 
    ? `galleries/${parentSlug}/${slug}`
    : `galleries/${slug}`;
  
  // Check if gallery already exists
  const exists = await storage.exists(`${galleryPath}/gallery.yaml`);
  if (exists) {
    return json({ success: false, error: "Gallery already exists" }, { status: 400 });
  }
  
  // Check if folder already exists with photos
  const existingFiles = await storage.list(galleryPath);
  const hasPhotos = existingFiles.some(f => 
    !f.isDirectory && /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(f.name)
  );
  
  // Create gallery.yaml
  const metadata: GalleryMetadata = {
    title,
    ...(description && { description }),
  };
  
  const yamlContent = yaml.stringify(metadata);
  await storage.put(`${galleryPath}/gallery.yaml`, yamlContent);
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: hasPhotos 
      ? `Gallery "${title}" created with existing photos`
      : `Gallery "${title}" created successfully`,
    slug: parentSlug ? `${parentSlug}/${slug}` : slug,
    path: galleryPath,
  });
}

/**
 * Update gallery metadata
 */
async function handleUpdate(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  
  if (!slug) {
    return json({ success: false, error: "Gallery slug is required" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const galleryPath = `galleries/${slug}`;
  const yamlPath = `${galleryPath}/gallery.yaml`;
  
  // Get existing metadata
  let existingMetadata: GalleryMetadata = {};
  const existingYaml = await storage.getText(yamlPath);
  if (existingYaml) {
    try {
      existingMetadata = yaml.parse(existingYaml) || {};
    } catch {
      // Invalid YAML, start fresh
    }
  }
  
  // Parse update fields from form data
  const updateFields: Record<string, unknown> = {};
  
  for (const [key, value] of formData.entries()) {
    if (key === "action" || key === "slug") continue;
    
    // Handle special field types
    if (key === "order") {
      const num = parseInt(value as string, 10);
      if (!isNaN(num)) {
        updateFields[key] = num;
      } else if (value === "" || value === "null") {
        // Remove field if empty
        updateFields[key] = undefined;
      }
    } else if (key === "tags") {
      // Parse comma-separated tags
      const tags = (value as string).split(",").map(t => t.trim()).filter(Boolean);
      updateFields[key] = tags.length > 0 ? tags : undefined;
    } else if (key === "private" || key === "includeNestedPhotos") {
      updateFields[key] = value === "true";
    } else if (value === "" || value === "null") {
      // Remove field if empty
      updateFields[key] = undefined;
    } else {
      updateFields[key] = value;
    }
  }
  
  // Merge with existing metadata
  const newMetadata: Record<string, unknown> = { ...existingMetadata };
  
  for (const [key, value] of Object.entries(updateFields)) {
    if (value === undefined) {
      delete newMetadata[key];
    } else {
      newMetadata[key] = value;
    }
  }
  
  // Write updated YAML
  const yamlContent = yaml.stringify(newMetadata);
  await storage.put(yamlPath, yamlContent);
  
  // Fast index update - only update this gallery's metadata, don't rebuild everything
  const indexResult = await updateGalleryMetadataInIndex(storage, galleryPath, {
    title: newMetadata.title as string | undefined,
    description: newMetadata.description as string | undefined,
    order: newMetadata.order as number | undefined,
    private: newMetadata.private as boolean | undefined,
    password: newMetadata.password as string | undefined,
    tags: newMetadata.tags as string[] | undefined,
    includeNestedPhotos: newMetadata.includeNestedPhotos as boolean | undefined,
  });
  
  console.log(`[Gallery Update] ${slug}: ${indexResult.message}`);
  
  return json({
    success: true,
    message: "Gallery updated successfully",
    slug,
  });
}

/**
 * Delete a gallery and all its contents
 */
async function handleDelete(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  const confirmDelete = formData.get("confirm") === "true";
  
  if (!slug) {
    return json({ success: false, error: "Gallery slug is required" }, { status: 400 });
  }
  
  if (!confirmDelete) {
    return json({ success: false, error: "Delete confirmation required" }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const galleryPath = `galleries/${slug}`;
  
  // Check gallery exists
  const files = await storage.list(galleryPath);
  if (files.length === 0) {
    return json({ success: false, error: "Gallery not found" }, { status: 404 });
  }
  
  // Delete the entire gallery directory
  const result = await storage.deleteDirectory(galleryPath);
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: `Gallery deleted successfully (${result.deleted} files removed)`,
    deleted: result.deleted,
  });
}

/**
 * Move/rename a gallery
 */
async function handleMove(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const fromSlug = formData.get("fromSlug") as string;
  const toSlug = formData.get("toSlug") as string;
  
  if (!fromSlug || !toSlug) {
    return json({ 
      success: false, 
      error: "Source and destination slugs are required" 
    }, { status: 400 });
  }
  
  // Validate slug format
  const slugParts = toSlug.split("/");
  for (const part of slugParts) {
    if (!/^[a-z0-9-]+$/.test(part)) {
      return json({ 
        success: false, 
        error: "Slug must contain only lowercase letters, numbers, and hyphens" 
      }, { status: 400 });
    }
  }
  
  const storage = getStorage(context);
  const fromPath = `galleries/${fromSlug}`;
  const toPath = `galleries/${toSlug}`;
  
  // Check source exists
  const sourceFiles = await storage.listRecursive(fromPath);
  if (sourceFiles.length === 0) {
    return json({ success: false, error: "Source gallery not found" }, { status: 404 });
  }
  
  // Check destination doesn't exist
  const destFiles = await storage.list(toPath);
  if (destFiles.length > 0) {
    return json({ success: false, error: "Destination gallery already exists" }, { status: 400 });
  }
  
  // Move all files
  let movedCount = 0;
  for (const file of sourceFiles) {
    const newPath = file.path.replace(fromPath, toPath);
    await storage.move(file.path, newPath);
    movedCount++;
  }
  
  // Update gallery.yaml slug if present
  const yamlPath = `${toPath}/gallery.yaml`;
  const yamlContent = await storage.getText(yamlPath);
  if (yamlContent) {
    try {
      const metadata = yaml.parse(yamlContent) as GalleryMetadata;
      // Update slug in metadata if it was explicitly set
      if (metadata.title && !metadata.title.includes("/")) {
        // Keep the original title
      }
      // Save updated YAML (even if no changes, ensures proper formatting)
      await storage.put(yamlPath, yaml.stringify(metadata));
    } catch {
      // YAML parsing failed, ignore
    }
  }
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: `Gallery moved successfully (${movedCount} files)`,
    newSlug: toSlug,
    moved: movedCount,
  });
}

export function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
