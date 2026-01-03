/**
 * Raw Pages Function to debug environment access
 * Visit /api/env-check to see the raw context structure
 */

interface Env {
  CONTENT_BUCKET?: R2Bucket;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SITE_NAME?: string;
  R2_BUCKET_NAME?: string;
  IMAGE_PROVIDER?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  // This is a raw Pages Function - context.env should have our bindings
  const env = context.env;
  
  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    rawContextKeys: Object.keys(context),
    envCheck: {
      hasEnv: !!env,
      envKeys: env ? Object.keys(env) : [],
      envType: typeof env,
    },
    bindings: {
      hasContentBucket: !!env?.CONTENT_BUCKET,
      contentBucketType: env?.CONTENT_BUCKET ? typeof env.CONTENT_BUCKET : "undefined",
    },
    secrets: {
      hasAdminUsername: !!env?.ADMIN_USERNAME,
      hasAdminPassword: !!env?.ADMIN_PASSWORD,
      adminUsernameLength: env?.ADMIN_USERNAME?.length || 0,
      adminPasswordLength: env?.ADMIN_PASSWORD?.length || 0,
    },
    variables: {
      siteName: env?.SITE_NAME || "(not set)",
      r2BucketName: env?.R2_BUCKET_NAME || "(not set)",
      imageProvider: env?.IMAGE_PROVIDER || "(not set)",
    },
  }, null, 2), {
    headers: {
      "Content-Type": "application/json",
    },
  });
};
