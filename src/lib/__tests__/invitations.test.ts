import { beforeEach, describe, expect, it, vi } from "vitest";

const verify = vi.fn();
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ verify, sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport },
  createTransport,
}));

describe("sendInvitationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "owner@example.com";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_FROM_EMAIL = "brand@example.com";
    verify.mockResolvedValue(undefined);
    sendMail.mockResolvedValue({
      accepted: ["student@example.com"],
      rejected: [],
      response: "250 ok",
    });
  });

  it("uses SMTP_USER when SMTP_FROM_EMAIL differs from authenticated mailbox", async () => {
    const { sendInvitationEmail } = await import("@/lib/invitations");

    const result = await sendInvitationEmail({
      to: "student@example.com",
      role: "student",
      joinUrl: "https://spectra.test/join?token=tok_1",
      orgName: "Alpha School",
    });

    expect(createTransport).toHaveBeenCalled();
    expect(verify).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "owner@example.com",
      to: "student@example.com",
    }));
    expect(result).toMatchObject({
      status: "sent",
      envelopeFrom: "owner@example.com",
      accepted: ["student@example.com"],
    });
  });
  it("renders invitation headings with explicit visible colors", async () => {
    const { sendInvitationEmail } = await import("@/lib/invitations");

    await sendInvitationEmail({
      to: "student@example.com",
      role: "student",
      joinUrl: "https://spectra.test/join?token=tok_1",
      orgName: "Alpha School",
    });

    const html = sendMail.mock.calls[0]?.[0]?.html as string;
    expect(html).toContain('background:#0f766e;color:#fffaf1;');
    expect(html).toContain('text-transform:uppercase;color:#fffaf1;">Spectra</div>');
    expect(html).toContain('font-weight:700;color:#fffaf1;">You have been invited to Alpha School</h1>');
    expect(html).not.toContain('linear-gradient');
    expect(html).not.toContain('opacity:0.8');
  });

});
