/**
 * Admin Authentication Utilities
 * 
 * Simple Basic Auth for the admin panel.
 * For production, consider using Cloudflare Access.
 */

// Environment variable names for admin credentials
// Set these in wrangler.toml or Cloudflare dashboard
const ADMIN_USERNAME_ENV = "ADMIN_USERNAME";
const ADMIN_PASSWORD_ENV = "ADMIN_PASSWORD";

interface AdminCredentials {
  username: string;
  password: string;
}

/**
 * Get admin credentials from environment
 */
export function getAdminCredentials(env: unknown): AdminCredentials | null {
  if (!env || typeof env !== "object") {
    return null;
  }
  const envObj = env as Record<string, unknown>;
  const username = envObj[ADMIN_USERNAME_ENV] as string | undefined;
  const password = envObj[ADMIN_PASSWORD_ENV] as string | undefined;
  
  if (!username || !password) {
    return null;
  }
  
  return { username, password };
}

/**
 * Check if request has valid Basic Auth credentials
 */
export function isAuthenticated(
  request: Request,
  credentials: AdminCredentials
): boolean {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }
  
  try {
    // Decode Base64 credentials
    const base64Credentials = authHeader.slice("Basic ".length);
    const decoded = atob(base64Credentials);
    const [username, password] = decoded.split(":");
    
    return username === credentials.username && password === credentials.password;
  } catch {
    return false;
  }
}

/**
 * Create a 401 response requesting Basic Auth
 */
export function requireAuth(realm = "VictoPress Admin"): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}"`,
    },
  });
}

/**
 * Check admin authentication and throw 401 if not authenticated
 * Use this in admin route loaders
 */
export function checkAdminAuth(
  request: Request,
  env: unknown
): void {
  // In development, allow access without authentication
  const url = new URL(request.url);
  const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  
  if (isDev) {
    // Allow access in dev mode without credentials
    return;
  }
  
  const credentials = getAdminCredentials(env);
  
  if (!credentials) {
    // No credentials configured - redirect to setup wizard
    // The setup page doesn't require auth
    if (!url.pathname.startsWith("/admin/setup")) {
      throw new Response(null, {
        status: 302,
        headers: { Location: "/admin/setup" },
      });
    }
    return; // Allow access to setup without auth
  }
  
  if (!isAuthenticated(request, credentials)) {
    throw requireAuth();
  }
}

/**
 * Check if admin credentials are configured
 */
export function isAdminConfigured(env: unknown): boolean {
  return getAdminCredentials(env) !== null;
}

/**
 * Get current admin user (for display purposes)
 */
export function getAdminUser(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }
  
  try {
    const base64Credentials = authHeader.slice("Basic ".length);
    const decoded = atob(base64Credentials);
    const [username] = decoded.split(":");
    return username;
  } catch {
    return null;
  }
}
