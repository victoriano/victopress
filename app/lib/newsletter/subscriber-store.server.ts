import type { Locale } from "~/lib/i18n";
import type { StorageAdapter } from "~/lib/content-engine";
import {
  NEWSLETTER_CONSENT_VERSION,
  type NewsletterCampaign,
  type NewsletterSubscriber,
  type NewsletterSubscriberStats,
} from "./types";

const SUBSCRIBER_PREFIX = ".victopress/newsletter/subscribers";
const CAMPAIGN_PREFIX = ".victopress/newsletter/campaigns";
const CONFIRMATION_COOLDOWN_MS = 10 * 60 * 1000;

function subscriberPath(id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid subscriber id.");
  return `${SUBSCRIBER_PREFIX}/${id}.json`;
}

function campaignPath(id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid campaign id.");
  return `${CAMPAIGN_PREFIX}/${id}.json`;
}

function parseSubscriber(raw: string | null): NewsletterSubscriber | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as NewsletterSubscriber;
    if (
      value.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.id) ||
      typeof value.email !== "string" ||
      !["pending", "active", "unsubscribed"].includes(value.status) ||
      !["es", "en"].includes(value.locale)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function parseCampaign(raw: string | null): NewsletterCampaign | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as NewsletterCampaign;
    if (
      value.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.id) ||
      !["sending", "sent", "failed"].includes(value.status) ||
      !Array.isArray(value.recipientIds) ||
      !Array.isArray(value.batches)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function mapInChunks<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
  chunkSize = 50,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    results.push(...await Promise.all(
      values.slice(index, index + chunkSize).map(mapper),
    ));
  }
  return results;
}

export function normalizeNewsletterEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    email.includes(" ") ||
    email.includes("\n") ||
    email.includes("\r")
  ) {
    return null;
  }

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length > 64 ||
    domain.length > 253 ||
    !/^[^\s@]+$/.test(local) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(domain) ||
    domain.includes("..")
  ) {
    return null;
  }
  return email;
}

export async function getNewsletterSubscriber(
  storage: StorageAdapter,
  id: string,
): Promise<NewsletterSubscriber | null> {
  return parseSubscriber(await storage.getText(subscriberPath(id)));
}

export async function saveNewsletterSubscriber(
  storage: StorageAdapter,
  subscriber: NewsletterSubscriber,
): Promise<void> {
  await storage.put(
    subscriberPath(subscriber.id),
    JSON.stringify(subscriber, null, 2),
    "application/json",
  );
}

export async function prepareNewsletterSubscription(options: {
  storage: StorageAdapter;
  id: string;
  email: string;
  locale: Locale;
  source: string;
  now?: Date;
}): Promise<{ subscriber: NewsletterSubscriber; shouldSendConfirmation: boolean }> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const existing = await getNewsletterSubscriber(options.storage, options.id);

  if (existing?.status === "active") {
    return { subscriber: existing, shouldSendConfirmation: false };
  }

  const lastSentAt = existing?.confirmationSentAt
    ? new Date(existing.confirmationSentAt).getTime()
    : 0;
  if (
    existing?.status === "pending" &&
    Number.isFinite(lastSentAt) &&
    now.getTime() - lastSentAt < CONFIRMATION_COOLDOWN_MS
  ) {
    return { subscriber: existing, shouldSendConfirmation: false };
  }

  const subscriber: NewsletterSubscriber = {
    version: 1,
    id: options.id,
    email: options.email,
    status: "pending",
    locale: options.locale,
    source: options.source.slice(0, 100),
    consentVersion: NEWSLETTER_CONSENT_VERSION,
    consentedAt: nowIso,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    confirmationSentAt: nowIso,
    ...(existing?.status === "unsubscribed"
      ? { resubscribedAt: nowIso }
      : existing?.resubscribedAt
        ? { resubscribedAt: existing.resubscribedAt }
        : {}),
  };
  await saveNewsletterSubscriber(options.storage, subscriber);
  return { subscriber, shouldSendConfirmation: true };
}

export async function markConfirmationDeliveryFailed(options: {
  storage: StorageAdapter;
  subscriber: NewsletterSubscriber;
  now?: Date;
}): Promise<void> {
  const current = await getNewsletterSubscriber(
    options.storage,
    options.subscriber.id,
  );
  if (
    !current ||
    current.status !== "pending" ||
    current.confirmationSentAt !== options.subscriber.confirmationSentAt
  ) {
    return;
  }

  const { confirmationSentAt: _confirmationSentAt, ...record } = current;
  await saveNewsletterSubscriber(options.storage, {
    ...record,
    updatedAt: (options.now || new Date()).toISOString(),
    confirmationDeliveryFailedAt: (options.now || new Date()).toISOString(),
  });
}

export async function confirmNewsletterSubscriber(options: {
  storage: StorageAdapter;
  id: string;
  now?: Date;
}): Promise<NewsletterSubscriber | null> {
  const existing = await getNewsletterSubscriber(options.storage, options.id);
  if (!existing || existing.status === "unsubscribed") return existing;
  if (existing.status === "active") return existing;

  const nowIso = (options.now || new Date()).toISOString();
  const subscriber: NewsletterSubscriber = {
    ...existing,
    status: "active",
    confirmedAt: nowIso,
    updatedAt: nowIso,
  };
  await saveNewsletterSubscriber(options.storage, subscriber);
  return subscriber;
}

export async function unsubscribeNewsletterSubscriber(options: {
  storage: StorageAdapter;
  id: string;
  now?: Date;
}): Promise<NewsletterSubscriber | null> {
  const existing = await getNewsletterSubscriber(options.storage, options.id);
  if (!existing || existing.status === "unsubscribed") return existing;

  const nowIso = (options.now || new Date()).toISOString();
  const subscriber: NewsletterSubscriber = {
    ...existing,
    status: "unsubscribed",
    unsubscribedAt: nowIso,
    updatedAt: nowIso,
  };
  await saveNewsletterSubscriber(options.storage, subscriber);
  return subscriber;
}

export async function listNewsletterSubscribers(
  storage: StorageAdapter,
): Promise<NewsletterSubscriber[]> {
  const files = (await storage.listRecursive(SUBSCRIBER_PREFIX))
    .filter((file) => !file.isDirectory && file.name.endsWith(".json"))
    .sort((left, right) => left.path.localeCompare(right.path));
  const records = await mapInChunks(files, async (file) =>
    parseSubscriber(await storage.getText(file.path)),
  );
  return records
    .filter((record): record is NewsletterSubscriber => Boolean(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function newsletterSubscriberStats(
  subscribers: readonly NewsletterSubscriber[],
): NewsletterSubscriberStats {
  return {
    total: subscribers.length,
    pending: subscribers.filter((subscriber) => subscriber.status === "pending").length,
    active: subscribers.filter((subscriber) => subscriber.status === "active").length,
    unsubscribed: subscribers.filter((subscriber) => subscriber.status === "unsubscribed").length,
    activeByLocale: {
      es: subscribers.filter(
        (subscriber) => subscriber.status === "active" && subscriber.locale === "es",
      ).length,
      en: subscribers.filter(
        (subscriber) => subscriber.status === "active" && subscriber.locale === "en",
      ).length,
    },
  };
}

export function maskNewsletterEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export async function getNewsletterCampaign(
  storage: StorageAdapter,
  id: string,
): Promise<NewsletterCampaign | null> {
  return parseCampaign(await storage.getText(campaignPath(id)));
}

export async function saveNewsletterCampaign(
  storage: StorageAdapter,
  campaign: NewsletterCampaign,
): Promise<void> {
  await storage.put(
    campaignPath(campaign.id),
    JSON.stringify(campaign, null, 2),
    "application/json",
  );
}

export async function listNewsletterCampaigns(
  storage: StorageAdapter,
): Promise<NewsletterCampaign[]> {
  const files = (await storage.listRecursive(CAMPAIGN_PREFIX))
    .filter((file) => !file.isDirectory && file.name.endsWith(".json"))
    .sort((left, right) => left.path.localeCompare(right.path));
  const records = await mapInChunks(files, async (file) =>
    parseCampaign(await storage.getText(file.path)),
  );
  return records
    .filter((record): record is NewsletterCampaign => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
