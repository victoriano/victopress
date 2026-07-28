import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { getStorage } from "~/lib/content-engine";
import { resolveNewsletterConfig } from "~/lib/newsletter/config.server";
import { trackNewsletterOpenToken } from "~/lib/newsletter/newsletter-service.server";

const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

const responseHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "Content-Type": "image/gif",
  "Content-Length": String(TRANSPARENT_GIF.byteLength),
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export const headers: HeadersFunction = () => responseHeaders;

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("token") || "";
    try {
      await trackNewsletterOpenToken({
        storage: getStorage(context, request),
        config: resolveNewsletterConfig(context, request),
        token,
      });
    } catch (error) {
      console.error("[Newsletter] Could not persist an open detection.", error);
    }
  }

  return new Response(TRANSPARENT_GIF.slice(), {
    status: 200,
    headers: responseHeaders,
  });
}
