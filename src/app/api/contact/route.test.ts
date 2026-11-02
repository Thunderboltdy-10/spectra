import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/convex-server", () => ({ convexPublicMutation: mocks.submit }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("SPECTRA_SECRET_BRIDGE_KEY", "bridge_fixture");
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubEnv("INVITE_FROM_EMAIL", "Spectra <hello@example.test>");
  vi.stubEnv("SUPER_ADMIN_EMAILS", " , first@example.test , second@example.test ");
  vi.stubGlobal("fetch", mocks.send);
  mocks.submit.mockResolvedValue({ status: "sent" });
  mocks.send.mockResolvedValue(Response.json({ id: "email_123" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function submit() {
  const { POST } = await import("./route");
  return POST(new NextRequest("https://spectra.example/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "192.0.2.1" },
    body: JSON.stringify({ name: "Visitor", email: "visitor@example.test", message: "Please tell me more.", elapsedMs: 5000 }),
  }));
}

it("sends one notification only to the first nonempty superadmin, with the visitor as reply-to", async () => {
  expect((await submit()).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenCalledOnce();
  const [url, request] = mocks.send.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  const email = JSON.parse(request.body);
  expect(email.to).toEqual(["first@example.test"]);
  expect(email.cc).toBeUndefined();
  expect(email.bcc).toBeUndefined();
  expect(email.reply_to).toBe("visitor@example.test");
});

it.each(["", " , "])("keeps the contact request without sending when the operator list is %j", async (operators) => {
  vi.stubEnv("SUPER_ADMIN_EMAILS", operators);
  expect((await submit()).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["RESEND_API_KEY", "INVITE_FROM_EMAIL"])("keeps local contact requests without emailing when %s is empty", async (name) => {
  vi.stubEnv(name, "");
  expect((await submit()).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("does not send another notification for an existing contact request", async () => {
  mocks.submit.mockResolvedValue({ status: "already" });
  expect((await submit()).status).toBe(409);
  expect(mocks.send).not.toHaveBeenCalled();
});
