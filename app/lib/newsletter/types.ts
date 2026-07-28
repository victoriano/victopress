import type { Locale } from "~/lib/i18n";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-v1";

export type NewsletterSubscriberStatus =
  | "pending"
  | "active"
  | "unsubscribed";

export interface NewsletterSubscriber {
  version: 1;
  id: string;
  email: string;
  status: NewsletterSubscriberStatus;
  locale: Locale;
  source: string;
  consentVersion: typeof NEWSLETTER_CONSENT_VERSION;
  consentedAt: string;
  createdAt: string;
  updatedAt: string;
  confirmationSentAt?: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
  resubscribedAt?: string;
  confirmationDeliveryFailedAt?: string;
}

export type NewsletterCampaignStatus =
  | "sending"
  | "sent"
  | "failed";

export interface NewsletterCampaignBatch {
  index: number;
  recipientIds: string[];
  status: "pending" | "sent" | "skipped";
  recipientCount?: number;
  sentRecipientIds?: string[];
  resendEmailIds?: string[];
  completedAt?: string;
}

export interface NewsletterCampaign {
  version: 1;
  id: string;
  postSlug: string;
  postTitle: string;
  locale: Locale;
  subject: string;
  status: NewsletterCampaignStatus;
  recipientIds: string[];
  batches: NewsletterCampaignBatch[];
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  lastError?: string;
}

export interface NewsletterSubscriberStats {
  total: number;
  pending: number;
  active: number;
  unsubscribed: number;
  activeByLocale: Record<Locale, number>;
}

export interface NewsletterOpenRecord {
  version: 1;
  campaignId: string;
  subscriberId: string;
  firstOpenedAt: string;
  lastOpenedAt: string;
  openCount: number;
}
