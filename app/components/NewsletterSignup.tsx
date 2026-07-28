import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import type { Locale } from "~/lib/i18n";

interface SubscribeResponse {
  ok: boolean;
  message: string;
}

const copy = {
  es: {
    eyebrow: "Newsletter",
    title: "Recibe los próximos artículos por correo",
    description:
      "Una nota cuando publique algo nuevo. Sin algoritmos ni ruido.",
    email: "Tu correo electrónico",
    button: "Suscribirme",
    submitting: "Enviando…",
    privacy:
      "Te enviaré un correo para confirmar. Puedes darte de baja cuando quieras.",
  },
  en: {
    eyebrow: "Newsletter",
    title: "Get new posts in your inbox",
    description:
      "One note whenever I publish something new. No algorithms, no noise.",
    email: "Your email address",
    button: "Subscribe",
    submitting: "Sending…",
    privacy:
      "I will email you to confirm. You can unsubscribe at any time.",
  },
} as const;

export function NewsletterSignup({
  locale,
  enabled,
  source,
  className = "",
}: {
  locale: Locale;
  enabled: boolean;
  source: string;
  className?: string;
}) {
  const fetcher = useFetcher<SubscribeResponse>();
  const formRef = useRef<HTMLFormElement>(null);
  const messages = copy[locale];
  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);

  if (!enabled) return null;

  return (
    <section
      className={`newsletter-signup border-y border-gray-200 py-12 dark:border-gray-800 ${className}`}
      aria-labelledby={`newsletter-heading-${source}`}
    >
      <div className="max-w-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
          {messages.eyebrow}
        </p>
        <h2
          id={`newsletter-heading-${source}`}
          className="mb-3 font-['Proxima_Nova_Title','Proxima_Nova',sans-serif] text-[26px] font-medium leading-tight text-[#121212] dark:text-white"
        >
          {messages.title}
        </h2>
        <p className="mb-6 max-w-xl text-[15px] leading-6 text-gray-600 dark:text-gray-300">
          {messages.description}
        </p>

        <fetcher.Form
          ref={formRef}
          method="post"
          action="/api/newsletter/subscribe"
          className="max-w-xl"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="source" value={source} />
          <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor={`newsletter-company-${source}`}>Company</label>
            <input
              id={`newsletter-company-${source}`}
              type="text"
              name="company"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-0">
            <label className="sr-only" htmlFor={`newsletter-email-${source}`}>
              {messages.email}
            </label>
            <input
              id={`newsletter-email-${source}`}
              type="email"
              name="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              placeholder={messages.email}
              disabled={submitting}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900 disabled:opacity-60 sm:rounded-r-none dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:border-white dark:focus:ring-white"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60 sm:rounded-l-none dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
            >
              {submitting ? messages.submitting : messages.button}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {messages.privacy}
          </p>
          {fetcher.data?.message && (
            <p
              className={`mt-3 text-sm ${
                fetcher.data.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-700 dark:text-red-400"
              }`}
              role="status"
              aria-live="polite"
            >
              {fetcher.data.message}
            </p>
          )}
        </fetcher.Form>
      </div>
    </section>
  );
}
