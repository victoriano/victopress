import { useRouteLoaderData } from "@remix-run/react";

import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "~/lib/i18n";

export interface ClientSiteLanguageSettings {
  multilingual: boolean;
  defaultLocale: Locale;
}

export function useSiteLanguages(): ClientSiteLanguageSettings {
  const rootData = useRouteLoaderData<{
    siteLanguages?: { multilingual?: boolean; defaultLocale?: string };
  }>("root");

  return {
    multilingual: rootData?.siteLanguages?.multilingual === true,
    defaultLocale:
      normalizeLocale(rootData?.siteLanguages?.defaultLocale) || DEFAULT_LOCALE,
  };
}
