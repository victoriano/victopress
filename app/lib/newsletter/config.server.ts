import { getBaseUrl } from "~/utils/seo";

type EnvironmentRecord = Record<string, unknown>;

export interface NewsletterConfig {
  configured: boolean;
  missing: string[];
  resendApiKey: string;
  fromEmail: string;
  replyTo?: string;
  tokenSecret: string;
  baseUrl: string;
  siteName: string;
}

function readContextEnvironment(context: unknown): EnvironmentRecord {
  if (!context || typeof context !== "object") return {};
  const cloudflare = (context as { cloudflare?: unknown }).cloudflare;
  if (!cloudflare || typeof cloudflare !== "object") return {};
  const env = (cloudflare as { env?: unknown }).env;
  return env && typeof env === "object" ? env as EnvironmentRecord : {};
}

function readSetting(
  contextEnvironment: EnvironmentRecord,
  key: string,
): string {
  const contextValue = contextEnvironment[key];
  if (typeof contextValue === "string" && contextValue.trim()) {
    return contextValue.trim();
  }

  const processValue = process.env[key];
  return typeof processValue === "string" ? processValue.trim() : "";
}

function safeHttpOrigin(value: string, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function resolveNewsletterConfig(
  context: unknown,
  request: Request,
): NewsletterConfig {
  const env = readContextEnvironment(context);
  const resendApiKey = readSetting(env, "RESEND_API_KEY");
  const fromEmail = readSetting(env, "NEWSLETTER_FROM_EMAIL");
  const tokenSecret = readSetting(env, "NEWSLETTER_TOKEN_SECRET");
  const replyTo = readSetting(env, "NEWSLETTER_REPLY_TO") || undefined;
  const siteName =
    readSetting(env, "BLOG_SITE_NAME") || "Victoriano Izquierdo";
  const requestBaseUrl = getBaseUrl(request);
  const baseUrl = safeHttpOrigin(
    readSetting(env, "PUBLIC_NEWSLETTER_URL"),
    requestBaseUrl,
  );

  const missing = [
    ["RESEND_API_KEY", resendApiKey],
    ["NEWSLETTER_FROM_EMAIL", fromEmail],
    ["NEWSLETTER_TOKEN_SECRET", tokenSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (tokenSecret && tokenSecret.length < 32) {
    missing.push("NEWSLETTER_TOKEN_SECRET (32+ characters)");
  }

  return {
    configured: missing.length === 0,
    missing,
    resendApiKey,
    fromEmail,
    replyTo,
    tokenSecret,
    baseUrl,
    siteName,
  };
}

export function isNewsletterConfigured(
  context: unknown,
  request: Request,
): boolean {
  return resolveNewsletterConfig(context, request).configured;
}
