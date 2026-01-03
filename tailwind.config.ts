import type { Config } from "tailwindcss";

export default {
  // Scan all Remix app files for class names (including responsive variants)
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Primary font: Proxima Nova (local files)
        // Alternatives: Montserrat, Google Sans (for future CMS config)
        // TODO: Make font configurable via CMS settings
        sans: [
          '"Proxima Nova"',
          '"Montserrat"',
          '"Google Sans"',
          '"Google Sans Text"',
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
    },
  },
  darkMode: "class",
  plugins: [],
} satisfies Config;
