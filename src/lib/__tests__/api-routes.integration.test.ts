import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

function authServerMock(overrides: Record<string, unknown>) {
  return {
    isAdminLikeActor: () => true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("auth access-state route integration", () => {
  it("returns identity without requiring org access when includeIdentity=1", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "student@example.com" }, { emailAddress: "alias@example.com" }],
      }),
    }));
    vi.doMock("@/lib/auth-server", () => authServerMock({
      requireActor: vi.fn().mockRejectedValue(new Error("AUTH_NO_ACCESS: missing org")),
    }));

    const route = await import("@/app/api/auth/access-state/route");
    const response = await route.GET(new NextRequest("http://localhost/api/auth/access-state?includeIdentity=1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      email: "student@example.com",
      emails: ["student@example.com", "alias@example.com"],
      userId: "clerk_1",
      invitationTokenPresent: undefined,
    });
  });

  it("marks expected no-access states without throwing", async () => {
    vi.doMock("@/lib/auth-server", () => authServerMock({
      requireActor: vi.fn().mockRejectedValue(new Error("AUTH_NO_ACCESS: missing org")),
    }));

    const route = await import("@/app/api/auth/access-state/route");
    const response = await route.GET(new NextRequest("http://localhost/api/auth/access-state"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "no_access", expected: true });
  });
});

describe("feedback route integration", () => {
  it("submits feedback with validated payload", async () => {
    const convexAction = vi.fn();
    const convexMutation = vi.fn().mockResolvedValue({ ok: true, feedbackId: "fb_1" });
    const auth = vi.fn().mockResolvedValue({ userId: "user_123" });

    vi.doMock("@/lib/convex-server", () => ({
      convexAction,
      convexMutation,
    }));
    vi.doMock("@clerk/nextjs/server", () => ({
      auth,
    }));

    const route = await import("@/app/api/feedback/route");
    const form = new FormData();
    form.set("category", "bug");
    form.set("message", "The toolbar overlaps on tablet.");
    form.set("mode", "research");
    form.set("page", "/");
    form.set("device", "tablet");

    const response = await route.POST(new NextRequest("http://localhost/api/feedback", { method: "POST", body: form }));
    const payload = (await response.json()) as { ok: boolean; feedbackId: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, feedbackId: "fb_1" });
    expect(convexMutation).toHaveBeenCalledWith("feedback:submitFeedback", {
      actorClerkId: "user_123",
      category: "bug",
      message: "The toolbar overlaps on tablet.",
      screenshotStorageId: undefined,
      context: {
        mode: "research",
        page: "/",
        device: "tablet",
        traceId: undefined,
      },
    });
    expect(convexAction).not.toHaveBeenCalled();
  });

  it("rejects invalid feedback category", async () => {
    vi.doMock("@/lib/convex-server", () => ({
      convexAction: vi.fn(),
      convexMutation: vi.fn(),
    }));
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "user_123" }),
    }));

    const route = await import("@/app/api/feedback/route");
    const form = new FormData();
    form.set("category", "unknown");
    form.set("message", "hello");

    const response = await route.POST(new NextRequest("http://localhost/api/feedback", { method: "POST", body: form }));
    expect(response.status).toBe(400);
  });
});

describe("bookmarks route integration", () => {
  it("lists and toggles bookmarks for actor", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_abc" });
    const convexQuery = vi.fn().mockResolvedValue([{ messageId: "m_1" }]);
    const convexMutation = vi.fn().mockResolvedValue({ added: true });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));

    const route = await import("@/app/api/bookmarks/route");

    const getResponse = await route.GET(new NextRequest("http://localhost/api/bookmarks?chatId=chat_1"));
    expect(getResponse.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledWith("bookmarks:getBookmarkedMessages", {
      actorClerkId: "user_abc",
      chatId: "chat_1",
    });

    const postResponse = await route.POST(
      new NextRequest("http://localhost/api/bookmarks", {
        method: "POST",
        body: JSON.stringify({ chatId: "chat_1", messageId: "msg_2", note: "review" }),
      }),
    );

    expect(postResponse.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("bookmarks:toggleBookmark", {
      actorClerkId: "user_abc",
      chatId: "chat_1",
      messageId: "msg_2",
      note: "review",
    });
  });
});

describe("personal resources route integration", () => {
  it("requeues stalled personal resource ingestion", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_files" });
    const convexMutation = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/personal-resources/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/personal-resources", {
        method: "POST",
        body: JSON.stringify({
          action: "retry_processing",
          resourceIds: ["res_1", "res_2"],
        }),
      }),
    );

    const payload = (await response.json()) as { ok: boolean; retried: number; skipped?: number; failures: unknown[] };
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, retried: 2, skipped: 0, failures: [] });
    expect(convexMutation).toHaveBeenNthCalledWith(1, "resources:enqueueResourceProcessing", {
      actorClerkId: "user_files",
      resourceId: "res_1",
    });
    expect(convexMutation).toHaveBeenNthCalledWith(2, "resources:enqueueResourceProcessing", {
      actorClerkId: "user_files",
      resourceId: "res_2",
    });
  });

  it("reports partial retry failures instead of aborting the whole batch", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_files" });
    const convexMutation = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("Resource already exhausted retries"));

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/personal-resources/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/personal-resources", {
        method: "POST",
        body: JSON.stringify({
          action: "retry_processing",
          resourceIds: ["res_1", "res_2"],
        }),
      }),
    );

    const payload = (await response.json()) as {
      ok: boolean;
      retried: number;
      failures: Array<{ resourceId: string; error: string }>;
    };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(false);
    expect(payload.retried).toBe(1);
    expect(payload.failures).toEqual([
      { resourceId: "res_2", ok: false, error: "Resource already exhausted retries" },
    ]);
  });
});

describe("request access route integration", () => {
  it("creates a school access request for signed-in users", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_req_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "student@example.edu" }],
        fullName: "Student Example",
      }),
    }));
    vi.doMock("@/lib/convex-server", () => ({
      convexQuery: vi.fn(),
      convexMutation: vi.fn().mockResolvedValue({ status: "requested", orgName: "North Ridge School" }),
    }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/request-access", {
        method: "POST",
        body: JSON.stringify({ orgId: "org_1", message: "Please approve me." }),
      }),
    );

    const payload = (await response.json()) as { status: string; orgName: string };
    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "requested", orgName: "North Ridge School" });
  });
});

describe("request access route integration", () => {
  it("lists matching schools for the no-access flow", async () => {
    const convexQuery = vi.fn().mockResolvedValue([
      { _id: "org_1", name: "Northfield Academy", slug: "northfield" },
    ]);

    vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation: vi.fn() }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.GET(new NextRequest("http://localhost/api/request-access?query=north"));
    const payload = (await response.json()) as { schools: Array<{ slug: string }> };

    expect(response.status).toBe(200);
    expect(payload.schools).toHaveLength(1);
    expect(convexQuery).toHaveBeenCalledWith("accessRequests:searchSchools", { query: "north" });
  });

  it("submits a signed-in access request with the Clerk profile identity", async () => {
    const convexMutation = vi.fn().mockResolvedValue({ status: "requested", orgName: "Northfield Academy" });

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_req_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "student@example.com" }],
        fullName: "Student Example",
        firstName: "Student",
      }),
    }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/request-access", {
        method: "POST",
        body: JSON.stringify({ orgId: "org_1", message: "Please approve my access." }),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("accessRequests:createAccessRequest", {
      requesterClerkId: "clerk_req_1",
      orgId: "org_1",
      email: "student@example.com",
      name: "Student Example",
      message: "Please approve my access.",
    });
  });
});

describe("school admin notifications route integration", () => {
  it("fails closed when recipientEmails is provided but empty after sanitization", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "admin_1", role: "admin" });
    const convexMutation = vi.fn();

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/school-admin/notifications/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/school-admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          title: "Heads up",
          body: "Testing targeting",
          recipientEmails: ["", "   "],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(convexMutation).not.toHaveBeenCalled();
  });
});

describe("gamification route integration", () => {
  it("returns streak, achievements, and catalog", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_ach" });
    const convexQuery = vi.fn().mockImplementation(async (fnName: string) => {
      if (fnName === "gamification:getUserStreak") {
        return { currentStreak: 7, longestStreak: 9, totalXp: 340, lastActiveDate: "2026-02-22" };
      }
      if (fnName === "gamification:getUserAchievements") {
        return [{ type: "streak_3", name: "3-Day Streak", description: "", xpEarned: 20, earnedAt: 1 }];
      }
      if (fnName === "gamification:getAchievementCatalog") {
        return [{ type: "streak_3", name: "3-Day Streak", description: "", xpEarned: 20 }];
      }
      return null;
    });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexQuery }));

    const route = await import("@/app/api/gamification/route");
    const response = await route.GET();
    const payload = (await response.json()) as {
      currentStreak: number;
      totalXp: number;
      achievements: Array<{ type: string }>;
      catalog: Array<{ type: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.currentStreak).toBe(7);
    expect(payload.totalXp).toBe(340);
    expect(payload.achievements).toHaveLength(1);
    expect(payload.catalog).toHaveLength(1);
  });
});

describe("manual compact route integration", () => {
  it("forwards compact mutation payload", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "user_compact" });
    const convexAction = vi.fn().mockResolvedValue({ ok: true, compactedMessages: 12 });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexAction, convexMutation: vi.fn(), convexQuery: vi.fn() }));

    const route = await import("@/app/api/chats/[id]/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/chats/chat_99", {
        method: "POST",
        body: JSON.stringify({ keepLatestMessages: 18 }),
      }),
      { params: Promise.resolve({ id: "chat_99" }) },
    );

    expect(response.status).toBe(200);
    expect(convexAction).toHaveBeenCalledWith("chats:manualCompact", {
      actorClerkId: "user_compact",
      chatId: "chat_99",
      keepLatestMessages: 18,
    });
  });
});

describe("school-admin notification route integration", () => {
  it("rejects invalid role filters instead of broadening audience", async () => {
    vi.doMock("@/lib/auth-server", () => authServerMock({
      requireActor: vi.fn().mockResolvedValue({ clerkId: "admin_1", role: "admin" }),
    }));
    vi.doMock("@/lib/convex-server", () => ({
      convexQuery: vi.fn(),
      convexMutation: vi.fn(),
    }));

    const route = await import("@/app/api/school-admin/notifications/route");

    const getResponse = await route.GET(
      new NextRequest("http://localhost/api/school-admin/notifications?role=everyone"),
    );
    expect(getResponse.status).toBe(400);

    const postResponse = await route.POST(
      new NextRequest("http://localhost/api/school-admin/notifications", {
        method: "POST",
        body: JSON.stringify({ title: "Hi", body: "Test", role: "everyone" }),
      }),
    );
    expect(postResponse.status).toBe(400);
  });
});

describe("legacy admin user route integration", () => {
  it("rejects admin-role escalation through the legacy route", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "admin_legacy", role: "admin" });
    const convexMutation = vi.fn();

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/admin/users/route");
    const response = await route.PATCH(
      new NextRequest("http://localhost/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ targetUserId: "user_1", role: "admin" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(convexMutation).not.toHaveBeenCalled();
  });
});

describe("invitation redeem route integration", () => {
  it("accepts an invitation when any signed-in Clerk email matches", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: "clerk_multi_1" });
    const currentUser = vi.fn().mockResolvedValue({
      emailAddresses: [
        { emailAddress: "primary@example.com" },
        { emailAddress: "invite@example.com" },
      ],
      fullName: "Multi Email User",
      firstName: "Multi",
    });
    const convexQuery = vi.fn().mockResolvedValue({
      _id: "invite_1",
      status: "pending",
      email: "invite@example.com",
      role: "teacher",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });
    const convexMutation = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: "tok_1", handoffToken: null }),
        clearInvitationTracking: vi.fn().mockResolvedValue(undefined),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));

    const route = await import("@/app/api/invitations/redeem/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/invitations/redeem", {
        method: "POST",
        body: JSON.stringify({ token: "tok_1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("users:acceptInvitationByToken", {
      clerkId: "clerk_multi_1",
      email: "invite@example.com",
      name: "Multi Email User",
      token: "tok_1",
    });
  });

  it("uses the handoff cookie token when the client posts without a token after sign-in", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: "clerk_handoff_1" });
    const currentUser = vi.fn().mockResolvedValue({
      emailAddresses: [{ emailAddress: "invite@example.com" }],
      fullName: "Invite User",
      firstName: "Invite",
    });
    const convexQuery = vi.fn().mockResolvedValue({
      _id: "invite_1",
      status: "pending",
      email: "invite@example.com",
      role: "student",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });
    const convexMutation = vi.fn().mockResolvedValue({ ok: true });

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: "tok_handoff" }),
        clearInvitationTracking: vi.fn().mockResolvedValue(undefined),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));

    const route = await import("@/app/api/invitations/redeem/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/invitations/redeem", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledWith("schoolAdmin:getInvitationByToken", { token: "tok_handoff" });
    expect(convexMutation).toHaveBeenCalledWith("users:acceptInvitationByToken", {
      clerkId: "clerk_handoff_1",
      email: "invite@example.com",
      name: "Invite User",
      token: "tok_handoff",
    });
  });

  it("returns alreadyAccepted same-user when the invite was previously redeemed by the same identity", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: "clerk_same_1" });
    const currentUser = vi.fn().mockResolvedValue({
      emailAddresses: [{ emailAddress: "invite@example.com" }],
      fullName: "Invite User",
      firstName: "Invite",
    });
    const convexQuery = vi.fn().mockResolvedValue({
      _id: "invite_1",
      status: "accepted",
      email: "invite@example.com",
      role: "student",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });

    const clearInvitationTracking = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: "tok_same", handoffToken: null }),
        clearInvitationTracking,
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexMutation: vi.fn(), convexQuery }));

    const route = await import("@/app/api/invitations/redeem/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/invitations/redeem", {
        method: "POST",
        body: JSON.stringify({ token: "tok_same" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      alreadyAccepted: true,
      sameUser: true,
      orgName: "Alpha School",
    });
    expect(clearInvitationTracking).toHaveBeenCalled();
  });

  it("preserves handoff when the signed-in identity does not match the invitation email", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: "clerk_wrong_1" });
    const currentUser = vi.fn().mockResolvedValue({
      emailAddresses: [{ emailAddress: "wrong@example.com" }],
      fullName: "Wrong User",
      firstName: "Wrong",
    });
    const convexQuery = vi.fn().mockResolvedValue({
      _id: "invite_1",
      status: "pending",
      email: "invite@example.com",
      role: "student",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });
    const persistInvitationHandoff = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: "tok_wrong", handoffToken: null }),
        clearInvitationTracking: vi.fn().mockResolvedValue(undefined),
        persistInvitationHandoff,
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexMutation: vi.fn(), convexQuery }));

    const route = await import("@/app/api/invitations/redeem/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/invitations/redeem", {
        method: "POST",
        body: JSON.stringify({ token: "tok_wrong" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(persistInvitationHandoff).toHaveBeenCalledWith("tok_wrong");
  });
});

describe("join route invitation state machine", () => {
  it("returns signed-out valid invite state", async () => {
    const convexQuery = vi.fn().mockResolvedValue({
      status: "pending",
      email: "invite@example.com",
      role: "student",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });
    const persistInvitationHandoff = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: null }),
      currentUser: vi.fn(),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff,
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery }));

    const route = await import("@/app/api/join/route");
    const response = await route.GET(new NextRequest("http://localhost/api/join?token=tok_1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("token_valid_signed_out");
    expect(payload.canRedeemNow).toBe(false);
    expect(payload.shouldAutoRedirectToAuth).toBe(true);
    expect(persistInvitationHandoff).toHaveBeenCalledWith("tok_1");
  });

  it("returns pending redeem when the signed-in identity matches", async () => {
    const convexQuery = vi.fn().mockResolvedValue({
      status: "pending",
      email: "invite@example.com",
      role: "teacher",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "invite@example.com" }],
      }),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery }));

    const route = await import("@/app/api/join/route");
    const response = await route.GET(new NextRequest("http://localhost/api/join?token=tok_2"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("token_valid_signed_in_match_pending_redeem");
    expect(payload.canRedeemNow).toBe(true);
  });

  it("returns wrong identity state when the signed-in viewer does not match", async () => {
    const convexQuery = vi.fn().mockResolvedValue({
      status: "pending",
      email: "invite@example.com",
      role: "teacher",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    });

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "wrong@example.com" }],
      }),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery }));

    const route = await import("@/app/api/join/route");
    const response = await route.GET(new NextRequest("http://localhost/api/join?token=tok_3"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.state).toBe("token_valid_signed_in_wrong_identity");
    expect(payload.shouldAutoRedirectToAuth).toBe(true);
  });

  it("returns already redeemed same-user and other-user terminal states", async () => {
    const acceptedInvite = {
      status: "accepted",
      email: "invite@example.com",
      role: "teacher",
      orgId: "org_1",
      expiresAt: Date.now() + 60_000,
      orgName: "Alpha School",
    };

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_1" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "invite@example.com" }],
      }),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn().mockResolvedValue(acceptedInvite) }));

    const route = await import("@/app/api/join/route");
    const sameUserResponse = await route.GET(new NextRequest("http://localhost/api/join?token=tok_4"));
    const sameUserPayload = await sameUserResponse.json();
    expect(sameUserPayload.state).toBe("token_already_redeemed_same_user");

    vi.resetModules();
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_2" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "other@example.com" }],
      }),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn().mockResolvedValue(acceptedInvite) }));

    const routeOther = await import("@/app/api/join/route");
    const otherUserResponse = await routeOther.GET(new NextRequest("http://localhost/api/join?token=tok_4"));
    const otherUserPayload = await otherUserResponse.json();
    expect(otherUserPayload.state).toBe("token_already_redeemed_other_user");
  });

  it("returns irrecoverable invalid and expired token states", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: null }),
      currentUser: vi.fn(),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery: vi.fn().mockResolvedValue(null) }));

    const route = await import("@/app/api/join/route");
    const invalidResponse = await route.GET(new NextRequest("http://localhost/api/join?token=tok_missing"));
    expect((await invalidResponse.json()).state).toBe("token_invalid");

    vi.resetModules();
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: null }),
      currentUser: vi.fn(),
    }));
    vi.doMock("@/lib/invitation-flow", async () => {
      const actual = await vi.importActual<typeof import("@/lib/invitation-flow")>("@/lib/invitation-flow");
      return {
        ...actual,
        getInvitationCookies: vi.fn().mockResolvedValue({ token: null, handoffToken: null }),
        persistInvitationHandoff: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock("@/lib/convex-server", () => ({
      convexQuery: vi.fn().mockResolvedValue({
        status: "expired",
        email: "invite@example.com",
        role: "student",
        orgId: "org_1",
        expiresAt: Date.now() - 1,
        orgName: "Alpha School",
      }),
    }));

    const routeExpired = await import("@/app/api/join/route");
    const expiredResponse = await routeExpired.GET(new NextRequest("http://localhost/api/join?token=tok_expired"));
    expect((await expiredResponse.json()).state).toBe("token_expired");
  });
});

describe("request access route email selection", () => {
  it("allows multi-email users to request access with a selected attached email", async () => {
    const convexMutation = vi.fn().mockResolvedValue({ status: "requested", orgName: "Northfield Academy" });

    vi.doMock("@clerk/nextjs/server", () => ({
      auth: vi.fn().mockResolvedValue({ userId: "clerk_req_multi" }),
      currentUser: vi.fn().mockResolvedValue({
        emailAddresses: [
          { emailAddress: "personal@example.com" },
          { emailAddress: "school@example.com" },
        ],
        fullName: "Student Example",
        firstName: "Student",
      }),
    }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/request-access", {
        method: "POST",
        body: JSON.stringify({ orgId: "org_1", email: "school@example.com", message: "Please approve." }),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("accessRequests:createAccessRequest", {
      requesterClerkId: "clerk_req_multi",
      orgId: "org_1",
      email: "school@example.com",
      name: "Student Example",
      message: "Please approve.",
    });
  });
});

describe("join page guarded redeem flow", () => {
  it("uses the explicit invitation state machine with auto redirect and redeem flow", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/app/join/page.tsx", "utf8"));
    expect(source).toContain("payload.shouldAutoRedirectToAuth");
    expect(source).toContain("payload.canRedeemNow");
    expect(source).toMatch(/fetch\(\s*["']\/api\/invitations\/redeem["']/);
  });
});

describe("invitation proxy middleware", () => {
  it("stores the invitation token cookie when visiting the join page", async () => {
    vi.doMock("@/lib/clerk-config", () => ({ hasClerkServerConfig: () => true }));
    vi.doMock("@clerk/nextjs/server", async () => {
      const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
      return {
        ...actual,
        clerkMiddleware: (handler: (auth: () => Promise<{ userId: string | null }>, req: Request) => Promise<Response>) =>
          async (req: Request) => handler(async () => ({ userId: null }), req),
        createRouteMatcher: (patterns: string[]) => (req: { nextUrl?: URL; url?: string }) => {
          const pathname = req.nextUrl?.pathname ?? new URL(req.url ?? "http://localhost").pathname;
          return patterns.some((pattern) => pattern === "/join(.*)" && pathname.startsWith("/join"));
        },
      };
    });

    const proxyModule = await import("@/proxy");
    const request = new NextRequest("https://spectrastudio.vercel.app/join?token=test_token_123");
    const response = await proxyModule.default(request, {} as never);
    const setCookieHeader = response?.headers.get("set-cookie") ?? "";

    expect(setCookieHeader).toContain("ai-school-invitation-token=test_token_123");
  });
});

describe("school-admin members route integration", () => {
  it("fails the invite request when email delivery is skipped or fails", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "admin_members", role: "admin" });
    const convexMutation = vi.fn().mockResolvedValue({ invitationId: "invite_1", token: "tok_1" });
    const convexQuery = vi.fn().mockResolvedValue({});

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));
    vi.doMock("@/lib/invitations", () => ({
      sendInvitationEmail: vi.fn().mockResolvedValue({
        status: "failed",
        reason: "SMTP offline",
      }),
    }));

    const route = await import("@/app/api/school-admin/members/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/school-admin/members", {
        method: "POST",
        body: JSON.stringify({ email: "student@example.com", role: "student" }),
      }),
    );

    expect(response.status).toBe(502);
  });
});

describe("super-admin school route integration", () => {
  it("sends admin assignment email with app join url", async () => {
    const requireSuperAdmin = vi.fn().mockResolvedValue({ clerkId: "super_admin_1" });
    const convexMutation = vi.fn().mockResolvedValue({ invitationId: "invite_admin_1", token: "tok_admin_1" });
    const convexQuery = vi.fn().mockResolvedValue({ org: { name: "Alpha School" } });
    const sendInvitationEmail = vi.fn().mockResolvedValue({ status: "sent" });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireSuperAdmin }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));
    vi.doMock("@/lib/invitations", () => ({ sendInvitationEmail }));

    process.env.NEXT_PUBLIC_APP_URL = "https://spectra.test";

    const route = await import("@/app/api/super-admin/schools/[id]/route");
    const response = await route.PATCH(
      new NextRequest("http://localhost/api/super-admin/schools/org_1", {
        method: "PATCH",
        body: JSON.stringify({ action: "assignAdmin", email: "admin@example.com" }),
      }),
      { params: Promise.resolve({ id: "org_1" }) },
    );

    expect(response.status).toBe(200);
    expect(sendInvitationEmail).toHaveBeenCalledWith({
      to: "admin@example.com",
      role: "admin",
      joinUrl: "https://spectra.test/join?token=tok_admin_1",
      orgName: "Alpha School",
    });
  });

  it("fails admin assignment when invitation email is not sent", async () => {
    const requireSuperAdmin = vi.fn().mockResolvedValue({ clerkId: "super_admin_1" });
    const convexMutation = vi.fn().mockResolvedValue({ invitationId: "invite_admin_1", token: "tok_admin_1" });
    const convexQuery = vi.fn().mockResolvedValue({ org: { name: "Alpha School" } });
    const sendInvitationEmail = vi.fn().mockResolvedValue({ status: "skipped", reason: "SMTP email environment is not configured." });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireSuperAdmin }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));
    vi.doMock("@/lib/invitations", () => ({ sendInvitationEmail }));

    process.env.NEXT_PUBLIC_APP_URL = "https://spectra.test";

    const route = await import("@/app/api/super-admin/schools/[id]/route");
    const response = await route.PATCH(
      new NextRequest("http://localhost/api/super-admin/schools/org_1", {
        method: "PATCH",
        body: JSON.stringify({ action: "assignAdmin", email: "admin@example.com" }),
      }),
      { params: Promise.resolve({ id: "org_1" }) },
    );

    expect(response.status).toBe(502);
  });

  it("fails admin assignment when invitation token is missing", async () => {
    const requireSuperAdmin = vi.fn().mockResolvedValue({ clerkId: "super_admin_1" });
    const convexMutation = vi.fn().mockResolvedValue({ invitationId: "invite_admin_1", invitationCreated: true });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireSuperAdmin }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));
    vi.doMock("@/lib/invitations", () => ({ sendInvitationEmail: vi.fn() }));

    const route = await import("@/app/api/super-admin/schools/[id]/route");
    const response = await route.PATCH(
      new NextRequest("http://localhost/api/super-admin/schools/org_1", {
        method: "PATCH",
        body: JSON.stringify({ action: "assignAdmin", email: "admin@example.com" }),
      }),
      { params: Promise.resolve({ id: "org_1" }) },
    );

    expect(response.status).toBe(502);
  });

  it("sends admin assignment email when a pending invitation is upgraded to admin", async () => {
    const requireSuperAdmin = vi.fn().mockResolvedValue({ clerkId: "super_admin_1" });
    const convexMutation = vi.fn().mockResolvedValue({
      invitationId: "invite_admin_1",
      invitationUpdated: true,
      token: "tok_existing_1",
    });
    const convexQuery = vi.fn().mockResolvedValue({ org: { name: "Alpha School" } });
    const sendInvitationEmail = vi.fn().mockResolvedValue({
      status: "sent",
      accepted: ["admin@example.com"],
      rejected: [],
      response: "250 ok",
      envelopeFrom: "owner@example.com",
    });

    vi.doMock("@/lib/auth-server", () => authServerMock({ requireSuperAdmin }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery }));
    vi.doMock("@/lib/invitations", () => ({ sendInvitationEmail }));

    process.env.NEXT_PUBLIC_APP_URL = "https://spectra.test";

    const route = await import("@/app/api/super-admin/schools/[id]/route");
    const response = await route.PATCH(
      new NextRequest("http://localhost/api/super-admin/schools/org_1", {
        method: "PATCH",
        body: JSON.stringify({ action: "assignAdmin", email: "admin@example.com" }),
      }),
      { params: Promise.resolve({ id: "org_1" }) },
    );

    expect(response.status).toBe(200);
    expect(sendInvitationEmail).toHaveBeenCalledWith({
      to: "admin@example.com",
      role: "admin",
      joinUrl: "https://spectra.test/join?token=tok_existing_1",
      orgName: "Alpha School",
    });
  });
});

describe("request-access route integration", () => {
  it("creates an access request for a signed-in user", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: "clerk_req_1" });
    const currentUser = vi.fn().mockResolvedValue({
      emailAddresses: [{ emailAddress: "student@example.com" }],
      fullName: "Student Example",
      firstName: "Student",
    });
    const convexMutation = vi.fn().mockResolvedValue({ status: "requested", orgName: "Alpha School" });

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/request-access", {
        method: "POST",
        body: JSON.stringify({
          orgId: "org_alpha",
          message: "I am in Year 10 biology.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("accessRequests:createAccessRequest", {
      requesterClerkId: "clerk_req_1",
      orgId: "org_alpha",
      email: "student@example.com",
      name: "Student Example",
      message: "I am in Year 10 biology.",
    });
  });

  it("rejects anonymous access requests", async () => {
    const auth = vi.fn().mockResolvedValue({ userId: null });
    const currentUser = vi.fn();

    vi.doMock("@clerk/nextjs/server", () => ({ auth, currentUser }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation: vi.fn(), convexQuery: vi.fn() }));

    const route = await import("@/app/api/request-access/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/request-access", {
        method: "POST",
        body: JSON.stringify({ orgId: "org_alpha" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
