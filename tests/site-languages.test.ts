import { describe, expect, test } from "bun:test";
import yaml from "js-yaml";

import {
  DEFAULT_SITE_LANGUAGE_SETTINGS,
  parseSiteLanguageSettings,
  readSiteLanguageSettings,
  writeSiteLanguageSettings,
} from "../app/lib/site-languages.server";

describe("site language settings", () => {
  test("is single-language by default", () => {
    expect(parseSiteLanguageSettings(undefined)).toEqual({
      multilingual: false,
      defaultLocale: "en",
    });
  });

  test("parses an enabled bilingual site", () => {
    expect(parseSiteLanguageSettings({
      language: { multilingual: true, default: "en-US" },
    })).toEqual({ multilingual: true, defaultLocale: "en" });
  });

  test("preserves unrelated site settings when saving", async () => {
    let stored = "name: Example\nfeatures:\n  search: true\n";
    const storage = {
      getText: async () => stored,
      put: async (_path: string, value: string | ArrayBuffer) => {
        stored = String(value);
      },
    };

    await writeSiteLanguageSettings(storage, {
      multilingual: true,
      defaultLocale: "en",
    });

    expect(await readSiteLanguageSettings(storage)).toEqual({
      multilingual: true,
      defaultLocale: "en",
    });
    expect(yaml.load(stored)).toEqual({
      name: "Example",
      features: { search: true },
      language: { multilingual: true, default: "en" },
    });
  });

  test("uses the product defaults for malformed YAML", async () => {
    expect(await readSiteLanguageSettings({
      getText: async () => "language: [",
    })).toEqual(DEFAULT_SITE_LANGUAGE_SETTINGS);
  });
});
