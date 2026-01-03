/**
 * Admin Logout
 * 
 * Clears the auth cookie and redirects to login.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

// Cookie clearing string - expires in the past and sets empty value
const CLEAR_COOKIE = "admin_auth=deleted; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

export async function loader({}: LoaderFunctionArgs) {
  // Handle GET requests for logout
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": CLEAR_COOKIE,
    },
  });
}

export async function action({}: ActionFunctionArgs) {
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": CLEAR_COOKIE,
    },
  });
}
