import { EMAIL_INK, EMAIL_SANS, emailAction, emailPage, emailParagraph, escapeHtml } from "./email-layout";

type InviteEmailParams = {
  to: string;
  role: string;
  joinUrl: string;
  orgName?: string;
  /** When the link stops working; the email says how long that leaves. */
  expiresAt?: number;
  /** Logged instead of the recipient when delivery fails. */
  invitationId?: string;
};

export type InviteEmailResult =
  | { status: "sent"; providerId?: string; envelopeFrom?: string; accepted?: string[]; rejected?: string[]; response?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

type Invitee = "student" | "teacher" | "admin";

function inviteeOf(role: string): Invitee {
  const value = role.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (value === "teacher") return "teacher";
  if (value === "school admin" || value === "admin") return "admin";
  return "student";
}

/** What each person will find when they join, in the words they would use. */
const WAITING: Record<Invitee, { lead: (school: string) => string; lines: string[] }> = {
  student: {
    lead: (school) => `${school} has set up Spectra for you: one place for your classes, your deadlines and the work you make for them.`,
    lines: [
      "Your ManageBac tasks and classes, already on one calendar",
      "A Library for your notes and files, filed by class",
      "Spectra AI, to plan your week, revise, and turn notes into quizzes and flashcards",
    ],
  },
  teacher: {
    lead: (school) => `${school} has set up Spectra, where its students plan their work and make what they study with.`,
    lines: [
      "Your classes and their deadlines, from ManageBac",
      "A Library for the resources you make and share",
      "Spectra AI, to draft materials, quizzes and plans with you",
    ],
  },
  admin: {
    lead: (school) => `You are setting up Spectra for ${school}.`,
    lines: [
      "Connect ManageBac, so classes and tasks arrive by themselves",
      "Invite your students and teachers",
      "Choose what Spectra AI may do at your school",
    ],
  },
};

function daysLeft(expiresAt?: number) {
  if (!expiresAt) return null;
  const days = Math.round((expiresAt - Date.now()) / 86_400_000);
  return days >= 1 ? days : null;
}

/** The invitation, as students and the people around them will read it. */
export function invitationEmail(params: InviteEmailParams) {
  const school = params.orgName?.trim() || "Your school";
  const who = inviteeOf(params.role);
  const waiting = WAITING[who];
  const days = daysLeft(params.expiresAt);
  const lasts = days ? ` The invitation lasts ${days === 1 ? "one more day" : `${days} more days`}.` : "";
  const title = who === "admin" ? `Set up Spectra for ${school}` : `Join ${school} on Spectra`;
  const subject = who === "admin" ? `Set up Spectra for ${school}` : `${school} invited you to Spectra`;
  const action = who === "admin" ? "Set up your school" : "Join your school";
  const list = waiting.lines
    .map(
      (line) =>
        `<tr><td style="padding:0 0 10px 14px;border-left:2px solid ${EMAIL_INK.violet};font-family:${EMAIL_SANS};font-size:15px;line-height:1.5;color:${EMAIL_INK.ink};">${escapeHtml(line)}</td></tr><tr><td style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>`,
    )
    .join("");
  const body = [
    emailParagraph(escapeHtml(waiting.lead(school))),
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">${list}</table>`,
    emailAction(action, params.joinUrl),
    emailParagraph(`Sign in with this email address, ${escapeHtml(params.to)}, so Spectra knows it is you.${escapeHtml(lasts)}`, "quiet"),
    emailParagraph(
      `If the button does not open, paste this into your browser:<br><a href="${escapeHtml(params.joinUrl)}" style="color:${EMAIL_INK.violet};word-break:break-all;">${escapeHtml(params.joinUrl)}</a>`,
      "quiet",
    ),
  ].join("\n");
  const footer = `${escapeHtml(school)} sent this invitation through Spectra. If you were not expecting it, you can ignore this email: nothing happens until you join.`;
  const text = [
    title,
    "",
    waiting.lead(school),
    "",
    ...waiting.lines.map((line) => `- ${line}`),
    "",
    `${action}: ${params.joinUrl}`,
    "",
    `Sign in with this email address, ${params.to}, so Spectra knows it is you.${lasts}`,
    "",
    `${school} sent this invitation through Spectra. If you were not expecting it, you can ignore this email.`,
  ].join("\n");
  return {
    subject,
    html: emailPage({ preheader: waiting.lead(school), title, body, footer, origin: new URL(params.joinUrl).origin }),
    text,
  };
}

export async function sendInvitationEmail(params: InviteEmailParams): Promise<InviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.INVITE_FROM_EMAIL?.trim();

  if (!apiKey || !fromEmail) {
    return {
      status: "skipped",
      reason: "Resend email environment is not configured.",
    };
  }

  try {
    const message = invitationEmail(params);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const info = await response.json() as { id?: string; message?: string };
    if (!response.ok)
      throw new Error(`Resend delivery not accepted (HTTP ${response.status}): ${info.message || "Unknown error"}`);
    if (!info.id) throw new Error("Resend did not return an email id.");

    return {
      status: "sent",
      providerId: "resend",
      envelopeFrom: fromEmail,
      accepted: [params.to],
      rejected: [],
      response: info.id,
    };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Unknown email transport failure")
      .replace(/[^\s<>@"']+@[^\s<>@"']+/g, "[address]");
    // Invitees are often minors: the log names the invitation, never the
    // address, and provider errors that echo the address are redacted.
    console.warn("[invite-email] resend delivery threw", {
      invitationId: params.invitationId ?? "unknown",
      reason,
    });
    return {
      status: "failed",
      reason,
    };
  }
}
