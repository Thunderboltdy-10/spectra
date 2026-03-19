import { NextRequest, NextResponse } from "next/server";

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
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#1a1510;margin:0 0 16px;">New contact form submission</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#6b5f52;width:120px;">Name</td><td style="padding:8px 0;color:#1a1510;">${safeName}</td></tr>
              <tr><td style="padding:8px 0;color:#6b5f52;">Email</td><td style="padding:8px 0;"><a href="mailto:${safeEmail}" style="color:#0e8ee8;">${safeEmail}</a></td></tr>
              ${safeSchool ? `<tr><td style="padding:8px 0;color:#6b5f52;">School</td><td style="padding:8px 0;color:#1a1510;">${safeSchool}</td></tr>` : ""}
              ${safeRole ? `<tr><td style="padding:8px 0;color:#6b5f52;">Role</td><td style="padding:8px 0;color:#1a1510;">${safeRole}</td></tr>` : ""}
            </table>
            <div style="margin-top:16px;padding:16px;background:#f5f3ef;border-radius:12px;">
              <p style="margin:0 0 4px;color:#6b5f52;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Message</p>
              <p style="margin:0;color:#1a1510;white-space:pre-wrap;">${safeMessage}</p>
            </div>
          </div>
        `,
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
