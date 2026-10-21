/*
 * The page every Spectra email is set on: the app's paper, ink and violet,
 * in tables and inline styles because mail clients read nothing else. The
 * serif is Newsreader where the reader has it and Georgia where they don't,
 * as in the app's headings. Light only: a mail client's own dark mode
 * inverts it more faithfully than a second palette it may ignore.
 */

export const EMAIL_INK = {
  page: "#f3f1ec",
  paper: "#fcfbf8",
  rule: "#dcd8d0",
  ink: "#1d1b21",
  secondary: "#58524b",
  violet: "#6a4de8",
} as const;

export const EMAIL_SERIF = "Newsreader, Georgia, 'Times New Roman', serif";
export const EMAIL_SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A paragraph in the body's voice. `html` is trusted markup; escape what a person typed first. */
export function emailParagraph(html: string, tone: "body" | "quiet" = "body") {
  const color = tone === "body" ? EMAIL_INK.ink : EMAIL_INK.secondary;
  const size = tone === "body" ? 16 : 13;
  return `<p style="margin:0 0 16px;font-family:${EMAIL_SANS};font-size:${size}px;line-height:1.6;color:${color};">${html}</p>`;
}

/** The one thing an email asks the reader to do. */
export function emailAction(label: string, href: string) {
  const url = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${EMAIL_INK.violet};"><a href="${url}" style="display:inline-block;padding:13px 22px;font-family:${EMAIL_SANS};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a></td></tr></table>`;
}

/** The prism from the site the email links to; the drawn triangle stands in where no site is known or images are off. */
function emailMark(origin?: string) {
  if (!origin) return `<span style="color:${EMAIL_INK.violet};">&#9650;</span>`;
  const src = escapeHtml(new URL("/icon-192.png", origin).href);
  return `<img src="${src}" width="22" height="22" alt="" style="display:inline-block;width:22px;height:22px;border:0;vertical-align:-4px;">`;
}

export function emailPage({
  preheader,
  title,
  body,
  footer,
  origin,
}: {
  preheader: string;
  title: string;
  body: string;
  footer: string;
  /** The Spectra site the email belongs to, for its mark. */
  origin?: string;
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_INK.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_INK.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font-family:${EMAIL_SERIF};font-size:20px;font-weight:500;color:${EMAIL_INK.ink};">${emailMark(origin)}&nbsp;Spectra</td></tr>
<tr><td style="background:${EMAIL_INK.paper};border:1px solid ${EMAIL_INK.rule};border-radius:14px;padding:36px 32px 20px;">
<h1 style="margin:0 0 20px;font-family:${EMAIL_SERIF};font-size:30px;font-weight:500;line-height:1.15;letter-spacing:-0.01em;color:${EMAIL_INK.ink};">${escapeHtml(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${EMAIL_SANS};font-size:12px;line-height:1.6;color:${EMAIL_INK.secondary};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
