import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authServer = vi.hoisted(() => ({
  requireAccessPrincipal: vi.fn(),
  requireAccount: vi.fn(),
}));
const convex = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));
const secrets = vi.hoisted(() => ({
  get: vi.fn(),
  revoke: vi.fn(),
  store: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth-server", () => authServer);
vi.mock("@/lib/convex-server", () => ({
  convexMutation: convex.mutation,
  convexQuery: convex.query,
}));
vi.mock("@/lib/invitations", () => ({
  sendInvitationEmail: vi.fn(),
}));
vi.mock("@/lib/server-secrets", () => ({
  getSchoolSecretStatus: secrets.get,
  revokeSchoolSecret: secrets.revoke,
  storeSchoolSecret: secrets.store,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/features/spectra/pages/school-admin-shell", () => ({
  SchoolAdminShell: () => null,
}));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import SchoolAdminPage from "@/app/admin/page";
import {
  GET as getAdministration,
  POST as postAdministration,
} from "@/app/api/spectra/administration/route";
import { GET as getSecret } from "@/app/api/operations/secrets/route";

const schoolActor = {
  clerkId: "clerk-admin",
  accountId: "account-admin",
  email: "admin@example.test",
  name: "School Admin",
  schoolId: "school-tgc",
  schoolRole: "school_admin" as const,
  membershipId: "membership-admin",
};

describe("operator route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServer.requireAccessPrincipal.mockImplementation(
      async (scope: "school" | "platform") =>
        scope === "platform"
          ? {
              kind: "platform",
              account: {
                accountId: "account-operator",
                email: "operator@example.test",
                emailVerified: true,
                name: "Platform Operator",
                status: "active",
                platformOperator: true,
              },
            }
          : { kind: "school", actor: schoolActor },
    );
    convex.mutation.mockResolvedValue({});
    convex.query.mockResolvedValue({});
    secrets.get.mockResolvedValue({ configured: false });
  });

  it("selects platform scope before loading platform administration data", async () => {
    const response = await getAdministration(
      new NextRequest(
        "http://localhost/api/spectra/administration?action=platformOverview",
      ),
    );

    expect(response.status).toBe(200);
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("platform");
    expect(convex.mutation).toHaveBeenCalledWith(
      "administration:platformOverview",
      expect.any(Object),
    );
  });

  it("keeps ordinary school administration on school scope", async () => {
    const response = await getAdministration(
      new NextRequest(
        "http://localhost/api/spectra/administration?action=schoolOverview",
      ),
    );

    expect(response.status).toBe(200);
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("school");
  });

  it("uses platform scope for school operations backed by an operator session", async () => {
    const response = await getAdministration(
      new NextRequest(
        "http://localhost/api/spectra/administration?action=schoolOverview&operatorSessionId=session-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("platform");
  });

  it("uses platform scope before starting an operator session", async () => {
    const response = await postAdministration(
      new NextRequest("http://localhost/api/spectra/administration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "startOperatorSession",
          schoolId: "school-tgc",
          label: "Inspect TGC",
          reason: "Support",
          mode: "inspect",
          durationMinutes: 30,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("platform");
  });

  it("uses platform scope for operator-session secret access", async () => {
    const response = await getSecret(
      new NextRequest(
        "http://localhost/api/operations/secrets?schoolId=school-tgc&purpose=managebac-api-token&operatorSessionId=session-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("platform");
    expect(secrets.get).toHaveBeenCalledWith({
      schoolId: "school-tgc",
      purpose: "managebac-api-token",
      operatorSessionId: "session-1",
    });
  });

  it("opens the school admin shell under operator scope only with a session", async () => {
    await SchoolAdminPage({
      searchParams: Promise.resolve({ operatorSessionId: "session-1" }),
    });
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("platform");

    vi.clearAllMocks();
    await SchoolAdminPage({ searchParams: Promise.resolve({}) });
    expect(authServer.requireAccessPrincipal).toHaveBeenCalledWith("school");
    expect(navigation.redirect).not.toHaveBeenCalled();
  });
});
