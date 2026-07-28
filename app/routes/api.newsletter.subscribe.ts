import { json } from "@remix-run/cloudflare";
import type {
  ActionFunctionArgs,
  HeadersFunction,
} from "@remix-run/cloudflare";
import { normalizeLocale } from "~/lib/i18n";
import { getStorage } from "~/lib/content-engine";
import { resolveNewsletterConfig } from "~/lib/newsletter/config.server";
import {
  NewsletterConfigurationError,
  NewsletterValidationError,
  requestNewsletterSubscription,
} from "~/lib/newsletter/newsletter-service.server";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export const headers: HeadersFunction = () => responseHeaders;

function message(
  locale: "es" | "en",
  key: "accepted" | "invalid" | "unavailable",
): string {
  const messages = {
    es: {
      accepted: "Revisa tu correo para confirmar la suscripción.",
      invalid: "Introduce un correo electrónico válido.",
      unavailable: "No he podido iniciar la suscripción. Inténtalo de nuevo en unos minutos.",
    },
    en: {
      accepted: "Check your inbox to confirm your subscription.",
      invalid: "Enter a valid email address.",
      unavailable: "I could not start the subscription. Please try again in a few minutes.",
    },
  } as const;
  return messages[locale][key];
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json(
      { ok: false, message: "Method not allowed." },
      { status: 405, headers: responseHeaders },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return json(
      { ok: false, message: "Request too large." },
      { status: 413, headers: responseHeaders },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(
      { ok: false, message: "Invalid request." },
      { status: 400, headers: responseHeaders },
    );
  }

  const locale = normalizeLocale(formData.get("locale")) || "es";
  if (String(formData.get("company") || "").trim()) {
    return json(
      { ok: true, message: message(locale, "accepted") },
      { status: 202, headers: responseHeaders },
    );
  }

  try {
    await requestNewsletterSubscription({
      storage: getStorage(context, request),
      config: resolveNewsletterConfig(context, request),
      email: String(formData.get("email") || ""),
      locale,
      source: String(formData.get("source") || "blog-footer"),
    });
    return json(
      { ok: true, message: message(locale, "accepted") },
      { status: 202, headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof NewsletterValidationError) {
      return json(
        { ok: false, message: message(locale, "invalid") },
        { status: 400, headers: responseHeaders },
      );
    }
    const unavailable = error instanceof NewsletterConfigurationError;
    console.error(
      unavailable
        ? "[Newsletter] Subscription requested before configuration was complete."
        : "[Newsletter] Confirmation delivery failed.",
      unavailable ? undefined : error,
    );
    return json(
      { ok: false, message: message(locale, "unavailable") },
      { status: 503, headers: responseHeaders },
    );
  }
}
