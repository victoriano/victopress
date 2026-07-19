import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { isPhotoAiEnabled } from "~/lib/ai/photo-ai-service.server";

import "./tailwind.css";

export function loader({ context }: LoaderFunctionArgs) {
  // Only expose the capability bit. The user's Gemini key never reaches the browser.
  return json({ photoAiEnabled: isPhotoAiEnabled(context) });
}

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body className="h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
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
