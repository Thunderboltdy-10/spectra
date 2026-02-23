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
    const convexMutation = vi.fn().mockResolvedValue({ ok: true, compactedMessages: 12 });

    vi.doMock("@/lib/auth-server", () => ({ requireActor }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation, convexQuery: vi.fn() }));

    const route = await import("@/app/api/chats/[id]/route");
    const response = await route.POST(
      new NextRequest("http://localhost/api/chats/chat_99", {
        method: "POST",
        body: JSON.stringify({ keepLatestMessages: 18 }),
      }),
      { params: Promise.resolve({ id: "chat_99" }) },
    );

    expect(response.status).toBe(200);
    expect(convexMutation).toHaveBeenCalledWith("chats:manualCompact", {
      actorClerkId: "user_compact",
      chatId: "chat_99",
      keepLatestMessages: 18,
    });
  });
});
