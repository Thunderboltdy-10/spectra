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
import { authorizedBridgeRequest, persistBridgeSession } from "@/features/spectra/bridge/client";
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
  vi.unstubAllGlobals();
});
describe("account storage boundary before restoring readers", () => {
  it.each([true, false])("retires pending Bridge requests on owner change=%s before backend identity resolves", async (changeOwner) => {
    session.account = { accountId: "account-A" };
    const view = render(app());
    persistBridgeSession("session-A");
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = authorizedBridgeRequest("/v1/status");
    session.authenticated = false;
    session.account = undefined;
    if (changeOwner) session.userId = "clerk-B";
    view.rerender(app());
    finish(Response.json({ private: "A" }));
    const response = await pending;
    if (changeOwner) expect(response).toBeNull();
    else expect(await response?.json()).toEqual({ private: "A" });
  });
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
  it("keeps the same prepared readers mounted through temporary Convex authentication loss", () => {
    session.account = { accountId: "account-A" };
    const view = render(app());
    const reader = screen.getByText("Readers mounted");
    save();
    session.authenticated = false;
    session.account = undefined;
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBe(reader);
    session.authenticated = true;
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBe(reader);
    session.account = { accountId: "account-A" };
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBe(reader);
    expect(useSpectraContextStore.getState().openObjects.map((o) => o.id)).toEqual(["foreign-table-id"]);
  });
  it.each(["account", "deployment", "unknown identity"])("blocks prepared readers when %s changes while Convex identity is unavailable", (change) => {
    session.account = { accountId: "account-A" };
    const view = render(app());
    save();
    session.authenticated = false;
    session.account = undefined;
    if (change === "account") session.userId = "clerk-B";
    if (change === "deployment") vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://localhost:4002");
    if (change === "unknown identity") session.loaded = false;
    view.rerender(app());
    expect(screen.queryByText("Readers mounted")).toBeNull();
    session.loaded = true;
    session.authenticated = true;
    session.account = { accountId: change === "account" ? "account-B" : "account-A" };
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBeTruthy();
    if (change !== "unknown identity") {
      expect(useSpectraContextStore.getState().openObjects).toEqual([]);
      expect(session.restored).toEqual([]);
    }
  });
  it.each([null, { accountId: "fresh-account" }])("clears prepared references when the resolved backend account changes to %j", (account) => {
    session.account = { accountId: "account-A" };
    const view = render(app());
    save();
    session.account = account;
    view.rerender(app());
    expect(screen.getByText("Readers mounted")).toBeTruthy();
    expect(useSpectraContextStore.getState().openObjects).toEqual([]);
    expect(session.restored).toEqual([]);
  });
  it("clears the previous account on sign-out", () => {
    session.account = { accountId: "account-A" };
    const view = render(app());
    save();
    session.userId = null;
    session.authenticated = false;
    session.account = undefined;
    view.rerender(app());
    expect(useSpectraContextStore.getState().openObjects).toEqual([]);
    expect(session.restored).toEqual([]);
  });

});
