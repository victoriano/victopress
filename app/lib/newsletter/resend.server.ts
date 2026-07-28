const RESEND_API_URL = "https://api.resend.com";
const RESEND_USER_AGENT = "VictoPress-Newsletter/1.0";

export interface ResendEmailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

interface ResendApiErrorPayload {
  message?: string;
  name?: string;
  error?: {
    message?: string;
    name?: string;
  };
}

export class ResendApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ResendApiError";
    this.status = status;
  }
}

async function resendRequest<T>(options: {
  apiKey: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${RESEND_API_URL}${options.path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey.slice(0, 256),
      "User-Agent": RESEND_USER_AGENT,
    },
    body: JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => ({})) as ResendApiErrorPayload & T;
  if (!response.ok) {
    const message =
      payload.error?.message ||
      payload.message ||
      `Resend request failed with HTTP ${response.status}.`;
    throw new ResendApiError(response.status, message);
  }
  return payload;
}

export async function sendResendEmail(options: {
  apiKey: string;
  message: ResendEmailMessage;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const response = await resendRequest<{ id?: string }>({
    apiKey: options.apiKey,
    path: "/emails",
    body: options.message,
    idempotencyKey: options.idempotencyKey,
    fetchImpl: options.fetchImpl,
  });
  if (!response.id) throw new ResendApiError(502, "Resend returned no email id.");
  return response.id;
}

export async function sendResendBatch(options: {
  apiKey: string;
  messages: ResendEmailMessage[];
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  if (options.messages.length === 0) return [];
  if (options.messages.length > 100) {
    throw new Error("Resend accepts at most 100 emails per batch.");
  }

  const response = await resendRequest<{ data?: Array<{ id?: string }> }>({
    apiKey: options.apiKey,
    path: "/emails/batch",
    body: options.messages,
    idempotencyKey: options.idempotencyKey,
    fetchImpl: options.fetchImpl,
  });
  const ids = (response.data || [])
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id));
  if (ids.length !== options.messages.length) {
    throw new ResendApiError(502, "Resend returned an incomplete batch response.");
  }
  return ids;
}
