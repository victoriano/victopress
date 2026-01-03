/**
 * Admin Logout
 * 
 * Clears the auth cookie and redirects to login.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

export async function loader({}: LoaderFunctionArgs) {
  // Redirect GET requests to login
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": "admin_auth=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  });
}

export async function action({}: ActionFunctionArgs) {
  return redirect("/admin/login", {
    headers: {
      "Set-Cookie": "admin_auth=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  });
}
