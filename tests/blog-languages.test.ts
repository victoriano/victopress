import { describe, expect, test } from "bun:test";

import {
  auditBlogLanguages,
  inspectBlogLanguage,
} from "../scripts/audit-blog-languages";

describe("blog edition languages", () => {
  test("detects a paragraph left in the other language", () => {
    const issues = inspectBlogLanguage({
      file: "example.md",
      locale: "en",
      title: "A translated post",
      description: "",
      markdown: [
        "This paragraph is written in English and belongs in the English edition.",
        "La demanda de software aumenta porque las empresas tienen más trabajo manual y necesitan mejores herramientas para hacerlo.",
      ].join("\n\n"),
    });

    expect(issues.some((issue) => issue.scope === "block" && issue.block === 2)).toBe(true);
  });

  test("keeps every current edition in its declared language", async () => {
    expect(await auditBlogLanguages()).toEqual([]);
  });
});
