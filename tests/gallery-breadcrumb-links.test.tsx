import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import {
  GalleryBreadcrumb,
  buildBreadcrumbSegments,
} from "../app/components/GalleryBreadcrumb";
import type { NavItem } from "../app/components/Sidebar";

const galleryNavigation: NavItem[] = [
  {
    title: "Humans",
    slug: "humans",
    path: "/gallery/humans",
    children: [
      {
        title: "Portraits",
        slug: "humans/portraits",
        path: "/gallery/humans/portraits",
      },
      {
        title: "Social",
        slug: "humans/social",
        path: "/gallery/humans/social",
      },
      {
        title: "Rituals",
        slug: "humans/rituals",
        path: "/gallery/humans/rituals",
      },
    ],
  },
];

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

  test.each([
    ["en", "All"],
    ["es", "Todas"],
  ] as const)("shows the %s aggregate as the next visible level", (locale, allTitle) => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/gallery/humans">
        <GalleryBreadcrumb
          currentSlug="humans"
          navigation={galleryNavigation}
          locale={locale}
        />
      </StaticRouter>,
    );

    expect(html).toContain(`aria-label="${locale === "es" ? "Elegir galería" : "Choose gallery"}: ${allTitle}"`);
    expect(html).toContain(`>${allTitle}</span>`);
  });

  test("uses one selector for All and the child galleries", () => {
    const [humans, all] = buildBreadcrumbSegments("humans", galleryNavigation, "en");

    expect(humans.title).toBe("Humans");
    expect(humans.options).toEqual([]);
    expect(all.title).toBe("All");
    expect(all.selectedOptionSlug).toBe("humans");
    expect(all.options.map((option) => option.title)).toEqual([
      "All",
      "Portraits",
      "Social",
      "Rituals",
    ]);
  });

  test("replaces All with the selected child and keeps the same choices", () => {
    const [humans, social] = buildBreadcrumbSegments(
      "humans/social",
      galleryNavigation,
      "en",
    );

    expect(humans.title).toBe("Humans");
    expect(social.title).toBe("Social");
    expect(social.selectedOptionSlug).toBe("humans/social");
    expect(social.options.map((option) => option.title)).toEqual([
      "All",
      "Portraits",
      "Social",
      "Rituals",
    ]);
  });
});
