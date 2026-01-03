/**
 * Gallery Authentication API
 *
 * POST /api/gallery-auth
 * Verifies gallery password and sets authentication cookie.
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { scanGalleries, getStorage } from "~/lib/content-engine";
import {
  addAuthenticatedGallery,
  verifyPassword,
} from "~/utils/gallery-auth";

export async function action({ request, context }: ActionFunctionArgs) {
  // Only allow POST requests
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const gallerySlug = formData.get("gallerySlug")?.toString();
  const password = formData.get("password")?.toString();
  const redirectTo = formData.get("redirectTo")?.toString() || "/";

  if (!gallerySlug || !password) {
    return json({ error: "Missing gallery slug or password" }, { status: 400 });
  }

  // Find the gallery
  const storage = getStorage(context);
  const galleries = await scanGalleries(storage);
  const gallery = galleries.find((g) => g.slug === gallerySlug);

  if (!gallery) {
    return json({ error: "Gallery not found" }, { status: 404 });
  }

  if (!gallery.password) {
    // Gallery is not password protected
    return redirect(redirectTo);
  }

  // Verify password
  const isValid = await verifyPassword(password, gallery.password);

  if (!isValid) {
    return json({ error: "Incorrect password" }, { status: 401 });
  }

  // Set authentication cookie
  const cookie = await addAuthenticatedGallery(request, gallerySlug);

  // Redirect to the gallery
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": cookie,
    },
  });
}

// Disallow GET requests
export function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
