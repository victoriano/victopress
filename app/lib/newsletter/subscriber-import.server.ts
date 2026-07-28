import type { Locale } from "~/lib/i18n";
import type { StorageAdapter } from "~/lib/content-engine";
import { newsletterSubscriberId } from "./crypto.server";
import {
  listNewsletterSubscribers,
  mergeNewsletterSubscriberIndex,
  normalizeNewsletterEmail,
  saveNewsletterSubscriber,
} from "./subscriber-store.server";
import {
  NEWSLETTER_CONSENT_VERSION,
  type NewsletterSubscriber,
  type NewsletterSubscriberInteractions,
} from "./types";

const MAX_CSV_CHARACTERS = 5_000_000;
const MAX_CSV_ROWS = 10_000;
const IMPORT_CONCURRENCY = 6;

const REQUIRED_HEADERS = [
  "Email",
  "Start date",
  "Subscription source (free)",
] as const;

type CsvRecord = Record<string, string>;

export interface ParsedNewsletterSubscriber {
  email: string;
  name?: string;
  signupAt: string;
  subscriptionSource: string;
  country?: string;
  region?: string;
  interactions: NewsletterSubscriberInteractions;
}

export interface ParsedNewsletterSubscriberCsv {
  subscribers: ParsedNewsletterSubscriber[];
  totalRows: number;
  duplicateRows: number;
}

export interface NewsletterSubscriberImportResult {
  totalRows: number;
  importedSubscribers: number;
  created: number;
  updated: number;
  unchanged: number;
  preservedUnsubscribed: number;
  duplicateRows: number;
}

export class NewsletterCsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterCsvImportError";
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseCsvRows(input: string): string[][] {
  if (input.length > MAX_CSV_CHARACTERS) {
    throw new NewsletterCsvImportError("The CSV is larger than 5 MB.");
  }
  if (input.includes("\0")) {
    throw new NewsletterCsvImportError("The CSV contains unsupported data.");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) {
      throw new NewsletterCsvImportError(
        `The CSV contains more than ${MAX_CSV_ROWS} subscribers.`,
      );
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === "\"") {
      if (inQuotes && input[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (inQuotes) {
        inQuotes = false;
      } else if (field.length === 0) {
        inQuotes = true;
      } else {
        field += character;
      }
      continue;
    }
    if (!inQuotes && character === ",") {
      finishField();
      continue;
    }
    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    throw new NewsletterCsvImportError("The CSV contains an unclosed quoted value.");
  }
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function csvRecords(input: string): CsvRecord[] {
  const rows = parseCsvRows(input);
  const rawHeaders = rows.shift();
  if (!rawHeaders) {
    throw new NewsletterCsvImportError("The CSV is empty.");
  }
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  if (
    normalizedHeaders.some((header) => !header) ||
    new Set(normalizedHeaders).size !== normalizedHeaders.length
  ) {
    throw new NewsletterCsvImportError(
      "The CSV contains empty or duplicated column names.",
    );
  }
  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !normalizedHeaders.includes(normalizeHeader(header)),
  );
  if (missingHeaders.length > 0) {
    throw new NewsletterCsvImportError(
      `Missing required columns: ${missingHeaders.join(", ")}.`,
    );
  }

  return rows.map((values, index) => {
    if (
      values.length > headers.length &&
      values.slice(headers.length).some((value) => value.trim() !== "")
    ) {
      throw new NewsletterCsvImportError(
        `CSV row ${index + 2} contains more values than columns.`,
      );
    }
    return Object.fromEntries(
      headers.map((header, headerIndex) => [
        normalizeHeader(header),
        values[headerIndex] || "",
      ]),
    );
  });
}

function value(record: CsvRecord, header: string): string {
  return (record[normalizeHeader(header)] || "").trim();
}

function optionalText(
  record: CsvRecord,
  header: string,
  maxLength: number,
): string | undefined {
  const text = value(record, header).replace(/\s+/g, " ");
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new NewsletterCsvImportError(
      `${header} contains a value longer than ${maxLength} characters.`,
    );
  }
  return text;
}

function requiredDate(
  record: CsvRecord,
  header: string,
  rowNumber: number,
): string {
  const raw = value(record, header);
  const timestamp = Date.parse(raw);
  if (!raw || !Number.isFinite(timestamp)) {
    throw new NewsletterCsvImportError(
      `CSV row ${rowNumber} has an invalid ${header}.`,
    );
  }
  return new Date(timestamp).toISOString();
}

function optionalDate(
  record: CsvRecord,
  header: string,
  rowNumber: number,
): string | undefined {
  const raw = value(record, header);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    throw new NewsletterCsvImportError(
      `CSV row ${rowNumber} has an invalid ${header}.`,
    );
  }
  return new Date(timestamp).toISOString();
}

function metric(
  record: CsvRecord,
  header: string,
  rowNumber: number,
): number {
  const raw = value(record, header);
  if (!raw) return 0;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) {
    throw new NewsletterCsvImportError(
      `CSV row ${rowNumber} has an invalid ${header}.`,
    );
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number));
}

function interactions(
  record: CsvRecord,
  rowNumber: number,
): NewsletterSubscriberInteractions {
  const lastEmailOpenedAt = optionalDate(
    record,
    "Last email open",
    rowNumber,
  );
  const lastClickedAt = optionalDate(record, "Last clicked at", rowNumber);
  return {
    emailsReceived6Months: metric(record, "Emails received (6mo)", rowNumber),
    emailsDropped6Months: metric(record, "Emails dropped (6mo)", rowNumber),
    emailsOpenedTotal: metric(record, "num_emails_opened", rowNumber),
    emailsOpened6Months: metric(record, "Emails opened (6mo)", rowNumber),
    emailsOpened7Days: metric(record, "Emails opened (7d)", rowNumber),
    emailsOpened30Days: metric(record, "Emails opened (30d)", rowNumber),
    ...(lastEmailOpenedAt ? { lastEmailOpenedAt } : {}),
    linksClicked: metric(record, "Links clicked", rowNumber),
    ...(lastClickedAt ? { lastClickedAt } : {}),
    uniqueEmailsSeen6Months: metric(
      record,
      "Unique emails seen (6mo)",
      rowNumber,
    ),
    uniqueEmailsSeen7Days: metric(record, "Unique emails seen (7d)", rowNumber),
    uniqueEmailsSeen30Days: metric(record, "Unique emails seen (30d)", rowNumber),
    postViews: metric(record, "Post views", rowNumber),
    postViews7Days: metric(record, "Post views (7d)", rowNumber),
    postViews30Days: metric(record, "Post views (30d)", rowNumber),
    uniquePostsSeen: metric(record, "Unique posts seen", rowNumber),
    uniquePostsSeen7Days: metric(record, "Unique posts seen (7d)", rowNumber),
    uniquePostsSeen30Days: metric(record, "Unique posts seen (30d)", rowNumber),
    comments: metric(record, "Comments", rowNumber),
    comments7Days: metric(record, "Comments (7d)", rowNumber),
    comments30Days: metric(record, "Comments (30d)", rowNumber),
    shares: metric(record, "Shares", rowNumber),
    shares7Days: metric(record, "Shares (7d)", rowNumber),
    shares30Days: metric(record, "Shares (30d)", rowNumber),
    daysActive30Days: metric(record, "Days active (30d)", rowNumber),
    activity: metric(record, "Activity", rowNumber),
  };
}

function earlierDate(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

export function parseNewsletterSubscriberCsv(
  input: string,
): ParsedNewsletterSubscriberCsv {
  const records = csvRecords(input);
  const subscribers = new Map<string, ParsedNewsletterSubscriber>();
  let duplicateRows = 0;

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const email = normalizeNewsletterEmail(value(record, "Email"));
    if (!email) {
      throw new NewsletterCsvImportError(
        `CSV row ${rowNumber} has an invalid email address.`,
      );
    }
    const subscriptionSource =
      optionalText(record, "Subscription source (free)", 100) || "csv-import";
    const parsed: ParsedNewsletterSubscriber = {
      email,
      name: optionalText(record, "Name", 200),
      signupAt: requiredDate(record, "Start date", rowNumber),
      subscriptionSource,
      country: optionalText(record, "Country", 100),
      region: optionalText(record, "State/Province", 100),
      interactions: interactions(record, rowNumber),
    };
    const existing = subscribers.get(email);
    if (existing) {
      duplicateRows += 1;
      subscribers.set(email, {
        ...parsed,
        name: parsed.name || existing.name,
        signupAt: earlierDate(existing.signupAt, parsed.signupAt),
        subscriptionSource:
          parsed.subscriptionSource || existing.subscriptionSource,
        country: parsed.country || existing.country,
        region: parsed.region || existing.region,
      });
    } else {
      subscribers.set(email, parsed);
    }
  });

  return {
    subscribers: [...subscribers.values()],
    totalRows: records.length,
    duplicateRows,
  };
}

function earliestSignupAt(
  existing: NewsletterSubscriber | null,
  importedSignupAt: string,
): string {
  const existingSignupAt = existing?.signupAt || existing?.createdAt;
  return existingSignupAt
    ? earlierDate(existingSignupAt, importedSignupAt)
    : importedSignupAt;
}

async function inChunks<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += IMPORT_CONCURRENCY) {
    results.push(...await Promise.all(
      values.slice(index, index + IMPORT_CONCURRENCY).map(mapper),
    ));
  }
  return results;
}

export async function importNewsletterSubscriberCsv(options: {
  storage: StorageAdapter;
  csv: string;
  locale: Locale;
  now?: Date;
}): Promise<NewsletterSubscriberImportResult> {
  const parsed = parseNewsletterSubscriberCsv(options.csv);
  const importedAt = (options.now || new Date()).toISOString();
  const existingSubscribers = new Map(
    (await listNewsletterSubscribers(options.storage)).map((subscriber) => [
      subscriber.id,
      subscriber,
    ]),
  );
  let results: Array<{
    created: boolean;
    changed: boolean;
    preservedUnsubscribed: boolean;
  }>;
  try {
    results = await inChunks(parsed.subscribers, async (imported) => {
      const id = await newsletterSubscriberId(imported.email);
      const existing = existingSubscribers.get(id) || null;
      const signupAt = earliestSignupAt(existing, imported.signupAt);
      const status = existing?.status === "unsubscribed"
        ? "unsubscribed"
        : "active";
      const source = existing?.source || imported.subscriptionSource;
      const subscriber: NewsletterSubscriber = {
        ...existing,
        version: 1,
        id,
        email: imported.email,
        name: existing?.name || imported.name,
        status,
        locale: existing?.locale || options.locale,
        source,
        subscriptionSource: imported.subscriptionSource,
        signupAt,
        importedAt: existing?.importedAt || importedAt,
        importedFrom: "substack",
        country: existing?.country || imported.country,
        region: existing?.region || imported.region,
        interactions: imported.interactions,
        consentVersion: existing?.consentVersion || NEWSLETTER_CONSENT_VERSION,
        consentedAt: existing?.consentedAt || signupAt,
        createdAt: signupAt,
        updatedAt: existing?.updatedAt || importedAt,
        confirmationSentAt:
          status === "active" && existing?.status === "pending"
            ? undefined
            : existing?.confirmationSentAt,
        confirmedAt:
          status === "active"
            ? existing?.confirmedAt || signupAt
            : existing?.confirmedAt,
      };
      const changed = !existing ||
        JSON.stringify(subscriber) !== JSON.stringify(existing);
      const savedSubscriber = changed
        ? { ...subscriber, updatedAt: importedAt }
        : subscriber;
      if (changed) {
        await saveNewsletterSubscriber(
          options.storage,
          savedSubscriber,
          { skipIndex: true },
        );
      }
      existingSubscribers.set(id, savedSubscriber);
      return {
        created: !existing,
        changed,
        preservedUnsubscribed: existing?.status === "unsubscribed",
      };
    });
    await mergeNewsletterSubscriberIndex(
      options.storage,
      [...existingSubscribers.values()],
    );
  } catch (error) {
    await options.storage.delete(
      ".victopress/newsletter/indexes/subscribers.json",
    ).catch(() => {});
    throw error;
  }

  return {
    totalRows: parsed.totalRows,
    importedSubscribers: parsed.subscribers.length,
    created: results.filter((result) => result.created).length,
    updated: results.filter((result) => !result.created && result.changed).length,
    unchanged: results.filter((result) => !result.changed).length,
    preservedUnsubscribed: results.filter(
      (result) => result.preservedUnsubscribed,
    ).length,
    duplicateRows: parsed.duplicateRows,
  };
}
