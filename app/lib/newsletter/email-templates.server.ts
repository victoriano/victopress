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
  locale: Locale;
  siteName: string;
  previewText: string;
  rows: string;
}): string {
  return `<!doctype html>
<html lang="${options.locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.previewText)}</title>
    <style>
      html, body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
      * { box-sizing: border-box; }
      table, td { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
      table { table-layout: fixed; }
      body { background: #f5f5f3; color: #222; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      img { display: block; max-width: 100%; height: auto; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
      .preview { display: none !important; max-height: 0; max-width: 0; overflow: hidden; opacity: 0; }
      .outer { width: 100% !important; max-width: 100% !important; box-sizing: border-box; table-layout: fixed; background: #f5f5f3; }
      .shell { width: 100%; max-width: 100%; box-sizing: border-box; padding: 32px 12px; }
      .card { width: 100% !important; max-width: 680px !important; box-sizing: border-box; table-layout: fixed; background: #fff; border: 1px solid #e5e5e5; }
      .header { padding: 24px 32px; border-bottom: 1px solid #ececec; font-size: 15px; font-weight: 700; letter-spacing: .01em; }
      .content { max-width: 100%; padding: 40px 32px; overflow-wrap: anywhere; word-break: break-word; }
      .content h1 { margin: 0 0 12px; color: #161616; font-size: 30px; line-height: 1.2; }
      .content h2 { margin: 30px 0 12px; color: #161616; font-size: 23px; line-height: 1.3; }
      .content h3 { margin: 26px 0 10px; color: #161616; font-size: 19px; line-height: 1.35; }
      .content p, .content li { color: #4d4d4d; font-size: 16px; line-height: 1.65; }
      .content a { color: #111; overflow-wrap: anywhere; word-break: break-word; }
      .content img { max-width: 100% !important; height: auto !important; margin: 24px 0; }
      .content figure { margin: 24px 0; }
      .content figcaption { color: #777; font-size: 13px; line-height: 1.5; }
      .content blockquote { margin: 28px 0; padding-left: 18px; border-left: 3px solid #d8d8d8; color: #555; }
      .content pre, .content code { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
      .content pre { padding: 16px; background: #f4f4f4; }
      .content table { width: 100% !important; max-width: 100% !important; table-layout: fixed; }
      .content td, .content th { overflow-wrap: anywhere; word-break: break-word; }
      .button { display: inline-block; padding: 12px 20px; border-radius: 4px; background: #171717; color: #fff !important; font-size: 15px; font-weight: 700; text-decoration: none; }
      .meta { margin: 0 0 28px; color: #858585; font-size: 14px; }
      .footer { padding: 24px 32px; border-top: 1px solid #ececec; color: #777; font-size: 12px; line-height: 1.6; text-align: center; }
      .footer a { color: #555; }
      @media (max-width: 600px) {
        .shell { padding: 0 !important; }
        .card { border-right: 0 !important; border-left: 0 !important; }
        .header { padding: 20px !important; }
        .content { padding: 30px 20px !important; }
        .content h1 { font-size: 27px; }
        .footer { padding: 22px 20px !important; }
      }
    </style>
  </head>
  <body>
    <div class="preview">${escapeHtml(options.previewText)}</div>
    <table role="presentation" class="outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:100%;box-sizing:border-box;table-layout:fixed;background:#f5f5f3;">
      <tr>
        <td class="shell" align="center" style="width:100%;max-width:100%;padding:32px 12px;box-sizing:border-box;">
          <table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;box-sizing:border-box;table-layout:fixed;background:#ffffff;border:1px solid #e5e5e5;">
            <tr>
              <td class="header" style="padding:24px 32px;border-bottom:1px solid #ececec;font-size:15px;font-weight:700;letter-spacing:.01em;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(options.siteName)}</td>
            </tr>
            ${options.rows}
          </table>
        </td>
      </tr>
    </table>
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
  const trackingDisclosure = spanish
    ? "Los envíos incluyen una medición aproximada de apertura mediante una imagen privada."
    : "Emails include approximate open detection through a private image.";
  const expiry = spanish
    ? "El enlace caduca dentro de 72 horas."
    : "The link expires in 72 hours.";
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
      locale: options.locale,
      siteName: options.siteName,
      previewText: subject,
      rows: `<tr>
        <td class="content" style="max-width:100%;padding:40px 32px;overflow-wrap:anywhere;word-break:break-word;">
          <h1>${escapeHtml(heading)}</h1>
          <p>${escapeHtml(body)}</p>
          <p style="color: #777; font-size: 13px;">${escapeHtml(expiry)} ${escapeHtml(trackingDisclosure)}</p>
          <p style="margin: 28px 0;"><a class="button" href="${url}">${escapeHtml(button)}</a></p>
          <p style="margin-top: 30px; color: #777; font-size: 13px;">${escapeHtml(ignore)}</p>
        </td>
      </tr>`,
    }),
    text: `${heading}\n\n${body}\n\n${expiry} ${trackingDisclosure}\n\n${options.confirmationUrl}\n\n${ignore}`,
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
  trackingPixelUrl: string;
  replyTo?: string;
  campaignTag: string;
}): ResendEmailMessage {
  const spanish = options.locale === "es";
  const readOnline = spanish ? "Leer en la web" : "Read on the web";
  const unsubscribe = spanish ? "Darme de baja" : "Unsubscribe";
  const reason = spanish
    ? `Recibes este correo porque te suscribiste al blog de ${options.siteName}.`
    : `You are receiving this because you subscribed to ${options.siteName}'s blog.`;
  const trackingDisclosure = spanish
    ? "La apertura se detecta de forma aproximada mediante una imagen privada."
    : "Opens are detected approximately through a private image.";
  const date = options.post.date
    ? new Date(`${options.post.date}T12:00:00Z`).toLocaleDateString(
        spanish ? "es-ES" : "en-US",
        { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
      )
    : "";
  const cover = options.post.coverUrl && !options.post.coverInBody
    ? `<a href="${escapeHtml(options.post.canonicalUrl)}"><img src="${escapeHtml(options.post.coverUrl)}" alt="${escapeHtml(options.post.title)}" style="display:block;max-width:100%;height:auto;border:0;"></a>`
    : "";
  const unsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const trackingPixelUrl = escapeHtml(options.trackingPixelUrl);

  return {
    from: options.from,
    to: [options.to],
    subject: options.subject,
    html: emailShell({
      locale: options.locale,
      siteName: options.siteName,
      previewText: options.post.excerpt || options.subject,
      rows: `<tr>
        <td class="content" style="max-width:100%;padding:40px 32px;overflow-wrap:anywhere;word-break:break-word;">
          <h1>${escapeHtml(options.post.title)}</h1>
          ${date ? `<p class="meta">${escapeHtml(date)}</p>` : ""}
          ${cover}
          <div class="article">${options.post.contentHtml}</div>
          <p style="margin-top: 36px;"><a class="button" href="${escapeHtml(options.post.canonicalUrl)}">${escapeHtml(readOnline)}</a></p>
        </td>
      </tr>
      <tr>
        <td class="footer" style="padding:24px 32px;border-top:1px solid #ececec;color:#777;font-size:12px;line-height:1.6;text-align:center;overflow-wrap:anywhere;word-break:break-word;">
          ${escapeHtml(reason)}<br>
          ${escapeHtml(trackingDisclosure)}<br>
          <a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a>
          <img src="${trackingPixelUrl}" width="1" height="1" alt="" aria-hidden="true" style="display:block;width:1px!important;max-width:1px!important;height:1px!important;margin:0;border:0;overflow:hidden;">
        </td>
      </tr>`,
    }),
    text: `${options.post.title}\n${date ? `${date}\n` : ""}\n${options.post.contentMarkdown}\n\n${readOnline}: ${options.post.canonicalUrl}\n\n${reason}\n${trackingDisclosure}\n${unsubscribe}: ${options.unsubscribeUrl}`,
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
