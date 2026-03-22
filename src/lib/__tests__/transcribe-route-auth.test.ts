import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("transcribe route auth and error handling", () => {
  it("returns 401 auth payload when actor is not signed in", async () => {
    vi.doMock("@/lib/auth-server", () => ({
      requireActor: vi.fn().mockRejectedValue(new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.")),
    }));
    vi.doMock("@/lib/env", () => ({
      getEnv: vi.fn().mockReturnValue({ OPENROUTER_API_KEY: "test_key" }),
    }));
    vi.doMock("@/lib/usage-tracking", () => ({
      recordOpenRouterUsage: vi.fn(),
    }));

    const route = await import("@/app/api/transcribe/route");
    const response = await route.POST(new NextRequest("http://localhost/api/transcribe", { method: "POST" }));
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("AUTH_NOT_SIGNED_IN");
    expect(payload.error?.status).toBe(401);
  });

  it("returns 502 when the transcription provider request fails", async () => {
    vi.doMock("@/lib/auth-server", () => ({
      requireActor: vi.fn().mockResolvedValue({ clerkId: "clerk_user_1" }),
    }));
    vi.doMock("@/lib/env", () => ({
      getEnv: vi.fn().mockReturnValue({ OPENROUTER_API_KEY: "test_key" }),
    }));
    vi.doMock("@/lib/usage-tracking", () => ({
      recordOpenRouterUsage: vi.fn(),
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));

    const route = await import("@/app/api/transcribe/route");
    const form = new FormData();
    form.append("audio", new Blob(["abc"], { type: "audio/webm" }), "recording.webm");

    const response = await route.POST(
      new NextRequest("http://localhost/api/transcribe", {
        method: "POST",
        body: form,
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("Transcription unavailable");
  });
});

