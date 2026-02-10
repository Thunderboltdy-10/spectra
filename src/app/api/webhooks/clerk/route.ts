import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { convexMutation } from "@/lib/convex-server";

type ClerkWebhookEvent = {
  type: string;
  data?: {
    id?: string;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    email_addresses?: Array<{ email_address?: string | null }>;
  };
};

function getSvixHeaders(request: NextRequest) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!id || !timestamp || !signature) {
    throw new Error("Missing Svix signature headers");
  }

  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}

function getUserName(event: ClerkWebhookEvent["data"]) {
  const first = event?.first_name?.trim();
  const last = event?.last_name?.trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || event?.username?.trim() || "Student";
}

function getUserEmail(event: ClerkWebhookEvent["data"]) {
  const email = event?.email_addresses?.[0]?.email_address?.trim();
  return email || "unknown@example.com";
}

export async function POST(request: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CLERK_WEBHOOK_SECRET is not configured." }, { status: 500 });
  }

  const payload = await request.text();

  let event: ClerkWebhookEvent;
  try {
    const webhook = new Webhook(secret);
    event = webhook.verify(payload, getSvixHeaders(request)) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const clerkId = event.data?.id;
  if (!clerkId) {
    return NextResponse.json({ error: "Missing Clerk user id in webhook payload." }, { status: 400 });
  }

  await convexMutation("users:syncFromWebhook", {
    clerkId,
    email: getUserEmail(event.data),
    name: getUserName(event.data),
  });

  return NextResponse.json({ ok: true, type: event.type });
}
