import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateLiveDockWidths,
  closePreservesRunningJob,
  deriveLiveDockTab,
  selectExpandedInputRun,
  shouldAutoOpenConversationAfterSend,
  type LiveDockTabSource,
} from "../runs/live-dock";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

function source(overrides: Partial<LiveDockTabSource> = {}): LiveDockTabSource {
  return {
    runId: "run-1",
    threadId: "thread-1",
    threadTitle: "Compare the evidence",
    run: { status: "running", phase: "retrieving" },
    card: {
      title: "Compare the evidence",
      summary: "Reading three primary sources and checking their dates.",
      provenance: {
        attachmentNames: ["rubric.pdf"],
        artifactTitles: ["Research notes"],
      },
    },
    ...overrides,
  };
}

describe("Live Dock V2", () => {
  it("keeps send and panel visibility independent", () => {
    expect(shouldAutoOpenConversationAfterSend()).toBe(false);
    const workspace = read("src/features/spectra/pages/workspace-shell.tsx");
    const ready = workspace.slice(
      workspace.indexOf("onThreadReady:"),
      workspace.indexOf("onContinuationConflict:"),
    );
    expect(ready).not.toContain("setLiveThread(");
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).not.toContain("autoOpenedLiveRuns");
  });

  it("derives distinct title, semantic step, hover summary, targets, and attachments", () => {
    const model = deriveLiveDockTab(source());
    expect(model.title).toBe("Compare the evidence");
    expect(model.semanticStep).toBe(
      "Reading three primary sources and checking their dates.",
    );
    expect(model.semanticStep).not.toBe(model.title);
    expect(model.hoverSummary).toContain("primary sources");
    expect(model.attachmentNames).toEqual(["rubric.pdf"]);
    expect(model.targetNames).toEqual(["Research notes"]);
  });

  it.each([
    [{ status: "running", phase: "reading" }, "working"],
    [{ status: "running", phase: "checking" }, "completing"],
    [{ status: "running", phase: "interrupted" }, "reconnecting"],
    [{ status: "awaiting_resolution", phase: "conflict" }, "waiting"],
    [
      { status: "completed", phase: "partial", traceDegraded: true },
      "completed_limited",
    ],
    [{ status: "cancelled" }, "cancelled"],
    [{ status: "failed", retryable: true }, "paused"],
    [{ status: "failed", retryable: false }, "failed_terminal"],
  ] as const)("maps %o to the truthful %s state", (run, expected) => {
    expect(deriveLiveDockTab(source({ run })).state).toBe(expected);
  });

  it("expands only one required-input run and compresses its peers", () => {
    const a = source({
      runId: "a",
      inputRequest: { kind: "approval", prompt: "Apply the changes?" },
    });
    const b = source({
      runId: "b",
      threadId: "thread-b",
      inputRequest: {
        kind: "choice",
        prompt: "Choose a format",
        options: [{ title: "Document" }, { title: "Presentation" }],
      },
    });
    const c = source({ runId: "c", threadId: "thread-c" });
    expect(selectExpandedInputRun([a, b, c], "b")).toBe("b");
    const layout = allocateLiveDockWidths([a, b, c], "b");
    expect(layout.filter((item) => item.expanded)).toEqual([
      expect.objectContaining({ runId: "b" }),
    ]);
    expect(layout.find((item) => item.runId === "a")?.expanded).toBe(false);
  });

  it("lets CSS size tabs from the strip rather than hardcoded pixel widths", () => {
    const one = allocateLiveDockWidths([source()], null);
    const two = allocateLiveDockWidths(
      [source({ runId: "a" }), source({ runId: "b" })],
      null,
    );
    const many = allocateLiveDockWidths(
      Array.from({ length: 7 }, (_, index) =>
        source({ runId: `run-${index}`, threadId: `thread-${index}` }),
      ),
      null,
    );
    expect(one[0]?.preferredWidth).toBe(0);
    expect(two.map((item) => item.preferredWidth)).toEqual([0, 0]);
    expect(many.every((item) => item.preferredWidth === 0)).toBe(true);
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("spectra-live-dock-tab");
    expect(dock).toContain("group-has-[.dock-tab-icon:hover]:hidden");
  });

  it("keeps close and cancel semantics separate", () => {
    expect(closePreservesRunningJob(source())).toBe(true);
    expect(
      closePreservesRunningJob(source({ run: { status: "completed" } })),
    ).toBe(false);
  });

  it("persists choice input and steering while sharing the conversation renderer", () => {
    const runs = read("convex/spectraRuns.ts");
    expect(runs).toContain('.query("spectraMessages")');
    expect(runs).toContain("inputRequest");
    const runHook = read("src/features/spectra/ai/use-spectra-run.ts");
    expect(runHook).toContain(
      'body: JSON.stringify({ action: "stop", runId })',
    );
    expect(runHook).toContain("threadId: target.threadId");
    const surface = read(
      "src/features/spectra/components/conversation-surface.tsx",
    );
    expect(surface).toContain("export function ThreadConversation");
    expect(surface).toContain("onSteer={runEngine.steer}");
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("ThreadConversation");
  });

  it("keeps explicit New thread and touch/keyboard disclosure paths", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain('aria-label="Start a new thread"');
    expect(dock).toContain("> Respond");
    expect(dock).toContain("visible.length === 0) return null");
    const workspace = read("src/features/spectra/pages/workspace-shell.tsx");
    expect(workspace).toContain("function startFreshComposerThread() ");
    expect(workspace).toContain(
      "skipAutoContinueThreadIdRef.current = liveThread.id",
    );
    expect(workspace).toContain("threadId: composerThread?.id ?? null");
    expect(workspace).toContain("width={liveThreadPanelWidth}");
    const runHook = read("src/features/spectra/ai/use-spectra-run.ts");
    expect(runHook).toContain("options?.threadId === null");
    expect(dock).toContain("group-focus-within:block");
    expect(dock).toContain("max-sm:fixed");
    expect(dock).toContain("data-mobile-sheet");
  });

  it("keeps Live Dock tabs off /chat and on Workspace and Library", () => {
    const chat = read("src/features/spectra/pages/chat-shell.tsx");
    const workspace = read("src/features/spectra/pages/workspace-shell.tsx");
    const library = read("src/features/spectra/pages/artifacts-shell.tsx");
    expect(chat).not.toContain("<LiveDock");
    expect(workspace).toContain("<LiveDock");
    expect(library).toContain("<LiveDock");
  });

  it("keeps side-panel display separate from composer history and restores saved threads by id", () => {
    const context = read("src/features/spectra/hooks/use-spectra-context.ts");
    expect(context).toContain("{ threadId: next.id }");
    const library = read("src/features/spectra/pages/artifacts-shell.tsx");
    expect(library).not.toContain("if (!liveThread) return;");
    expect(library).toContain(
      'studio.activeArtifact?.blueprintKey !== "thread_reference"',
    );
    expect(library).toContain('artifact.blueprintKey !== "thread_reference"');
    expect(library).toContain('label: "Threads"');
    expect(library).toContain("count: libraryThreads.length");
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("Continue this thread in the Live Dock");
  });
});
