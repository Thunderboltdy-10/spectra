// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spectraBus } from "@/features/spectra/events";
import { activeRailDestination, Rail, RAIL_DESTINATIONS } from "./rail";

const route = vi.hoisted(() => ({ pathname: "/calendar", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode } & { prefetch?: boolean }) => {
    delete props.prefetch;
    return <a {...props}>{children}</a>;
  },
}));
vi.mock("@/features/spectra/hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: route.push, replace: vi.fn() }) }));
vi.mock("@/components/spectra-prism-optic", () => ({ PrismLoader: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Nothing = () => null;
  return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Nothing, DropdownMenuItem: Nothing, DropdownMenuLabel: Nothing, DropdownMenuSeparator: Nothing };
});
vi.mock("./account-menu", () => ({ AccountMenu: () => <button type="button">Account menu</button> }));
vi.mock("./use-shell-notifications", () => ({
  useShellNotifications: () => ({ items: [], unreadCount: 0, loading: false, refresh: vi.fn(), markAllRead: vi.fn(), markRead: vi.fn() }),
}));
vi.mock("@/features/spectra/administration/api", () => ({ getAdministration: async () => null }));
const threadRows = vi.hoisted(() => ({ threads: [] as Array<Record<string, unknown>> }));
vi.mock("@/features/spectra/data/api", () => ({ getSpectraThreads: async () => ({ threads: threadRows.threads }) }));
vi.mock("@/features/spectra/island/run-tabs", () => ({ useRunTabs: () => [], isActiveRunStatus: () => false }));
vi.mock("@/features/spectra/data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [] }) }));
vi.mock("@/features/spectra/components/catalog-progress", () => ({ CatalogProgress: () => null }));
const pinned = vi.hoisted(() => ({ nodes: [] as Array<Record<string, unknown>> }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }), useQuery: () => undefined, useMutation: () => vi.fn() }));
vi.mock("@/features/spectra/organization/tree-client", () => ({ useTreeQuickView: () => ({ nodes: pinned.nodes }) }));

beforeEach(() => {
  route.pathname = "/calendar";
  route.push.mockClear();
  pinned.nodes = [];
  threadRows.threads = [];
  window.localStorage.clear();
  delete document.documentElement.dataset.spectraSidebarCollapsed;
});
afterEach(() => cleanup());

describe("the rail", () => {
  it("lists the six destinations in SHELL.md's order, then the admin pages for those who hold them", () => {
    expect(RAIL_DESTINATIONS.map((destination) => destination.label)).toEqual(["Home", "Library", "Calendar", "School", "Agents", "Devices", "School admin", "Platform"]);
  });

  it("marks the current destination", () => {
    expect(activeRailDestination("/home")).toBe("home");
    expect(activeRailDestination("/chat")).toBe("home");
    expect(activeRailDestination("/workspace")).toBe("library");
    expect(activeRailDestination("/workspace/abc")).toBe("library");
    expect(activeRailDestination("/managebac")).toBe("school");
    expect(activeRailDestination("/settings")).toBeNull();
  });

  it("lists recent threads that open as their own page, and starts a new one in place", async () => {
    threadRows.threads = [{ _id: "t1", title: "Essay plan", status: "active", updatedAt: Date.now() }];
    const composed = vi.fn();
    const off = spectraBus.on("island.compose", composed);
    await act(async () => {
      render(<Rail />);
    });
    expect((await screen.findByRole("link", { name: "Essay plan" })).getAttribute("href")).toBe("/home?threadId=t1");
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(composed).toHaveBeenCalledWith({ fresh: true });
    off();
  });

  it("collapses to icons, remembers the choice, and publishes the geometry", async () => {
    const layout = vi.fn();
    const off = spectraBus.on("shell.sidebarLayout", layout);
    await act(async () => {
      render(<Rail />);
    });
    expect(document.documentElement.dataset.spectraSidebarCollapsed).toBe("false");
    expect(screen.getByText("Library")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse the rail" }));
    expect(document.documentElement.dataset.spectraSidebarCollapsed).toBe("true");
    expect(window.localStorage.getItem("spectra:sidebar-collapsed")).toBe("true");
    expect(layout).toHaveBeenCalledWith({ collapsed: true });
    // Collapsed, the names stay for assistive technology only.
    expect(screen.getByText("Library").className).toContain("sr-only");
    fireEvent.click(screen.getByRole("button", { name: "Open the rail" }));
    expect(document.documentElement.dataset.spectraSidebarCollapsed).toBe("false");
    off();
  });

  it("rails itself while a page is crowded, without rewriting the preference", async () => {
    await act(async () => {
      render(<Rail />);
    });
    act(() => spectraBus.emit("shell.sidebarCrowd", { crowded: true }));
    expect(document.documentElement.dataset.spectraSidebarCollapsed).toBe("true");
    expect(window.localStorage.getItem("spectra:sidebar-collapsed")).toBeNull();
    act(() => spectraBus.emit("shell.sidebarCrowd", { crowded: false }));
    expect(document.documentElement.dataset.spectraSidebarCollapsed).toBe("false");
  });

  it("opens a pinned work where the page can hold it, else in the Library", async () => {
    pinned.nodes = [{ nodeId: "n1", sourceId: "work-1", name: "Essay", typeKey: "document", activityAt: Date.now(), kind: "work" }];
    await act(async () => {
      render(<Rail />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Essay" }));
    expect(route.push).toHaveBeenCalledWith("/library/work-1");
    const off = spectraBus.handle("work.open", async () => ({ status: "completed", message: "Opened." }));
    route.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Essay" }));
    expect(route.push).not.toHaveBeenCalled();
    off();
  });
});
