type InviteEmailParams = {
  to: string;
  role: string;
  joinUrl: string;
  orgName?: string;
};

export type InviteEmailResult =
  | { status: "sent"; providerId?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function inviteEmailHtml(params: InviteEmailParams) {
  const schoolName = params.orgName?.trim() || "AI School";
  const roleLabel = params.role.trim();
  return `
    <div style="margin:0;padding:24px;background:#f5efe2;font-family:Georgia,'Times New Roman',serif;color:#1f2937;">
      <div style="max-width:560px;margin:0 auto;background:#fffaf1;border:1px solid #d9cfbd;border-radius:24px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f766e,#d97706);color:#fffaf1;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8;">AI School</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.1;font-weight:700;">You have been invited to ${schoolName}</h1>
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
  if (!process.env.RESEND_API_KEY || !process.env.INVITE_FROM_EMAIL) {
    return {
      status: "skipped",
      reason: "Invite email environment is not configured.",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.INVITE_FROM_EMAIL,
        to: [params.to],
        subject: `Your ${params.orgName?.trim() || "AI School"} invitation`,
        html: inviteEmailHtml(params),
      }),
    });

    if (!response.ok) {
      const reason = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 400);
      console.warn("[invite-email] resend delivery failed", {
        to: params.to,
        status: response.status,
        reason,
      });
      return {
        status: "failed",
        reason: reason || `Provider returned HTTP ${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    return {
      status: "sent",
      providerId: payload?.id,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email transport failure";
    console.warn("[invite-email] resend delivery threw", {
      to: params.to,
      reason,
    });
    return {
      status: "failed",
      reason,
    };
  }
}
