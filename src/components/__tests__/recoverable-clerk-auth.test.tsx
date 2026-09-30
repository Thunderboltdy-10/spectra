// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useRecoverableClerkAuth } from "../use-recoverable-clerk-auth";
const clerk = vi.hoisted(() => ({
  getToken: vi.fn(), userId: "user-A", sessionId: "session-A", orgId: null as string | null,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ ...clerk, isLoaded: true, isSignedIn: true, orgRole: null, sessionClaims: null }),
}));
class HttpFailure extends Error {
  static kind = "ClerkAPIResponseError";
  constructor(public status: number) { super("Disposable HTTP failure"); }
}
type Fetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null>;
let fetchers: Fetcher[];
const client = { setAuth: vi.fn((fetcher: Fetcher) => { fetchers.push(fetcher); }), clearAuth: vi.fn() };
function app() { return <ConvexProviderWithClerk client={client} useAuth={useRecoverableClerkAuth}><p>Shell</p></ConvexProviderWithClerk>; }
function offline(value: boolean) { vi.spyOn(navigator, "onLine", "get").mockReturnValue(!value); }
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  vi.useFakeTimers(); fetchers = []; clerk.userId = "user-A"; clerk.sessionId = "session-A"; clerk.orgId = null;
  clerk.getToken.mockReset(); client.setAuth.mockClear(); client.clearAuth.mockClear(); offline(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("keeps the installed Clerk adapter's token fetch pending offline and resumes on reconnect", async () => {
  offline(true);
  clerk.getToken.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue("new-token");
  render(app());
  let settled = false;
  const result = fetchers[0]({ forceRefreshToken: true }).then(value => { settled = true; return value; });
  await flush();
  expect(settled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(clerk.getToken).toHaveBeenCalledOnce();
  offline(false); act(() => { window.dispatchEvent(new Event("online")); });
  expect(await result).toBe("new-token");
  expect(clerk.getToken.mock.calls).toEqual([[{template:"convex",skipCache:true}],[{template:"convex",skipCache:true}]]);
});
it("retries an online transport failure without translating it into missing credentials", async () => {
  clerk.getToken.mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue("new-token");
  render(app());
  const result = fetchers[0]({forceRefreshToken:false});
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(await result).toBe("new-token");
  expect(clerk.getToken).toHaveBeenCalledTimes(2);
});
it.each([null, new Error("Session revoked"), new HttpFailure(401), new HttpFailure(403)])("keeps terminal identity failures terminal: %j", async failure => {
  if (failure === null) clerk.getToken.mockResolvedValue(null); else clerk.getToken.mockRejectedValue(failure);
  render(app());
  expect(await fetchers[0]({forceRefreshToken:true})).toBeNull();
  expect(clerk.getToken).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels offline token recovery on a session change without fetching for the old session", async () => {
  offline(true); clerk.getToken.mockRejectedValue(new TypeError("Failed to fetch"));
  const view = render(app()); const result = fetchers[0]({forceRefreshToken:true}); await flush();
  clerk.userId = "user-B"; clerk.sessionId = "session-B"; view.rerender(app()); await flush();
  expect(await result).toBeNull();
  clerk.getToken.mockResolvedValue("user-B-token");
  offline(false); act(() => { window.dispatchEvent(new Event("online")); });
  expect(await fetchers[fetchers.length-1]({forceRefreshToken:true})).toBe("user-B-token");
  expect(clerk.getToken).toHaveBeenCalledTimes(2);
});
it("cancels recovery and removes its timer when the provider unmounts", async () => {
  clerk.getToken.mockRejectedValue(new TypeError("Failed to fetch"));
  const view = render(app()); const result = fetchers[0]({forceRefreshToken:true}); await flush();
  expect(vi.getTimerCount()).toBe(1);
  view.unmount(); expect(await result).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

it.each([429, 503])("recovers transient Clerk HTTP %s without changing token options", async status => {
  clerk.getToken.mockRejectedValueOnce(new HttpFailure(status)).mockResolvedValue("new-token");
  render(app()); const result = fetchers[0]({forceRefreshToken:true}); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(await result).toBe("new-token"); expect(clerk.getToken).toHaveBeenCalledTimes(2);
});
it("does not return an in-flight token after the owner changes", async () => {
  let resolve!: (token: string) => void;
  clerk.getToken.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  const view = render(app()); const result = fetchers[0]({forceRefreshToken:true});
  clerk.sessionId = "session-B"; view.rerender(app());
  resolve("old-session-token"); expect(await result).toBeNull();
});
