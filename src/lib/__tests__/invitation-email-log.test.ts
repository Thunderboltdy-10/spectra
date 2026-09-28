import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ verify: vi.fn().mockResolvedValue(true), sendMail: mocks.sendMail }),
  },
}));
import { sendInvitationEmail } from "@/lib/invitations";

beforeEach(() => {
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_USER", "school@example.test");
  vi.stubEnv("SMTP_PASS", "fixture");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("logs the invitation id, not the invitee's address, when SMTP delivery throws", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.sendMail.mockRejectedValue(new Error("550 5.1.1 <pupil.name@school.test>: Recipient address rejected"));
  const result = await sendInvitationEmail({
    to: "pupil.name@school.test", role: "student", joinUrl: "https://example.test/join?token=t", invitationId: "inv_123",
  });
  expect(result.status).toBe("failed");
  expect(warn).toHaveBeenCalledOnce();
  const logged = JSON.stringify(warn.mock.calls[0]);
  expect(logged).toContain("inv_123");
  expect(logged).not.toContain("pupil.name@school.test");
});
