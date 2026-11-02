import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), access: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({
  requireAccessPrincipal: mocks.access, requireAccount: vi.fn(), requireActor: vi.fn(), isAuthNoSchool: vi.fn(),
}));
vi.mock("@/lib/convex-server", () => ({ convexMutation: mocks.mutation, convexQuery: vi.fn() }));
vi.mock("@/lib/invitations", () => ({ sendInvitationEmail: mocks.send }));
import { POST } from "../administration/route";

function request(body: object) {
  return new NextRequest("http://localhost:3160/api/spectra/administration", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ kind: "platform" });
  mocks.mutation.mockResolvedValue({ schoolId: "school", invitationId: "invite" });
});

describe("school onboarding invitation delivery", () => {
  it("always returns the initial link even when the email provider accepts the email", async () => {
    mocks.send.mockResolvedValue({ status: "sent" });
    const response = await POST(request({ action: "createSchool", name: "School", timezone: "Europe/Madrid", initialAdminEmail: "admin@example.test" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.manualInvitationUrl).toMatch(/^http:\/\/localhost:3160\/join\?token=/);
  });

  it("creates a platform-authorized replacement link without sending an email or persisting its raw token", async () => {
    const response = await POST(request({ action: "recoverOnboardingInvitation", sagaId: "saga", initialAdminEmail: "new@example.test" }));
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith("platform");
    expect(mocks.send).not.toHaveBeenCalled();
    const result = await response.json();
    const token = new URL(result.manualInvitationUrl).searchParams.get("token")!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(mocks.mutation).toHaveBeenCalledWith("schools:recoverOnboardingInvitation", {
      sagaId: "saga", initialAdminEmail: "new@example.test", tokenHash: createHash("sha256").update(token).digest("base64url"), requestId: undefined,
    });
  });
});
