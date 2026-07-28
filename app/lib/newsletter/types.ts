import type { Locale } from "~/lib/i18n";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-v1";

export type NewsletterSubscriberStatus =
  | "pending"
  | "active"
  | "unsubscribed";

export interface NewsletterSubscriberInteractions {
  emailsReceived6Months: number;
  emailsDropped6Months: number;
  emailsOpenedTotal: number;
  emailsOpened6Months: number;
  emailsOpened7Days: number;
  emailsOpened30Days: number;
  lastEmailOpenedAt?: string;
  linksClicked: number;
  lastClickedAt?: string;
  uniqueEmailsSeen6Months: number;
  uniqueEmailsSeen7Days: number;
  uniqueEmailsSeen30Days: number;
  postViews: number;
  postViews7Days: number;
  postViews30Days: number;
  uniquePostsSeen: number;
  uniquePostsSeen7Days: number;
  uniquePostsSeen30Days: number;
  comments: number;
  comments7Days: number;
  comments30Days: number;
  shares: number;
  shares7Days: number;
  shares30Days: number;
  daysActive30Days: number;
  activity: number;
}

export interface NewsletterSubscriber {
  version: 1;
  id: string;
  email: string;
  name?: string;
  status: NewsletterSubscriberStatus;
  locale: Locale;
  source: string;
  subscriptionSource?: string;
  signupAt?: string;
  importedAt?: string;
  importedFrom?: "substack";
  country?: string;
  region?: string;
  interactions?: NewsletterSubscriberInteractions;
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
