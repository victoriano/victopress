import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageAdapter } from "../app/lib/content-engine/storage/local-adapter.ts";
import { action as loginAction } from "../app/routes/admin.login.tsx";
import {
  adminSessionCookie,
  createAdminSessionToken,
  hasValidAdminSession,
  requireAdminUser,
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
    expect(JSON.parse(stored).passwordIterations).toBe(100_000);
  });

  test("persists the session only when remembering credentials", () => {
    const persistentCookie = adminSessionCookie("signed-token");
    const browserSessionCookie = adminSessionCookie("signed-token", false);

    expect(persistentCookie).toContain("Max-Age=86400");
    expect(browserSessionCookie).not.toContain("Max-Age");
    expect(browserSessionCookie).toContain("HttpOnly; Secure; SameSite=Lax");
  });

  test("the login form respects the remember choice", async () => {
    const emptyAuthBucket = {
      get: async () => null,
    };
    const submitLogin = (remember) => loginAction({
      request: new Request("https://victopress.example/admin/login", {
        method: "POST",
        body: new URLSearchParams({
          username: "admin",
          password: "test-password",
          ...(remember ? { remember: "on" } : {}),
        }),
      }),
      context: {
        cloudflare: {
          env: {
            ADMIN_USERNAME: "admin",
            ADMIN_PASSWORD: "test-password",
            CONTENT_BUCKET: emptyAuthBucket,
          },
        },
      },
      params: {},
    });

    const persistentResponse = await submitLogin(true);
    const browserSessionResponse = await submitLogin(false);

    expect(persistentResponse.status).toBe(302);
    expect(persistentResponse.headers.get("Set-Cookie")).toContain("Max-Age=86400");
    expect(browserSessionResponse.status).toBe(302);
    expect(browserSessionResponse.headers.get("Set-Cookie")).not.toContain("Max-Age");
  });

  test("returns the authenticated username without reading credentials twice", async () => {
    const credentials = { username: "admin", password: "test-password" };
    const token = await createAdminSessionToken(credentials);
    let authRecordReads = 0;
    const emptyAuthBucket = {
      get: async () => {
        authRecordReads += 1;
        return null;
      },
    };

    const username = await requireAdminUser(
      new Request("https://victopress.example/admin/blog/example", {
        headers: { Cookie: `admin_auth=${token}` },
      }),
      {
        cloudflare: {
          env: {
            ADMIN_USERNAME: credentials.username,
            ADMIN_PASSWORD: credentials.password,
            CONTENT_BUCKET: emptyAuthBucket,
          },
        },
      },
    );

    expect(username).toBe("admin");
    expect(authRecordReads).toBe(1);
  });
});
