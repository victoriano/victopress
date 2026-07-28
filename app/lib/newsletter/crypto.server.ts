export type NewsletterTokenPurpose = "confirm" | "unsubscribe" | "open";

export interface NewsletterTokenPayload {
  version: 1;
  purpose: NewsletterTokenPurpose;
  subscriberId: string;
  campaignId?: string;
  expiresAt?: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function newsletterSubscriberId(email: string): Promise<string> {
  return sha256Hex(email);
}

export async function createNewsletterToken(options: {
  secret: string;
  purpose: NewsletterTokenPurpose;
  subscriberId: string;
  campaignId?: string;
  now?: number;
  expiresInSeconds?: number;
}): Promise<string> {
  if (
    (options.purpose === "open" &&
      !/^[a-f0-9]{64}$/.test(options.campaignId || "")) ||
    (options.purpose !== "open" && options.campaignId !== undefined)
  ) {
    throw new Error("Invalid newsletter token context.");
  }
  const now = options.now ?? Date.now();
  const payload: NewsletterTokenPayload = {
    version: 1,
    purpose: options.purpose,
    subscriberId: options.subscriberId,
    ...(options.campaignId ? { campaignId: options.campaignId } : {}),
    ...(options.expiresInSeconds
      ? { expiresAt: now + options.expiresInSeconds * 1000 }
      : {}),
  };
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${encodedPayload}.${await hmac(encodedPayload, options.secret)}`;
}

export async function verifyNewsletterToken(options: {
  token: string;
  secret: string;
  purpose: NewsletterTokenPurpose;
  now?: number;
}): Promise<NewsletterTokenPayload | null> {
  const [encodedPayload, signature, extra] = options.token.split(".");
  if (!encodedPayload || !signature || extra) return null;

  const expectedSignature = await hmac(encodedPayload, options.secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as Partial<NewsletterTokenPayload>;
    const now = options.now ?? Date.now();
    if (
      payload.version !== 1 ||
      payload.purpose !== options.purpose ||
      typeof payload.subscriberId !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.subscriberId) ||
      (options.purpose === "open" &&
        (typeof payload.campaignId !== "string" ||
          !/^[a-f0-9]{64}$/.test(payload.campaignId))) ||
      (options.purpose !== "open" && payload.campaignId !== undefined) ||
      (payload.expiresAt !== undefined &&
        (typeof payload.expiresAt !== "number" || payload.expiresAt < now))
    ) {
      return null;
    }
    return payload as NewsletterTokenPayload;
  } catch {
    return null;
  }
}
