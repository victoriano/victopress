import type { CaptureResult, Properties } from "posthog-js";

export interface AnalyticsConfig {
  apiHost: string;
  projectToken: string;
  site: "victoriano.me" | "photos.victoriano.me";
}

export type AnalyticsProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

type PostHogClient = typeof import("posthog-js")["default"];

const BLOCKED_PROPERTY_KEYS = new Set([
  "cf-turnstile-response",
  "email",
  "message",
  "name",
  "password",
  "query",
  "search",
  "turnstile_token",
  "turnstiletoken",
]);

const pendingEvents: Array<{
  eventName: string;
  properties: AnalyticsProperties;
}> = [];

let client: PostHogClient | null = null;
let initialization: Promise<PostHogClient | null> | null = null;

export function stripAnalyticsUrl(value: string): string {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const parsed = new URL(value, "https://analytics.invalid");
    parsed.search = "";
    parsed.hash = "";
    return absolute ? parsed.toString() : parsed.pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] || "/";
  }
}

export function sanitizeAnalyticsEvent(
  event: CaptureResult | null,
  site: AnalyticsConfig["site"],
): CaptureResult | null {
  if (!event) return null;

  const properties = { ...event.properties } as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    const normalizedKey = key.toLowerCase();
    if (BLOCKED_PROPERTY_KEYS.has(normalizedKey)) {
      delete properties[key];
      continue;
    }

    if (
      typeof value === "string" &&
      (normalizedKey.includes("url") || normalizedKey.includes("referrer"))
    ) {
      properties[key] = stripAnalyticsUrl(value);
    }
  }

  delete properties.$element_text;
  delete properties.$elements;
  delete properties.$elements_chain;

  return {
    ...event,
    properties: {
      ...properties,
      analytics_privacy: "cookieless",
      site,
    } as Properties,
  };
}

function compactProperties(properties: AnalyticsProperties): Properties {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as Properties;
}

function flushPendingEvents(posthog: PostHogClient) {
  for (const pending of pendingEvents.splice(0)) {
    posthog.capture(pending.eventName, compactProperties(pending.properties));
  }
}

export function initializeAnalytics(
  config: AnalyticsConfig,
): Promise<PostHogClient | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (initialization) return initialization;

  initialization = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(config.projectToken, {
        advanced_disable_flags: true,
        api_host: config.apiHost,
        autocapture: false,
        before_send: (event) => sanitizeAnalyticsEvent(event, config.site),
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_pageleave: true,
        capture_pageview: "history_change",
        capture_performance: false,
        cookieless_mode: "always",
        cross_subdomain_cookie: true,
        defaults: "2026-05-30",
        disable_capture_url_hashes: true,
        disable_session_recording: true,
        disable_surveys: true,
        mask_all_element_attributes: true,
        mask_all_text: true,
        person_profiles: "identified_only",
        property_denylist: Array.from(BLOCKED_PROPERTY_KEYS),
        respect_dnt: true,
        secure_cookie: true,
      });
      client = posthog;
      flushPendingEvents(posthog);
      return posthog;
    })
    .catch(() => {
      initialization = null;
      return null;
    });

  return initialization;
}

export function captureAnalyticsEvent(
  eventName: string,
  properties: AnalyticsProperties = {},
) {
  if (typeof window === "undefined") return;
  if (client) {
    client.capture(eventName, compactProperties(properties));
    return;
  }

  if (pendingEvents.length < 50) {
    pendingEvents.push({ eventName, properties });
  }
  void initialization?.then((posthog) => {
    if (posthog && pendingEvents.length > 0) flushPendingEvents(posthog);
  });
}
