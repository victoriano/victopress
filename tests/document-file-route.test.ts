import { describe, expect, test } from "bun:test";
import { __documentFileInternals } from "../app/routes/api.files.$";

describe("document file route", () => {
  test("allows nested PDF paths and rejects traversal", () => {
    expect(__documentFileInternals.decodeDocumentPath(
      "blog/2025/6/30/post/presentation.pdf",
    )).toBe("blog/2025/6/30/post/presentation.pdf");
    expect(__documentFileInternals.decodeDocumentPath(
      "blog/%2E%2E/secrets.pdf",
    )).toBeNull();
    expect(__documentFileInternals.decodeDocumentPath(
      "blog/%2Fetc/passwd.pdf",
    )).toBeNull();
  });

  test("serves only PDF documents with a safe filename", () => {
    expect(__documentFileInternals.documentType("presentation.pdf")).toBe("application/pdf");
    expect(__documentFileInternals.documentType("photo.jpg")).toBeNull();
    expect(__documentFileInternals.safeDownloadName("blog/My deck (1).pdf"))
      .toBe("My-deck-1-.pdf");
  });
});
