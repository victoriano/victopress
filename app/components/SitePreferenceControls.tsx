import type { Locale } from "~/lib/i18n";

import { LanguageEditionSwitch } from "./LanguageEditionSwitch";
import { ThemeToggle } from "./ThemeToggle";

interface SitePreferenceControlsProps {
  multilingual: boolean;
  locale: Locale;
  className?: string;
}

export function SitePreferenceControls({
  multilingual,
  locale,
  className = "",
}: SitePreferenceControlsProps) {
  return (
    <div
      className={`flex items-center gap-3 ${className}`.trim()}
      data-site-preference-controls
    >
      {multilingual && <LanguageEditionSwitch locale={locale} />}
      <ThemeToggle locale={locale} />
    </div>
  );
}
