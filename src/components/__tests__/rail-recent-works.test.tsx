// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({ useConvex: () => convex, useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../../convex/_generated/api", () => ({ api: { orgTree: { recentWorks: "orgTree:recentWorks", search: "orgTree:search" } } }));
import { RailRecentWorks } from "../layout/rail-recent-works";

const work = (workId: string, title: string, activityAt: number) => ({ workId, title, typeKey: "document", activityAt });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  convex.query.mockReset();
  convex.query.mockImplementation(async (name: string) =>
    name === "orgTree:recentWorks"
      ? Array.from({ length: 7 }, (_, index) => work(`w${index}`, index === 6 ? "Physics progress" : `Artifact ${index}`, 1000 - index))
      : { results: [{ sourceId: "lib-1", name: "Physics IA", typeKey: "document", updatedAt: 1 }] },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the rail's recent artifacts", () => {
  it("lists the five touched last, each opening its page", async () => {
    render(<RailRecentWorks />);
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Artifact 0", "Artifact 1", "Artifact 2", "Artifact 3", "Artifact 4"]);
    expect(links[0]!.getAttribute("href")).toBe("/library/w0");
    expect(convex.query).toHaveBeenCalledWith("orgTree:recentWorks", { limit: 12 });
  });

  it("searches the recent ones first, then asks the Library once by name", async () => {
    render(<RailRecentWorks />);
    await screen.findAllByRole("link");
    fireEvent.click(screen.getByRole("button", { name: "Search your artifacts" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find artifact by name" }), { target: { value: "physics" } });
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Physics progress"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(convex.query).toHaveBeenCalledWith("orgTree:search", { term: "physics", kinds: ["work"], limit: 8 });
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Physics progress", "Physics IA"]);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
