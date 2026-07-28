import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import { GalleryBreadcrumb } from "../app/components/GalleryBreadcrumb";

describe("mobile Photos navigation", () => {
  test.each([
    ["en", "/blog", "https://victoriano.me/#about", "https://victoriano.me/#contact"],
    ["es", "/es/blog", "https://victoriano.me/es#about", "https://victoriano.me/es#contact"],
  ] as const)(
    "keeps Blog in Photos and sends %s personal links to the landing",
    (locale, blogHref, aboutHref, contactHref) => {
      const html = renderToStaticMarkup(
        <StaticRouter location="/">
          <GalleryBreadcrumb navigation={[]} locale={locale} />
        </StaticRouter>,
      );

      expect(html).toContain(`href="${blogHref}"`);
      expect(html).toContain(`href="${aboutHref}"`);
      expect(html).toContain(`href="${contactHref}"`);
    },
  );
});
