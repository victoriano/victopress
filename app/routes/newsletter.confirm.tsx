import { json } from "@remix-run/cloudflare";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { Link, useLoaderData } from "@remix-run/react";
import { NewsletterStatusPage } from "~/components/NewsletterStatusPage";
import { getStorage } from "~/lib/content-engine";
import { localizedPath, normalizeLocale } from "~/lib/i18n";
import { resolveNewsletterConfig } from "~/lib/newsletter/config.server";
import {
  confirmNewsletterToken,
  NewsletterConfigurationError,
} from "~/lib/newsletter/newsletter-service.server";

export const meta: MetaFunction = () => [
  { title: "Newsletter — Victoriano Izquierdo" },
  { name: "robots", content: "noindex, nofollow" },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
});

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const fallbackLocale = normalizeLocale(url.searchParams.get("lang")) || "es";

  try {
    const result = await confirmNewsletterToken({
      storage: getStorage(context, request),
      config: resolveNewsletterConfig(context, request),
      token,
    });
    const locale = result.subscriber?.locale || fallbackLocale;
    return json(
      {
        state: result.result,
        locale,
        blogPath: localizedPath(locale, "/blog"),
      },
      { status: result.result === "invalid" ? 400 : 200 },
    );
  } catch (error) {
    if (!(error instanceof NewsletterConfigurationError)) throw error;
    return json(
      {
        state: "unavailable" as const,
        locale: fallbackLocale,
        blogPath: localizedPath(fallbackLocale, "/blog"),
      },
      { status: 503 },
    );
  }
}

export default function NewsletterConfirmPage() {
  const data = useLoaderData<typeof loader>();
  const spanish = data.locale === "es";
  const content = {
    confirmed: {
      title: spanish ? "Suscripción confirmada" : "Subscription confirmed",
      description: spanish
        ? "Ya recibirás por correo los próximos artículos."
        : "You will now receive future posts by email.",
    },
    already_confirmed: {
      title: spanish ? "Ya estabas suscrito" : "You are already subscribed",
      description: spanish
        ? "No tienes que hacer nada más."
        : "There is nothing else you need to do.",
    },
    unsubscribed: {
      title: spanish ? "Esta suscripción está dada de baja" : "This subscription is inactive",
      description: spanish
        ? "Puedes volver a suscribirte desde el pie del blog."
        : "You can subscribe again from the blog footer.",
    },
    invalid: {
      title: spanish ? "El enlace no es válido" : "This link is not valid",
      description: spanish
        ? "Puede haber caducado. Solicita un nuevo correo desde el pie del blog."
        : "It may have expired. Request a new email from the blog footer.",
    },
    unavailable: {
      title: spanish ? "Newsletter no disponible" : "Newsletter unavailable",
      description: spanish
        ? "Inténtalo de nuevo dentro de unos minutos."
        : "Please try again in a few minutes.",
    },
  } as const;
  const selected = content[data.state];

  return (
    <NewsletterStatusPage
      title={selected.title}
      description={selected.description}
      action={
        <Link
          to={data.blogPath}
          className="inline-flex rounded bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950"
        >
          {spanish ? "Volver al blog" : "Back to the blog"}
        </Link>
      }
    />
  );
}
