/**
 * Admin Setup Redirect
 * 
 * Redirects to the public /setup route.
 * Kept for backward compatibility with existing links.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

export async function loader({ request }: LoaderFunctionArgs) {
  // Preserve any query parameters
  const url = new URL(request.url);
  const setupUrl = new URL("/setup", url.origin);
  setupUrl.search = url.search;
  
  return redirect(setupUrl.toString());
}
