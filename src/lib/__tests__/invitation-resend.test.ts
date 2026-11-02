import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invitationEmail, sendInvitationEmail } from "@/lib/invitations";

const send = vi.fn();
const params = {
  to: "student@example.test",
  role: "student",
  joinUrl: "https://spectra.example/join?token=invite",
  orgName: "Example School",
};

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

it.each(["student", "teacher", "school admin"])("sends the existing %s invitation content through Resend", async (role) => {
  send.mockResolvedValue(Response.json({ id: "email_123" }));
  const invitation = { ...params, role };
  const result = await sendInvitationEmail(invitation);

  expect(send).toHaveBeenCalledOnce();
  const [url, request] = send.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual({ Authorization: "Bearer re_fixture", "Content-Type": "application/json" });
  expect(JSON.parse(request.body)).toEqual({
    from: "Spectra <invites@example.test>",
    to: [params.to],
    ...invitationEmail(invitation),
  });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(result).toEqual({
    status: "sent", providerId: "resend", envelopeFrom: "Spectra <invites@example.test>",
    accepted: [params.to], rejected: [], response: "email_123",
  });
});

it.each(["RESEND_API_KEY", "INVITE_FROM_EMAIL"])("skips delivery when %s is missing", async (name) => {
  vi.stubEnv(name, "");
  expect(await sendInvitationEmail(params)).toEqual({ status: "skipped", reason: "Resend email environment is not configured." });
  expect(send).not.toHaveBeenCalled();
});

it("reports a timed-out request as failed so the admin can retry", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  send.mockRejectedValue(new DOMException("Email request timed out", "TimeoutError"));
  expect(await sendInvitationEmail(params)).toEqual({ status: "failed", reason: "Email request timed out" });
});

it("does not report success without Resend's email id", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  send.mockResolvedValue(Response.json({}));
  expect(await sendInvitationEmail(params)).toEqual({ status: "failed", reason: "Resend did not return an email id." });
});
