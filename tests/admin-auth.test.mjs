import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter.ts";
import {
  createAdminSessionToken,
  hasValidAdminSession,
  setAdminPassword,
  verifyAdminPassword,
} from "../app/utils/admin-auth.ts";

describe("local admin password reset", () => {
  let temporaryDirectory = "";

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "victopress-auth-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test("stores only a password hash and invalidates the previous session", async () => {
    const storage = new LocalStorageAdapter(temporaryDirectory);
    const first = await setAdminPassword(storage, "admin", "first-secure-password-value");
    const oldSession = await createAdminSessionToken(first);

    const second = await setAdminPassword(storage, "admin", "second-secure-password-value");
    expect(await verifyAdminPassword("first-secure-password-value", second)).toBe(false);
    expect(await verifyAdminPassword("second-secure-password-value", second)).toBe(true);

    const oldSessionRequest = new Request("https://victopress.example/admin", {
      headers: { Cookie: `admin_auth=${oldSession}` },
    });
    expect(await hasValidAdminSession(oldSessionRequest, second)).toBe(false);

    const stored = await storage.getText(".victopress/admin-auth.json");
    expect(stored).not.toContain("second-secure-password-value");
    expect(JSON.parse(stored).passwordHash).toBeString();
  });
});
