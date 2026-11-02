import { afterEach, beforeEach, expect, it, vi } from "vitest";

const send = vi.fn();
import { sendInvitationEmail } from "@/lib/invitations";

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubEnv("INVITE_FROM_EMAIL", "Spectra <invites@example.test>");
  vi.stubGlobal("fetch", send);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  send.mockReset();
});

it("logs the invitation id, not the invitee's address, when Resend delivery throws", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  send.mockRejectedValue(new Error("<pupil.name@school.test>: Recipient address rejected"));
  const result = await sendInvitationEmail({
    to: "pupil.name@school.test", role: "student", joinUrl: "https://example.test/join?token=t", invitationId: "inv_123",
  });
  expect(result.status).toBe("failed");
  expect(warn).toHaveBeenCalledOnce();
  const logged = JSON.stringify(warn.mock.calls[0]);
  expect(logged).toContain("inv_123");
  expect(logged).not.toContain("pupil.name@school.test");
});

it("redacts the invitee's address from a refused delivery", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  send.mockResolvedValue(Response.json({ message: "<pupil.name@school.test> unknown" }, { status: 422 }));
  const result = await sendInvitationEmail({
    to: "pupil.name@school.test", role: "student", joinUrl: "https://example.test/join?token=t", invitationId: "inv_123",
  });
  expect(result).toEqual({ status: "failed", reason: "Resend delivery not accepted (HTTP 422): <[address]> unknown" });
});
