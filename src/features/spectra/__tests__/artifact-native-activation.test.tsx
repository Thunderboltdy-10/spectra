// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useArtifactNativeSync } from "../components/artifact-native-sync";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture(content: unknown, application = "PowerPoint") {
  const snapshot = { title: "Audit.pptx", summary: "", tagDraft: "", content };
  const value = { title: snapshot.title, summary: "", tags: [], content };
  return {
    artifactId: "audit-presentation",
    nativeOfficeDocument: true,
    nativeWordDocument: application === "Word",
    nativeOfficeApplication: application,
    dirty: false,
    userHasEditedRef: { current: false },
    reconcilingRemoteRef: { current: false },
    currentSnapshotRef: { current: snapshot },
    live: {
      liveValue: value,
      synchronize: vi.fn(async () => undefined),
      modelSnapshot: { initialized: true, validity: "valid", value: { content } },
      unsynchronizedChanges: 0,
    },
    initialLiveValue: value,
    replicas: undefined,
    conflicts: undefined,
    setContent: vi.fn(),
    setBaseline: vi.fn(),
    setDirty: vi.fn(),
  } satisfies Parameters<typeof useArtifactNativeSync>[0];
}

it.each(["Word", "Excel", "PowerPoint"])("does not replay an old %s activation over an edit that has already saved", async (application) => {
  const original = { slides: [{ id: "slide-1", title: "Original" }] };
  const edited = { slides: [{ id: "slide-1", title: "Newer saved text" }] };
  let reply!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { reply = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const props = fixture(original, application);
  const hook = renderHook(() => useArtifactNativeSync(props));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  // Autosave has cleared dirty/userHasEdited by the time the older response
  // arrives. The current content, rather than those transient flags, decides.
  props.currentSnapshotRef.current = { ...props.currentSnapshotRef.current, content: edited };
  props.live.liveValue.content = edited;
  props.live.modelSnapshot.value.content = edited;
  hook.rerender();
  await act(async () => reply(new Response(JSON.stringify({ state: "opened", content: original }))));
  expect(props.live.synchronize).not.toHaveBeenCalled();
  expect(props.setContent).not.toHaveBeenCalled();
  expect(hook.result.current.nativeProjectionOverrideRef.current).toBeUndefined();
});

it("still applies a pristine first activation projection", async () => {
  const original = { slides: [] };
  const native = { slides: [{ id: "slide-1", title: "Native text" }] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: "opened", content: native }))));
  const props = fixture(original);
  renderHook(() => useArtifactNativeSync(props));
  await waitFor(() => expect(props.setContent).toHaveBeenCalledWith(native));
  expect(props.live.synchronize).toHaveBeenCalledWith(expect.objectContaining({ content: native }));
});
