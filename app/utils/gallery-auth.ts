/**
 * Gallery Authentication Utilities
 *
 * Handles password protection for galleries using cookie-based sessions.
 */

import { createCookie } from "@remix-run/cloudflare";

// Cookie for storing authenticated gallery slugs
export const galleryAuthCookie = createCookie("gallery-auth", {
  maxAge: 60 * 60 * 24 * 7, // 7 days
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
});

/**
 * Get the list of authenticated gallery slugs from the cookie
 */
export async function getAuthenticatedGalleries(
  request: Request
): Promise<Set<string>> {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = await galleryAuthCookie.parse(cookieHeader);
  
  if (!cookie || !Array.isArray(cookie)) {
    return new Set();
  }
  
  return new Set(cookie);
}

/**
 * Add a gallery slug to the authenticated list
 */
export async function addAuthenticatedGallery(
  request: Request,
  gallerySlug: string
): Promise<string> {
  const authenticated = await getAuthenticatedGalleries(request);
  authenticated.add(gallerySlug);
  
  return galleryAuthCookie.serialize(Array.from(authenticated));
}

/**
 * Check if a gallery is authenticated
 */
export async function isGalleryAuthenticated(
  request: Request,
  gallerySlug: string
): Promise<boolean> {
  const authenticated = await getAuthenticatedGalleries(request);
  return authenticated.has(gallerySlug);
}

/**
 * Simple password hashing using SHA-256
 * Note: For production, consider using bcrypt or argon2 on the server
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const inputHash = await hashPassword(password);
  return inputHash === storedHash;
}
