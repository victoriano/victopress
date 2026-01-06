import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
} from "@remix-run/react";
import type { LinksFunction } from "@remix-run/cloudflare";

import "./tailwind.css";

/**
 * Global navigation loading indicator
 * Shows an animated progress bar at the top when navigating between pages
 */
function NavigationProgress() {
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  
  return (
    <>
      {/* Progress bar */}
      <div
        className={`fixed top-0 left-0 right-0 z-[100] h-0.5 transition-opacity duration-150 ${
          isLoading ? "opacity-100" : "opacity-0"
        }`}
      >
        <div 
          className="h-full bg-gray-900 dark:bg-white"
          style={{
            animation: isLoading ? "progress 2s ease-in-out infinite" : "none",
          }}
        />
      </div>
      
      {/* CSS animation for progress bar */}
      <style>{`
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 95%; }
        }
      `}</style>
    </>
  );
}

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    // Fallback fonts from Google Fonts (Proxima Nova is loaded locally via CSS)
    // TODO: Make font configurable via CMS settings
    href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap",
  },
];

// Script to detect and apply dark mode preference before hydration (prevents flash)
const darkModeScript = `
  (function() {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  })();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body className="h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <NavigationProgress />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
