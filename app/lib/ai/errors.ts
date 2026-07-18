/** Stable error codes that routes and jobs can safely branch on. */
export type AiErrorCode =
  | "AI_CONFIGURATION_ERROR"
  | "AI_VALIDATION_ERROR"
  | "AI_STORAGE_ERROR"
  | "GEMINI_REQUEST_ERROR"
  | "GEMINI_RESPONSE_ERROR";

export class AiCoreError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiCoreError";
    this.code = code;
  }
}

export class AiConfigurationError extends AiCoreError {
  constructor(message: string, options?: ErrorOptions) {
    super("AI_CONFIGURATION_ERROR", message, options);
    this.name = "AiConfigurationError";
  }
}

export class AiDataValidationError extends AiCoreError {
  readonly path?: string;

  constructor(message: string, path?: string, options?: ErrorOptions) {
    super("AI_VALIDATION_ERROR", path ? `${message} (${path})` : message, options);
    this.name = "AiDataValidationError";
    this.path = path;
  }
}

export class AiStorageError extends AiCoreError {
  readonly storageKey: string;

  constructor(message: string, storageKey: string, options?: ErrorOptions) {
    super("AI_STORAGE_ERROR", `${message}: ${storageKey}`, options);
    this.name = "AiStorageError";
    this.storageKey = storageKey;
  }
}

export class GeminiRequestError extends AiCoreError {
  readonly status: number;
  readonly retryable: boolean;
  readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      status: number;
      responseBody?: string;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super("GEMINI_REQUEST_ERROR", message, { cause: options.cause });
    this.name = "GeminiRequestError";
    this.status = options.status;
    this.retryable =
      options.retryable ??
      (options.status === 408 || options.status === 429 || options.status >= 500);
    this.responseBody = options.responseBody;
  }
}

export class GeminiResponseError extends AiCoreError {
  readonly finishReason?: string;

  constructor(
    message: string,
    options?: { finishReason?: string; cause?: unknown },
  ) {
    super("GEMINI_RESPONSE_ERROR", message, { cause: options?.cause });
    this.name = "GeminiResponseError";
    this.finishReason = options?.finishReason;
  }
}
