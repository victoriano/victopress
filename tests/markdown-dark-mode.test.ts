import { describe, expect, test } from "bun:test";

const stylesheetSource = await Bun.file(
  new URL("../app/tailwind.css", import.meta.url),
).text();

const DARK_SURFACE = "#030712";

function readThemeColor(block: string, property: string): string {
  const match = block.match(
    new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(#[0-9a-fA-F]{6})`),
  );

  if (!match) {
    throw new Error(`Missing ${property} in the dark theme`);
  }

  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4
    ));

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Markdown dark mode", () => {
  test("keeps article titles readable on the dark surface", () => {
    const darkTitle = stylesheetSource.match(
      /\.dark \.blog-entry-title\s*\{([^}]+)\}/,
    )?.[1];

    expect(darkTitle).toBeDefined();

    const color = readThemeColor(darkTitle!, "color");
    expect(contrastRatio(color, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  test("keeps body text, emphasis, and links readable on the dark surface", () => {
    const darkTheme = stylesheetSource.match(
      /\.dark \.markdown-blog-content\s*\{([^}]+)\}/,
    )?.[1];

    expect(darkTheme).toBeDefined();

    for (const property of ["--blog-copy", "--blog-heading", "--blog-link"]) {
      const color = readThemeColor(darkTheme!, property);
      expect(contrastRatio(color, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
