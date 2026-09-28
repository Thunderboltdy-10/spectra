import { afterEach, expect, it, vi } from "vitest";

const createTransport = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport } }));

afterEach(() => {
  vi.unstubAllEnvs();
  createTransport.mockReset();
});

it("bounds every SMTP phase so a stalled host reports a failed invite", async () => {
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_USER", "invites@example.test");
  vi.stubEnv("SMTP_PASS", "secret");
  createTransport.mockReturnValue({
    verify: vi.fn().mockRejectedValue(new Error("Connection timeout")),
    sendMail: vi.fn(),
  });
  const { sendInvitationEmail, SMTP_TIMEOUTS } = await import("@/lib/invitations");

  const result = await sendInvitationEmail({ to: "student@example.test", role: "student", joinUrl: "https://spectra.example/join" });

  // Nodemailer defaults are 120 s to connect and 600 s of socket silence.
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining(SMTP_TIMEOUTS));
  for (const limit of Object.values(SMTP_TIMEOUTS)) expect(limit).toBeLessThanOrEqual(30_000);
  expect(result).toEqual({ status: "failed", reason: "Connection timeout" });
});
