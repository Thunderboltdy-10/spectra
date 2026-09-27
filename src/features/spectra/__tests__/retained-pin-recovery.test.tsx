// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPinRecovery } from "../components/retained-pin-recovery";

const mocks = vi.hoisted(() => ({ client: {}, refresh: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.client,
  useAction: () => mocks.refresh,
}));
let observations: Array<{
  callback: IntersectionObserverCallback;
  active: boolean;
}> = [];
let hidden = false;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function tick(ms = 750) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function show(visible = true) {
  act(() =>
    observations
      .filter((entry) => entry.active)
      .forEach(({ callback }) =>
        callback(
          [{ isIntersecting: visible } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      ),
  );
}
function pageVisibility(value: boolean) {
  hidden = value;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.client = {};
  mocks.refresh.mockReset().mockResolvedValue({ status: "unavailable" });
  observations = [];
  hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private item: { callback: IntersectionObserverCallback; active: boolean };
      constructor(callback: IntersectionObserverCallback) {
        this.item = { callback, active: true };
        observations.push(this.item);
      }
      observe() {}
      disconnect() {
        this.item.active = false;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("visible retained pin placement recovery", () => {
  it("does not repeat materialization when the action already checked a newer subscribed head", async () => {
    mocks.refresh.mockResolvedValueOnce({
      status: "proven",
      headHash: "head-b",
    });
    const { rerender } = render(
      <RetainedPinRecovery embedId="embed" refreshKey="head-a" />,
    );
    show();
    await tick();
    rerender(<RetainedPinRecovery embedId="embed" refreshKey="head-b" />);
    await tick(5_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Placement verified");
  });
  it("does not materialize hidden or offscreen references and cancels pending demand on hide", async () => {
    render(<RetainedPinRecovery embedId="embed" refreshKey="head-a" />);
    await tick(5_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    show();
    await tick(500);
    pageVisibility(true);
    await tick(2_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    pageVisibility(false);
    await tick();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith({ embedId: "embed" });
  });

  it("coalesces two visible readers and Strict Mode into one attempt per head", async () => {
    render(
      <StrictMode>
        <RetainedPinRecovery embedId="embed" refreshKey="head-a" />
        <RetainedPinRecovery embedId="embed" refreshKey="head-a" />
      </StrictMode>,
    );
    show();
    await tick();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await tick(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getAllByText(
        "This placement could not be verified. The retained version is still kept.",
      ),
    ).toHaveLength(2);
  });

  it("debounces acknowledged edits and waits for the in-flight reconstruction before the latest settled head", async () => {
    const old = deferred<{ status: "stale" }>();
    mocks.refresh.mockReturnValueOnce(old.promise);
    const { rerender } = render(
      <RetainedPinRecovery embedId="embed" refreshKey="head-a" />,
    );
    show();
    await tick(500);
    rerender(<RetainedPinRecovery embedId="embed" refreshKey="head-b" />);
    await tick(500);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await tick(250);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    rerender(<RetainedPinRecovery embedId="embed" refreshKey="head-c" />);
    await tick(2_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => old.resolve({ status: "stale" }));
    await tick();
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await tick(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it.each(["unavailable", "stale", "needs_checkpoint"] as const)(
    "requires deliberate retry after %s and never loops",
    async (status) => {
      mocks.refresh.mockResolvedValue({ status });
      render(<RetainedPinRecovery embedId="embed" refreshKey="head-a" />);
      show();
      await tick();
      await tick(60_000);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status")).not.toHaveTextContent(
        "Placement verified",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Retry placement check" }),
      );
      await tick(0);
      expect(mocks.refresh).toHaveBeenCalledTimes(2);
    },
  );

  it("preserves a failed check as retryable without turning it into successful access", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("offline"));
    render(<RetainedPinRecovery embedId="embed" refreshKey="head-a" />);
    show();
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent("could not finish");
    await tick(60_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.refresh.mockResolvedValueOnce({
      status: "proven",
      headHash: "head-a",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Retry placement check" }),
    );
    await tick(0);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Placement verified. Loading the pinned version",
    );
  });

  it("does not show a late result for another embed, and releases readers on unmount", async () => {
    const old = deferred<{ status: "proven" }>();
    mocks.refresh.mockReturnValueOnce(old.promise);
    const { rerender, unmount } = render(
      <RetainedPinRecovery embedId="embed-a" refreshKey="head-a" />,
    );
    show();
    await tick();
    rerender(<RetainedPinRecovery embedId="embed-b" refreshKey="head-b" />);
    await act(async () => old.resolve({ status: "proven" }));
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Placement verified",
    );
    show();
    await tick(500);
    unmount();
    await tick(2_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
