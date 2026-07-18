/**
 * Admin Login Page
 * 
 * Provides a login form for admin authentication.
 * Redirects to admin dashboard on successful login.
 */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  adminSessionCookie,
  createAdminSessionToken,
  getEffectiveAdminCredentials,
  hasValidAdminSession,
  verifyAdminPassword,
} from "~/utils/admin-auth";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const credentials = await getEffectiveAdminCredentials(context, request);
  
  // If no credentials configured, redirect to setup
  if (!credentials) {
    return redirect("/setup");
  }
  
  // Check if already authenticated via cookie
  if (await hasValidAdminSession(request, credentials)) return redirect("/admin");
  
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const credentials = await getEffectiveAdminCredentials(context, request);
  
  if (!credentials) {
    return redirect("/setup");
  }
  
  const formData = await request.formData();
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  const requestedRedirect = String(formData.get("redirectTo") || "/admin");
  const redirectTo = requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
    ? requestedRedirect
    : "/admin";
  
  if (username === credentials.username && await verifyAdminPassword(password, credentials)) {
    const token = await createAdminSessionToken(credentials);
    
    // Use Path=/ so cookie works for all admin routes
    return redirect(redirectTo, {
      headers: {
        "Set-Cookie": adminSessionCookie(token),
      },
    });
  }
  
  return json({ error: "Invalid username or password" }, { status: 401 });
}

export default function AdminLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-auto">
      <div className="min-h-screen flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">VictoPress</h1>
            <p className="text-gray-400">Admin Panel</p>
          </div>
          
          {/* Login Card */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-white mb-6 text-center">Sign In</h2>
            
            {actionData?.error && (
              <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
                <p className="text-red-400 text-sm">{actionData.error}</p>
              </div>
            )}
            
            <Form method="post" className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  required
                  autoComplete="username"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
                  placeholder="Enter your username"
                />
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
                  placeholder="Enter your password"
                />
              </div>
              
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>
            </Form>

          </div>
          
          <p className="mt-6 text-center text-gray-500 text-sm">
            <a href="/" className="hover:text-gray-300 transition-colors">
              ← Back to site
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
