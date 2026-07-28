import { json } from "@remix-run/cloudflare";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { Link, useLoaderData } from "@remix-run/react";
import { AdminLayout } from "~/components/AdminLayout";
import { getStorage } from "~/lib/content-engine";
import {
  getNewsletterCampaign,
  listNewsletterOpens,
  listNewsletterSubscribers,
} from "~/lib/newsletter/subscriber-store.server";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";

export const meta: MetaFunction = () => [
  { title: "Newsletter report — VictoPress" },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
});

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  const campaignId = params.campaignId || "";
  if (!/^[a-f0-9]{64}$/.test(campaignId)) {
    throw new Response("Campaign not found.", { status: 404 });
  }

  const storage = getStorage(context, request);
  const [username, campaign, subscribers, opens] = await Promise.all([
    getAdminUser(request, context),
    getNewsletterCampaign(storage, campaignId),
    listNewsletterSubscribers(storage),
    listNewsletterOpens(storage, campaignId),
  ]);
  if (!campaign) {
    throw new Response("Campaign not found.", { status: 404 });
  }

  const subscribersById = new Map(
    subscribers.map((subscriber) => [subscriber.id, subscriber]),
  );
  const opensBySubscriberId = new Map(
    opens.map((open) => [open.subscriberId, open]),
  );
  const recipients = campaign.recipientIds.map((subscriberId) => {
    const subscriber = subscribersById.get(subscriberId);
    const batch = campaign.batches.find((candidate) =>
      candidate.recipientIds.includes(subscriberId)
    );
    const deliveryStatus = batch?.sentRecipientIds
      ? batch.sentRecipientIds.includes(subscriberId)
        ? "sent"
        : "skipped"
      : batch?.status === "sent"
        ? "sent"
        : batch?.status || "pending";
    return {
      subscriberId,
      email: subscriber?.email || null,
      subscriberStatus: subscriber?.status || null,
      locale: subscriber?.locale || campaign.locale,
      deliveryStatus,
      open: opensBySubscriberId.get(subscriberId) || null,
    };
  });
  const sentCount = recipients.filter(
    (recipient) => recipient.deliveryStatus === "sent",
  ).length;
  const openedCount = recipients.filter((recipient) => recipient.open).length;

  return json({
    username,
    campaign,
    recipients,
    sentCount,
    openedCount,
  });
}

export default function AdminNewsletterCampaignReport() {
  const {
    username,
    campaign,
    recipients,
    sentCount,
    openedCount,
  } = useLoaderData<typeof loader>();

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        <Link
          to="/admin/newsletter"
          className="text-sm font-medium text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white"
        >
          ← Newsletter
        </Link>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {campaign.locale} · {campaign.status}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
              {campaign.postTitle}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Subject: {campaign.subject}
            </p>
          </div>
          <Link
            to={`/admin/blog/${campaign.postSlug}`}
            className="text-sm font-medium text-gray-900 underline dark:text-white"
          >
            View post
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric label="Recipients" value={recipients.length.toString()} />
          <Metric label="Sent" value={sentCount.toString()} />
          <Metric label="Open detections" value={openedCount.toString()} />
          <Metric
            label="Detected open rate"
            value={formatOpenRate(openedCount, sentCount)}
          />
        </div>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          “Open detected” means the recipient’s mail client requested a private
          tracking image. Image blocking can hide a real read, while privacy
          proxies and security scanners can create an open without a person
          reading the message.
        </div>

        <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Recipient report
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Stored privately in VictoPress; no IP address or user agent is retained.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Subscription</th>
                  <th className="px-5 py-3">Delivery</th>
                  <th className="px-5 py-3">Open detected</th>
                  <th className="px-5 py-3">First detected</th>
                  <th className="px-5 py-3">Last detected</th>
                  <th className="px-5 py-3">Detections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {recipients.map((recipient) => (
                  <tr key={recipient.subscriberId}>
                    <td className="px-5 py-4 text-gray-900 dark:text-white">
                      {recipient.email || "Subscriber record unavailable"}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={recipient.subscriberStatus || "unknown"} />
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={recipient.deliveryStatus} />
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={recipient.open ? "yes" : "no"} />
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                      {recipient.open
                        ? formatDate(recipient.open.firstOpenedAt)
                        : "—"}
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                      {recipient.open
                        ? formatDate(recipient.open.lastOpenedAt)
                        : "—"}
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                      {recipient.open?.openCount || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const positive = ["active", "sent", "yes"].includes(status);
  const pending = ["pending", "sending"].includes(status);
  const tone = positive
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
    : pending
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

function formatOpenRate(opens: number, recipients: number): string {
  if (recipients < 1) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(opens / recipients);
}
