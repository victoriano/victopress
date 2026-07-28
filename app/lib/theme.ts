export const THEME_STORAGE_KEY = "theme";
export const THEME_CHANGE_EVENT = "victopress:theme-change";

export type Theme = "dark" | "light";

export const THEME_FAVICONS: Record<Theme, string> = {
  dark: "/favicon-dark.svg",
  light: "/favicon-light.svg",
};

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export function resolveTheme(
  storedTheme: string | null,
  prefersDark: boolean,
): Theme {
  return isTheme(storedTheme) ? storedTheme : prefersDark ? "dark" : "light";
}

export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function applyTheme(
  theme: Theme,
  {
    notify = true,
    persist = false,
  }: { notify?: boolean; persist?: boolean } = {},
) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  document
    .querySelector<HTMLLinkElement>('link[data-theme-favicon="true"]')
    ?.setAttribute("href", THEME_FAVICONS[theme]);

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The visual preference still applies when storage is unavailable.
    }
  }

  if (notify) {
    window.dispatchEvent(
      new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }),
    );
  }
}
