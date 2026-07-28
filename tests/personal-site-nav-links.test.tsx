import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PersonalSiteNavLinks,
  personalSiteSectionHref,
} from "../app/components/PersonalSiteNavLinks";
import type { Locale } from "../app/lib/i18n";

describe("personal site navigation links", () => {
  test.each([
    ["en", "About me", "Contact", "https://victoriano.me/"],
    ["es", "Sobre mí", "Contacto", "https://victoriano.me/es"],
  ] as const)(
    "links the %s labels to the matching personal-site sections",
    (
      locale: Locale,
      aboutLabel: string,
      contactLabel: string,
      baseUrl: string,
    ) => {
      const html = renderToStaticMarkup(
        <PersonalSiteNavLinks locale={locale} />,
      );

      expect(personalSiteSectionHref(locale, "about")).toBe(
        `${baseUrl}#about`,
      );
      expect(personalSiteSectionHref(locale, "contact")).toBe(
        `${baseUrl}#contact`,
      );
      expect(html).toContain(`href="${baseUrl}#about"`);
      expect(html).toContain(`>${aboutLabel}</a>`);
      expect(html).toContain(`href="${baseUrl}#contact"`);
      expect(html).toContain(`>${contactLabel}</a>`);
    },
  );
});
