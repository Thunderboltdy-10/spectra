import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UTILITY_ZONES } from "@/lib/workspace/contracts";
import { useWorkspaceStore } from "@/stores/workspace-store";

describe("workspace utility contracts", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it("places the focus timer in the bottom-right zone", () => {
    expect(DEFAULT_UTILITY_ZONES.focus_timer).toBe("bottom-right");
  });

  it("cycles and persists all supported canvas background modes", () => {
    const store = useWorkspaceStore.getState();

    expect(store.backgroundMode).toBe("dots");

    store.setBackgroundMode("grid");
    expect(useWorkspaceStore.getState().backgroundMode).toBe("grid");

    store.setBackgroundMode("blank");
    expect(useWorkspaceStore.getState().backgroundMode).toBe("blank");

    store.setBackgroundMode("dots");
    expect(useWorkspaceStore.getState().backgroundMode).toBe("dots");
  });
});
