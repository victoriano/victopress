import { json } from "@remix-run/cloudflare";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { AdminLayout } from "~/components/AdminLayout";
import {
  getContentIndex,
  getStorage,
  scanBlog,
} from "~/lib/content-engine";
import {
  buildHeadlessBlogPost,
  resolveHeadlessBlogConfig,
} from "~/lib/headless-blog";
import { normalizeLocale } from "~/lib/i18n";
import { resolveNewsletterConfig } from "~/lib/newsletter/config.server";
import {
  NewsletterCampaignAlreadySentError,
  NewsletterConfigurationError,
  NewsletterValidationError,
  sendNewsletterCampaign,
} from "~/lib/newsletter/newsletter-service.server";
import {
  importNewsletterSubscriberCsv,
  NewsletterCsvImportError,
} from "~/lib/newsletter/subscriber-import.server";
import {
  listNewsletterCampaigns,
  listNewsletterOpens,
  listNewsletterSubscribers,
  newsletterSubscriberStats,
  updateNewsletterSubscriberName,
} from "~/lib/newsletter/subscriber-store.server";
import type { NewsletterSubscriberInteractions } from "~/lib/newsletter/types";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";

export const meta: MetaFunction = () => [
  { title: "Newsletter — VictoPress" },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
});

const subscriberFilters = ["all", "active", "pending", "unsubscribed"] as const;
type SubscriberFilter = typeof subscriberFilters[number];
const SUBSCRIBERS_PER_PAGE = 100;
const MAX_CSV_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  const storage = getStorage(context, request);
  const url = new URL(request.url);
  const [username, allSubscribers, campaigns, contentIndex] = await Promise.all([
    getAdminUser(request, context),
    listNewsletterSubscribers(storage),
    listNewsletterCampaigns(storage),
    getContentIndex(storage),
  ]);
  const requestedFilter = url.searchParams.get("status");
  const subscriberFilter: SubscriberFilter = subscriberFilters.includes(
      requestedFilter as SubscriberFilter,
    )
    ? requestedFilter as SubscriberFilter
    : "all";
  const filteredSubscribers = subscriberFilter === "all"
    ? allSubscribers
    : allSubscribers.filter((subscriber) => subscriber.status === subscriberFilter);
  const requestedPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const subscriberPageCount = Math.max(
    1,
    Math.ceil(filteredSubscribers.length / SUBSCRIBERS_PER_PAGE),
  );
  const subscriberPage = Math.min(
    subscriberPageCount,
    Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1),
  );
  const subscribers = filteredSubscribers.slice(
    (subscriberPage - 1) * SUBSCRIBERS_PER_PAGE,
    subscriberPage * SUBSCRIBERS_PER_PAGE,
  );
  const campaignOpenRecords = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaignId: campaign.id,
      records: await listNewsletterOpens(storage, campaign.id),
    })),
  );
  const campaignOpenCounts = Object.fromEntries(
    campaignOpenRecords.map(({ campaignId, records }) => [
      campaignId,
      records.length,
    ]),
  );
  const allSubscriberOpenStats = campaignOpenRecords
    .flatMap(({ records }) => records)
    .reduce<Record<string, { openCount: number; lastOpenedAt: string | null }>>(
      (stats, record) => {
        const existing = stats[record.subscriberId] || {
          openCount: 0,
          lastOpenedAt: null,
        };
        stats[record.subscriberId] = {
          openCount: existing.openCount + record.openCount,
          lastOpenedAt:
            !existing.lastOpenedAt ||
              record.lastOpenedAt.localeCompare(existing.lastOpenedAt) > 0
              ? record.lastOpenedAt
              : existing.lastOpenedAt,
        };
        return stats;
      },
      {},
    );
  const subscriberOpenStats = Object.fromEntries(
    subscribers.map((subscriber) => [
      subscriber.id,
      allSubscriberOpenStats[subscriber.id] || {
        openCount: 0,
        lastOpenedAt: null,
      },
    ]),
  );
  const config = resolveNewsletterConfig(context, request);
  const posts = contentIndex.posts
    .filter((post) => !post.draft)
    .sort((left, right) =>
      new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime()
    )
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      date: post.date ? new Date(post.date).toISOString() : null,
    }));

  return json({
    username,
    subscribers,
    campaigns,
    campaignOpenCounts,
    subscriberOpenStats,
    posts,
    stats: newsletterSubscriberStats(allSubscribers),
    subscriberFilter,
    subscriberPagination: {
      page: subscriberPage,
      pageCount: subscriberPageCount,
      total: filteredSubscribers.length,
      perPage: SUBSCRIBERS_PER_PAGE,
    },
    configuration: {
      configured: config.configured,
      missing: config.missing,
      fromEmail: config.fromEmail || null,
    },
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  await checkAdminAuth(request, context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "import-subscribers") {
    if (formData.get("confirmImport") !== "yes") {
      return json(
        {
          ok: false,
          error: "Confirm that the CSV contains people who already subscribed.",
        },
        { status: 400 },
      );
    }
    const locale = normalizeLocale(formData.get("locale"));
    const upload = formData.get("csv");
    if (
      !locale ||
      !upload ||
      typeof upload === "string" ||
      typeof upload.text !== "function"
    ) {
      return json(
        { ok: false, error: "Choose a CSV file and subscriber language." },
        { status: 400 },
      );
    }
    if (upload.size > MAX_CSV_UPLOAD_BYTES) {
      return json(
        { ok: false, error: "The CSV must be no larger than 5 MB." },
        { status: 413 },
      );
    }
    try {
      const result = await importNewsletterSubscriberCsv({
        storage: getStorage(context, request),
        csv: await upload.text(),
        locale,
      });
      return json({
        ok: true,
        message:
          `Imported ${result.importedSubscribers} subscribers ` +
          `(${result.created} new, ${result.updated} updated, ` +
          `${result.unchanged} unchanged). ` +
          `${result.preservedUnsubscribed} existing unsubscribed records stayed unsubscribed.` +
          (result.duplicateRows > 0
            ? ` ${result.duplicateRows} duplicate CSV rows were merged.`
            : ""),
      });
    } catch (error) {
      if (error instanceof NewsletterCsvImportError) {
        return json({ ok: false, error: error.message }, { status: 400 });
      }
      console.error("[Newsletter] Subscriber CSV import failed.", error);
      return json(
        {
          ok: false,
          error: "VictoPress could not complete the subscriber import.",
        },
        { status: 500 },
      );
    }
  }

  if (intent === "update-subscriber-name") {
    const subscriberId = String(formData.get("subscriberId") || "");
    const name = String(formData.get("name") || "");
    if (!/^[a-f0-9]{64}$/.test(subscriberId) || name.trim().length > 200) {
      return json(
        { ok: false, error: "The subscriber name is not valid." },
        { status: 400 },
      );
    }
    const subscriber = await updateNewsletterSubscriberName({
      storage: getStorage(context, request),
      id: subscriberId,
      name,
    });
    if (!subscriber) {
      return json(
        { ok: false, error: "That subscriber no longer exists." },
        { status: 404 },
      );
    }
    return json({
      ok: true,
      message: subscriber.name
        ? `Saved the name for ${subscriber.email}.`
        : `Removed the saved name for ${subscriber.email}.`,
    });
  }

  if (intent !== "send") {
    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  }
  if (formData.get("confirmSend") !== "yes") {
    return json(
      { ok: false, error: "Confirm that you want to email every active subscriber." },
      { status: 400 },
    );
  }

  const postSlug = String(formData.get("postSlug") || "").trim();
  const locale = normalizeLocale(formData.get("locale"));
  const subject = String(formData.get("subject") || "").trim();
  if (!postSlug || !locale) {
    return json(
      { ok: false, error: "Choose a published post and language." },
      { status: 400 },
    );
  }

  try {
    const storage = getStorage(context, request);
    const posts = await scanBlog(storage);
    const headlessPost = buildHeadlessBlogPost(
      posts,
      postSlug,
      resolveHeadlessBlogConfig(context, request),
      locale,
    );
    if (!headlessPost) {
      return json(
        { ok: false, error: "The selected published post no longer exists." },
        { status: 404 },
      );
    }
    if (!headlessPost.post.availableLocales.includes(locale)) {
      return json(
        {
          ok: false,
          error: "That post does not have a published edition in the selected language.",
        },
        { status: 400 },
      );
    }
    const campaign = await sendNewsletterCampaign({
      storage,
      config: resolveNewsletterConfig(context, request),
      post: headlessPost.post,
      locale,
      subject: subject || undefined,
    });
    const recipientCount = campaign.batches.reduce(
      (total, batch) => total + (batch.recipientCount || 0),
      0,
    );
    return json({
      ok: true,
      message: `Newsletter sent to ${recipientCount} active subscriber${recipientCount === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    if (error instanceof NewsletterConfigurationError) {
      return json(
        { ok: false, error: "Complete the Resend configuration before sending." },
        { status: 503 },
      );
    }
    if (error instanceof NewsletterCampaignAlreadySentError) {
      return json({ ok: false, error: error.message }, { status: 409 });
    }
    if (error instanceof NewsletterValidationError) {
      return json(
        {
          ok: false,
          error: error.message === "no_active_subscribers"
            ? "There are no active subscribers for that language."
            : "The campaign details are not valid.",
        },
        { status: 400 },
      );
    }
    console.error("[Newsletter] Campaign delivery failed.", error);
    return json(
      {
        ok: false,
        error: "Resend could not complete the campaign. The saved campaign can be retried safely.",
      },
      { status: 502 },
    );
  }
}

export default function AdminNewsletter() {
  const {
    username,
    subscribers,
    campaigns,
    campaignOpenCounts,
    subscriberOpenStats,
    posts,
    stats,
    subscriberFilter,
    subscriberPagination,
    configuration,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = navigation.formData?.get("intent");
  const isSending =
    navigation.state === "submitting" && submittingIntent === "send";
  const isImporting =
    navigation.state === "submitting" &&
    submittingIntent === "import-subscribers";

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Newsletter
          </h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Subscribers live in VictoPress storage; Resend only delivers the emails.
          </p>
        </div>

        {!configuration.configured && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <h2 className="font-semibold">Finish newsletter configuration</h2>
            <p className="mt-1 text-sm">
              Missing: {configuration.missing.join(", ")}. Add secrets through
              Cloudflare Pages or <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">.dev.vars</code>;
              never commit their values.
            </p>
          </div>
        )}

        {actionData && (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              actionData.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
            }`}
            role="status"
          >
            {"message" in actionData
              ? actionData.message
              : actionData.error}
          </div>
        )}

        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Active" value={stats.active} tone="green" />
          <StatCard label="Pending" value={stats.pending} tone="amber" />
          <StatCard label="Unsubscribed" value={stats.unsubscribed} tone="gray" />
          <StatCard label="Total records" value={stats.total} tone="gray" />
        </div>

        <div className="mb-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <div className="mb-5">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Send a post
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                The complete article is sent once per language, with a personal unsubscribe link.
              </p>
            </div>

            <Form method="post" className="space-y-5">
              <input type="hidden" name="intent" value="send" />
              <div>
                <label
                  htmlFor="newsletter-post"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Published post
                </label>
                <select
                  id="newsletter-post"
                  name="postSlug"
                  required
                  defaultValue=""
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="" disabled>Select a post…</option>
                  {posts.map((post) => (
                    <option key={post.slug} value={post.slug}>
                      {post.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div>
                  <label
                    htmlFor="newsletter-locale"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Language
                  </label>
                  <select
                    id="newsletter-locale"
                    name="locale"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="es">Español ({stats.activeByLocale.es})</option>
                    <option value="en">English ({stats.activeByLocale.en})</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="newsletter-subject"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Subject <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="newsletter-subject"
                    name="subject"
                    maxLength={200}
                    placeholder="Defaults to the post title"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <input
                  type="checkbox"
                  name="confirmSend"
                  value="yes"
                  required
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  Send this article now to every active subscriber in the selected language.
                  This external email action cannot be recalled.
                </span>
              </label>

              <button
                type="submit"
                disabled={!configuration.configured || isSending || posts.length === 0}
                className="inline-flex rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
              >
                {isSending ? "Sending…" : "Send newsletter"}
              </button>
            </Form>
          </section>

          <aside className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold text-gray-900 dark:text-white">Delivery</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-gray-500 dark:text-gray-400">From</dt>
                <dd className="mt-1 break-words text-gray-900 dark:text-white">
                  {configuration.fromEmail || "Not configured"}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Spanish audience</dt>
                <dd className="mt-1 text-gray-900 dark:text-white">
                  {stats.activeByLocale.es} active
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">English audience</dt>
                <dd className="mt-1 text-gray-900 dark:text-white">
                  {stats.activeByLocale.en} active
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,520px)]">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Import subscribers
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Upload a Substack subscriber CSV. VictoPress keeps the original
                <strong className="font-medium text-gray-700 dark:text-gray-300">
                  {" "}Start date
                </strong>
                , name, free subscription source and interaction history.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <li>Paid plans, Stripe, revenue and paid-source columns are ignored.</li>
                <li>Existing unsubscribed readers are never reactivated by an import.</li>
                <li>Imports are idempotent and merge duplicate email addresses.</li>
              </ul>
            </div>

            <Form
              method="post"
              encType="multipart/form-data"
              className="space-y-4"
            >
              <input type="hidden" name="intent" value="import-subscribers" />
              <div>
                <label
                  htmlFor="subscriber-csv"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Subscriber CSV
                </label>
                <input
                  id="subscriber-csv"
                  name="csv"
                  type="file"
                  accept=".csv,text/csv"
                  required
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 file:mr-4 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:file:bg-gray-800"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Maximum 5 MB and 10,000 rows.
                </p>
              </div>
              <div>
                <label
                  htmlFor="subscriber-import-locale"
                  className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Language for new subscribers
                </label>
                <select
                  id="subscriber-import-locale"
                  name="locale"
                  defaultValue="es"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </div>
              <label className="flex items-start gap-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <input
                  type="checkbox"
                  name="confirmImport"
                  value="yes"
                  required
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  These people already consented to receive this newsletter.
                </span>
              </label>
              <button
                type="submit"
                disabled={isImporting}
                className="inline-flex rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
              >
                {isImporting ? "Importing…" : "Import subscribers"}
              </button>
            </Form>
          </div>
        </section>

        <section className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white">Campaigns</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Opens are detections, not proof of reading: inboxes can block, cache, or preload images.
            </p>
          </div>
          {campaigns.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              No newsletter has been sent yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-5 py-3">Post</th>
                    <th className="px-5 py-3">Language</th>
                    <th className="px-5 py-3">Recipients</th>
                    <th className="px-5 py-3">Open detections</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3"><span className="sr-only">Report</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="px-5 py-4">
                        <Link
                          to={`/admin/blog/${campaign.postSlug}`}
                          className="font-medium text-gray-900 hover:underline dark:text-white"
                        >
                          {campaign.postTitle}
                        </Link>
                      </td>
                      <td className="px-5 py-4 uppercase text-gray-600 dark:text-gray-300">
                        {campaign.locale}
                      </td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                        {campaign.batches.reduce(
                          (total, batch) => total + (batch.recipientCount || 0),
                          0,
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                        {campaignOpenCounts[campaign.id]}{" "}
                        <span className="text-gray-400">
                          ({formatOpenRate(
                            campaignOpenCounts[campaign.id],
                            campaign.batches.reduce(
                              (total, batch) => total + (batch.recipientCount || 0),
                              0,
                            ),
                          )})
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={campaign.status} />
                      </td>
                      <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                        {formatDate(campaign.createdAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/admin/newsletter/${campaign.id}`}
                          className="font-medium text-gray-900 hover:underline dark:text-white"
                        >
                          Report
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="subscribers" className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Subscribers</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Consent records and interaction history stored privately in VictoPress.
                </p>
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {subscriberPagination.total}
              </span>
            </div>
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Subscriber status">
              {subscriberFilters.map((filter) => {
                const count = filter === "all" ? stats.total : stats[filter];
                const selected = subscriberFilter === filter;
                return (
                  <Link
                    key={filter}
                    to={subscriberPageUrl(filter, 1)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? "bg-gray-950 text-white dark:bg-white dark:text-gray-950"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    {filter === "all"
                      ? "All"
                      : filter[0].toUpperCase() + filter.slice(1)} ({count})
                  </Link>
                );
              })}
            </nav>
          </div>
          {subscribers.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              {subscriberFilter === "all"
                ? "No one has subscribed yet."
                : `There are no ${subscriberFilter} subscribers.`}
            </p>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Email</th>
                      <th className="px-5 py-3">Signed up</th>
                      <th className="px-5 py-3">Source</th>
                      <th className="px-5 py-3">Open detections</th>
                      <th className="px-5 py-3">Clicks</th>
                      <th className="px-5 py-3">Post views</th>
                      <th className="px-5 py-3">Last interaction</th>
                      <th className="px-5 py-3">Language</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {subscribers.map((subscriber) => {
                      const openStats = subscriberOpenStats[subscriber.id];
                      return (
                        <tr key={subscriber.id} className="align-top">
                          <td className="min-w-56 px-5 py-4">
                            <Form method="post" className="flex items-center gap-2">
                              <input
                                type="hidden"
                                name="intent"
                                value="update-subscriber-name"
                              />
                              <input
                                type="hidden"
                                name="subscriberId"
                                value={subscriber.id}
                              />
                              <input
                                name="name"
                                defaultValue={subscriber.name || ""}
                                maxLength={200}
                                aria-label={`Name for ${subscriber.email}`}
                                placeholder="Add a name"
                                className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                              />
                              <button
                                type="submit"
                                className="rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                              >
                                Save
                              </button>
                            </Form>
                          </td>
                          <td className="px-5 py-4 text-gray-900 dark:text-white">
                            {subscriber.email}
                            {(subscriber.country || subscriber.region) && (
                              <span className="mt-1 block text-xs text-gray-400">
                                {[subscriber.country, subscriber.region]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-gray-600 dark:text-gray-300">
                            {formatDate(subscriber.signupAt || subscriber.createdAt)}
                          </td>
                          <td className="max-w-52 px-5 py-4 text-gray-600 dark:text-gray-300">
                            <span className="break-words">
                              {subscriber.subscriptionSource || subscriber.source}
                            </span>
                            {subscriber.importedFrom && (
                              <span className="mt-1 block text-xs text-gray-400">
                                Imported from Substack
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-gray-600 dark:text-gray-300">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {openStats?.openCount || 0}
                            </span>
                            <span className="mt-1 block text-xs text-gray-400">
                              VictoPress · {subscriber.interactions?.emailsOpenedTotal || 0} imported
                            </span>
                          </td>
                          <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                            {subscriber.interactions?.linksClicked || 0}
                          </td>
                          <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                            {subscriber.interactions?.postViews || 0}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-gray-500 dark:text-gray-400">
                            {formatOptionalDate(
                              latestSubscriberInteraction(
                                subscriber.interactions,
                                openStats?.lastOpenedAt,
                              ),
                            )}
                          </td>
                          <td className="px-5 py-4 uppercase text-gray-600 dark:text-gray-300">
                            {subscriber.locale}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={subscriber.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {subscriberPagination.pageCount > 1 && (
                <nav
                  className="flex items-center justify-between gap-4 border-t border-gray-200 px-5 py-4 text-sm dark:border-gray-800"
                  aria-label="Subscriber pages"
                >
                  {subscriberPagination.page > 1 ? (
                    <Link
                      to={subscriberPageUrl(
                        subscriberFilter,
                        subscriberPagination.page - 1,
                      )}
                      className="font-medium text-gray-700 hover:underline dark:text-gray-200"
                    >
                      ← Previous
                    </Link>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-700">← Previous</span>
                  )}
                  <span className="text-gray-500 dark:text-gray-400">
                    Page {subscriberPagination.page} of {subscriberPagination.pageCount}
                  </span>
                  {subscriberPagination.page < subscriberPagination.pageCount ? (
                    <Link
                      to={subscriberPageUrl(
                        subscriberFilter,
                        subscriberPagination.page + 1,
                      )}
                      className="font-medium text-gray-700 hover:underline dark:text-gray-200"
                    >
                      Next →
                    </Link>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-700">Next →</span>
                  )}
                </nav>
              )}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}

function subscriberPageUrl(
  filter: SubscriberFilter,
  page: number,
): string {
  const search = new URLSearchParams();
  if (filter !== "all") search.set("status", filter);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return `/admin/newsletter${query ? `?${query}` : ""}#subscribers`;
}

function latestSubscriberInteraction(
  interactions: NewsletterSubscriberInteractions | undefined,
  currentLastOpenedAt: string | null | undefined,
): string | null {
  return [
    currentLastOpenedAt,
    interactions?.lastEmailOpenedAt,
    interactions?.lastClickedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] || null;
}

function formatOptionalDate(value: string | null): string {
  return value ? formatDate(value) : "—";
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "gray";
}) {
  const tones = {
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    gray: "text-gray-900 dark:text-white",
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "active" || status === "sent"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
    : status === "pending" || status === "sending"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
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
