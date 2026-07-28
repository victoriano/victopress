import type { Locale } from "~/lib/i18n";
import type { HeadlessBlogPost } from "~/lib/headless-blog";
import type { ResendEmailMessage } from "./resend.server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailShell(options: {
  siteName: string;
  previewText: string;
  content: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.previewText)}</title>
    <style>
      body { margin: 0; background: #f5f5f3; color: #222; font-family: Arial, Helvetica, sans-serif; }
      .preview { display: none !important; max-height: 0; max-width: 0; overflow: hidden; opacity: 0; }
      .shell { width: 100%; padding: 32px 12px; }
      .card { width: 100%; max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e5e5e5; }
      .header { padding: 24px 32px; border-bottom: 1px solid #ececec; font-size: 15px; font-weight: 700; letter-spacing: .01em; }
      .content { padding: 40px 32px; }
      .content h1 { margin: 0 0 12px; color: #161616; font-size: 30px; line-height: 1.2; }
      .content h2 { margin: 30px 0 12px; color: #161616; font-size: 23px; line-height: 1.3; }
      .content h3 { margin: 26px 0 10px; color: #161616; font-size: 19px; line-height: 1.35; }
      .content p, .content li { color: #4d4d4d; font-size: 16px; line-height: 1.65; }
      .content a { color: #111; }
      .content img { display: block; width: 100%; max-width: 100%; height: auto; margin: 24px 0; }
      .content figure { margin: 24px 0; }
      .content figcaption { color: #777; font-size: 13px; line-height: 1.5; }
      .content blockquote { margin: 28px 0; padding-left: 18px; border-left: 3px solid #d8d8d8; color: #555; }
      .content pre { padding: 16px; overflow-x: auto; background: #f4f4f4; }
      .button { display: inline-block; padding: 12px 20px; border-radius: 4px; background: #171717; color: #fff !important; font-size: 15px; font-weight: 700; text-decoration: none; }
      .meta { margin: 0 0 28px; color: #858585; font-size: 14px; }
      .footer { padding: 24px 32px; border-top: 1px solid #ececec; color: #777; font-size: 12px; line-height: 1.6; text-align: center; }
      .footer a { color: #555; }
      @media (max-width: 600px) {
        .shell { padding: 0; }
        .card { border-right: 0; border-left: 0; }
        .header { padding: 20px; }
        .content { padding: 30px 20px; }
        .content h1 { font-size: 27px; }
        .footer { padding: 22px 20px; }
      }
    </style>
  </head>
  <body>
    <div class="preview">${escapeHtml(options.previewText)}</div>
    <div class="shell">
      <div class="card">
        <div class="header">${escapeHtml(options.siteName)}</div>
        ${options.content}
      </div>
    </div>
  </body>
</html>`;
}

export function buildConfirmationEmail(options: {
  locale: Locale;
  siteName: string;
  from: string;
  to: string;
  confirmationUrl: string;
  replyTo?: string;
}): ResendEmailMessage {
  const spanish = options.locale === "es";
  const subject = spanish
    ? `Confirma tu suscripción a ${options.siteName}`
    : `Confirm your subscription to ${options.siteName}`;
  const heading = spanish ? "Confirma tu suscripción" : "Confirm your subscription";
  const body = spanish
    ? "Haz clic en el botón para recibir por correo los próximos artículos del blog."
    : "Click the button to receive future blog posts by email.";
  const button = spanish ? "Confirmar suscripción" : "Confirm subscription";
  const ignore = spanish
    ? "Si no solicitaste esta suscripción, puedes ignorar este correo."
    : "If you did not request this subscription, you can ignore this email.";
  const url = escapeHtml(options.confirmationUrl);

  return {
    from: options.from,
    to: [options.to],
    subject,
    html: emailShell({
      siteName: options.siteName,
      previewText: subject,
      content: `<div class="content">
          <h1>${escapeHtml(heading)}</h1>
          <p>${escapeHtml(body)}</p>
          <p style="margin: 28px 0;"><a class="button" href="${url}">${escapeHtml(button)}</a></p>
          <p style="margin-top: 30px; color: #777; font-size: 13px;">${escapeHtml(ignore)}</p>
        </div>`,
    }),
    text: `${heading}\n\n${body}\n\n${options.confirmationUrl}\n\n${ignore}`,
    ...(options.replyTo ? { reply_to: options.replyTo } : {}),
    tags: [{ name: "category", value: "newsletter_confirmation" }],
  };
}

export function buildNewsletterEmail(options: {
  locale: Locale;
  siteName: string;
  from: string;
  to: string;
  subject: string;
  post: HeadlessBlogPost;
  unsubscribeUrl: string;
  replyTo?: string;
  campaignTag: string;
}): ResendEmailMessage {
  const spanish = options.locale === "es";
  const readOnline = spanish ? "Leer en la web" : "Read on the web";
  const unsubscribe = spanish ? "Darme de baja" : "Unsubscribe";
  const reason = spanish
    ? `Recibes este correo porque te suscribiste al blog de ${options.siteName}.`
    : `You are receiving this because you subscribed to ${options.siteName}'s blog.`;
  const date = options.post.date
    ? new Date(`${options.post.date}T12:00:00Z`).toLocaleDateString(
        spanish ? "es-ES" : "en-US",
        { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
      )
    : "";
  const cover = options.post.coverUrl && !options.post.coverInBody
    ? `<a href="${escapeHtml(options.post.canonicalUrl)}"><img src="${escapeHtml(options.post.coverUrl)}" alt="${escapeHtml(options.post.title)}"></a>`
    : "";
  const unsubscribeUrl = escapeHtml(options.unsubscribeUrl);

  return {
    from: options.from,
    to: [options.to],
    subject: options.subject,
    html: emailShell({
      siteName: options.siteName,
      previewText: options.post.excerpt || options.subject,
      content: `<div class="content">
          <h1>${escapeHtml(options.post.title)}</h1>
          ${date ? `<p class="meta">${escapeHtml(date)}</p>` : ""}
          ${cover}
          <div class="article">${options.post.contentHtml}</div>
          <p style="margin-top: 36px;"><a class="button" href="${escapeHtml(options.post.canonicalUrl)}">${escapeHtml(readOnline)}</a></p>
        </div>
        <div class="footer">
          ${escapeHtml(reason)}<br>
          <a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a>
        </div>`,
    }),
    text: `${options.post.title}\n${date ? `${date}\n` : ""}\n${options.post.contentMarkdown}\n\n${readOnline}: ${options.post.canonicalUrl}\n\n${reason}\n${unsubscribe}: ${options.unsubscribeUrl}`,
    ...(options.replyTo ? { reply_to: options.replyTo } : {}),
    headers: {
      "List-Unsubscribe": `<${options.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "category", value: "newsletter" },
      { name: "campaign", value: options.campaignTag },
    ],
  };
}
