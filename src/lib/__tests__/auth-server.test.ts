import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}));
const convex = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => clerk);
vi.mock("@/lib/clerk-config", () => ({
  hasClerkServerConfig: () => true,
}));
vi.mock("@/lib/convex-server", () => ({
  convexMutation: convex.mutation,
  convexQuery: convex.query,
}));

import {
  isAuthNoSchool,
  requireAccessPrincipal,
  requireActor,
  requirePlatformOperator,
} from "@/lib/auth-server";

const operatorAccount = {
  accountId: "account-operator",
  email: "operator@example.test",
  emailVerified: true,
  name: "Platform Operator",
  status: "active" as const,
  platformOperator: true,
};

const schoolIdentity = {
  accountId: "account-admin",
  clerkId: "clerk-admin",
  email: "admin@example.test",
  emailVerified: true,
  name: "School Admin",
  schoolId: "school-tgc",
  schoolRole: "school_admin" as const,
  membershipId: "membership-admin",
};

describe("server authorization principals", () => {
  beforeEach(() => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "operator@example.test");
    clerk.auth.mockResolvedValue({ userId: "clerk-operator" });
    clerk.currentUser.mockResolvedValue({
      emailAddresses: [],
      primaryEmailAddressId: null,
    });
    convex.mutation.mockReset();
    convex.query.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes an allowlisted active account without reading school identity", async () => {
    convex.query.mockImplementation(async (name: string) => {
      if (name === "identity:account") return operatorAccount;
      throw new Error(`Unexpected query: ${name}`);
    });

    await expect(requirePlatformOperator()).resolves.toEqual(operatorAccount);
    await expect(requireAccessPrincipal("platform")).resolves.toEqual({
      kind: "platform",
      account: operatorAccount,
    });
    expect(convex.query).not.toHaveBeenCalledWith("identity:me", {});
  });

  it("denies a membershipless account that is not on the operator allowlist", async () => {
    convex.query.mockResolvedValue({
      ...operatorAccount,
      email: "ordinary@example.test",
      platformOperator: false,
    });

    await expect(requirePlatformOperator()).rejects.toThrow(
      "AUTH_OPERATOR_REQUIRED",
    );
  });

  it("keeps school-scoped authorization on the membership-bearing actor path", async () => {
    clerk.auth.mockResolvedValue({ userId: schoolIdentity.clerkId });
    convex.query.mockImplementation(async (name: string) => {
      if (name === "identity:me") return schoolIdentity;
      throw new Error(`Unexpected query: ${name}`);
    });

    await expect(requireAccessPrincipal("school")).resolves.toEqual({
      kind: "school",
      actor: {
        clerkId: schoolIdentity.clerkId,
        accountId: schoolIdentity.accountId,
        email: schoolIdentity.email,
        name: schoolIdentity.name,
        schoolId: schoolIdentity.schoolId,
        schoolRole: schoolIdentity.schoolRole,
        membershipId: schoolIdentity.membershipId,
      },
    });
  });

  it("still denies school-scoped authorization when no membership exists", async () => {
    convex.query.mockResolvedValue(null);
    clerk.currentUser.mockResolvedValue({
      fullName: "Ordinary User",
      firstName: "Ordinary",
      imageUrl: "",
      primaryEmailAddressId: "email-1",
      emailAddresses: [
        {
          id: "email-1",
          emailAddress: "ordinary@example.test",
          verification: { status: "verified" },
        },
      ],
    });

    await expect(requireActor()).rejects.toThrow("AUTH_NO_SCHOOL");
    expect(isAuthNoSchool(new Error("AUTH_NO_SCHOOL: missing membership"))).toBe(
      true,
    );
    expect(convex.mutation).toHaveBeenCalledWith("identity:registerSelf", {
      name: "Ordinary User",
      avatarUrl: undefined,
    });
  });
});
