/**
 * Theme Toggle Component
 * 
 * Toggles between light and dark mode with localStorage persistence
 */

import { useEffect, useState } from "react";
import { photoMessages, type Locale } from "~/lib/i18n";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type Theme,
} from "~/lib/theme";

interface ThemeToggleProps {
  locale?: Locale;
  size?: "default" | "compact";
}

export function ThemeToggle({
  locale = "en",
  size = "default",
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const messages = photoMessages[locale];
  const buttonSizeClasses = size === "compact" ? "p-1 rounded-md" : "p-2 rounded-lg";
  const iconSizeClasses = size === "compact" ? "w-4 h-4" : "w-5 h-5";

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const initialTheme = resolveTheme(readStoredTheme(), mediaQuery.matches);
    applyTheme(initialTheme, { notify: false });
    setTheme(initialTheme);

    const handleSystemChange = (event: MediaQueryListEvent) => {
      if (readStoredTheme()) return;
      const nextTheme = resolveTheme(null, event.matches);
      applyTheme(nextTheme);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = resolveTheme(event.newValue, mediaQuery.matches);
      applyTheme(nextTheme);
    };
    const handleThemeChange = (event: Event) => {
      setTheme((event as CustomEvent<Theme>).detail);
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  // Prevent hydration mismatch by not rendering until mounted
  if (!theme) {
    return (
      <button
        className={`${buttonSizeClasses} bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400`}
        data-theme-toggle-size={size}
        aria-label={messages.toggleTheme}
      >
        <span className={`${iconSizeClasses} block`} />
      </button>
    );
  }

  const isDark = theme === "dark";
  const nextTheme: Theme = isDark ? "light" : "dark";

  return (
    <button
      onClick={() => {
        applyTheme(nextTheme, { persist: true });
      }}
      className={`${buttonSizeClasses} bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
      data-theme-toggle-size={size}
      aria-label={isDark ? messages.switchToLight : messages.switchToDark}
      title={isDark ? messages.switchToLight : messages.switchToDark}
    >
      {isDark ? (
        // Sun icon for light mode
        <svg className={iconSizeClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        // Moon icon for dark mode
        <svg className={iconSizeClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
