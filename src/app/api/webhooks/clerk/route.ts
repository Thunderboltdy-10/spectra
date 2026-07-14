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
    primary_email_address_id?: string | null;
    image_url?: string | null;
    email_addresses?: Array<{
      id?: string;
      email_address?: string | null;
      verification?: { status?: string | null } | null;
    }>;
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

function getVerifiedEmail(event: ClerkWebhookEvent["data"]) {
  const candidates = event?.email_addresses ?? [];
  const primary = candidates.find((entry) => entry.id === event?.primary_email_address_id);
  const verified = [primary, ...candidates]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .find((entry) => entry.verification?.status === "verified" && Boolean(entry.email_address?.trim()));
  return verified?.email_address?.trim().toLowerCase() ?? null;
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

  const email = getVerifiedEmail(event.data);
  if (!email) {
    return NextResponse.json({ ok: true, skipped: true, reason: "verified_email_required" });
  }

  const result = await convexMutation("identity:registerVerifiedAccount", {
    clerkId,
    email,
    emailVerified: true,
    name: getUserName(event.data),
    avatarUrl: event.data?.image_url?.trim() || undefined,
  });

  return NextResponse.json({ ok: true, type: event.type, result });
}
