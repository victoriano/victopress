import type { Locale } from "~/lib/i18n";
import type { StorageAdapter } from "~/lib/content-engine";
import type { HeadlessBlogPost } from "~/lib/headless-blog";
import type { NewsletterConfig } from "./config.server";
import {
  createNewsletterToken,
  newsletterSubscriberId,
  sha256Hex,
  verifyNewsletterToken,
} from "./crypto.server";
import {
  buildConfirmationEmail,
  buildNewsletterEmail,
} from "./email-templates.server";
import {
  confirmNewsletterSubscriber,
  getNewsletterCampaign,
  getNewsletterSubscriber,
  listNewsletterSubscribers,
  markConfirmationDeliveryFailed,
  normalizeNewsletterEmail,
  prepareNewsletterSubscription,
  recordNewsletterOpen,
  saveNewsletterCampaign,
  unsubscribeNewsletterSubscriber,
} from "./subscriber-store.server";
import {
  sendResendBatch,
  sendResendEmail,
} from "./resend.server";
import type {
  NewsletterCampaign,
  NewsletterOpenRecord,
  NewsletterSubscriber,
} from "./types";

const CONFIRMATION_TTL_SECONDS = 72 * 60 * 60;
const RESEND_BATCH_SIZE = 100;

export class NewsletterConfigurationError extends Error {
  constructor() {
    super("Newsletter delivery is not configured.");
    this.name = "NewsletterConfigurationError";
  }
}

export class NewsletterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterValidationError";
  }
}

export class NewsletterCampaignAlreadySentError extends Error {
  constructor() {
    super("A newsletter for this post and language has already been sent.");
    this.name = "NewsletterCampaignAlreadySentError";
  }
}

function requireConfiguration(config: NewsletterConfig): void {
  if (!config.configured || config.tokenSecret.length < 32) {
    throw new NewsletterConfigurationError();
  }
}

function link(baseUrl: string, path: string, token: string): string {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function requestNewsletterSubscription(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  email: string;
  locale: Locale;
  source: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ accepted: true; confirmationSent: boolean }> {
  requireConfiguration(options.config);
  const email = normalizeNewsletterEmail(options.email);
  if (!email) throw new NewsletterValidationError("invalid_email");

  const id = await newsletterSubscriberId(email);
  const prepared = await prepareNewsletterSubscription({
    storage: options.storage,
    id,
    email,
    locale: options.locale,
    source: options.source,
    now: options.now,
  });
  if (!prepared.shouldSendConfirmation) {
    return { accepted: true, confirmationSent: false };
  }

  const now = options.now || new Date();
  const token = await createNewsletterToken({
    secret: options.config.tokenSecret,
    purpose: "confirm",
    subscriberId: id,
    now: now.getTime(),
    expiresInSeconds: CONFIRMATION_TTL_SECONDS,
  });
  const confirmationUrl = link(
    options.config.baseUrl,
    "/newsletter/confirm",
    token,
  );
  const message = buildConfirmationEmail({
    locale: options.locale,
    siteName: options.config.siteName,
    from: options.config.fromEmail,
    to: email,
    confirmationUrl,
    replyTo: options.config.replyTo,
  });

  try {
    await sendResendEmail({
      apiKey: options.config.resendApiKey,
      message,
      idempotencyKey: `vp-newsletter-confirm-${id}-${now.toISOString().slice(0, 16)}`,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    await markConfirmationDeliveryFailed({
      storage: options.storage,
      subscriber: prepared.subscriber,
      now,
    });
    throw error;
  }

  return { accepted: true, confirmationSent: true };
}

export async function confirmNewsletterToken(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  token: string;
  now?: Date;
}): Promise<{
  result: "confirmed" | "already_confirmed" | "unsubscribed" | "invalid";
  subscriber: NewsletterSubscriber | null;
}> {
  requireConfiguration(options.config);
  const payload = await verifyNewsletterToken({
    token: options.token,
    secret: options.config.tokenSecret,
    purpose: "confirm",
    now: (options.now || new Date()).getTime(),
  });
  if (!payload) return { result: "invalid", subscriber: null };

  const before = await getNewsletterSubscriber(
    options.storage,
    payload.subscriberId,
  );
  if (!before) return { result: "invalid", subscriber: null };
  if (before.status === "unsubscribed") {
    return { result: "unsubscribed", subscriber: before };
  }
  const subscriber = await confirmNewsletterSubscriber({
    storage: options.storage,
    id: payload.subscriberId,
    now: options.now,
  });
  return {
    result: before.status === "active" ? "already_confirmed" : "confirmed",
    subscriber,
  };
}

export async function inspectNewsletterUnsubscribeToken(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  token: string;
  now?: Date;
}): Promise<NewsletterSubscriber | null> {
  requireConfiguration(options.config);
  const payload = await verifyNewsletterToken({
    token: options.token,
    secret: options.config.tokenSecret,
    purpose: "unsubscribe",
    now: (options.now || new Date()).getTime(),
  });
  if (!payload) return null;
  return getNewsletterSubscriber(options.storage, payload.subscriberId);
}

export async function unsubscribeNewsletterToken(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  token: string;
  now?: Date;
}): Promise<NewsletterSubscriber | null> {
  const subscriber = await inspectNewsletterUnsubscribeToken(options);
  if (!subscriber) return null;
  return unsubscribeNewsletterSubscriber({
    storage: options.storage,
    id: subscriber.id,
    now: options.now,
  });
}

export async function trackNewsletterOpenToken(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  token: string;
  now?: Date;
}): Promise<NewsletterOpenRecord | null> {
  requireConfiguration(options.config);
  const payload = await verifyNewsletterToken({
    token: options.token,
    secret: options.config.tokenSecret,
    purpose: "open",
    now: (options.now || new Date()).getTime(),
  });
  if (!payload?.campaignId) return null;

  const [campaign, subscriber] = await Promise.all([
    getNewsletterCampaign(options.storage, payload.campaignId),
    getNewsletterSubscriber(options.storage, payload.subscriberId),
  ]);
  if (
    !campaign ||
    !subscriber ||
    !campaign.recipientIds.includes(payload.subscriberId)
  ) {
    return null;
  }

  return recordNewsletterOpen({
    storage: options.storage,
    campaignId: campaign.id,
    subscriberId: subscriber.id,
    now: options.now,
  });
}

function campaignBatches(recipientIds: string[]) {
  const batches = [];
  for (let index = 0; index < recipientIds.length; index += RESEND_BATCH_SIZE) {
    batches.push({
      index: batches.length,
      recipientIds: recipientIds.slice(index, index + RESEND_BATCH_SIZE),
      status: "pending" as const,
    });
  }
  return batches;
}

export async function newsletterCampaignId(
  postSlug: string,
  locale: Locale,
): Promise<string> {
  return sha256Hex(`newsletter:${locale}:${postSlug}`);
}

export async function sendNewsletterCampaign(options: {
  storage: StorageAdapter;
  config: NewsletterConfig;
  post: HeadlessBlogPost;
  locale: Locale;
  subject?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<NewsletterCampaign> {
  requireConfiguration(options.config);
  const now = options.now || new Date();
  const id = await newsletterCampaignId(options.post.slug, options.locale);
  const existing = await getNewsletterCampaign(options.storage, id);
  if (existing?.status === "sent") {
    throw new NewsletterCampaignAlreadySentError();
  }

  let campaign = existing;
  if (!campaign) {
    const subscribers = (await listNewsletterSubscribers(options.storage))
      .filter(
        (subscriber) =>
          subscriber.status === "active" &&
          subscriber.locale === options.locale,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    if (subscribers.length === 0) {
      throw new NewsletterValidationError("no_active_subscribers");
    }
    const recipientIds = subscribers.map((subscriber) => subscriber.id);
    const subject = (options.subject || options.post.title).trim().slice(0, 200);
    if (!subject) throw new NewsletterValidationError("invalid_subject");
    campaign = {
      version: 1,
      id,
      postSlug: options.post.slug,
      postTitle: options.post.title,
      locale: options.locale,
      subject,
      status: "sending",
      recipientIds,
      batches: campaignBatches(recipientIds),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  } else {
    campaign = {
      ...campaign,
      status: "sending",
      updatedAt: now.toISOString(),
      lastError: undefined,
    };
  }
  await saveNewsletterCampaign(options.storage, campaign);

  try {
    for (const batch of campaign.batches) {
      if (batch.status !== "pending") continue;
      const subscribers = (await Promise.all(
        batch.recipientIds.map((subscriberId) =>
          getNewsletterSubscriber(options.storage, subscriberId),
        ),
      )).filter(
        (subscriber): subscriber is NewsletterSubscriber =>
          Boolean(
            subscriber &&
            subscriber.status === "active" &&
            subscriber.locale === campaign?.locale,
          ),
      );

      if (subscribers.length === 0) {
        batch.status = "skipped";
        batch.recipientCount = 0;
        batch.completedAt = new Date().toISOString();
        campaign.updatedAt = batch.completedAt;
        await saveNewsletterCampaign(options.storage, campaign);
        continue;
      }

      const messages = await Promise.all(subscribers.map(async (subscriber) => {
        const unsubscribeToken = await createNewsletterToken({
          secret: options.config.tokenSecret,
          purpose: "unsubscribe",
          subscriberId: subscriber.id,
        });
        const unsubscribeUrl = link(
          options.config.baseUrl,
          "/newsletter/unsubscribe",
          unsubscribeToken,
        );
        const openToken = await createNewsletterToken({
          secret: options.config.tokenSecret,
          purpose: "open",
          subscriberId: subscriber.id,
          campaignId: campaign!.id,
        });
        const trackingPixelUrl = link(
          options.config.baseUrl,
          "/newsletter/open.gif",
          openToken,
        );
        return buildNewsletterEmail({
          locale: campaign!.locale,
          siteName: options.config.siteName,
          from: options.config.fromEmail,
          to: subscriber.email,
          subject: campaign!.subject,
          post: options.post,
          unsubscribeUrl,
          trackingPixelUrl,
          replyTo: options.config.replyTo,
          campaignTag: campaign!.id.slice(0, 32),
        });
      }));
      const resendEmailIds = await sendResendBatch({
        apiKey: options.config.resendApiKey,
        messages,
        idempotencyKey: `vp-newsletter-${campaign.id.slice(0, 40)}-${batch.index}`,
        fetchImpl: options.fetchImpl,
      });
      const completedAt = new Date().toISOString();
      batch.status = "sent";
      batch.recipientCount = subscribers.length;
      batch.sentRecipientIds = subscribers.map((subscriber) => subscriber.id);
      batch.resendEmailIds = resendEmailIds;
      batch.completedAt = completedAt;
      campaign.updatedAt = completedAt;
      await saveNewsletterCampaign(options.storage, campaign);
    }

    const sentAt = new Date().toISOString();
    campaign.status = "sent";
    campaign.sentAt = sentAt;
    campaign.updatedAt = sentAt;
    await saveNewsletterCampaign(options.storage, campaign);
    return campaign;
  } catch (error) {
    campaign.status = "failed";
    campaign.updatedAt = new Date().toISOString();
    campaign.lastError = error instanceof Error
      ? error.message.slice(0, 500)
      : "Unknown newsletter delivery error.";
    await saveNewsletterCampaign(options.storage, campaign);
    throw error;
  }
}
