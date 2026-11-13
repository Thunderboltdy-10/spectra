// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { SPECTRA_REQUEST_UNREACHABLE } from "@/features/spectra/data/request";

const route = vi.hoisted(() => ({ pathname: "/calendar", ready: true, router: { push: vi.fn(), replace: vi.fn() }, error: vi.fn() }));
vi.mock("next/font/google", () => ({ Figtree: () => ({ variable: "font-main" }), Newsreader: () => ({ variable: "font-display" }), IBM_Plex_Mono: () => ({ variable: "font-mono" }) }));
vi.mock("../account-gate", () => ({ AccountGate: ({ children }: { children: import("react").ReactNode }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useRouter: () => route.router, useSearchParams: () => new URLSearchParams("section=appearance") }));
vi.mock("sonner", () => ({ toast: { error: route.error, dismiss: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode } & { prefetch?: boolean }) => { delete props.prefetch; return <a {...props} onClick={event => { event.preventDefault(); route.router.push(String((props as { href?: string }).href)); }}>{children}</a>; } }));
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: ReactNode }) => children, useClerk: () => ({ openUserProfile: vi.fn() }) }));
vi.mock("@/lib/clerk-config", () => ({ getClerkPublishableKey: () => undefined }));
vi.mock("@/lib/boot-diagnostics", () => ({ checkDeploymentConsistency: () => {} }));
vi.mock("@/components/providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }));
vi.mock("../account-storage-boundary", () => ({ useAccountStorageReady: () => route.ready }));
vi.mock("@/features/spectra/data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [] }) }));
vi.mock("@/features/spectra/components/catalog-progress", () => ({ CatalogProgress: () => null }));
vi.mock("@/components/spectra-prism-optic", () => ({ PrismLoader: () => null }));
vi.mock("@/components/signed-in-continue", () => ({ SignedInContinue: () => null }));
vi.mock("@/components/keyboard-shortcuts", () => ({ KeyboardShortcutsRegistrar: () => null, KeyboardShortcutsHelp: () => null }));
vi.mock("@/features/spectra/components/universal-kbar", () => ({ UniversalKBar: () => null }));
vi.mock("@/features/spectra/components/viewport-readiness-mount", () => ({ ViewportReadinessMount: () => null }));
vi.mock("@/features/spectra/components/route-side-panel-host", () => ({ RouteSidePanelHost: () => null }));
vi.mock("@/features/spectra/components/viewport-reference-picker", () => ({ ViewportReferencePicker: () => null }));
vi.mock("@/features/spectra/island/island-host", () => ({ IslandHost: () => null }));
vi.mock("@/features/spectra/collaboration/app-choreography-host", () => ({ AppChoreographyMount: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => { const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>; const Nothing = () => null; return { DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Nothing, DropdownMenuItem: Nothing, DropdownMenuLabel: Nothing, DropdownMenuSeparator: Nothing, DropdownMenuRadioGroup: Nothing, DropdownMenuRadioItem: Nothing, OverflowMenu: Nothing }; });
vi.mock("./account-menu", () => ({ AccountMenu: () => null }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }), useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({ query: vi.fn(), mutation: vi.fn() }) }));
vi.mock("@/features/spectra/onboarding/tour", () => ({ TourMount: () => null }));
vi.mock("@/features/spectra/organization/tree-client", () => ({ useTreeQuickView: () => ({ nodes: [] }) }));

vi.mock("@/features/spectra/administration/api", () => ({ getAdministration: async () => null }));
vi.mock("@/features/spectra/island/run-tabs", () => ({ useRunTabs: () => [], isActiveRunStatus: () => false }));
vi.mock("@/features/spectra/data/api", () => ({
  getSpectraThreads: async () => ({ threads: [] }),
  getSpectraNotificationCenter: async () => ({ comments: [], planner: [], timetable: [], invitations: [] }),
}));

beforeEach(() => { route.router.push.mockClear(); route.error.mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([["/calendar", "Library"], ["/chat", "Calendar"]])("keeps the shell when %s opens %s offline", async (path, label) => {
  route.pathname = path;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => { render(<AppShell><p>Open artifact stays here</p></AppShell>); });
  fireEvent.click(screen.getAllByRole("link", { name: label })[0]!);
  expect(route.router.push).not.toHaveBeenCalled();
  expect(route.error).toHaveBeenCalledExactlyOnceWith(SPECTRA_REQUEST_UNREACHABLE);
  expect(screen.getByText("Open artifact stays here")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("This device is offline");
});

it("keeps normal online navigation available", async () => {
  route.pathname = "/calendar";
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => { render(<AppShell><p>Open artifact stays here</p></AppShell>); });
  fireEvent.click(screen.getAllByRole("link", { name: "Library" })[0]!);
  expect(route.router.push).toHaveBeenCalledWith("/library");
  expect(route.error).not.toHaveBeenCalled();
});
