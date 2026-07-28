import type { Locale } from "~/lib/i18n";
import type { StorageAdapter } from "~/lib/content-engine";
import {
  NEWSLETTER_CONSENT_VERSION,
  type NewsletterCampaign,
  type NewsletterOpenRecord,
  type NewsletterSubscriber,
  type NewsletterSubscriberInteractions,
  type NewsletterSubscriberStats,
} from "./types";

const SUBSCRIBER_PREFIX = ".victopress/newsletter/subscribers";
const CAMPAIGN_PREFIX = ".victopress/newsletter/campaigns";
const OPEN_PREFIX = ".victopress/newsletter/opens";
const CONFIRMATION_COOLDOWN_MS = 10 * 60 * 1000;
const OPEN_DETECTION_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_OPEN_DETECTIONS = 100;

function requireNewsletterId(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Invalid ${label} id.`);
  }
  return value;
}

function subscriberPath(id: string): string {
  return `${SUBSCRIBER_PREFIX}/${requireNewsletterId(id, "subscriber")}.json`;
}

function campaignPath(id: string): string {
  return `${CAMPAIGN_PREFIX}/${requireNewsletterId(id, "campaign")}.json`;
}

function openPath(campaignId: string, subscriberId: string): string {
  return `${OPEN_PREFIX}/${requireNewsletterId(campaignId, "campaign")}/${
    requireNewsletterId(subscriberId, "subscriber")
  }.json`;
}

function isOptionalDate(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isInteractions(
  value: unknown,
): value is NewsletterSubscriberInteractions {
  if (!value || typeof value !== "object") return false;
  const interactions = value as Record<string, unknown>;
  const numericFields: Array<keyof NewsletterSubscriberInteractions> = [
    "emailsReceived6Months",
    "emailsDropped6Months",
    "emailsOpenedTotal",
    "emailsOpened6Months",
    "emailsOpened7Days",
    "emailsOpened30Days",
    "linksClicked",
    "uniqueEmailsSeen6Months",
    "uniqueEmailsSeen7Days",
    "uniqueEmailsSeen30Days",
    "postViews",
    "postViews7Days",
    "postViews30Days",
    "uniquePostsSeen",
    "uniquePostsSeen7Days",
    "uniquePostsSeen30Days",
    "comments",
    "comments7Days",
    "comments30Days",
    "shares",
    "shares7Days",
    "shares30Days",
    "daysActive30Days",
    "activity",
  ];
  return numericFields.every((field) =>
    Number.isInteger(interactions[field]) &&
    Number(interactions[field]) >= 0
  ) &&
    isOptionalDate(interactions.lastEmailOpenedAt) &&
    isOptionalDate(interactions.lastClickedAt);
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
      !["es", "en"].includes(value.locale) ||
      (value.name !== undefined &&
        (typeof value.name !== "string" || value.name.length > 200)) ||
      (value.subscriptionSource !== undefined &&
        (typeof value.subscriptionSource !== "string" ||
          value.subscriptionSource.length > 100)) ||
      !isOptionalDate(value.signupAt) ||
      !isOptionalDate(value.importedAt) ||
      (value.importedFrom !== undefined && value.importedFrom !== "substack") ||
      (value.country !== undefined &&
        (typeof value.country !== "string" || value.country.length > 100)) ||
      (value.region !== undefined &&
        (typeof value.region !== "string" || value.region.length > 100)) ||
      (value.interactions !== undefined && !isInteractions(value.interactions))
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
      !value.recipientIds.every((id) =>
        typeof id === "string" && /^[a-f0-9]{64}$/.test(id)
      ) ||
      !Array.isArray(value.batches) ||
      !value.batches.every((batch) =>
        Number.isInteger(batch.index) &&
        Array.isArray(batch.recipientIds) &&
        batch.recipientIds.every((id) =>
          typeof id === "string" && /^[a-f0-9]{64}$/.test(id)
        ) &&
        ["pending", "sent", "skipped"].includes(batch.status) &&
        (batch.sentRecipientIds === undefined ||
          (Array.isArray(batch.sentRecipientIds) &&
            batch.sentRecipientIds.every((id) =>
              typeof id === "string" && /^[a-f0-9]{64}$/.test(id)
            )))
      )
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function parseOpenRecord(raw: string | null): NewsletterOpenRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as NewsletterOpenRecord;
    if (
      value.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.campaignId) ||
      !/^[a-f0-9]{64}$/.test(value.subscriberId) ||
      typeof value.firstOpenedAt !== "string" ||
      typeof value.lastOpenedAt !== "string" ||
      !Number.isFinite(Date.parse(value.firstOpenedAt)) ||
      !Number.isFinite(Date.parse(value.lastOpenedAt)) ||
      !Number.isInteger(value.openCount) ||
      value.openCount < 1
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

export async function updateNewsletterSubscriberName(options: {
  storage: StorageAdapter;
  id: string;
  name: string;
  now?: Date;
}): Promise<NewsletterSubscriber | null> {
  const existing = await getNewsletterSubscriber(options.storage, options.id);
  if (!existing) return null;
  const name = options.name.trim().replace(/\s+/g, " ");
  if (name.length > 200) {
    throw new Error("Subscriber name is longer than 200 characters.");
  }
  const subscriber: NewsletterSubscriber = {
    ...existing,
    name: name || undefined,
    updatedAt: (options.now || new Date()).toISOString(),
  };
  await saveNewsletterSubscriber(options.storage, subscriber);
  return subscriber;
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
    ...existing,
    version: 1,
    id: options.id,
    email: options.email,
    status: "pending",
    locale: options.locale,
    source: options.source.slice(0, 100),
    subscriptionSource:
      existing?.subscriptionSource || options.source.slice(0, 100),
    signupAt: existing?.signupAt || existing?.createdAt || nowIso,
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

export async function getNewsletterOpen(
  storage: StorageAdapter,
  campaignId: string,
  subscriberId: string,
): Promise<NewsletterOpenRecord | null> {
  return parseOpenRecord(
    await storage.getText(openPath(campaignId, subscriberId)),
  );
}

export async function recordNewsletterOpen(options: {
  storage: StorageAdapter;
  campaignId: string;
  subscriberId: string;
  now?: Date;
}): Promise<NewsletterOpenRecord> {
  const now = options.now || new Date();
  const openedAt = now.toISOString();
  const existing = await getNewsletterOpen(
    options.storage,
    options.campaignId,
    options.subscriberId,
  );
  const lastOpenedAt = existing
    ? new Date(existing.lastOpenedAt).getTime()
    : 0;
  if (
    existing &&
    (existing.openCount >= MAX_OPEN_DETECTIONS ||
      (Number.isFinite(lastOpenedAt) &&
        now.getTime() - lastOpenedAt < OPEN_DETECTION_COOLDOWN_MS))
  ) {
    return existing;
  }
  const record: NewsletterOpenRecord = existing
    ? {
        ...existing,
        lastOpenedAt: openedAt,
        openCount: existing.openCount + 1,
      }
    : {
        version: 1,
        campaignId: options.campaignId,
        subscriberId: options.subscriberId,
        firstOpenedAt: openedAt,
        lastOpenedAt: openedAt,
        openCount: 1,
      };
  await options.storage.put(
    openPath(options.campaignId, options.subscriberId),
    JSON.stringify(record, null, 2),
    "application/json",
  );
  return record;
}

export async function listNewsletterOpens(
  storage: StorageAdapter,
  campaignId: string,
): Promise<NewsletterOpenRecord[]> {
  const prefix = `${OPEN_PREFIX}/${requireNewsletterId(campaignId, "campaign")}`;
  const files = (await storage.listRecursive(prefix))
    .filter((file) => !file.isDirectory && file.name.endsWith(".json"))
    .sort((left, right) => left.path.localeCompare(right.path));
  const records = await mapInChunks(files, async (file) =>
    parseOpenRecord(await storage.getText(file.path)),
  );
  return records
    .filter((record): record is NewsletterOpenRecord => Boolean(record))
    .filter((record) => record.campaignId === campaignId)
    .sort((left, right) => left.firstOpenedAt.localeCompare(right.firstOpenedAt));
}
