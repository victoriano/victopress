/**
 * Debug endpoint to check environment configuration
 * DELETE THIS FILE IN PRODUCTION!
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";

export async function loader({ context }: LoaderFunctionArgs) {
  // Try multiple ways to access env
  const cloudflareEnv = context.cloudflare?.env as Record<string, unknown> | undefined;
  const directContext = context as unknown as Record<string, unknown>;
  
  return json({
    timestamp: new Date().toISOString(),
    contextStructure: {
      contextKeys: Object.keys(context),
      hasCloudflare: !!context.cloudflare,
      cloudflareKeys: context.cloudflare ? Object.keys(context.cloudflare) : [],
    },
    cloudflareEnv: {
      hasEnv: !!cloudflareEnv,
      envKeys: cloudflareEnv ? Object.keys(cloudflareEnv) : [],
    },
    bindings: {
      hasContentBucket: !!cloudflareEnv?.CONTENT_BUCKET,
      contentBucketType: cloudflareEnv?.CONTENT_BUCKET ? typeof cloudflareEnv.CONTENT_BUCKET : "undefined",
    },
    secrets: {
      hasAdminUsername: !!cloudflareEnv?.ADMIN_USERNAME,
      hasAdminPassword: !!cloudflareEnv?.ADMIN_PASSWORD,
      // Show length to verify they exist without exposing values
      adminUsernameLength: cloudflareEnv?.ADMIN_USERNAME ? String(cloudflareEnv.ADMIN_USERNAME).length : 0,
      adminPasswordLength: cloudflareEnv?.ADMIN_PASSWORD ? String(cloudflareEnv.ADMIN_PASSWORD).length : 0,
    },
    variables: {
      siteName: cloudflareEnv?.SITE_NAME || "(not set)",
      r2BucketName: cloudflareEnv?.R2_BUCKET_NAME || "(not set)",
      imageProvider: cloudflareEnv?.IMAGE_PROVIDER || "(not set)",
    },
    // Check if maybe env is at a different path
    alternativePaths: {
      hasDirectEnv: !!directContext.env,
      directEnvKeys: directContext.env ? Object.keys(directContext.env as object) : [],
    },
  });
}
