/**
 * API - Storage Configuration
 * 
 * POST /api/storage-config
 * Actions: test-token, list-buckets, create-bucket, save-config, test-connection, switch-adapter
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { checkAdminAuth } from "~/utils/admin-auth";
import { isDevelopment } from "~/lib/content-engine";

interface CloudflareTokenInfo {
  id: string;
  name: string;
  status: string;
}

interface R2Bucket {
  name: string;
  creation_date: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  checkAdminAuth(request, context.cloudflare?.env || {});
  
  const formData = await request.formData();
  const action = formData.get("action") as string;
  
  switch (action) {
    case "test-token":
      return handleTestToken(formData);
    case "list-buckets":
      return handleListBuckets(formData);
    case "create-bucket":
      return handleCreateBucket(formData);
    case "save-config":
      return handleSaveConfig(formData, context);
    case "test-connection":
      return handleTestConnection(formData);
    case "switch-adapter":
      return handleSwitchAdapter(formData);
    default:
      return json({ success: false, error: "Unknown action" }, { status: 400 });
  }
}

async function handleTestToken(formData: FormData) {
  const apiToken = formData.get("apiToken") as string;
  
  if (!apiToken) {
    return json({ success: false, error: "API Token is required" });
  }
  
  try {
    // Verify token with Cloudflare API
    const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });
    
    const data = await response.json() as { success: boolean; result?: CloudflareTokenInfo; errors?: Array<{ message: string }> };
    
    if (!data.success) {
      return json({ 
        success: false, 
        error: data.errors?.[0]?.message || "Invalid token" 
      });
    }
    
    // Get account info
    const accountsResponse = await fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });
    
    const accountsData = await accountsResponse.json() as { 
      success: boolean; 
      result?: Array<{ id: string; name: string }>;
      errors?: Array<{ message: string }>;
    };
    
    if (!accountsData.success || !accountsData.result?.length) {
      return json({ 
        success: false, 
        error: "Could not retrieve account information. Make sure your token has account access." 
      });
    }
    
    return json({
      success: true,
      tokenInfo: data.result,
      accounts: accountsData.result,
    });
  } catch (error) {
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to verify token" 
    });
  }
}

async function handleListBuckets(formData: FormData) {
  const apiToken = formData.get("apiToken") as string;
  const accountId = formData.get("accountId") as string;
  
  if (!apiToken || !accountId) {
    return json({ success: false, error: "API Token and Account ID are required" });
  }
  
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
      {
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    
    const data = await response.json() as { 
      success: boolean; 
      result?: { buckets: R2Bucket[] };
      errors?: Array<{ message: string }>;
    };
    
    if (!data.success) {
      return json({ 
        success: false, 
        error: data.errors?.[0]?.message || "Failed to list buckets" 
      });
    }
    
    return json({
      success: true,
      buckets: data.result?.buckets || [],
    });
  } catch (error) {
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to list buckets" 
    });
  }
}

async function handleCreateBucket(formData: FormData) {
  const apiToken = formData.get("apiToken") as string;
  const accountId = formData.get("accountId") as string;
  const bucketName = formData.get("bucketName") as string;
  
  if (!apiToken || !accountId || !bucketName) {
    return json({ success: false, error: "API Token, Account ID, and Bucket Name are required" });
  }
  
  // Validate bucket name
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName)) {
    return json({ 
      success: false, 
      error: "Bucket name must be 3-63 characters, lowercase letters, numbers, and hyphens only" 
    });
  }
  
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: bucketName }),
      }
    );
    
    const data = await response.json() as { 
      success: boolean; 
      result?: R2Bucket;
      errors?: Array<{ message: string }>;
    };
    
    if (!data.success) {
      return json({ 
        success: false, 
        error: data.errors?.[0]?.message || "Failed to create bucket" 
      });
    }
    
    return json({
      success: true,
      bucket: data.result,
      message: `Bucket "${bucketName}" created successfully!`,
    });
  } catch (error) {
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to create bucket" 
    });
  }
}

async function handleSaveConfig(formData: FormData, context: { cloudflare?: { env?: Record<string, unknown> } }) {
  const accountId = formData.get("accountId") as string;
  const bucketName = formData.get("bucketName") as string;
  const publicUrl = formData.get("publicUrl") as string || "";
  
  if (!accountId || !bucketName) {
    return json({ success: false, error: "Account ID and Bucket Name are required" });
  }
  
  const isDevMode = isDevelopment();
  
  if (isDevMode) {
    // In development, we can write to .dev.vars
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      
      const devVarsPath = path.join(process.cwd(), ".dev.vars");
      
      // Read existing .dev.vars
      let existingContent = "";
      try {
        existingContent = await fs.readFile(devVarsPath, "utf-8");
      } catch {
        // File doesn't exist, that's fine
      }
      
      // Parse existing vars
      const existingVars: Record<string, string> = {};
      for (const line of existingContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key) {
            existingVars[key] = valueParts.join("=");
          }
        }
      }
      
      // Update R2 configuration
      existingVars["R2_ACCOUNT_ID"] = accountId;
      existingVars["R2_BUCKET_NAME"] = bucketName;
      if (publicUrl) {
        existingVars["R2_PUBLIC_URL"] = publicUrl;
      }
      
      // Write back to .dev.vars
      const newContent = [
        "# Admin credentials for local development",
        `ADMIN_USERNAME=${existingVars["ADMIN_USERNAME"] || "admin"}`,
        `ADMIN_PASSWORD=${existingVars["ADMIN_PASSWORD"] || "admin123"}`,
        "",
        "# R2 Storage Configuration",
        `R2_ACCOUNT_ID=${accountId}`,
        `R2_BUCKET_NAME=${bucketName}`,
        publicUrl ? `R2_PUBLIC_URL=${publicUrl}` : "",
      ].filter(Boolean).join("\n") + "\n";
      
      await fs.writeFile(devVarsPath, newContent);
      
      return json({
        success: true,
        message: "Your R2 configuration is verified and ready for production deployment!",
        configSaved: true,
        wranglerConfig: generateWranglerConfig(accountId, bucketName, publicUrl),
      });
    } catch (error) {
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to save configuration" 
      });
    }
  } else {
    // In production, return the wrangler.toml snippet they need to add
    return json({
      success: true,
      message: "Copy the configuration below to your wrangler.toml and redeploy.",
      configSaved: false,
      wranglerConfig: generateWranglerConfig(accountId, bucketName, publicUrl),
    });
  }
}

async function handleTestConnection(formData: FormData) {
  const apiToken = formData.get("apiToken") as string;
  const accountId = formData.get("accountId") as string;
  const bucketName = formData.get("bucketName") as string;
  
  if (!apiToken || !accountId || !bucketName) {
    return json({ success: false, error: "All fields are required" });
  }
  
  try {
    // Try to list objects in the bucket (limit 1)
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects`,
      {
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    
    const data = await response.json() as { 
      success: boolean; 
      errors?: Array<{ message: string }>;
    };
    
    if (!data.success) {
      return json({ 
        success: false, 
        error: data.errors?.[0]?.message || "Failed to connect to bucket" 
      });
    }
    
    return json({
      success: true,
      message: `Successfully connected to bucket "${bucketName}"!`,
    });
  } catch (error) {
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to test connection" 
    });
  }
}

async function handleSwitchAdapter(formData: FormData) {
  const adapter = formData.get("adapter") as string;
  
  if (!adapter || (adapter !== "local" && adapter !== "r2")) {
    return json({ success: false, message: "Invalid adapter type" });
  }
  
  // Only allow in development
  if (!isDevelopment()) {
    return json({ 
      success: false, 
      message: "Adapter switching is only available in development mode" 
    });
  }
  
  try {
    // Use dynamic import for Node.js fs module
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const devVarsPath = path.join(process.cwd(), ".dev.vars");
    
    // Read existing .dev.vars content
    let existingContent = "";
    try {
      existingContent = await fs.readFile(devVarsPath, "utf-8");
    } catch {
      // File doesn't exist, that's fine
    }
    
    // Parse existing content
    const lines = existingContent.split("\n");
    const existingVars: Record<string, string> = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          existingVars[match[1].trim()] = match[2].trim();
        }
      }
    }
    
    // Update or add STORAGE_ADAPTER
    existingVars["STORAGE_ADAPTER"] = adapter;
    
    // Build new content preserving comments
    const comments: string[] = [];
    for (const line of lines) {
      if (line.trim().startsWith("#")) {
        comments.push(line);
      }
    }
    
    // Check if we have the header comment
    const hasHeaderComment = comments.some(c => c.includes("Admin credentials") || c.includes("Storage"));
    
    let newContent = "";
    if (!hasHeaderComment) {
      newContent = "# Admin credentials and storage configuration for local development\n";
    } else {
      newContent = comments.join("\n") + "\n";
    }
    
    // Add all variables
    for (const [key, value] of Object.entries(existingVars)) {
      newContent += `${key}=${value}\n`;
    }
    
    await fs.writeFile(devVarsPath, newContent);
    
    return json({
      success: true,
      message: `Switched to ${adapter === "r2" ? "R2 Storage" : "Local Storage"}`,
      needsRestart: true,
    });
  } catch (error) {
    return json({ 
      success: false, 
      message: error instanceof Error ? error.message : "Failed to switch adapter" 
    });
  }
}

function generateWranglerConfig(accountId: string, bucketName: string, publicUrl: string): string {
  return `# Add to your wrangler.toml:

[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "${bucketName}"

[vars]
R2_BUCKET_NAME = "${bucketName}"
R2_ACCOUNT_ID = "${accountId}"${publicUrl ? `\nR2_PUBLIC_URL = "${publicUrl}"` : ""}`;
}

export function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
