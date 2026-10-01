// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster, toast } from "sonner";
import { spectraBus } from "../events";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";
import { RouteSidePanelHost } from "../components/route-side-panel-host";

const session = vi.hoisted(() => ({ authenticated: true, account: { accountId: "account-A" } as { accountId: string } | undefined }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, userId: "clerk-A" }) }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: session.authenticated }), useQuery: () => session.account }));
import { AccountStorageBoundary, useAccountStorageReady } from "@/components/account-storage-boundary";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/school", useRouter: () => navigation }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({ preferences: DEFAULT_SPECTRA_PREFERENCES, replace: navigation.push }),
}));
vi.mock("../components/live-thread-panel", () => ({
  LiveThreadPanel: ({ threadId, onClose }: { threadId: string; onClose: () => void }) => (
    <aside aria-label="Live conversation"><p>Opened {threadId}</p><button onClick={onClose}>Close live chat</button></aside>
  ),
}));
// Studio visuals are unrelated to the conversation loader under test.
vi.mock("../components/artifact-studio-shell", () => {
  const studio = { openSplit: vi.fn(), closeStudio: vi.fn(), activateTab: vi.fn(), setDirty: vi.fn(), mode: "closed" };
  return { useArtifactStudioState: () => studio, StudioSplitPlaceholder: () => null };
});

let offline = true;
const fetchRequest = vi.fn(async (input: RequestInfo | URL) => {
  if (offline) throw new TypeError("Failed to fetch");
  const url = new URL(String(input), "http://localhost");
  const data = url.searchParams.get("action") === "runDetail"
    ? { run: { threadId: "conversation-a" } }
    : { thread: { _id: url.searchParams.get("threadId"), title: "Temporary conversation" } };
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
});
beforeEach(() => {
  window.localStorage.clear();
  session.authenticated = true;
  session.account = { accountId: "account-A" };
  offline = true;
  fetchRequest.mockClear();
  vi.stubGlobal("fetch", fetchRequest);
});
afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function mountHost() {
  render(<><main>School context</main><RouteSidePanelHost /><Toaster /></>);
}
async function openConversation(threadId?: string) {
  let result: Awaited<ReturnType<typeof spectraBus.commandAsyncResults>> | undefined;
  await act(async () => {
    result = await spectraBus.commandAsyncResults("run.openConversation", { runId: "run-a", threadId }).catch(() => undefined);
  });
  return result;
}

it("gives Dock conversation opens one retry notice through repeated failures and opens after reconnect", async () => {
  mountHost();
  const outcome = await openConversation("conversation-a");
  await screen.findByRole("button", { name: "Try again" });
  expect(outcome?.results[0]).toMatchObject({ status: "failed" });
  expect(screen.getByText("School context")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close live chat" })).toBeNull();
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledTimes(i + 2));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1));
  }
  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Opened conversation-a")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
  expect(fetchRequest).toHaveBeenCalledTimes(4);
  expect(new URL(String(fetchRequest.mock.calls[3][0]), "http://localhost").searchParams.get("threadId")).toBe("conversation-a");
});

it("retries the run-to-conversation lookup as part of the same open when no thread ID is supplied", async () => {
  mountHost();
  const outcome = await openConversation();
  await screen.findByRole("button", { name: "Try again" });
  expect(outcome?.results[0]).toMatchObject({ status: "failed" });
  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Opened conversation-a")).toBeTruthy();
  expect(fetchRequest.mock.calls.map(([url]) => new URL(String(url), "http://localhost").searchParams.get("action"))).toEqual(["runDetail", "runDetail", "thread"]);
});

it("reports a successful online open and uses the supplied thread without a run lookup", async () => {
  offline = false;
  mountHost();
  expect((await openConversation("conversation-b"))?.results[0]).toMatchObject({ status: "completed" });
  expect(screen.getByText("Opened conversation-b")).toBeTruthy();
  expect(fetchRequest).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

it("handles the Dock's fire-and-forget bus delivery without an unhandled rejection", async () => {
  mountHost();
  act(() => { spectraBus.command("run.openConversation", { runId: "run-a", threadId: "conversation-a" }); });
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.getByText("School context")).toBeTruthy();
  expect(fetchRequest).toHaveBeenCalledOnce();
});

it("does not let a late run lookup replace a newer selected conversation", async () => {
  offline = false;
  let resolveLookup!: (response: Response) => void;
  const lookup = new Promise<Response>((resolve) => { resolveLookup = resolve; });
  fetchRequest.mockImplementationOnce(() => lookup);
  mountHost();
  let first!: Promise<unknown>;
  await act(async () => {
    first = spectraBus.commandAsyncResults("run.openConversation", { runId: "run-a" });
  });
  expect(fetchRequest).toHaveBeenCalledOnce();
  await openConversation("conversation-b");
  expect(screen.getByText("Opened conversation-b")).toBeTruthy();
  await act(async () => {
    resolveLookup(new Response(JSON.stringify({ run: { threadId: "conversation-a" } }), { status: 200 }));
    await first;
  });
  expect(screen.getByText("Opened conversation-b")).toBeTruthy();
  expect(fetchRequest).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

function PreparedRouteHost() {
  return useAccountStorageReady() ? <><main>School context</main><RouteSidePanelHost /></> : <p>Preparing account</p>;
}
function accountGatedHost() {
  return <><AccountStorageBoundary><PreparedRouteHost /></AccountStorageBoundary><Toaster /></>;
}
it("retains the route host and its retry action while the same account refreshes authentication", async () => {
  const view = render(accountGatedHost());
  const context = screen.getByText("School context");
  await openConversation("conversation-a");
  await screen.findByRole("button", { name: "Try again" });
  session.authenticated = false;
  session.account = undefined;
  view.rerender(accountGatedHost());
  expect(screen.getByText("School context")).toBe(context);
  session.authenticated = true;
  view.rerender(accountGatedHost());
  expect(screen.getByText("School context")).toBe(context);
  offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Opened conversation-a")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
});

it("keeps the original recovery action across a long offline hold with the production toast lifetime", async () => {
  vi.useFakeTimers();
  mountHost();
  await openConversation("conversation-a");
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
  offline = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getByText("Opened conversation-a")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(fetchRequest).toHaveBeenCalledTimes(4);
});
