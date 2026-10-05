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
vi.mock("@/components/spectra-logo", () => ({ SpectraLogo: () => null }));
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
vi.mock("@/features/spectra/data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [] }) }));
vi.mock("@/features/spectra/components/catalog-progress", () => ({ CatalogProgress: () => null }));
const pinned = vi.hoisted(() => ({ nodes: [] as Array<Record<string, unknown>> }));
vi.mock("@/features/spectra/organization/tree-client", () => ({ useTreeQuickView: () => ({ nodes: pinned.nodes }) }));

beforeEach(() => {
  route.pathname = "/calendar";
  route.push.mockClear();
  pinned.nodes = [];
  window.localStorage.clear();
  delete document.documentElement.dataset.spectraSidebarCollapsed;
  spectraBus.setQuery("threads.view", { open: false });
});
afterEach(() => cleanup());

describe("the rail", () => {
  it("lists the seven destinations in SHELL.md's order", () => {
    expect(RAIL_DESTINATIONS.map((destination) => destination.label)).toEqual(["Home", "Library", "Calendar", "Conversations", "School", "Agents", "Devices"]);
  });

  it("marks the current destination, and Conversations while the threads view is open", () => {
    expect(activeRailDestination("/workspace/abc", false)).toBe("home");
    expect(activeRailDestination("/managebac", false)).toBe("school");
    expect(activeRailDestination("/chat", false)).toBe("conversations");
    expect(activeRailDestination("/calendar", true)).toBe("conversations");
    expect(activeRailDestination("/settings", false)).toBeNull();
  });

  it("opens and closes the threads view from Conversations, and from the old search shortcut", async () => {
    const opened = vi.fn();
    const closed = vi.fn();
    const offOpen = spectraBus.on("threads.open", opened);
    const offClose = spectraBus.on("threads.close", closed);
    await act(async () => {
      render(<Rail />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(opened).toHaveBeenCalledTimes(1);
    act(() => spectraBus.setQuery("threads.view", { open: true }));
    expect(screen.getByRole("button", { name: "Conversations" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(closed).toHaveBeenCalledTimes(1);
    act(() => spectraBus.emit("shell.focusSidebarSearch", {}));
    expect(opened).toHaveBeenCalledTimes(2);
    offOpen();
    offClose();
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
    fireEvent.click(screen.getByRole("button", { name: "Expand the rail" }));
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
