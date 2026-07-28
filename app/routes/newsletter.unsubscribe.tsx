import { json } from "@remix-run/cloudflare";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { NewsletterStatusPage } from "~/components/NewsletterStatusPage";
import { getStorage } from "~/lib/content-engine";
import { localizedPath, normalizeLocale } from "~/lib/i18n";
import {
  newsletterBlogUrl,
  resolveNewsletterConfig,
} from "~/lib/newsletter/config.server";
import {
  inspectNewsletterUnsubscribeToken,
  NewsletterConfigurationError,
  unsubscribeNewsletterToken,
} from "~/lib/newsletter/newsletter-service.server";
import { maskNewsletterEmail } from "~/lib/newsletter/subscriber-store.server";

export const meta: MetaFunction = () => [
  { title: "Unsubscribe — Victoriano Izquierdo" },
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
    const config = resolveNewsletterConfig(context, request);
    const subscriber = await inspectNewsletterUnsubscribeToken({
      storage: getStorage(context, request),
      config,
      token,
    });
    const locale = subscriber?.locale || fallbackLocale;
    return json(
      {
        state: !subscriber
          ? "invalid"
          : subscriber.status === "unsubscribed"
            ? "unsubscribed"
            : "ready",
        locale,
        maskedEmail: subscriber ? maskNewsletterEmail(subscriber.email) : null,
        token,
        blogPath: newsletterBlogUrl(config, locale),
      },
      { status: subscriber ? 200 : 400 },
    );
  } catch (error) {
    if (!(error instanceof NewsletterConfigurationError)) throw error;
    return json(
      {
        state: "unavailable" as const,
        locale: fallbackLocale,
        maskedEmail: null,
        token: "",
        blogPath: localizedPath(fallbackLocale, "/blog"),
      },
      { status: 503 },
    );
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const fallbackLocale = normalizeLocale(url.searchParams.get("lang")) || "es";

  try {
    const subscriber = await unsubscribeNewsletterToken({
      storage: getStorage(context, request),
      config: resolveNewsletterConfig(context, request),
      token,
    });
    if (!subscriber) {
      return json(
        { state: "invalid" as const, locale: fallbackLocale },
        { status: 400 },
      );
    }
    return json({
      state: "unsubscribed" as const,
      locale: subscriber.locale,
    });
  } catch (error) {
    if (!(error instanceof NewsletterConfigurationError)) throw error;
    return json(
      { state: "unavailable" as const, locale: fallbackLocale },
      { status: 503 },
    );
  }
}

export default function NewsletterUnsubscribePage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const state = actionData?.state || loaderData.state;
  const locale = actionData?.locale || loaderData.locale;
  const spanish = locale === "es";

  if (state === "unsubscribed") {
    return (
      <NewsletterStatusPage
        title={spanish ? "Te has dado de baja" : "You are unsubscribed"}
        description={spanish
          ? "No recibirás más artículos por correo."
          : "You will not receive any more posts by email."}
        homePath={loaderData.blogPath}
        action={
          <Link
            to={loaderData.blogPath}
            className="text-sm font-semibold text-gray-900 underline dark:text-white"
          >
            {spanish ? "Volver al blog" : "Back to the blog"}
          </Link>
        }
      />
    );
  }

  if (state === "ready") {
    return (
      <NewsletterStatusPage
        title={spanish ? "¿Quieres darte de baja?" : "Unsubscribe?"}
        description={spanish
          ? `Dejarás de recibir los próximos artículos en ${loaderData.maskedEmail}.`
          : `You will stop receiving future posts at ${loaderData.maskedEmail}.`}
        homePath={loaderData.blogPath}
        action={
          <Form
            method="post"
            action={`?token=${encodeURIComponent(loaderData.token)}`}
          >
            <button
              type="submit"
              className="rounded bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950"
            >
              {spanish ? "Confirmar baja" : "Confirm unsubscribe"}
            </button>
          </Form>
        }
      />
    );
  }

  return (
    <NewsletterStatusPage
      title={spanish ? "No se puede completar la baja" : "Unable to unsubscribe"}
      description={state === "invalid"
        ? spanish
          ? "El enlace no es válido."
          : "The unsubscribe link is not valid."
        : spanish
          ? "Inténtalo de nuevo dentro de unos minutos."
          : "Please try again in a few minutes."}
      homePath={loaderData.blogPath}
    />
  );
}
