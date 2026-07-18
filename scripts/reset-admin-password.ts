import { join } from "node:path";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter";
import { R2ApiAdapter } from "../app/lib/content-engine/storage/r2-api-adapter";
import type { StorageAdapter } from "../app/lib/content-engine/types";
import { setAdminPassword } from "../app/utils/admin-auth";

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .dev.vars.`);
  return value;
}

function createStorage(): { storage: StorageAdapter; description: string } {
  if (process.env.STORAGE_ADAPTER === "r2") {
    const bucketName = process.env.R2_BUCKET_NAME || "victopress-content";
    return {
      storage: new R2ApiAdapter({
        accountId: requireEnvironmentVariable("R2_ACCOUNT_ID"),
        accessKeyId: requireEnvironmentVariable("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnvironmentVariable("R2_SECRET_ACCESS_KEY"),
        bucketName,
      }),
      description: `R2 bucket ${bucketName}`,
    };
  }

  const contentPath = process.env.VICTOPRESS_CONTENT_PATH || join(process.cwd(), "content");
  return {
    storage: new LocalStorageAdapter(contentPath),
    description: `local content at ${contentPath}`,
  };
}

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = generatePassword();
  const { storage, description } = createStorage();

  await setAdminPassword(storage, username, password);

  console.log("\nAdmin password reset successfully.");
  console.log(`Storage: ${description}`);
  console.log(`Username: ${username}`);
  console.log(`New password: ${password}`);
  console.log("\nSave this password now. It will not be shown again.");
}

main().catch((error) => {
  console.error(`\nCould not reset the admin password: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
