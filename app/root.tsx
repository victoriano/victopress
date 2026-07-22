import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { isPhotoAiEnabled } from "~/lib/ai/photo-ai-service.server";
import { getStorage } from "~/lib/content-engine";
import { localeForRequest, localeResponseHeaders } from "~/lib/i18n.server";
import {
  DEFAULT_SITE_LANGUAGE_SETTINGS,
  readSiteLanguageSettings,
} from "~/lib/site-languages.server";

import stylesheet from "./tailwind.css?url";

// In development, Vite resolves `?url` differently on the server and in the
// browser (the client URL can contain an HMR timestamp). Keep the initial URL
// byte-for-byte stable so hydration never replaces a loaded stylesheet with a
// second request and exposes an unstyled frame.
const resilientStylesheet = import.meta.env.DEV
  ? "/app/tailwind.css?direct&v=linked-3"
  : stylesheet;

export async function loader({ context, request }: LoaderFunctionArgs) {
  // Only expose the capability bit. The user's Gemini key never reaches the browser.
  let siteLanguages = DEFAULT_SITE_LANGUAGE_SETTINGS;
  try {
    siteLanguages = await readSiteLanguageSettings(getStorage(context, request));
  } catch {
    // Setup and unconfigured-storage routes still need a renderable document.
  }
  const locale = localeForRequest(request, siteLanguages);
  return json(
    { photoAiEnabled: isPhotoAiEnabled(context), locale, siteLanguages },
    { headers: localeResponseHeaders(request, locale, siteLanguages) },
  );
}

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: resilientStylesheet },
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

// This tiny always-inline layer covers the only interval in which the main
// stylesheet could be unavailable. The zero-specificity icon fallbacks are a
// second line of defence: Tailwind overrides them as soon as it is present.
const styleGuardCss = `
  html.vp-styles-pending body {
    visibility: hidden !important;
  }

  :where(a[aria-label='Instagram'], a[aria-label='Twitter'], a[aria-label='LinkedIn']) {
    color: #4b5563;
    text-decoration: none;
  }

  :where(a[aria-label='Instagram'] > svg, a[aria-label='Twitter'] > svg) {
    width: 24px;
    height: 24px;
  }

  :where(a[aria-label='LinkedIn'] > svg) {
    width: 20px;
    height: 20px;
  }

  @media (min-width: 1024px) {
    :where(a[aria-label='Instagram'] > svg, a[aria-label='Twitter'] > svg) {
      width: 19px;
      height: 19px;
    }

    :where(a[aria-label='LinkedIn'] > svg) {
      width: 17px;
      height: 17px;
    }
  }

  :where(html.dark a[aria-label='Instagram'], html.dark a[aria-label='Twitter'], html.dark a[aria-label='LinkedIn']) {
    color: #d1d5db;
  }
`;

const styleGuardBootstrapScript = `
  document.documentElement.classList.add('vp-styles-pending');
`;

// Development CSS used to be injected only by Vite's HMR runtime. A background
// tab could process the removal half of an update after waking up without ever
// receiving the replacement, leaving the server-rendered page completely
// unstyled. The stylesheet is now a real <link>; this independent watchdog is a
// final safety net for interrupted requests, browser tab suspension, or tunnels
// reconnecting while the tab is hidden.
const styleRecoveryScript = `
  (function() {
    const readyProperty = '--victopress-styles-ready';
    const recoveryParameter = '__vp_style_recovery';
    const recoveryStorageKey = 'victopress:last-style-recovery';
    const recoveryCooldownMs = 10000;
    let checkTimer;

    function stylesAreReady() {
      return window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(readyProperty)
        .trim() === '1';
    }

    function syncStyleVisibility() {
      const ready = stylesAreReady();
      document.documentElement.classList.toggle('vp-styles-pending', !ready);
      return ready;
    }

    function clearRecoveryParameter() {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(recoveryParameter)) return;

      url.searchParams.delete(recoveryParameter);
      window.history.replaceState(window.history.state, '', url);
    }

    function checkStyles() {
      window.clearTimeout(checkTimer);
      if (syncStyleVisibility()) {
        clearRecoveryParameter();
        return;
      }

      checkTimer = window.setTimeout(function() {
        if (syncStyleVisibility()) {
          clearRecoveryParameter();
          return;
        }

        const now = Date.now();
        let lastRecovery = 0;

        try {
          lastRecovery = Number(
            window.sessionStorage.getItem(recoveryStorageKey) || 0
          );
        } catch (_) {
          // Storage can be unavailable in hardened/private browser contexts.
        }

        if (now - lastRecovery < recoveryCooldownMs) return;

        try {
          window.sessionStorage.setItem(recoveryStorageKey, String(now));
        } catch (_) {
          // The cache-busting navigation still works without session storage.
        }

        const recoveryUrl = new URL(window.location.href);
        recoveryUrl.searchParams.set(recoveryParameter, String(now));
        window.location.replace(recoveryUrl.href);
      }, 300);
    }

    window.addEventListener('pageshow', checkStyles);
    window.addEventListener('focus', checkStyles);
    window.addEventListener('online', checkStyles);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) checkStyles();
    });
    window.addEventListener('error', function(event) {
      const target = event.target;
      if (
        target instanceof HTMLLinkElement &&
        target.relList.contains('stylesheet')
      ) {
        checkStyles();
      }
    }, true);
    window.addEventListener('load', function(event) {
      const target = event.target;
      if (
        target instanceof HTMLLinkElement &&
        target.relList.contains('stylesheet')
      ) {
        checkStyles();
      }
    }, true);

    // Catch a failed HMR swap even while this is the active tab. The debounce
    // gives a normal link replacement time to finish before checking the CSS.
    new MutationObserver(checkStyles).observe(document.head, {
      childList: true,
    });

    // The script sits after <Links>, so a healthy render-blocking stylesheet is
    // already available here and the body is revealed before its first paint.
    syncStyleVisibility();

    if (document.readyState === 'complete') {
      checkStyles();
    } else {
      window.addEventListener('load', checkStyles, { once: true });
    }
  })();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang={data?.locale || "es"} className="h-full" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: styleGuardCss }} />
        <script dangerouslySetInnerHTML={{ __html: styleGuardBootstrapScript }} />
        <Meta />
        <Links />
        {/* Inline script to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
        <script dangerouslySetInnerHTML={{ __html: styleRecoveryScript }} />
      </head>
      <body
        className="victopress-app-body h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
        // The main stylesheet overrides this with !important. If that sheet is
        // absent for even one style recalculation, the document cannot paint an
        // unstyled frame; no JavaScript or observer timing is involved.
        style={{ display: "none" }}
      >
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
