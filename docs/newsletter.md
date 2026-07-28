# Newsletter subscriptions and delivery

VictoPress owns the subscriber list. Resend sends confirmation messages and
newsletter campaigns, but it is not the source of truth for consent.

## User flow

1. The footer form submits an email address and the current blog language.
2. VictoPress writes a `pending` subscriber record and sends a confirmation
   email through Resend.
3. The signed confirmation link is valid for 48 hours. Opening it changes the
   record to `active`.
4. **Admin → Newsletter** sends a published post only to active subscribers
   whose saved language matches the chosen edition.
5. Every campaign message has a visible unsubscribe link plus
   `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
6. A normal `GET` only displays the unsubscribe confirmation page, so link
   scanners cannot silently remove a subscriber. A human form submission—or
   the standard one-click email-client `POST`—changes the status to
   `unsubscribed`.

Unsubscribed records are retained as a suppression/consent trail and are never
included in future sends. Subscribing again starts a new double-opt-in flow.

## Storage

The newsletter uses the same `StorageAdapter` as the rest of VictoPress:

```text
.victopress/newsletter/
├── subscribers/
│   └── <sha256-normalized-email>.json
└── campaigns/
    └── <sha256-language-and-post-slug>.json
```

The paths are under `content/.victopress/` in local development (already
ignored by Git) and inside the private `CONTENT_BUCKET` in production.

Each subscriber has its own object. This avoids a single shared JSON list where
two simultaneous signups could overwrite one another. Campaign records retain
batch progress and Resend message IDs so a failed send can resume without
repeating completed batches.

## Required configuration

| Variable | Kind | Purpose |
|---|---|---|
| `RESEND_API_KEY` | secret | Resend API authentication |
| `NEWSLETTER_TOKEN_SECRET` | secret | HMAC signing for confirmation and unsubscribe links; use at least 32 random characters |
| `NEWSLETTER_FROM_EMAIL` | variable | Sender in `Name <email@verified-domain>` format |
| `NEWSLETTER_REPLY_TO` | optional variable | Reply-to address |
| `PUBLIC_NEWSLETTER_URL` | optional variable | Public origin that hosts `/newsletter/*`; request origin is the fallback |

The sender domain must already be verified in Resend. Do not place either
secret in `wrangler.toml`, source files, screenshots, logs, or commits.

For local development, add the values to the ignored `.dev.vars` file and
restrict it to the current user:

```bash
chmod 600 .dev.vars
```

For Cloudflare Pages, enter each secret interactively so it never appears in
shell history:

```bash
bunx wrangler pages secret put RESEND_API_KEY --project-name victopress
bunx wrangler pages secret put NEWSLETTER_TOKEN_SECRET --project-name victopress
```

Generate the token secret locally with:

```bash
openssl rand -base64 48
```

Set `NEWSLETTER_FROM_EMAIL`, optional `NEWSLETTER_REPLY_TO`, and optional
`PUBLIC_NEWSLETTER_URL` in the Pages environment variables. Redeploy after
changing the configuration. Avoid rotating `NEWSLETTER_TOKEN_SECRET` casually:
old confirmation and unsubscribe links depend on it.

## Sending and recovery

The admin action requires an explicit checkbox before it makes an external
send. VictoPress renders the selected language edition, uses absolute image and
article URLs, and sends personalized batches of at most 100 messages.

Only one completed campaign is allowed for each post/language pair. A provider
failure saves the campaign as `failed`; submitting the same post/language
again resumes only pending batches. Resend idempotency keys add another guard
against an immediate duplicate request.

No test or build command sends live email. Unit tests inject a fake Resend HTTP
client.
