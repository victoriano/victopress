import { describe, expect, test } from "bun:test";

const rootSource = await Bun.file(
  new URL("../app/root.tsx", import.meta.url),
).text();
const stylesheetSource = await Bun.file(
  new URL("../app/tailwind.css", import.meta.url),
).text();

describe("CSS first-paint guard", () => {
  test("keeps the SSR body non-rendering until the main stylesheet is valid", () => {
    expect(rootSource).toContain(
      'className="victopress-app-body h-full bg-white',
    );
    expect(rootSource).toContain('style={{ display: "none" }}');
    expect(stylesheetSource).toMatch(
      /body\.victopress-app-body\s*\{\s*display:\s*block\s*!important;/,
    );
  });
});
