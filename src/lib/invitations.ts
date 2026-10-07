import nodemailer from "nodemailer";

type InviteEmailParams = {
  to: string;
  role: string;
  joinUrl: string;
  orgName?: string;
  /** Logged instead of the recipient when delivery fails. */
  invitationId?: string;
};

export type InviteEmailResult =
  | { status: "sent"; providerId?: string; envelopeFrom?: string; accepted?: string[]; rejected?: string[]; response?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/** Connect, greeting and idle-socket limits for one invitation delivery. */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

function normalizeMailbox(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSmtpSecret(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function resolveEnvelopeFrom() {
  const smtpUser = normalizeMailbox(process.env.SMTP_USER);
  const configuredFrom = normalizeMailbox(process.env.SMTP_FROM_EMAIL);
  if (!smtpUser) return null;
  if (!configuredFrom) return smtpUser;
  if (configuredFrom.toLowerCase() !== smtpUser.toLowerCase()) {
    console.warn("[invite-email] SMTP_FROM_EMAIL differs from SMTP_USER; using authenticated mailbox as sender", {
      smtpUser,
      configuredFrom,
    });
    return smtpUser;
  }
  return configuredFrom;
}

function inviteEmailHtml(params: InviteEmailParams) {
  const schoolName = params.orgName?.trim() || "Spectra";
  const roleLabel = params.role.trim();
  return `
    <div style="margin:0;padding:24px;background:#f5efe2;font-family:Georgia,'Times New Roman',serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#fffaf1;border:1px solid #d9cfbd;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f766e;color:#fffaf1;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#fffaf1;">Spectra</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.1;font-weight:700;color:#fffaf1;">You have been invited to ${schoolName}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Your school invited you to join as a <strong style="text-transform:capitalize;">${roleLabel}</strong>.</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">Use the link below to activate your access. This invitation is scoped to your email address and may expire.</p>
          <p style="margin:0 0 24px;">
            <a href="${params.joinUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0f766e;color:#fffaf1;text-decoration:none;font-weight:700;">Accept invitation</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#4b5563;">If the button does not open, copy this link into your browser:</p>
          <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-word;color:#0f172a;">${params.joinUrl}</p>
        </div>
      </div>
    </div>
  `;
}

export async function sendInvitationEmail(params: InviteEmailParams): Promise<InviteEmailResult> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = normalizeMailbox(process.env.SMTP_USER);
  const smtpPass = normalizeSmtpSecret(process.env.SMTP_PASS);
  const smtpFrom = resolveEnvelopeFrom();

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    return {
      status: "skipped",
      reason: "SMTP email environment is not configured.",
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      // The invite request waits for this. Nodemailer's defaults allow two
      // minutes to connect and ten minutes of socket silence, far past the
      // route's own limit, so a stalled SMTP host hung the invite instead of
      // reporting a failed delivery the admin can retry.
      ...SMTP_TIMEOUTS,
    });

    await transporter.verify();

    const info = await transporter.sendMail({
      from: smtpFrom,
      to: params.to,
      subject: `Your ${params.orgName?.trim() || "Spectra"} invitation`,
      html: inviteEmailHtml(params),
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    if (accepted.length === 0 || rejected.length > 0) {
      return {
        status: "failed",
        // Counts, not addresses: the reason travels in the response and may be logged on the way.
        reason: `SMTP delivery not accepted. accepted=${accepted.length} rejected=${rejected.length} response=${(info.response || "none").replace(/[^\s<>@"']+@[^\s<>@"']+/g, "[address]")}`,
      };
    }

    return {
      status: "sent",
      providerId: "smtp",
      envelopeFrom: smtpFrom,
      accepted,
      rejected,
      response: info.response,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email transport failure";
    // Invitees are often minors: the log names the invitation, never the
    // address, and SMTP errors that echo the address are redacted.
    console.warn("[invite-email] smtp delivery threw", {
      invitationId: params.invitationId ?? "unknown",
      reason: reason.replace(/[^\s<>@"']+@[^\s<>@"']+/g, "[address]"),
    });
    return {
      status: "failed",
      reason,
    };
  }
}
