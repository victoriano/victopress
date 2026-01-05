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
  const apiToken = formData.get("apiToken") as string;
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
      
      // Also update wrangler.toml with R2 bucket binding
      const wranglerPath = path.join(process.cwd(), "wrangler.toml");
      let wranglerUpdated = false;
      
      try {
        let wranglerContent = await fs.readFile(wranglerPath, "utf-8");
        
        // Check if R2 bucket binding already exists
        if (!wranglerContent.includes("[[r2_buckets]]")) {
          // Add R2 bucket binding before [vars] or at the end
          const r2Config = `
# R2 Storage Bucket
[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "${bucketName}"
`;
          
          // Find a good place to insert (before [vars] if it exists)
          if (wranglerContent.includes("[vars]")) {
            wranglerContent = wranglerContent.replace("[vars]", r2Config + "\n[vars]");
          } else {
            wranglerContent += "\n" + r2Config;
          }
          
          await fs.writeFile(wranglerPath, wranglerContent);
          wranglerUpdated = true;
        } else {
          // R2 bucket already configured, just update the bucket name if different
          const bucketMatch = wranglerContent.match(/bucket_name\s*=\s*"([^"]+)"/);
          if (bucketMatch && bucketMatch[1] !== bucketName) {
            wranglerContent = wranglerContent.replace(
              /bucket_name\s*=\s*"[^"]+"/,
              `bucket_name = "${bucketName}"`
            );
            await fs.writeFile(wranglerPath, wranglerContent);
            wranglerUpdated = true;
          }
        }
      } catch (e) {
        // wrangler.toml doesn't exist or couldn't be updated
        console.warn("Could not update wrangler.toml:", e);
      }
      
      return json({
        success: true,
        message: wranglerUpdated 
          ? "Configuration saved! Both .dev.vars and wrangler.toml have been updated."
          : "Configuration saved to .dev.vars. wrangler.toml already has R2 configured.",
        configSaved: true,
        wranglerUpdated,
      });
    } catch (error) {
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to save configuration" 
      });
    }
  } else {
    // In production, use Cloudflare API to configure the project
    const projectName = formData.get("projectName") as string;
    
    if (!projectName || !apiToken) {
      // If no project name or token, fall back to showing config
      return json({
        success: true,
        message: "Copy the configuration below to your wrangler.toml and redeploy.",
        configSaved: false,
        wranglerConfig: generateWranglerConfig(accountId, bucketName, publicUrl),
      });
    }
    
    try {
      // Step 1: Set environment variables for the Pages project
      const envVarsResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
        {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            deployment_configs: {
              production: {
                env_vars: {
                  R2_BUCKET_NAME: { value: bucketName },
                  R2_ACCOUNT_ID: { value: accountId },
                  ...(publicUrl ? { R2_PUBLIC_URL: { value: publicUrl } } : {}),
                },
                r2_buckets: {
                  CONTENT_BUCKET: { name: bucketName },
                },
              },
              preview: {
                env_vars: {
                  R2_BUCKET_NAME: { value: bucketName },
                  R2_ACCOUNT_ID: { value: accountId },
                  ...(publicUrl ? { R2_PUBLIC_URL: { value: publicUrl } } : {}),
                },
                r2_buckets: {
                  CONTENT_BUCKET: { name: bucketName },
                },
              },
            },
          }),
        }
      );
      
      const envResult = await envVarsResponse.json() as { 
        success: boolean; 
        errors?: Array<{ message: string }>;
      };
      
      if (!envResult.success) {
        return json({
          success: false,
          error: `Failed to configure project: ${envResult.errors?.[0]?.message || "Unknown error"}`,
        });
      }
      
      // Step 2: Trigger a new deployment
      const deployResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      
      const deployResult = await deployResponse.json() as { 
        success: boolean;
        result?: { id: string; url: string };
        errors?: Array<{ message: string }>;
      };
      
      if (deployResult.success && deployResult.result) {
        return json({
          success: true,
          message: "Configuration saved and deployment triggered!",
          configSaved: true,
          deploymentId: deployResult.result.id,
          deploymentUrl: deployResult.result.url,
        });
      } else {
        // Config saved but deployment didn't trigger - still a success
        return json({
          success: true,
          message: "Configuration saved! A new deployment will use these settings.",
          configSaved: true,
          deploymentNote: "Trigger a new deployment from the Cloudflare dashboard or push a commit.",
        });
      }
    } catch (error) {
      // API calls failed, fall back to showing config
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to configure project via API",
        wranglerConfig: generateWranglerConfig(accountId, bucketName, publicUrl),
      });
    }
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
  
  // Set cookie for instant switching (no restart needed!)
  // Cookie expires in 1 year
  const cookieValue = `storage_adapter=${adapter}; Path=/; Max-Age=31536000; SameSite=Lax`;
  
  return json(
    {
      success: true,
      message: `Switched to ${adapter === "r2" ? "R2 Storage" : "Local Storage"}`,
      adapter,
      needsRestart: false, // No restart needed with cookie approach!
    },
    {
      headers: {
        "Set-Cookie": cookieValue,
      },
    }
  );
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
