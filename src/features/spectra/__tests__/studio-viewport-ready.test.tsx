// @vitest-environment jsdom
import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StudioViewportContext,
  useStudioViewportReady,
  withStudioViewportReady,
} from "../components/studio-viewport-ready";
import { __resetViewportReadiness, pendingViewportActions, requestViewportAction } from "../viewport-readiness";

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
const onReady = vi.fn();
const context = { artifactId: "work-a", onReady };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  frames = new Map();
  let frame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frame, callback);
    return frame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  root = createRoot(host);
  onReady.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  __resetViewportReadiness();
  vi.unstubAllGlobals();
});

async function paint() {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
}

describe("selected studio viewport readiness", () => {
  it("keeps a slow lazy editor pending through its fallback and waits for the mounted viewport", async () => {
    let resolve!: (value: { default: ReturnType<typeof withStudioViewportReady> }) => void;
    const Loaded = withStudioViewportReady(() => <div>Sheet cells</div>);
    const Studio = lazy(() => new Promise<{ default: typeof Loaded }>((done) => { resolve = done; }));
    const opened = requestViewportAction({ targetId: "work-a", view: "artifact", navigate: () => undefined });
    await act(async () => root.render(
      <StudioViewportContext.Provider value={context}>
        <Suspense fallback={<span>Opening editor</span>}><Studio /></Suspense>
      </StudioViewportContext.Provider>,
    ));
    await paint();
    expect(host.textContent).toBe("Opening editor");
    expect(pendingViewportActions()).toHaveLength(1);
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => resolve({ default: Loaded }));
    expect(host.textContent).toBe("Sheet cells");
    expect(pendingViewportActions()).toHaveLength(1);
    await paint();
    await expect(opened).resolves.toMatchObject({ targetId: "work-a", status: "ready" });
    expect(onReady).toHaveBeenLastCalledWith(true);
  });

  it("waits for a document editor instance and cancels an old selection's queued frame", async () => {
    function Document({ ready }: { ready: boolean }) {
      useStudioViewportReady(ready);
      return <div>{ready ? "ProseMirror" : "Document shell"}</div>;
    }
    const render = (ready: boolean) => root.render(
      <StudioViewportContext.Provider value={context}><Document ready={ready} /></StudioViewportContext.Provider>,
    );
    const opened = requestViewportAction({ targetId: "work-a", view: "artifact", navigate: () => undefined });
    await act(async () => render(false));
    await paint();
    expect(pendingViewportActions()).toHaveLength(1);
    await act(async () => render(true));
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    await paint();
    expect(onReady).not.toHaveBeenCalledWith(true);
    expect(pendingViewportActions()).toHaveLength(1);
    __resetViewportReadiness();
    await expect(opened).resolves.toMatchObject({ status: "cancelled" });
  });
});
