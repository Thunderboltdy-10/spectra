// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LocalRecoveryController,
  LocalRecoveryInspection,
  RecoveryBranch,
} from "../collaboration/recovery-controller";
import { ArtifactDraftRecovery } from "../components/artifact-draft-recovery";

const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../components/artifact-studio-file-utils", () => ({
  downloadDocumentBlob: download,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function branch(id = "one"): RecoveryBranch {
  return {
    id,
    createdAt: 1_700_000_000_000,
    bytes: 1_234,
    generation: `generation-${id}`,
    reason: id === "one" ? "native_overlap" : "unknown_ancestor",
    regionIds: ["paragraph-one", "paragraph-two"],
    canReadCurrent: true,
    canReapply: true,
    currentAnchor: {
      roomId: "room",
      nextSequence: 12,
      frontierHash: "frontier",
    },
  };
}

function inspection(value: RecoveryBranch): LocalRecoveryInspection {
  return {
    branch: value,
    previews: [
      {
        regionId: "paragraph-one",
        label: "Introduction",
        draft: `LOCAL ${value.id}`,
        current: `CURRENT ${value.id}`,
      },
      {
        regionId: "paragraph-two",
        label: "Conclusion",
        draft: "<script>local text</script>",
        current: "Saved conclusion",
      },
    ],
  };
}

function controller(values = [branch()]) {
  const state: LocalRecoveryController["recovery"] = {
    state: "review_required",
    branches: values,
    activeBranchId: values[0]?.id,
  };
  const inspect = vi.fn<LocalRecoveryController["inspectLocalRecovery"]>();
  const value = {
    recovery: state,
    inspectLocalRecovery: inspect,
    exportLocalRecovery: vi.fn(
      async (_id: string, _options?: { signal?: AbortSignal }) => ({
        fileName: "draft.spectra-recovery.json",
        blob: new Blob(["COMPLETE RETAINED BYTES"]),
      }),
    ),
    archiveAndAdoptCurrent: vi
      .fn<LocalRecoveryController["archiveAndAdoptCurrent"]>()
      .mockResolvedValue({ archivedBranchId: "one", adoptionId: "adoption" }),
    reapplyLocalRecovery: vi
      .fn<LocalRecoveryController["reapplyLocalRecovery"]>()
      .mockResolvedValue(undefined),
  };
  inspect.mockImplementation(async (id) =>
    inspection(
      value.recovery.branches.find((candidate) => candidate.id === id)!,
    ),
  );
  return value;
}

function view(
  value: LocalRecoveryController,
  artifactId = "paper",
  open = true,
) {
  return (
    <ArtifactDraftRecovery
      artifactId={artifactId}
      controller={value}
      open={open}
      onOpenChange={vi.fn()}
    />
  );
}

async function inspectFirst() {
  fireEvent.click(screen.getByRole("button", { name: /Both copies changed/ }));
  await screen.findByText("LOCAL one");
}

describe("retained local draft recovery UI", () => {
  it("dismisses a stable branch notice without losing the menu route or inspecting eagerly", async () => {
    const value = controller();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Local drafts</button>
          <ArtifactDraftRecovery
            artifactId="paper"
            controller={value}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    const { rerender } = render(<Harness />);
    expect(value.inspectLocalRecovery).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss sync notice" }),
    );
    value.recovery = {
      ...value.recovery,
      branches: [{ ...branch(), generation: "new-local-edit" }],
    };
    rerender(<Harness />);
    expect(
      screen.queryByText(
        "A local draft needs review. It is kept on this device.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Local drafts" }));
    expect(
      screen.getByRole("dialog", { name: "Local drafts" }),
    ).toBeInTheDocument();
    await inspectFirst();
    expect(value.archiveAndAdoptCurrent).not.toHaveBeenCalled();
    expect(value.reapplyLocalRecovery).not.toHaveBeenCalled();
  });

  it("applies only the selected stable regions with the exact reviewed generation and current anchor", async () => {
    const value = controller();
    const pending = deferred<void>();
    value.reapplyLocalRecovery.mockReturnValue(pending.promise);
    render(view(value));
    await inspectFirst();
    expect(screen.getByText("<script>local text</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply selected changes" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Conclusion" }));
    const apply = screen.getByRole("button", {
      name: "Apply selected changes",
    });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(value.reapplyLocalRecovery).toHaveBeenCalledTimes(1);
    expect(value.reapplyLocalRecovery).toHaveBeenCalledWith({
      branchId: "one",
      expectedGeneration: "generation-one",
      expectedCurrentAnchor: branch().currentAnchor,
      regionIds: ["paragraph-two"],
      signal: expect.any(AbortSignal),
    });
    await act(async () => pending.resolve());
    expect(
      screen.getByText(
        "Selected changes applied. Your original draft remains in Local drafts.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use current version" }),
    ).toBeDisabled();
  });

  it("does not adopt or clear the review until the atomic operation resolves, and retains it on quota failure", async () => {
    const value = controller();
    const pending = deferred<{
      archivedBranchId: string;
      adoptionId: string;
    }>();
    value.archiveAndAdoptCurrent.mockReturnValue(pending.promise);
    render(view(value));
    await inspectFirst();
    fireEvent.click(
      screen.getByRole("button", { name: "Use current version" }),
    );
    expect(value.archiveAndAdoptCurrent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Using the current version\./)).toBeNull();
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    await act(async () => pending.reject(new Error("LOCAL_QUOTA_EXCEEDED")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "isn’t enough device storage",
    );
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export draft" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Use current version" }),
    ).toBeDisabled();
  });

  it("keeps the original branch retrievable after a successful adoption", async () => {
    const value = controller();
    render(view(value));
    await inspectFirst();
    fireEvent.click(
      screen.getByRole("button", { name: "Use current version" }),
    );
    await screen.findByText(
      "Using the current version. Your original draft remains in Local drafts.",
    );
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export draft" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(value.archiveAndAdoptCurrent).toHaveBeenCalledTimes(1);
  });

  it.each(["generation", "anchor"] as const)(
    "requires another explicit review after the %s changes",
    async (kind) => {
      const value = controller();
      const { rerender } = render(view(value));
      await inspectFirst();
      fireEvent.click(screen.getByRole("checkbox", { name: "Introduction" }));
      const next =
        kind === "generation"
          ? { ...branch(), generation: "second-generation" }
          : {
              ...branch(),
              currentAnchor: { ...branch().currentAnchor!, nextSequence: 13 },
            };
      value.recovery = { ...value.recovery, branches: [next] };
      rerender(view(value));
      expect(
        screen.getByRole("button", { name: "Use current version" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Apply selected changes" }),
      ).toBeDisabled();
      expect(value.inspectLocalRecovery).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Review again" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Use current version" }),
        ).toBeEnabled(),
      );
      expect(
        screen.getByRole("checkbox", { name: "Introduction" }),
      ).not.toBeChecked();
      expect(value.archiveAndAdoptCurrent).not.toHaveBeenCalled();
    },
  );

  it("does not retry a stale rejected witness with newly published authority", async () => {
    const value = controller();
    value.reapplyLocalRecovery.mockRejectedValueOnce(
      new Error("LOCAL_RECOVERY_CURRENT_CHANGED"),
    );
    const { rerender } = render(view(value));
    await inspectFirst();
    fireEvent.click(screen.getByRole("checkbox", { name: "Introduction" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply selected changes" }),
    );
    await screen.findByText(
      "This draft or the current version changed. Review it again before applying changes.",
    );
    value.recovery = {
      ...value.recovery,
      branches: [
        {
          ...branch(),
          currentAnchor: { ...branch().currentAnchor!, nextSequence: 14 },
        },
      ],
    };
    rerender(view(value));
    expect(value.reapplyLocalRecovery).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Apply selected changes" }),
    ).toBeDisabled();
    expect(value.inspectLocalRecovery).toHaveBeenCalledTimes(1);
  });

  it("fences a late inspection after selecting a different branch", async () => {
    const value = controller([branch(), branch("two")]);
    const late = deferred<LocalRecoveryInspection>();
    value.inspectLocalRecovery.mockImplementationOnce(() => late.promise);
    render(view(value));
    fireEvent.click(
      screen.getByRole("button", { name: /Both copies changed/ }),
    );
    const oldSignal = value.inspectLocalRecovery.mock.calls[0][1]?.signal;
    fireEvent.click(
      screen.getByRole("button", { name: /Earlier local draft/ }),
    );
    await screen.findByText("LOCAL two");
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => late.resolve(inspection(branch())));
    expect(screen.queryByText("LOCAL one")).toBeNull();
    expect(screen.getByText("LOCAL two")).toBeInTheDocument();
  });

  it("fences late reads and exports across artifact changes, even when the transport ignores cancellation", async () => {
    const value = controller();
    const late = deferred<LocalRecoveryInspection>();
    value.inspectLocalRecovery.mockImplementationOnce(() => late.promise);
    const { rerender } = render(view(value));
    fireEvent.click(
      screen.getByRole("button", { name: /Both copies changed/ }),
    );
    rerender(view(controller([branch("two")]), "deck"));
    await act(async () => late.resolve(inspection(branch())));
    expect(screen.queryByText("LOCAL one")).toBeNull();
    rerender(view(value));
    await inspectFirst();
    const exported = deferred<{ fileName: string; blob: Blob }>();
    value.exportLocalRecovery.mockReturnValueOnce(exported.promise);
    fireEvent.click(screen.getByRole("button", { name: "Export draft" }));
    rerender(view(controller([branch("two")]), "deck"));
    await act(async () =>
      exported.resolve({
        fileName: "stale.json",
        blob: new Blob(["original"]),
      }),
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("hides cached current content on permission loss while leaving local inspection and complete export available", async () => {
    const value = controller();
    const { rerender } = render(view(value));
    await inspectFirst();
    value.recovery = {
      ...value.recovery,
      branches: [
        {
          ...branch(),
          canReadCurrent: false,
          canReapply: false,
          currentAnchor: undefined,
        },
      ],
    };
    rerender(view(value));
    expect(screen.queryByText("CURRENT one")).toBeNull();
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use current version" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Introduction" }),
    ).toBeDisabled();
    expect(value.exportLocalRecovery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Export draft" }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        "draft.spectra-recovery.json",
        expect.any(Blob),
      ),
    );
    const result = await value.exportLocalRecovery.mock.results[0].value;
    expect(download.mock.calls[0][1]).toBe(result.blob);
    expect(result.blob.size).toBe("COMPLETE RETAINED BYTES".length);
  });

  it("aborts pending adoption on close without reporting success or losing the retained branch", async () => {
    const value = controller();
    const pending = deferred<{
      archivedBranchId: string;
      adoptionId: string;
    }>();
    value.archiveAndAdoptCurrent.mockReturnValueOnce(pending.promise);
    const { rerender } = render(view(value));
    await inspectFirst();
    fireEvent.click(
      screen.getByRole("button", { name: "Use current version" }),
    );
    const signal = value.archiveAndAdoptCurrent.mock.calls[0][0].signal;
    rerender(view(value, "paper", false));
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve({
        archivedBranchId: "one",
        adoptionId: "adopted-after-close",
      }),
    );
    rerender(view(value));
    expect(screen.queryByText(/Using the current version\./)).toBeNull();
    await inspectFirst();
    expect(screen.getByText("LOCAL one")).toBeInTheDocument();
    expect(value.archiveAndAdoptCurrent).toHaveBeenCalledTimes(1);
  });

  it("shows finite loading, empty, and inspection failure states without applying anything", async () => {
    const value = controller([]);
    value.recovery = { state: "loading", branches: [] };
    const { rerender } = render(view(value));
    expect(screen.getByText("Loading local drafts…")).toBeInTheDocument();
    value.recovery = { state: "ready", branches: [] };
    rerender(view(value));
    expect(
      screen.getByText("No local drafts need recovery on this device."),
    ).toBeInTheDocument();
    value.recovery = {
      state: "review_required",
      branches: [branch()],
      activeBranchId: "one",
    };
    value.inspectLocalRecovery.mockRejectedValueOnce(
      new Error("device read failed"),
    );
    rerender(view(value));
    fireEvent.click(
      screen.getByRole("button", { name: /Both copies changed/ }),
    );
    await screen.findByText(
      "Could not review this draft. Your local draft is still available. Try again when you’re ready.",
    );
    expect(screen.getByRole("button", { name: "Export draft" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    await screen.findByText("LOCAL one");
    expect(value.archiveAndAdoptCurrent).not.toHaveBeenCalled();
  });
});
