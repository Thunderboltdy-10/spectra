// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Session = null | undefined | {
  account: { email: string; platformOperator: boolean };
  memberships: Array<{ status: string; school: { status: string } | null }>;
  catalog: object | null;
};
const state = vi.hoisted(() => ({ session: undefined as unknown, signOut: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "clerk-1" }),
  useClerk: () => ({ signOut: state.signOut }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "new@example.test" } } }),
}));
const nav = vi.hoisted(() => ({ pathname: "/home" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/features/spectra/data/use-kept-query", () => ({ useQuery: () => state.session }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/auth/auth-shell", () => ({ AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

import { AccountGate } from "../account-gate";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function show(session: Session) {
  state.session = session;
  return render(<AccountGate><p>The app</p></AccountGate>);
}

const member = { account: { email: "a@example.test", platformOperator: false }, memberships: [{ status: "active", school: { status: "active" } }], catalog: {} };

describe("AccountGate", () => {
  it("opens the app for a school member", () => {
    show(member);
    expect(screen.getByText("The app")).toBeTruthy();
  });

  it("tells an uninvited email it has no invitation, and keeps the app shut", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: { code: "IDENTITY_NOT_INVITED" } }), { status: 403 }));
    show(null);
    await waitFor(() => expect(screen.getByRole("heading", { name: "No invitation for this email" })).toBeTruthy());
    expect(screen.getByText("new@example.test")).toBeTruthy();
    expect(screen.queryByText("The app")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("waits while a first sign-in makes the account", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    show(null);
    expect(await screen.findByText("Setting up your account…")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops an account with no school and points to the invitation", () => {
    show({ ...member, memberships: [], catalog: null });
    expect(screen.getByRole("heading", { name: "Join your school first" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open my invitation" }).getAttribute("href")).toBe("/join");
    expect(screen.queryByText("The app")).toBeNull();
  });

  it("says when the school itself is switched off", () => {
    show({ ...member, memberships: [{ status: "active", school: { status: "suspended" } }], catalog: null });
    expect(screen.getByRole("heading", { name: "Your school is not active" })).toBeTruthy();
  });

  it("lets a platform operator with no school into the platform console only", () => {
    const operator = { ...member, account: { ...member.account, platformOperator: true }, memberships: [], catalog: null };
    show(operator);
    expect(screen.getByRole("heading", { name: "Join your school first" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the platform console" }).getAttribute("href")).toBe("/superadmin");
    cleanup();
    nav.pathname = "/superadmin";
    show(operator);
    expect(screen.getByText("The app")).toBeTruthy();
    nav.pathname = "/home";
  });
});
