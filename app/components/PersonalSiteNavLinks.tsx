import { photoMessages, type Locale } from "~/lib/i18n";

type PersonalSiteSection = "about" | "contact";

type PersonalSiteNavLinksProps = {
  locale: Locale;
  onNavigate?: () => void;
};

export function personalSiteSectionHref(
  locale: Locale,
  section: PersonalSiteSection,
) {
  const localePath = locale === "es" ? "/es" : "/";
  return `https://victoriano.me${localePath}#${section}`;
}

export function PersonalSiteNavLinks({
  locale,
  onNavigate,
}: PersonalSiteNavLinksProps) {
  const messages = photoMessages[locale];
  const className =
    "block text-xs font-semibold text-gray-800 transition-colors hover:text-black dark:text-gray-300 dark:hover:text-white";

  return (
    <>
      <a
        href={personalSiteSectionHref(locale, "about")}
        className={className}
        onClick={onNavigate}
      >
        {messages.about}
      </a>
      <a
        href={personalSiteSectionHref(locale, "contact")}
        className={className}
        onClick={onNavigate}
      >
        {messages.contact}
      </a>
    </>
  );
}
