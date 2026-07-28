/**
 * Admin authentication and password recovery.
 *
 * Existing ADMIN_USERNAME / ADMIN_PASSWORD secrets remain a compatible
 * fallback. Once recovery is requested, credentials are migrated to a salted
 * PBKDF2 hash stored in the configured content storage.
 */

import { getStorage } from "~/lib/content-engine";
import type { StorageAdapter } from "~/lib/content-engine";

const ADMIN_AUTH_PATH = ".victopress/admin-auth.json";
const SESSION_COOKIE = "admin_auth";
const SESSION_TTL_SECONDS = 24 * 60 * 60;
// Cloudflare Workers currently rejects PBKDF2 costs above 100,000.
const PBKDF2_ITERATIONS = 100_000;
const LEGACY_PBKDF2_ITERATIONS = 210_000;

interface AdminContext {
  cloudflare?: { env?: unknown };
}

interface LegacyAdminCredentials {
  username: string;
  password: string;
}

export interface AdminCredentials {
  username: string;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  passwordIterations?: number;
}

interface AdminAuthRecord {
  version: 1;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations?: number;
  updatedAt: string;
}

interface SessionPayload {
  username: string;
  expiresAt: number;
}

function getEnv(context: AdminContext): Record<string, unknown> {
  const env = context.cloudflare?.env;
  return env && typeof env === "object" ? env as Record<string, unknown> : {};
}

function getAuthStorage(context: AdminContext, request?: Request): StorageAdapter {
  return getStorage(
    context as Parameters<typeof getStorage>[0],
    request,
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function derivePasswordHash(
  password: string,
  salt: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(salt),
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = randomToken(16);
  return {
    hash: await derivePasswordHash(password, salt),
    salt,
    iterations: PBKDF2_ITERATIONS,
  };
}

async function readAuthRecord(storage: StorageAdapter): Promise<AdminAuthRecord | null> {
  const raw = await storage.getText(ADMIN_AUTH_PATH);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as AdminAuthRecord;
    if (
      record.version !== 1 ||
      !record.username ||
      !record.passwordHash ||
      !record.passwordSalt ||
      (
        record.passwordIterations !== undefined &&
        (
          !Number.isInteger(record.passwordIterations) ||
          record.passwordIterations <= 0
        )
      )
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

async function writeAuthRecord(storage: StorageAdapter, record: AdminAuthRecord): Promise<void> {
  await storage.put(ADMIN_AUTH_PATH, JSON.stringify(record, null, 2), "application/json");
}

/** Read the original environment-based credentials. */
export function getAdminCredentials(env: unknown): LegacyAdminCredentials | null {
  if (!env || typeof env !== "object") return null;
  const values = env as Record<string, unknown>;
  const username = values.ADMIN_USERNAME;
  const password = values.ADMIN_PASSWORD;
  return typeof username === "string" && typeof password === "string" && username && password
    ? { username, password }
    : null;
}

export async function getEffectiveAdminCredentials(
  context: AdminContext,
  request?: Request,
): Promise<AdminCredentials | null> {
  try {
    const record = await readAuthRecord(getAuthStorage(context, request));
    if (record) {
      return {
        username: record.username,
        passwordHash: record.passwordHash,
        passwordSalt: record.passwordSalt,
        passwordIterations:
          record.passwordIterations ?? LEGACY_PBKDF2_ITERATIONS,
      };
    }
  } catch (error) {
    console.warn("[Admin Auth] Could not read persistent credentials; using environment fallback.", error);
  }

  const legacy = getAdminCredentials(getEnv(context));
  if (!legacy) return null;
  return legacy;
}

export async function verifyAdminPassword(
  password: string,
  credentials: AdminCredentials,
): Promise<boolean> {
  if (credentials.passwordHash && credentials.passwordSalt) {
    try {
      return safeEqual(
        await derivePasswordHash(
          password,
          credentials.passwordSalt,
          credentials.passwordIterations ?? PBKDF2_ITERATIONS,
        ),
        credentials.passwordHash,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.name === "NotSupportedError" ||
          error.message.includes("iteration counts above")
        )
      ) {
        console.warn(
          "[Admin Auth] The stored PBKDF2 cost is unsupported by this runtime. Reset the admin password to migrate it.",
        );
        return false;
      }
      throw error;
    }
  }
  return typeof credentials.password === "string" && safeEqual(password, credentials.password);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function sessionSecret(credentials: AdminCredentials): string {
  return credentials.passwordHash || credentials.password || "";
}

export async function createAdminSessionToken(credentials: AdminCredentials): Promise<string> {
  const payload: SessionPayload = {
    username: credentials.username,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await sign(encodedPayload, sessionSecret(credentials))}`;
}

async function verifyAdminSessionToken(
  token: string,
  credentials: AdminCredentials,
): Promise<boolean> {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;
  if (!safeEqual(signature, await sign(encodedPayload, sessionSecret(credentials)))) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))) as SessionPayload;
    return payload.username === credentials.username && payload.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function hasValidAdminSession(
  request: Request,
  credentials: AdminCredentials,
): Promise<boolean> {
  const token = readSessionCookie(request);
  if (!token) return false;
  if (await verifyAdminSessionToken(token, credentials)) return true;
  return Boolean(credentials.password && token === btoa(`${credentials.username}:${credentials.password}`));
}

export function adminSessionCookie(token: string, persistent = true): string {
  const maxAge = persistent ? `; Max-Age=${SESSION_TTL_SECONDS}` : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`;
}

function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] || null;
}

/**
 * Validate an admin request and return the authenticated username from the
 * same credential read. Loaders that need the username should use this helper
 * instead of checking auth and then reading the auth record a second time.
 */
export async function requireAdminUser(
  request: Request,
  context: AdminContext,
): Promise<string | null> {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return getAdminCredentials(getEnv(context))?.username || null;
  }

  const credentials = await getEffectiveAdminCredentials(context, request);
  if (!credentials) {
    throw new Response(null, { status: 302, headers: { Location: "/setup" } });
  }

  if (await hasValidAdminSession(request, credentials)) {
    return credentials.username;
  }

  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const [username, password] = atob(authorization.slice(6)).split(":");
      if (
        username === credentials.username &&
        await verifyAdminPassword(password, credentials)
      ) {
        return credentials.username;
      }
    } catch {
      // Invalid Basic Auth data.
    }
  }

  const loginUrl = new URLSearchParams({ redirectTo: url.pathname }).toString();
  throw new Response(null, { status: 302, headers: { Location: `/admin/login?${loginUrl}` } });
}

export async function checkAdminAuth(request: Request, context: AdminContext): Promise<void> {
  await requireAdminUser(request, context);
}

export async function isAdminConfigured(context: AdminContext): Promise<boolean> {
  return (await getEffectiveAdminCredentials(context)) !== null;
}

export async function getAdminUser(request: Request, context: AdminContext): Promise<string | null> {
  const credentials = await getEffectiveAdminCredentials(context, request);
  if (!credentials) return null;
  return await hasValidAdminSession(request, credentials) ? credentials.username : null;
}
export async function setAdminPassword(
  storage: StorageAdapter,
  username: string,
  password: string,
): Promise<AdminCredentials> {
  if (!username.trim()) throw new Error("Admin username is required.");
  if (password.length < 20) throw new Error("Generated admin passwords must contain at least 20 characters.");
  const { hash, salt, iterations } = await hashPassword(password);
  const record: AdminAuthRecord = {
    version: 1,
    username: username.trim(),
    passwordHash: hash,
    passwordSalt: salt,
    passwordIterations: iterations,
    updatedAt: new Date().toISOString(),
  };
  await writeAuthRecord(storage, record);
  return {
    username: record.username,
    passwordHash: record.passwordHash,
    passwordSalt: record.passwordSalt,
    passwordIterations: record.passwordIterations,
  };
}
