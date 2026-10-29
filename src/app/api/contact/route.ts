import { NextRequest, NextResponse } from "next/server";
import { convexPublicMutation } from "@/lib/convex-server";
import { EMAIL_INK, EMAIL_SANS, emailPage, escapeHtml } from "@/lib/email-layout";

/*
 * The walkthrough request from the landing page's door. It is the one thing
 * on that page that reaches the network, so it is guarded against the usual
 * abuse: a field only bots fill, a form submitted faster than a person can,
 * a cap per address and per sender, a cap on the whole day, and no messages
 * that are mostly links. A guarded request that looks like a bot is answered
 * as if it went through, so a bot learns nothing. Limits live in memory and
 * reset when the server restarts.
 *
 * A request is kept in Convex, one per email address, for the platform team
 * to read in the superadmin; when email is configured, they are also told.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PER_SENDER = { count: 3, windowMs: HOUR };
const PER_EMAIL = { count: 2, windowMs: DAY };
const PER_DAY = 120;
/** Faster than this, nobody typed the form. */
const MIN_ELAPSED_MS = 2500;
const MAX_LINKS = 2;

type Window = { count: number; resetAt: number };
const senders = new Map<string, Window>();
const emails = new Map<string, Window>();
let today: Window = { count: 0, resetAt: Date.now() + DAY };

/** Counts one more against `key`; false once the window is full. */
function take(map: Map<string, Window>, key: string, limit: { count: number; windowMs: number }) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + limit.windowMs });
    // Old windows go, so the maps never grow without bound.
    if (map.size > 5000) for (const [stale, window] of map) if (now > window.resetAt) map.delete(stale);
    return true;
  }
  if (entry.count >= limit.count) return false;
  entry.count += 1;
  return true;
}

function takeToday() {
  const now = Date.now();
  if (now > today.resetAt) today = { count: 0, resetAt: now + DAY };
  if (today.count >= PER_DAY) return false;
  today.count += 1;
  return true;
}

function sanitize(s: string, maxLen = 2000): string {
  return s.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const quietlyAccepted = () => NextResponse.json({ status: "sent" });
const tooMany = () => NextResponse.json({ error: "Too many requests from here today. Please try again tomorrow." }, { status: 429 });

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // A bot fills every field, and fills it at once.
  if (text(body.website).trim()) return quietlyAccepted();
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_ELAPSED_MS) return quietlyAccepted();

  const name = text(body.name);
  const email = text(body.email);
  const school = text(body.school);
  const role = text(body.role);
  const message = text(body.message);
  const walkthrough = body.kind === "walkthrough";
  const usesManageBac = body.usesManageBac === true;

  if (!name.trim() || !email.trim() || (walkthrough ? !school.trim() : !message.trim())) {
    return NextResponse.json(
      { error: walkthrough ? "Your name, email and school are needed." : "Name, email, and message are required." },
      { status: 400 },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
  }

  if ((`${message} ${school} ${name}`.match(/https?:\/\/|www\./gi) ?? []).length > MAX_LINKS) {
    return NextResponse.json({ error: "Please leave out the links; we will write back by email." }, { status: 400 });
  }

  if (!take(senders, ip, PER_SENDER) || !take(emails, email.trim().toLowerCase(), PER_EMAIL)) return tooMany();
  if (!takeToday()) {
    return NextResponse.json({ error: "We have had a lot of requests today. Please try again tomorrow." }, { status: 429 });
  }

  const safeName = sanitize(name, 200);
  const safeEmail = email.trim().slice(0, 320);
  const safeSchool = school ? sanitize(school, 300) : "";
  const safeRole = role ? sanitize(role, 100) : "";
  const safeMessage = sanitize(message) || (walkthrough ? "Asked for a walkthrough." : "");
  const subject = walkthrough ? `[Spectra] Walkthrough request from ${safeName}${safeSchool ? `, ${safeSchool}` : ""}` : `[Spectra Contact] New message from ${safeName}`;

  const key = process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!key) {
    console.error("[contact] SPECTRA_SECRET_BRIDGE_KEY is not set; the request cannot be kept.");
    return NextResponse.json({ error: "Requests cannot be sent from this server yet." }, { status: 503 });
  }
  try {
    const kept = await convexPublicMutation<Record<string, unknown>, { status: "sent" | "already" }>("landingRequests:submit", {
      key,
      email: safeEmail,
      name: safeName,
      school: safeSchool,
      role: safeRole,
      message: sanitize(message),
      usesManageBac,
    });
    if (kept.status === "already") {
      return NextResponse.json(
        { error: "We already have a request from this address, and we'll write to you there." },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error("[contact] Could not keep the request:", error);
    return NextResponse.json({ error: "The request did not go through. Please try again." }, { status: 500 });
  }

  // The request is kept; an email to the team is a courtesy, when email is set up.
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INVITE_FROM_EMAIL;
  if (!apiKey || !fromEmail) return NextResponse.json({ status: "sent" });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: ["pablo.martinez.dovale@gmail.com"],
        reply_to: safeEmail,
        subject,
        html: contactEmailHtml({
          name: safeName,
          email: safeEmail,
          school: safeSchool,
          role: safeRole,
          message: walkthrough ? `Uses ManageBac: ${usesManageBac ? "yes" : "no"}

${safeMessage}` : safeMessage,
        }),
      }),
    });

    if (!response.ok) console.error("[contact] Resend error:", await response.text());
  } catch (error) {
    console.error("[contact] Send error:", error);
  }
  return NextResponse.json({ status: "sent" });
}

/** The message, laid out on Spectra's paper. Every value is escaped here, once. */
function contactEmailHtml(raw: { name: string; email: string; school: string; role: string; message: string }) {
  const sent = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, escapeHtml(value)])) as typeof raw;
  const row = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:6px 16px 6px 0;width:96px;font-family:${EMAIL_SANS};font-size:13px;color:${EMAIL_INK.secondary};vertical-align:top;">${label}</td><td style="padding:6px 0;font-family:${EMAIL_SANS};font-size:15px;color:${EMAIL_INK.ink};">${value}</td></tr>`
      : "";
  const body = [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${row("Name", sent.name)}${row("Email", `<a href="mailto:${sent.email}" style="color:${EMAIL_INK.violet};">${sent.email}</a>`)}${row("School", sent.school)}${row("Role", sent.role)}</table>`,
    `<div style="padding:16px 0 4px;border-top:1px solid ${EMAIL_INK.rule};font-family:${EMAIL_SANS};font-size:15px;line-height:1.6;color:${EMAIL_INK.ink};white-space:pre-wrap;">${sent.message}</div>`,
  ].join("\n");
  return emailPage({
    preheader: `${raw.name} wrote through the Spectra contact form.`,
    title: `A message from ${raw.name}`,
    body,
    footer: "Sent from the contact form on the Spectra site. Reply to the address above to answer.",
  });
}
