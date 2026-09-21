import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  convexQuery: vi.fn(),
}));
vi.mock("@/lib/auth-server", () => ({ requireActor: mocks.requireActor }));
vi.mock("@/lib/convex-server", () => ({
  convexQuery: mocks.convexQuery,
  convexMutation: vi.fn(),
}));
import { GET } from "./route";

describe("Calendar GET continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue({ accountId: "student" });
    mocks.convexQuery.mockResolvedValue({ items: [] });
  });
  it("forwards each cursor with its range and target through the authenticated route", async () => {
    const params = new URLSearchParams({
      from: "1000",
      to: "2000",
      limit: "2",
      targetTitle: "Essay",
      cursor: "visible",
      unscheduledCursor: "tasks",
      plannerCursor: "plans",
      partialCursor: "partial",
      migrationCursor: "migration",
      targetCursor: "title",
    });
    const response = await GET(
      new NextRequest(`https://example.test/api/spectra/calendar?${params}`),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireActor).toHaveBeenCalledOnce();
    expect(mocks.convexQuery).toHaveBeenCalledWith("calendar:overview", {
      from: 1000,
      to: 2000,
      limit: 2,
      targetTitle: "Essay",
      cursor: "visible",
      unscheduledCursor: "tasks",
      plannerCursor: "plans",
      partialCursor: "partial",
      migrationCursor: "migration",
      targetCursor: "title",
    });
  });
});
