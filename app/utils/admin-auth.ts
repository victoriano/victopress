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
const PBKDF2_ITERATIONS = 210_000;

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
}

interface AdminAuthRecord {
  version: 1;
  username: string;
  passwordHash: string;
  passwordSalt: string;
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

async function derivePasswordHash(password: string, salt: string): Promise<string> {
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
      iterations: PBKDF2_ITERATIONS,
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

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomToken(16);
  return { hash: await derivePasswordHash(password, salt), salt };
}

async function readAuthRecord(storage: StorageAdapter): Promise<AdminAuthRecord | null> {
  const raw = await storage.getText(ADMIN_AUTH_PATH);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as AdminAuthRecord;
    if (record.version !== 1 || !record.username || !record.passwordHash || !record.passwordSalt) {
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
    return safeEqual(
      await derivePasswordHash(password, credentials.passwordSalt),
      credentials.passwordHash,
    );
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

export function adminSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] || null;
}

export async function checkAdminAuth(request: Request, context: AdminContext): Promise<void> {
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;

  const credentials = await getEffectiveAdminCredentials(context, request);
  if (!credentials) {
    throw new Response(null, { status: 302, headers: { Location: "/setup" } });
  }

  if (await hasValidAdminSession(request, credentials)) return;

  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const [username, password] = atob(authorization.slice(6)).split(":");
      if (username === credentials.username && await verifyAdminPassword(password, credentials)) return;
    } catch {
      // Invalid Basic Auth data.
    }
  }

  const loginUrl = new URLSearchParams({ redirectTo: url.pathname }).toString();
  throw new Response(null, { status: 302, headers: { Location: `/admin/login?${loginUrl}` } });
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
  const { hash, salt } = await hashPassword(password);
  const record: AdminAuthRecord = {
    version: 1,
    username: username.trim(),
    passwordHash: hash,
    passwordSalt: salt,
    updatedAt: new Date().toISOString(),
  };
  await writeAuthRecord(storage, record);
  return {
    username: record.username,
    passwordHash: record.passwordHash,
    passwordSalt: record.passwordSalt,
  };
}
