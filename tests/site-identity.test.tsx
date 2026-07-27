import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteIdentity } from "../app/components/SiteIdentity";

describe("Photos site identity", () => {
  test.each([
    ["en", "/"],
    ["es", "/es"],
  ] as const)("links the %s identity to the personal and Photos homepages", (locale, photosHref) => {
    const html = renderToStaticMarkup(
      <SiteIdentity locale={locale} layout="mobile" />,
    );

    expect(html).toContain('href="https://victoriano.me"');
    expect(html).toContain(">Victoriano Izquierdo</a>");
    expect(html).toContain(`href="${photosHref}"`);
    expect(html).toContain(">PHOTOS</a>");
  });

  test("renders the same destinations in the desktop identity", () => {
    const html = renderToStaticMarkup(
      <SiteIdentity locale="en" layout="desktop" />,
    );

    expect(html).toContain('href="https://victoriano.me"');
    expect(html).toContain('href="/"');
    expect(html).toContain(">PHOTOS</a>");
  });
});
