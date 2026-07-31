import { describe, expect, test } from "bun:test";

import {
  sanitizeAnalyticsEvent,
  stripAnalyticsUrl,
} from "../app/lib/analytics";

describe("analytics privacy", () => {
  test("removes query strings and fragments from captured URLs", () => {
    expect(
      stripAnalyticsUrl("https://photos.victoriano.me/search?q=granada#results"),
    ).toBe("https://photos.victoriano.me/search");
    expect(stripAnalyticsUrl("/blog?category=data#archive")).toBe("/blog");
  });

  test("drops free text, PII and autocapture element data", () => {
    const sanitized = sanitizeAnalyticsEvent(
      {
        uuid: "00000000-0000-4000-8000-000000000000",
        event: "contact_form_completed",
        properties: {
          $current_url: "https://victoriano.me/es/?from=private",
          $elements: [{ text: "private" }],
          email: "person@example.com",
          message: "private message",
          query: "private search",
        },
      },
      "victoriano.me",
    );

    expect(sanitized?.properties).toEqual({
      $current_url: "https://victoriano.me/es/",
      analytics_privacy: "cookieless",
      site: "victoriano.me",
    });
  });
});
