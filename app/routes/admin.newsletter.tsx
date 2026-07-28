import { json } from "@remix-run/cloudflare";
import type {
  ActionFunctionArgs,
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
  listNewsletterCampaigns,
  listNewsletterSubscribers,
  newsletterSubscriberStats,
} from "~/lib/newsletter/subscriber-store.server";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";

export const meta: MetaFunction = () => [
  { title: "Newsletter — VictoPress" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  const storage = getStorage(context, request);
  const [username, subscribers, campaigns, contentIndex] = await Promise.all([
    getAdminUser(request, context),
    listNewsletterSubscribers(storage),
    listNewsletterCampaigns(storage),
    getContentIndex(storage),
  ]);
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
    posts,
    stats: newsletterSubscriberStats(subscribers),
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
  if (formData.get("intent") !== "send") {
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
    posts,
    stats,
    configuration,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSending = navigation.state === "submitting";

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

            {actionData && (
              <div
                className={`mb-5 rounded-lg border p-4 text-sm ${
                  actionData.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
                }`}
                role="status"
              >
                {actionData.ok ? actionData.message : actionData.error}
              </div>
            )}

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

        <section className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-white">Campaigns</h2>
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
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
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
                      <td className="px-5 py-4">
                        <StatusBadge status={campaign.status} />
                      </td>
                      <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                        {formatDate(campaign.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Subscribers</h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Double opt-in records stored privately in VictoPress.
              </p>
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">{stats.total}</span>
          </div>
          {subscribers.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
              No one has subscribed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Language</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {subscribers.slice(0, 250).map((subscriber) => (
                    <tr key={subscriber.id}>
                      <td className="px-5 py-4 text-gray-900 dark:text-white">
                        {subscriber.email}
                      </td>
                      <td className="px-5 py-4 uppercase text-gray-600 dark:text-gray-300">
                        {subscriber.locale}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={subscriber.status} />
                      </td>
                      <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                        {formatDate(subscriber.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {subscribers.length > 250 && (
                <p className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  Showing the 250 most recently updated records.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
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
