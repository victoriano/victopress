/**
 * Robots.txt Generator
 *
 * Provides crawler directives for search engines.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getBaseUrl } from "~/utils/seo";

export async function loader({ request }: LoaderFunctionArgs) {
  const baseUrl = getBaseUrl(request);

  const robotsTxt = `# VictoPress robots.txt
User-agent: *
Allow: /

# Sitemap location
Sitemap: ${baseUrl}/sitemap.xml

# Disallow admin routes (when implemented)
Disallow: /admin/

# Disallow API routes from being indexed
Disallow: /api/

# Allow image API for OG images (search engines may need these)
Allow: /api/images/
`;

  return new Response(robotsTxt, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
