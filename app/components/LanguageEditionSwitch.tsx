import { Link, useLocation } from "@remix-run/react";

import {
  localeNames,
  languageSwitchPath,
  SUPPORTED_LOCALES,
  type Locale,
} from "~/lib/i18n";

export function LanguageEditionSwitch({ locale }: { locale: Locale }) {
  const location = useLocation();
  const current = `${location.pathname}${location.search}${location.hash}`;
  const label = locale === "es" ? "Idioma" : "Language";

  return (
    <div
      className="inline-flex items-center text-[12px] leading-none"
      role="group"
      aria-label={label}
    >
      <span className="inline-flex items-center gap-1 font-semibold tracking-[0.12em] text-gray-400 dark:text-gray-500">
        {SUPPORTED_LOCALES.map((candidate, index) => (
          <span key={candidate} className="inline-flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <Link
              to={languageSwitchPath(candidate, current)}
              reloadDocument
              lang={candidate}
              hrefLang={candidate}
              aria-current={candidate === locale ? "page" : undefined}
              aria-label={localeNames[candidate]}
              className={`transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-offset-4 dark:focus-visible:ring-offset-gray-950 ${
                candidate === locale
                  ? "text-gray-950 underline decoration-red-800 decoration-1 underline-offset-4 dark:text-white"
                  : "hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {candidate.toUpperCase()}
            </Link>
          </span>
        ))}
      </span>
    </div>
  );
}
