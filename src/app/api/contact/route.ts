import { NextRequest, NextResponse } from "next/server";
import { EMAIL_INK, EMAIL_SANS, emailPage, escapeHtml } from "@/lib/email-layout";

// Simple in-memory rate limiter (resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_REQUESTS = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQUESTS) return false;
  entry.count++;
  return true;
}

function sanitize(s: string, maxLen = 2000): string {
  return s.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const email = typeof body.email === "string" ? body.email : "";
  const school = typeof body.school === "string" ? body.school : "";
  const role = typeof body.role === "string" ? body.role : "";
  const message = typeof body.message === "string" ? body.message : "";

  if (!name.trim() || !email.trim() || !message.trim()) {
    return NextResponse.json(
      { error: "Name, email, and message are required." },
      { status: 400 },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  const safeName = sanitize(name, 200);
  const safeEmail = email.trim().slice(0, 320);
  const safeSchool = school ? sanitize(school, 300) : "";
  const safeRole = role ? sanitize(role, 100) : "";
  const safeMessage = sanitize(message);


  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.INVITE_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    // Fallback when email is not configured
    return NextResponse.json({
      status: "fallback",
      mailto: `mailto:pablo.martinez.dovale@gmail.com?subject=${encodeURIComponent(`[Spectra Contact] New message from ${safeName}`)}&body=${encodeURIComponent(`Name: ${safeName}\nEmail: ${safeEmail}\nSchool: ${safeSchool}\nRole: ${safeRole}\n\nMessage:\n${safeMessage}`)}`,
    });
  }

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
        subject: `[Spectra Contact] New message from ${safeName}`,
        html: contactEmailHtml({ name: safeName, email: safeEmail, school: safeSchool, role: safeRole, message: safeMessage }),
      }),
    });

    if (!response.ok) {
      console.error("[contact] Resend error:", await response.text());
      return NextResponse.json(
        { error: "Failed to send message. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: "sent" });
  } catch (error) {
    console.error("[contact] Send error:", error);
    return NextResponse.json(
      { error: "Failed to send message. Please try again." },
      { status: 500 },
    );
  }
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
