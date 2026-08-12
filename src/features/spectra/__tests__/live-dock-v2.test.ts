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
      provenance: { attachmentNames: ["rubric.pdf"], artifactTitles: ["Research notes"] },
    },
    ...overrides,
  };
}

describe("Live Dock V2", () => {
  it("keeps send and panel visibility independent", () => {
    expect(shouldAutoOpenConversationAfterSend()).toBe(false);
    const workspace = read("src/features/spectra/pages/workspace-shell.tsx");
    const ready = workspace.slice(workspace.indexOf("onThreadReady:"), workspace.indexOf("onContinuationConflict:"));
    expect(ready).not.toContain("setLiveThread(");
    const legacy = read("src/features/spectra/components/durable-run-tabs.tsx");
    expect(legacy).toContain('LiveDock as DurableRunTabs');
    expect(legacy).not.toContain("autoOpenedLiveRuns");
  });

  it("derives distinct title, semantic step, hover summary, targets, and attachments", () => {
    const model = deriveLiveDockTab(source());
    expect(model.title).toBe("Compare the evidence");
    expect(model.semanticStep).toBe("Reading three primary sources and checking their dates.");
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
    [{ status: "completed", phase: "partial", traceDegraded: true }, "completed_limited"],
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
      expect.objectContaining({ runId: "b", minWidth: 320 }),
    ]);
    expect(layout.find((item) => item.runId === "a")?.minWidth).toBe(176);
  });

  it("keeps close and cancel semantics separate", () => {
    expect(closePreservesRunningJob(source())).toBe(true);
    expect(closePreservesRunningJob(source({ run: { status: "completed" } }))).toBe(false);
  });

  it("persists choice input and steering while sharing the conversation renderer", () => {
    const runs = read("convex/spectraRuns.ts");
    expect(runs).toContain('.query("spectraMessages")');
    expect(runs).toContain("inputRequest");
    const route = read("src/app/api/spectra/run/route.ts");
    expect(route).toContain('type: "steer_queued"');
    expect(route).toContain('applyAt: "next_safe_boundary"');
    const surface = read("src/features/spectra/components/conversation-surface.tsx");
    expect(surface).toContain("export function ThreadConversation");
    expect(surface).toContain("onSteer={runEngine.steer}");
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("ThreadConversation");
  });

  it("keeps explicit New thread and touch/keyboard disclosure paths", () => {
    const command = read("src/features/spectra/components/command-bar.tsx");
    expect(command).toContain('aria-label="Start a new thread"');
    const workspace = read("src/features/spectra/pages/workspace-shell.tsx");
    expect(workspace).toContain("function startFreshComposerThread() ");
    expect(workspace).toContain(
      "skipAutoContinueThreadIdRef.current = liveThread.id",
    );
    expect(workspace).toContain("threadId: composerThread?.id ?? null");
    expect(workspace).toContain("width={liveThreadPanelWidth}");
    const runHook = read("src/features/spectra/ai/use-spectra-run.ts");
    expect(runHook).toContain("options?.threadId === null");
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("group-focus-within:block");
    expect(dock).toContain("max-sm:fixed");
    expect(dock).toContain("data-mobile-sheet");
  });
});
