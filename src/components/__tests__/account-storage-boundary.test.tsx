// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({
  loaded: true,
  userId: "clerk-A" as string | null,
  authenticated: true,
  account: undefined as undefined | null | { accountId: string },
  restored: [] as string[],
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: session.loaded, userId: session.userId }),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: session.authenticated }),
  useQuery: () => session.account,
}));
import {
  AccountStorageBoundary,
  useAccountStorageReady,
} from "../account-storage-boundary";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
function Reader() {
  useLayoutEffect(() => {
    void useSpectraContextStore.persist.rehydrate();
    session.restored.push(
      ...useSpectraContextStore.getState().openObjects.map((o) => o.id),
    );
  }, []);
  return <p>Readers mounted</p>;
}
function PrivateShell() {
  return useAccountStorageReady() ? <Reader /> : null;
}
function app() {
  return (
    <AccountStorageBoundary>
      <PrivateShell />
    </AccountStorageBoundary>
  );
}
function save() {
  useSpectraContextStore
    .getState()
    .openObject({
      type: "artifact",
      id: "foreign-table-id",
      label: "Saved",
      presentation: "tab",
    });
}
beforeEach(() => {
  localStorage.clear();
  useSpectraContextStore.setState(
    useSpectraContextStore.getInitialState(),
    true,
  );
  localStorage.clear();
  session.loaded = true;
  session.userId = "clerk-A";
  session.authenticated = true;
  session.account = undefined;
  session.restored = [];
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://localhost:3002");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe("account storage boundary before restoring readers", () => {
  it("waits for identity then releases legacy IDs before mounting readers", () => {
    save();
    const view = render(app());
    expect(screen.queryByText("Readers mounted")).toBeNull();
    session.account = { accountId: "account-A" };
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBeTruthy();
    expect(session.restored).toEqual([]);
  });
  it("accepts an unregistered account so normal bootstrap can register it", () => {
    session.account = null;
    render(app());
    expect(screen.getByText("Readers mounted")).toBeTruthy();
  });
  it("rejects foreign state after a database reset on the same URL and Clerk session", () => {
    session.account = { accountId: "old-account" };
    const first = render(app());
    save();
    first.unmount();
    session.account = { accountId: "fresh-account" };
    render(app());
    expect(session.restored).toEqual([]);
    expect(useSpectraContextStore.getState().openObjects).toEqual([]);
  });
  it("restores the same account's work across reloads", () => {
    session.account = { accountId: "account-A" };
    const first = render(app());
    save();
    first.unmount();
    render(app());
    expect(session.restored).toEqual(["foreign-table-id"]);
  });
});
