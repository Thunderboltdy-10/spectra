import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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
    vi.doMock("@/lib/auth-server", () => ({
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

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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

describe("school-admin members route integration", () => {
  it("fails the invite request when email delivery is skipped or fails", async () => {
    const requireActor = vi.fn().mockResolvedValue({ clerkId: "admin_members", role: "admin" });
    const convexMutation = vi.fn().mockResolvedValue({ invitationId: "invite_1", token: "tok_1" });
    const convexQuery = vi.fn().mockResolvedValue({});

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
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
