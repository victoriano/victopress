import yaml from "js-yaml";

import type { StorageAdapter } from "~/lib/content-engine";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
} from "~/lib/i18n";

export const SITE_SETTINGS_PATH = "site.yaml";

export interface SiteLanguageSettings {
  /** Whether the public site and CMS expose more than one language edition. */
  multilingual: boolean;
  /** Source/default language for new content and unmatched browser languages. */
  defaultLocale: Locale;
}

export const DEFAULT_SITE_LANGUAGE_SETTINGS: SiteLanguageSettings = {
  multilingual: false,
  defaultLocale: DEFAULT_LOCALE,
};

type SiteSettingsDocument = {
  language?: {
    multilingual?: unknown;
    default?: unknown;
    defaultLocale?: unknown;
  };
  [key: string]: unknown;
};

export function parseSiteLanguageSettings(value: unknown): SiteLanguageSettings {
  if (!value || typeof value !== "object") return DEFAULT_SITE_LANGUAGE_SETTINGS;
  const document = value as SiteSettingsDocument;
  const language = document.language;
  if (!language || typeof language !== "object") return DEFAULT_SITE_LANGUAGE_SETTINGS;

  return {
    multilingual: language.multilingual === true,
    defaultLocale:
      normalizeLocale(language.defaultLocale) ||
      normalizeLocale(language.default) ||
      DEFAULT_SITE_LANGUAGE_SETTINGS.defaultLocale,
  };
}

async function readSiteSettingsDocument(
  storage: Pick<StorageAdapter, "getText">,
): Promise<SiteSettingsDocument> {
  const source = await storage.getText(SITE_SETTINGS_PATH);
  if (!source) return {};

  try {
    const parsed = yaml.load(source);
    return parsed && typeof parsed === "object"
      ? parsed as SiteSettingsDocument
      : {};
  } catch {
    return {};
  }
}

export async function readSiteLanguageSettings(
  storage: Pick<StorageAdapter, "getText">,
): Promise<SiteLanguageSettings> {
  return parseSiteLanguageSettings(await readSiteSettingsDocument(storage));
}

export async function writeSiteLanguageSettings(
  storage: Pick<StorageAdapter, "getText" | "put">,
  settings: SiteLanguageSettings,
): Promise<void> {
  const document = await readSiteSettingsDocument(storage);
  const normalized: SiteLanguageSettings = {
    multilingual: settings.multilingual === true,
    defaultLocale: normalizeLocale(settings.defaultLocale) || DEFAULT_LOCALE,
  };

  document.language = {
    multilingual: normalized.multilingual,
    default: normalized.defaultLocale,
  };

  await storage.put(
    SITE_SETTINGS_PATH,
    yaml.dump(document, { noRefs: true, lineWidth: 100 }),
    "text/yaml",
  );
}
