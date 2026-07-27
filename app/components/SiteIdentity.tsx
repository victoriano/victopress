import { localizedPath, type Locale } from "~/lib/i18n";

type SiteIdentityProps = {
  locale: Locale;
  layout: "desktop" | "mobile";
  onNavigate?: () => void;
};

export function SiteIdentity({ locale, layout, onNavigate }: SiteIdentityProps) {
  if (layout === "desktop") {
    return (
      <div className="mb-12">
        <a
          href="https://victoriano.me"
          className="block text-[27px] font-bold leading-[1.2] tracking-normal text-black transition-colors hover:text-gray-600 dark:text-white dark:hover:text-gray-300"
        >
          <span className="block">Victoriano</span>
          <span className="block">Izquierdo</span>
        </a>
        <a
          href={localizedPath(locale, "/")}
          className="mt-2 inline-block text-[11px] font-semibold leading-none tracking-[0.18em] text-gray-500 transition-colors hover:text-black dark:text-gray-400 dark:hover:text-white"
        >
          PHOTOS
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <a
        href="https://victoriano.me"
        className="truncate text-[15px] font-bold leading-none text-black dark:text-white"
        onClick={onNavigate}
      >
        Victoriano Izquierdo
      </a>
      <a
        href={localizedPath(locale, "/")}
        className="shrink-0 text-[10px] font-semibold leading-none tracking-[0.16em] text-gray-500 dark:text-gray-400"
        onClick={onNavigate}
      >
        PHOTOS
      </a>
    </div>
  );
}
