import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getStorage } from "~/lib/content-engine";

const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
};

function decodeDocumentPath(value: string): string | null {
  try {
    const segments = value.split("/").map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    )) {
      return null;
    }
    return segments.join("/");
  } catch {
    return null;
  }
}

function documentType(path: string): string | null {
  const extension = path.toLowerCase().split(".").pop() || "";
  return ALLOWED_DOCUMENT_TYPES[extension] || null;
}

function safeDownloadName(path: string): string {
  const filename = path.split("/").pop() || "document.pdf";
  return filename.replace(/[^a-z0-9._-]+/gi, "-");
}

export async function loader({ params, context, request }: LoaderFunctionArgs) {
  const decodedPath = params["*"] ? decodeDocumentPath(params["*"]) : null;
  if (!decodedPath) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = documentType(decodedPath);
  if (!contentType) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const storage = getStorage(context, request);
    const buffer = await storage.get(decodedPath);
    if (!buffer) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(buffer, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${safeDownloadName(decodedPath)}"`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Failed to serve document:", decodedPath, error);
    return new Response("Not Found", { status: 404 });
  }
}

export const __documentFileInternals = {
  decodeDocumentPath,
  documentType,
  safeDownloadName,
};
