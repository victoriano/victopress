/**
 * API - Admin Blog CRUD
 * 
 * POST /api/admin/blog (action: create) - Create new blog post
 * POST /api/admin/blog (action: update) - Update blog post
 * POST /api/admin/blog (action: delete) - Delete blog post
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { getStorage, invalidateContentIndex } from "~/lib/content-engine";
import * as yaml from "yaml";

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
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

/**
 * Create a new blog post
 */
async function handleCreate(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  const title = formData.get("title") as string;
  
  if (!slug || !title) {
    return json({ 
      success: false, 
      error: "Slug and title are required" 
    }, { status: 400 });
  }
  
  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(slug)) {
    return json({ 
      success: false, 
      error: "Slug must contain only lowercase letters, numbers, and hyphens" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const postPath = `blog/${slug}`;
  const indexPath = `${postPath}/index.md`;
  
  // Check if post already exists
  const exists = await storage.exists(indexPath);
  if (exists) {
    return json({ 
      success: false, 
      error: "A post with this slug already exists" 
    }, { status: 400 });
  }
  
  // Build frontmatter
  const frontmatter: Record<string, any> = {
    title,
    date: new Date().toISOString().split("T")[0],
    draft: true,
  };
  
  const description = formData.get("description") as string | null;
  if (description) frontmatter.description = description;
  
  const tagsStr = formData.get("tags") as string | null;
  if (tagsStr) {
    const tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
    if (tags.length > 0) frontmatter.tags = tags;
  }
  
  // Create content
  const content = formData.get("content") as string || `# ${title}\n\nStart writing your post here...`;
  const fileContent = `---\n${yaml.stringify(frontmatter)}---\n\n${content}`;
  
  // Create directory and file
  await storage.createDir(postPath);
  await storage.put(indexPath, fileContent);
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: "Blog post created",
    slug,
  });
}

/**
 * Update an existing blog post
 */
async function handleUpdate(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  
  if (!slug) {
    return json({ 
      success: false, 
      error: "Slug is required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const indexPath = `blog/${slug}/index.md`;
  
  // Check if post exists
  const existingContent = await storage.getText(indexPath);
  if (!existingContent) {
    return json({ 
      success: false, 
      error: "Post not found" 
    }, { status: 404 });
  }
  
  // Parse existing frontmatter
  const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let frontmatter: Record<string, any> = {};
  let content = "";
  
  if (frontmatterMatch) {
    try {
      frontmatter = yaml.parse(frontmatterMatch[1]) || {};
      content = frontmatterMatch[2];
    } catch {
      // Invalid YAML, start fresh
    }
  } else {
    content = existingContent;
  }
  
  // Update fields if provided
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const date = formData.get("date") as string | null;
  const tagsStr = formData.get("tags") as string | null;
  const draft = formData.get("draft");
  const newContent = formData.get("content") as string | null;
  const author = formData.get("author") as string | null;
  
  if (title !== null) frontmatter.title = title || "Untitled";
  if (description !== null) frontmatter.description = description || undefined;
  if (date !== null) frontmatter.date = date || undefined;
  if (author !== null) frontmatter.author = author || undefined;
  if (draft !== null) frontmatter.draft = draft === "true";
  
  if (tagsStr !== null) {
    const tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
    frontmatter.tags = tags.length > 0 ? tags : undefined;
  }
  
  if (newContent !== null) {
    content = newContent;
  }
  
  // Clean up undefined values
  Object.keys(frontmatter).forEach(key => {
    if (frontmatter[key] === undefined) {
      delete frontmatter[key];
    }
  });
  
  // Build new file content
  const fileContent = `---\n${yaml.stringify(frontmatter)}---\n\n${content.trim()}\n`;
  
  // Save file
  await storage.put(indexPath, fileContent);
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: "Blog post updated",
    slug,
  });
}

/**
 * Delete a blog post
 */
async function handleDelete(
  formData: FormData,
  context: { cloudflare?: { env?: Record<string, unknown> } }
) {
  const slug = formData.get("slug") as string;
  
  if (!slug) {
    return json({ 
      success: false, 
      error: "Slug is required" 
    }, { status: 400 });
  }
  
  const storage = getStorage(context);
  const postPath = `blog/${slug}`;
  
  // Check if post exists
  const exists = await storage.exists(`${postPath}/index.md`);
  if (!exists) {
    return json({ 
      success: false, 
      error: "Post not found" 
    }, { status: 404 });
  }
  
  // Delete the entire post directory
  await storage.deleteDir(postPath);
  
  // Invalidate content index
  await invalidateContentIndex(storage);
  
  return json({
    success: true,
    message: "Blog post deleted",
    slug,
  });
}
