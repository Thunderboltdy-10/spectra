import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "svix";

const mocks = vi.hoisted(() => ({ convexPublicAction: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({
  convexAction: vi.fn(),
  convexPublicAction: mocks.convexPublicAction,
}));
import { POST } from "./route";

const WEBHOOK_SECRET = `whsec_${Buffer.from("clerk-webhook-fixture-secret-32b").toString("base64")}`;
const BRIDGE_KEY = "bridge-key-fixture-with-at-least-32-characters";

function signedRequest(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const id = "msg_fixture";
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(id, timestamp, payload);
  return new NextRequest("https://example.test/api/webhooks/clerk", {
    method: "POST",
    body: payload,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  });
}

describe("Clerk webhook user.deleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLERK_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", BRIDGE_KEY);
    mocks.convexPublicAction.mockResolvedValue({ status: "running" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("asks Convex to erase the deleted identity with a bridge signature over its subject", async () => {
    const response = await POST(signedRequest({ type: "user.deleted", data: { id: "user_deleted", deleted: true } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, erasure: "running" });
    expect(mocks.convexPublicAction).toHaveBeenCalledOnce();
    const [name, args] = mocks.convexPublicAction.mock.calls[0]!;
    expect(name).toBe("secretBridge:eraseDeletedIdentity");
    expect(args.clerkId).toBe("user_deleted");
    // The same canonical string convex/secretBridge.ts verifies.
    const canonical = ["erase-account", "user_deleted", "-", "clerk-user-deleted", args.timestamp, args.nonce, "-"].join("|");
    expect(args.signature).toBe(createHmac("sha256", BRIDGE_KEY).update(canonical).digest("base64url"));
  });

  it("rejects an event that svix did not sign", async () => {
    const forged = signedRequest(
      { type: "user.deleted", data: { id: "user_victim" } },
      `whsec_${Buffer.from("some-other-secret-of-32-bytes!!!").toString("base64")}`,
    );
    const response = await POST(forged);
    expect(response.status).toBe(400);
    expect(mocks.convexPublicAction).not.toHaveBeenCalled();
  });

  it("returns 500 when the erasure cannot be started so svix redelivers", async () => {
    mocks.convexPublicAction.mockRejectedValue(new Error("network down"));
    const response = await POST(signedRequest({ type: "user.deleted", data: { id: "user_deleted" } }));
    expect(response.status).toBe(500);
  });

  it("still writes nothing for user.created", async () => {
    const response = await POST(signedRequest({
      type: "user.created",
      data: { id: "user_new", primary_email_address_id: "e1", email_addresses: [{ id: "e1", email_address: "a@example.test", verification: { status: "verified" } }] },
    }));
    expect(response.status).toBe(200);
    expect(mocks.convexPublicAction).not.toHaveBeenCalled();
  });
});
