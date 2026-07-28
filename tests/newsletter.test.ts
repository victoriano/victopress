import { describe, expect, test } from "bun:test";
import type {
  FileInfo,
  StorageAdapter,
} from "~/lib/content-engine";
import type { HeadlessBlogPost } from "~/lib/headless-blog";
import type { NewsletterConfig } from "~/lib/newsletter/config.server";
import { newsletterBlogUrl } from "~/lib/newsletter/config.server";
import {
  createNewsletterToken,
  newsletterSubscriberId,
  verifyNewsletterToken,
} from "~/lib/newsletter/crypto.server";
import {
  confirmNewsletterToken,
  inspectNewsletterUnsubscribeToken,
  NewsletterCampaignAlreadySentError,
  requestNewsletterSubscription,
  sendNewsletterCampaign,
  trackNewsletterOpenToken,
  unsubscribeNewsletterToken,
} from "~/lib/newsletter/newsletter-service.server";
import {
  importNewsletterSubscriberCsv,
  NewsletterCsvImportError,
  parseNewsletterSubscriberCsv,
} from "~/lib/newsletter/subscriber-import.server";
import {
  getNewsletterSubscriber,
  listNewsletterOpens,
  normalizeNewsletterEmail,
  saveNewsletterSubscriber,
  updateNewsletterSubscriberName,
} from "~/lib/newsletter/subscriber-store.server";
import {
  NEWSLETTER_CONSENT_VERSION,
  type NewsletterSubscriber,
} from "~/lib/newsletter/types";

class MemoryStorage implements StorageAdapter {
  private files = new Map<string, string | ArrayBuffer>();

  async list(prefix: string): Promise<FileInfo[]> {
    return this.listRecursive(prefix);
  }

  async listRecursive(prefix: string): Promise<FileInfo[]> {
    return [...this.files.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({
        name: key.split("/").pop() || key,
        path: key,
        size: typeof value === "string" ? value.length : value.byteLength,
        lastModified: new Date("2026-07-28T10:00:00.000Z"),
        isDirectory: false,
      }));
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const value = this.files.get(key);
    if (value === undefined) return null;
    if (typeof value !== "string") return value;
    return new TextEncoder().encode(value).buffer;
  }

  async getText(key: string): Promise<string | null> {
    const value = this.files.get(key);
    if (value === undefined) return null;
    return typeof value === "string"
      ? value
      : new TextDecoder().decode(value);
  }

  async put(key: string, data: ArrayBuffer | string): Promise<void> {
    this.files.set(key, data);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async deleteDirectory(prefix: string): Promise<{ deleted: number }> {
    const keys = [...this.files.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) this.files.delete(key);
    return { deleted: keys.length };
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async move(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error("Missing source.");
    this.files.set(to, value);
    this.files.delete(from);
  }

  async copy(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error("Missing source.");
    this.files.set(to, value);
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/api/images/${key}`;
  }
}

const newsletterConfig: NewsletterConfig = {
  configured: true,
  missing: [],
  resendApiKey: "re_test",
  fromEmail: "Victoriano <newsletter@example.com>",
  replyTo: "victoriano@example.com",
  tokenSecret: "newsletter-test-secret-that-is-long-enough",
  baseUrl: "https://photos.example.com",
  publicBlogUrl: "https://example.com/blog",
  siteName: "Victoriano Izquierdo",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function subscriber(options: {
  id: string;
  email: string;
  locale?: "es" | "en";
  status?: "pending" | "active" | "unsubscribed";
}): NewsletterSubscriber {
  return {
    version: 1,
    id: options.id,
    email: options.email,
    locale: options.locale || "es",
    status: options.status || "active",
    source: "test",
    consentVersion: NEWSLETTER_CONSENT_VERSION,
    consentedAt: "2026-07-28T10:00:00.000Z",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    ...(options.status === "unsubscribed"
      ? { unsubscribedAt: "2026-07-28T10:01:00.000Z" }
      : { confirmedAt: "2026-07-28T10:01:00.000Z" }),
  };
}

describe("newsletter identity and signed links", () => {
  test("returns readers to the canonical language edition of the public blog", () => {
    expect(newsletterBlogUrl(newsletterConfig, "en")).toBe(
      "https://example.com/blog",
    );
    expect(newsletterBlogUrl(newsletterConfig, "es")).toBe(
      "https://example.com/es/blog",
    );
  });

  test("normalizes valid addresses and rejects malformed input", () => {
    expect(normalizeNewsletterEmail("  Reader@Example.COM ")).toBe(
      "reader@example.com",
    );
    expect(normalizeNewsletterEmail("reader@example")).toBeNull();
    expect(normalizeNewsletterEmail("reader @example.com")).toBeNull();
    expect(normalizeNewsletterEmail("reader@example..com")).toBeNull();
  });

  test("separates confirmation and unsubscribe tokens and expires confirmation links", async () => {
    const id = await newsletterSubscriberId("reader@example.com");
    const token = await createNewsletterToken({
      secret: newsletterConfig.tokenSecret,
      purpose: "confirm",
      subscriberId: id,
      now: 1_000,
      expiresInSeconds: 60,
    });
    expect((await verifyNewsletterToken({
      token,
      secret: newsletterConfig.tokenSecret,
      purpose: "confirm",
      now: 60_000,
    }))?.subscriberId).toBe(id);
    expect(await verifyNewsletterToken({
      token,
      secret: newsletterConfig.tokenSecret,
      purpose: "unsubscribe",
      now: 60_000,
    })).toBeNull();
    expect(await verifyNewsletterToken({
      token,
      secret: newsletterConfig.tokenSecret,
      purpose: "confirm",
      now: 62_000,
    })).toBeNull();
  });
});

describe("newsletter double opt-in and unsubscribe", () => {
  test("sends one confirmation during the cooldown, confirms, and only unsubscribes on action", async () => {
    const storage = new MemoryStorage();
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body || "{}")),
        headers: new Headers(init?.headers),
      });
      return jsonResponse({ id: "confirmation-email-id" });
    }) as typeof fetch;
    const now = new Date("2026-07-28T10:00:00.000Z");

    await requestNewsletterSubscription({
      storage,
      config: newsletterConfig,
      email: "Reader@Example.com",
      locale: "es",
      source: "blog-footer",
      now,
      fetchImpl,
    });
    await requestNewsletterSubscription({
      storage,
      config: newsletterConfig,
      email: "reader@example.com",
      locale: "es",
      source: "blog-footer",
      now: new Date(now.getTime() + 60_000),
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers.get("authorization")).toBe("Bearer re_test");
    expect(calls[0].headers.get("user-agent")).toBe(
      "VictoPress-Newsletter/1.0",
    );
    expect(calls[0].body.to).toEqual(["reader@example.com"]);

    const confirmationMatch = String(calls[0].body.html).match(
      /newsletter\/confirm\?token=([^"&]+)/,
    );
    expect(confirmationMatch).not.toBeNull();
    const confirmationToken = decodeURIComponent(confirmationMatch![1]);
    expect((await verifyNewsletterToken({
      token: confirmationToken,
      secret: newsletterConfig.tokenSecret,
      purpose: "confirm",
      now: now.getTime() + 49 * 60 * 60 * 1000,
    }))?.subscriberId).toBe(await newsletterSubscriberId("reader@example.com"));
    expect(await verifyNewsletterToken({
      token: confirmationToken,
      secret: newsletterConfig.tokenSecret,
      purpose: "confirm",
      now: now.getTime() + 73 * 60 * 60 * 1000,
    })).toBeNull();
    expect(calls[0].body.html).toContain(
      '<table role="presentation" class="outer" width="100%"',
    );
    expect(calls[0].body.html).toContain("box-sizing:border-box");
    expect(calls[0].body.html).not.toContain('<div class="shell">');
    expect(calls[0].body.html).toContain(
      "medición aproximada de apertura",
    );
    expect(calls[0].body.html).toContain(
      "El enlace caduca dentro de 72 horas.",
    );
    const confirmed = await confirmNewsletterToken({
      storage,
      config: newsletterConfig,
      token: confirmationToken,
      now: new Date("2026-07-28T10:02:00.000Z"),
    });
    expect(confirmed.result).toBe("confirmed");
    expect(confirmed.subscriber?.status).toBe("active");

    const unsubscribeToken = await createNewsletterToken({
      secret: newsletterConfig.tokenSecret,
      purpose: "unsubscribe",
      subscriberId: confirmed.subscriber!.id,
    });
    expect((await inspectNewsletterUnsubscribeToken({
      storage,
      config: newsletterConfig,
      token: unsubscribeToken,
    }))?.status).toBe("active");
    expect((await getNewsletterSubscriber(
      storage,
      confirmed.subscriber!.id,
    ))?.status).toBe("active");

    const unsubscribed = await unsubscribeNewsletterToken({
      storage,
      config: newsletterConfig,
      token: unsubscribeToken,
      now: new Date("2026-07-28T10:03:00.000Z"),
    });
    expect(unsubscribed?.status).toBe("unsubscribed");
  });

  test("allows an immediate retry when Resend rejects the confirmation", async () => {
    const storage = new MemoryStorage();
    const fetchImpl = (async () =>
      jsonResponse({ message: "provider unavailable" }, 503)) as typeof fetch;
    await expect(requestNewsletterSubscription({
      storage,
      config: newsletterConfig,
      email: "retry@example.com",
      locale: "en",
      source: "blog-footer",
      now: new Date("2026-07-28T10:00:00.000Z"),
      fetchImpl,
    })).rejects.toThrow("provider unavailable");
    const id = await newsletterSubscriberId("retry@example.com");
    const record = await getNewsletterSubscriber(storage, id);
    expect(record?.status).toBe("pending");
    expect(record?.confirmationSentAt).toBeUndefined();
    expect(record?.confirmationDeliveryFailedAt).toBeDefined();
  });
});

describe("newsletter subscriber CSV imports", () => {
  const csvHeaders = [
    "Email",
    "Name",
    "Stripe plan",
    "Start date",
    "Paid upgrade date",
    "Revenue",
    "Subscription source (free)",
    "Subscription source (paid)",
    "Emails received (6mo)",
    "Emails dropped (6mo)",
    "num_emails_opened",
    "Emails opened (6mo)",
    "Emails opened (7d)",
    "Emails opened (30d)",
    "Last email open",
    "Links clicked",
    "Last clicked at",
    "Unique emails seen (6mo)",
    "Unique emails seen (7d)",
    "Unique emails seen (30d)",
    "Post views",
    "Post views (7d)",
    "Post views (30d)",
    "Unique posts seen",
    "Unique posts seen (7d)",
    "Unique posts seen (30d)",
    "Comments",
    "Comments (7d)",
    "Comments (30d)",
    "Shares",
    "Shares (7d)",
    "Shares (30d)",
    "Days active (30d)",
    "Activity",
    "Country",
    "State/Province",
  ];

  function csvRow(overrides: Record<string, string> = {}): string {
    const values: Record<string, string> = {
      Email: "Reader@Example.com",
      Name: "Ada, Lovelace",
      "Stripe plan": "legacy-paid-plan",
      "Start date": "2024-02-03T04:05:06.789Z",
      "Paid upgrade date": "2024-03-01T00:00:00.000Z",
      Revenue: "999",
      "Subscription source (free)": "substack-signup-flow",
      "Subscription source (paid)": "stripe",
      "Emails received (6mo)": "12",
      "Emails dropped (6mo)": "1",
      num_emails_opened: "7",
      "Emails opened (6mo)": "6",
      "Emails opened (7d)": "2",
      "Emails opened (30d)": "4",
      "Last email open": "2026-07-01T12:00:00.000Z",
      "Links clicked": "3",
      "Last clicked at": "2026-06-30T12:00:00.000Z",
      "Unique emails seen (6mo)": "5",
      "Unique emails seen (7d)": "2",
      "Unique emails seen (30d)": "3",
      "Post views": "9",
      "Post views (7d)": "1",
      "Post views (30d)": "4",
      "Unique posts seen": "8",
      "Unique posts seen (7d)": "1",
      "Unique posts seen (30d)": "3",
      Comments: "2",
      "Comments (7d)": "1",
      "Comments (30d)": "2",
      Shares: "4",
      "Shares (7d)": "1",
      "Shares (30d)": "2",
      "Days active (30d)": "5",
      Activity: "11",
      Country: "ES",
      "State/Province": "M",
      ...overrides,
    };
    return csvHeaders.map((header) => {
      const value = values[header] || "";
      return /[",\n\r]/.test(value)
        ? `"${value.replaceAll("\"", "\"\"")}"`
        : value;
    }).join(",");
  }

  test("preserves signup, identity, source and interactions while ignoring paid columns", async () => {
    const storage = new MemoryStorage();
    const csv = `${csvHeaders.join(",")}\r\n${csvRow()}\r\n`;
    const result = await importNewsletterSubscriberCsv({
      storage,
      csv,
      locale: "es",
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(result).toEqual({
      totalRows: 1,
      importedSubscribers: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      preservedUnsubscribed: 0,
      duplicateRows: 0,
    });
    const id = await newsletterSubscriberId("reader@example.com");
    const imported = await getNewsletterSubscriber(storage, id);
    expect(imported?.name).toBe("Ada, Lovelace");
    expect(imported?.status).toBe("active");
    expect(imported?.signupAt).toBe("2024-02-03T04:05:06.789Z");
    expect(imported?.createdAt).toBe("2024-02-03T04:05:06.789Z");
    expect(imported?.consentedAt).toBe("2024-02-03T04:05:06.789Z");
    expect(imported?.confirmedAt).toBe("2024-02-03T04:05:06.789Z");
    expect(imported?.importedAt).toBe("2026-07-28T12:00:00.000Z");
    expect(imported?.source).toBe("substack-signup-flow");
    expect(imported?.subscriptionSource).toBe("substack-signup-flow");
    expect(imported?.country).toBe("ES");
    expect(imported?.region).toBe("M");
    expect(imported?.interactions).toMatchObject({
      emailsReceived6Months: 12,
      emailsOpenedTotal: 7,
      linksClicked: 3,
      postViews: 9,
      comments: 2,
      shares: 4,
      lastEmailOpenedAt: "2026-07-01T12:00:00.000Z",
      lastClickedAt: "2026-06-30T12:00:00.000Z",
    });
    const serialized = JSON.stringify(imported);
    expect(serialized).not.toContain("legacy-paid-plan");
    expect(serialized).not.toContain("\"Revenue\"");
    expect(serialized).not.toContain("\"stripe\"");
  });

  test("is idempotent, merges duplicates and never reactivates an unsubscribed reader", async () => {
    const storage = new MemoryStorage();
    const id = await newsletterSubscriberId("reader@example.com");
    await saveNewsletterSubscriber(
      storage,
      subscriber({
        id,
        email: "reader@example.com",
        status: "unsubscribed",
      }),
    );
    const csv = [
      csvHeaders.join(","),
      csvRow({ Name: "", "Start date": "2025-01-01T00:00:00.000Z" }),
      csvRow({ Name: "Imported name" }),
    ].join("\n");
    const parsed = parseNewsletterSubscriberCsv(csv);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.duplicateRows).toBe(1);
    expect(parsed.subscribers).toHaveLength(1);
    expect(parsed.subscribers[0].signupAt).toBe("2024-02-03T04:05:06.789Z");

    const result = await importNewsletterSubscriberCsv({
      storage,
      csv,
      locale: "es",
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.preservedUnsubscribed).toBe(1);
    expect(result.duplicateRows).toBe(1);
    expect((await getNewsletterSubscriber(storage, id))?.status).toBe(
      "unsubscribed",
    );

    const repeated = await importNewsletterSubscriberCsv({
      storage,
      csv,
      locale: "es",
      now: new Date("2026-07-28T13:00:00.000Z"),
    });
    expect(repeated.created).toBe(0);
    expect(repeated.updated).toBe(0);
    expect(repeated.unchanged).toBe(1);
  });

  test("validates the complete CSV before writing and lets the owner edit names", async () => {
    const storage = new MemoryStorage();
    const csv = [
      csvHeaders.join(","),
      csvRow(),
      csvRow({
        Email: "second@example.com",
        "Start date": "not-a-date",
      }),
    ].join("\n");
    await expect(importNewsletterSubscriberCsv({
      storage,
      csv,
      locale: "es",
    })).rejects.toBeInstanceOf(NewsletterCsvImportError);
    const id = await newsletterSubscriberId("reader@example.com");
    expect(await getNewsletterSubscriber(storage, id)).toBeNull();

    await saveNewsletterSubscriber(
      storage,
      subscriber({ id, email: "reader@example.com" }),
    );
    expect((await updateNewsletterSubscriberName({
      storage,
      id,
      name: "  Ada   Lovelace  ",
      now: new Date("2026-07-28T12:00:00.000Z"),
    }))?.name).toBe("Ada Lovelace");
    expect((await updateNewsletterSubscriberName({
      storage,
      id,
      name: "",
      now: new Date("2026-07-28T12:01:00.000Z"),
    }))?.name).toBeUndefined();
  });
});

describe("newsletter campaigns", () => {
  test("sends only active same-language subscribers in personalized batches", async () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 101; index += 1) {
      const email = `reader-${index}@example.com`;
      const id = await newsletterSubscriberId(email);
      await saveNewsletterSubscriber(storage, subscriber({ id, email }));
    }
    const englishEmail = "english@example.com";
    await saveNewsletterSubscriber(storage, subscriber({
      id: await newsletterSubscriberId(englishEmail),
      email: englishEmail,
      locale: "en",
    }));
    const formerEmail = "former@example.com";
    await saveNewsletterSubscriber(storage, subscriber({
      id: await newsletterSubscriberId(formerEmail),
      email: formerEmail,
      status: "unsubscribed",
    }));

    const batches: any[][] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "[]"));
      batches.push(payload);
      return jsonResponse({
        data: payload.map((_: unknown, index: number) => ({
          id: `batch-${batches.length}-${index}`,
        })),
      });
    }) as typeof fetch;
    const post: HeadlessBlogPost = {
      slug: "a-new-post",
      title: "A new post",
      date: "2026-07-28",
      excerpt: "An excerpt",
      readingTime: 3,
      tags: [],
      coverUrl: "https://photos.example.com/api/images/cover.jpg",
      canonicalUrl: "https://example.com/blog/a-new-post",
      locale: "es",
      resolvedLocale: "es",
      availableLocales: ["es", "en"],
      isFallback: false,
      alternateUrls: {
        es: "https://example.com/es/blog/a-new-post",
        en: "https://example.com/blog/a-new-post",
      },
      author: "Victoriano",
      sourceUrl: null,
      coverInBody: false,
      format: "markdown",
      contentMarkdown: "Hello newsletter.",
      contentHtml: "<p>Hello newsletter.</p>",
      images: [],
    };

    const campaign = await sendNewsletterCampaign({
      storage,
      config: newsletterConfig,
      post,
      locale: "es",
      fetchImpl,
      now: new Date("2026-07-28T11:00:00.000Z"),
    });
    expect(campaign.status).toBe("sent");
    expect(campaign.batches.every((batch) =>
      batch.sentRecipientIds?.length === batch.recipientCount
    )).toBe(true);
    expect(batches.map((batch) => batch.length)).toEqual([100, 1]);
    expect(batches.flat()).toHaveLength(101);
    expect(batches.flat().some((message) =>
      message.to.includes(englishEmail) || message.to.includes(formerEmail)
    )).toBe(false);
    for (const message of batches.flat()) {
      expect(message.headers["List-Unsubscribe"]).toMatch(
        /^<https:\/\/photos\.example\.com\/newsletter\/unsubscribe\?token=/,
      );
      expect(message.headers["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
      expect(message.html).toContain("Darme de baja");
      expect(message.html).not.toContain("reader-0@example.com");
      expect(message.html).toMatch(
        /newsletter\/open\.gif\?token=[^"&]+/,
      );
      expect(message.html).toContain(
        'width="1" height="1" alt="" aria-hidden="true"',
      );
      expect(message.html).toContain(
        "apertura se detecta de forma aproximada",
      );
    }

    const firstOpenMatch = String(batches[0][0].html).match(
      /newsletter\/open\.gif\?token=([^"&]+)/,
    );
    expect(firstOpenMatch).not.toBeNull();
    const firstOpenToken = decodeURIComponent(firstOpenMatch![1]);
    const openPayload = await verifyNewsletterToken({
      token: firstOpenToken,
      secret: newsletterConfig.tokenSecret,
      purpose: "open",
    });
    expect(openPayload?.campaignId).toBe(campaign.id);
    expect(campaign.recipientIds).toContain(openPayload?.subscriberId);

    const firstDetection = await trackNewsletterOpenToken({
      storage,
      config: newsletterConfig,
      token: firstOpenToken,
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const secondDetection = await trackNewsletterOpenToken({
      storage,
      config: newsletterConfig,
      token: firstOpenToken,
      now: new Date("2026-07-28T12:05:00.000Z"),
    });
    const laterDetection = await trackNewsletterOpenToken({
      storage,
      config: newsletterConfig,
      token: firstOpenToken,
      now: new Date("2026-07-28T14:05:00.000Z"),
    });
    expect(firstDetection?.openCount).toBe(1);
    expect(secondDetection?.openCount).toBe(1);
    expect(laterDetection?.openCount).toBe(2);
    expect(secondDetection?.firstOpenedAt).toBe(
      "2026-07-28T12:00:00.000Z",
    );
    expect(laterDetection?.lastOpenedAt).toBe(
      "2026-07-28T14:05:00.000Z",
    );
    expect(await listNewsletterOpens(storage, campaign.id)).toHaveLength(1);

    const unrelatedOpenToken = await createNewsletterToken({
      secret: newsletterConfig.tokenSecret,
      purpose: "open",
      subscriberId: campaign.recipientIds[0],
      campaignId: "a".repeat(64),
    });
    expect(await trackNewsletterOpenToken({
      storage,
      config: newsletterConfig,
      token: unrelatedOpenToken,
    })).toBeNull();

    await expect(sendNewsletterCampaign({
      storage,
      config: newsletterConfig,
      post,
      locale: "es",
      fetchImpl,
    })).rejects.toBeInstanceOf(NewsletterCampaignAlreadySentError);
  });
});
