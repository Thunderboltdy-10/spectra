import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateLiveDockWidths,
  closePreservesRunningJob,
  deriveLiveDockTab,
  publicSpectraFailureText,
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
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    const ready = shell.slice(
      shell.indexOf("onThreadReady:"),
      shell.indexOf("onContinuationConflict:"),
    );
    expect(ready).not.toContain("setLiveThread(");
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).not.toContain("autoOpenedLiveRuns");
  });

  it.each([
    { outcome: "canonical_saved", nativeSync: null, says: "Updated the essay.", never: /computer/ },
    { outcome: "native_pending", nativeSync: "pending", says: "hasn't confirmed this change yet", never: /checked in/ },
    { outcome: "native_verified", nativeSync: "verified", says: "checked in the file on your computer", never: /hasn't confirmed/ },
    { outcome: "native_superseded", nativeSync: "superseded", says: "A newer edit replaced this change", never: /hasn't confirmed|checked in/ },
  ])("tells the student the native file truth for $outcome", ({ outcome, nativeSync, says, never }) => {
    const model = deriveLiveDockTab(source({
      run: { status: "completed", phase: "completed", finalSummary: "Updated the essay.", outcome },
    }));
    expect(model.state).toBe("completed");
    expect(model.nativeSync).toBe(nativeSync);
    expect(model.finalSummary).toContain(says);
    expect(model.finalSummary).toContain("Updated the essay.");
    expect(`${model.finalSummary} ${model.semanticStep}`).not.toMatch(never);
    expect(`${model.finalSummary} ${model.semanticStep}`).not.toMatch(/native|Bridge|verified|pending/i);
  });

  it("does not claim a native file state for a stopped or failed run", () => {
    for (const status of ["cancelled", "failed"]) {
      const model = deriveLiveDockTab(source({ run: { status, outcome: "native_verified" } }));
      expect(model.nativeSync).toBeNull();
      expect(model.finalSummary).not.toContain("computer");
    }
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

  it("does not leave a completed run labelled as starting", () => {
    const model = deriveLiveDockTab(
      source({
        threadTitle: "Starting run",
        card: { title: "Spectra", summary: "Finished the comparison." },
        run: { status: "completed", userPrompt: "Compare the evidence" },
      }),
    );
    expect(model.title).toBe("Compare the evidence");
    expect(model.titlePending).toBe(false);
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
    expect(dock).toContain("spectra-live-dock-hover");
    expect(dock).toContain("ProgressTrace");
    expect(dock).toContain("OverflowMenu");
    expect(dock).toContain("Open chat for");
    expect(dock).toContain("dock-tab-identity min-w-0 flex-1");
    const css = read("src/styles/spectra-app.css");
    expect(css).toContain("min-width: calc((100% - 12px) / 3)");
    expect(css).toContain("flex: 1 1 calc((100% - 12px) / 3)");
    expect(css).not.toContain("flex: 1 1 240px");
    expect(css).toContain(
      '[data-studio-mode="tab"][data-blueprint="document"]',
    );
    expect(css).not.toContain("min-height: 52px !important");
    expect(css).toContain(".spectra-run-tab-strip::-webkit-scrollbar {");
    expect(css).toContain(".spectra-live-dock-progress::-webkit-scrollbar {");
    expect(css).not.toMatch(
      /\.spectra-run-tab-strip::-webkit-scrollbar,\s*\.spectra-live-dock-progress::-webkit-scrollbar/,
    );
  });

  it("marks a reverted run as undone", () => {
    const model = deriveLiveDockTab(
      source({
        run: { status: "completed", phase: "completed" },
        card: {
          title: "Compare the evidence",
          summary: "Restored the earlier copy of this work.",
          actions: [{ key: "undone" }],
        },
      }),
    );
    expect(model.undone).toBe(true);
    expect(model.semanticStep).toBe("Undone");
    expect(model.state).toBe("completed");
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
    expect(runHook).toContain("displayedRunVersions");
    expect(runHook).not.toContain("force: true");
    expect(runHook).toContain("let targetThreadId = target?.threadId");
    expect(runHook).toContain("threadId: targetThreadId");
    expect(runHook).toContain("mergeContinuationAttachments");
    expect(runHook).toContain("attachmentsByThreadId.current.get(targetThreadId)");
    const surface = read(
      "src/features/spectra/components/conversation-surface.tsx",
    );
    expect(surface).toContain("export function ThreadConversation");
    expect(surface).toContain("onSteer={runEngine.steer}");
    expect(surface).toContain('from "./progress-trace"');
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("ThreadConversation");
  });

  it("keeps explicit New thread and touch/keyboard disclosure paths", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain('aria-label="Start a new chat"');
    expect(dock).toContain("> Respond");
    expect(dock).toContain("visible.length === 0 && !openChat) return null");
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(shell).toContain("function startFreshComposerThread() ");
    expect(shell).toContain(
      "skipAutoContinueThreadIdRef.current = liveThread.id",
    );
    expect(shell).toContain("threadId: composerThread?.id ?? null");
    // The thread panel's width state is its intent; the row allocator turns
    // intents into actual widths (`allocateWorkbenchPanes`).
    expect(shell).toContain("width={paneWidths.thread ?? liveThreadPanelWidth}");
    expect(shell).toContain('notePaneIntent("thread", next)');
    const runHook = read("src/features/spectra/ai/use-spectra-run.ts");
    expect(runHook).toContain("options?.threadId === null");
    expect(dock).toContain("dock-tab-identity min-w-0 flex-1 py-1 text-left");
    expect(dock).toContain("onPointerEnter={() => openTabHover(tab.runId)}");
    expect(dock).toContain("persistKey={tab.runId}");
    expect(dock).toContain("max-sm:fixed");
    expect(dock).toContain("data-mobile-sheet");
  });

  it("marks only the continued thread tab with a blue left-edge affordance", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("const active = continuation?.id === tab.threadId");
    expect(dock).toContain("data-continued={active || undefined}");
    // New chat clears continuation; no tab keeps data-continued without it.
    expect(dock).not.toContain("border-l-[3px] border-cyan");
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(shell).toContain("function startFreshComposerThread()");
    expect(shell).toContain("setComposerThread(null)");
    const css = read("src/styles/spectra-app.css");
    expect(css).toContain(".spectra-live-dock-tab[data-continued]");
    expect(css).toContain("inset 3px 0 var(--accent-cyan)");
  });

  it("keeps Live Dock tabs off /chat and on the work surfaces", () => {
    // /chat is the conversation, so a floating rail of running conversations
    // would restate the page. Library and Workspace are one shell now, and it
    // mounts the dock through WorkbenchDockShell; the routes that own no
    // workbench of their own get it from GlobalRouteWorkbench instead.
    const chat = read("src/features/spectra/pages/chat-shell.tsx");
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    const global = read(
      "src/features/spectra/components/global-route-workbench.tsx",
    );
    expect(chat).not.toContain("LiveDock");
    expect(shell).toContain("<WorkbenchDockShell");
    expect(global).toContain("<LiveDock");
    expect(global).toContain('"/library"');
    expect(global).toContain('"/workspace"');
  });

  it("keeps conversation and Stop immediate, with Follow Undo and Close in the shared overflow", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("data-spectra-follow-control");
    expect(dock).toContain("Follow AI");
    expect(dock).toContain("icon: Crosshair");
    expect(dock).toContain("followAiActor(tab.runId)");
    expect(dock).toContain('aria-label={`Open chat for ${model.title}`}');
    expect(dock).toContain('title="Stop"');
    expect(dock).toContain("OverflowMenu");
    expect(dock).toContain("Undo this run");
    expect(dock).toContain("Close tab");
    expect(dock).toContain('side="top"');
    expect(dock).toContain('layer="toast"');
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("followAiActor(actor)");
    expect(panel).toContain("runIdForLiveThread(threadId)");
    const presence = read(
      "src/features/spectra/components/collaboration-presence.tsx",
    );
    expect(presence).toContain("followAiActor(aiActorId)");
    expect(presence).toContain("collapseCollaborators");
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).toContain("<AppChoreographyMount");
  });

  it("polls active run tabs promptly without making idle surfaces noisy", () => {
    const dock = read("src/features/spectra/components/live-dock.tsx");
    expect(dock).toContain("SYNC_RETRY_POLICY.activeRunPollMaxDelayMs");
    expect(dock).toContain("syncRetryDelayMs(");
    expect(dock).toContain("window.setTimeout(");
    expect(dock).not.toContain("window.setInterval(");
    expect(dock).toContain("activePollSignature");
    expect(dock).toContain("const runChanged = () => void refresh();");
    expect(dock).toContain('spectraBus.on("run.changed", runChanged)');
    expect(dock).toContain("let refreshGeneration = 0;");
    expect(dock).toContain("if (generation < appliedRefreshGeneration) return;");
    expect(dock).not.toContain("refreshRunTabs(), 180_000");
    const runHook = read("src/features/spectra/ai/use-spectra-run.ts");
    expect(runHook).toContain("Date.now() - tabsFetchedAt >=");
    expect(runHook).toContain("180_000");
    expect(runHook).not.toContain(": 12_000");
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).toContain("getSpectraNotificationCenter(false, 30)");
    expect(shell).toContain("}, 180_000);");
    expect(shell).not.toContain("}, 60_000);");
    const context = read("src/features/spectra/hooks/use-spectra-context.ts");
    expect(context).toContain("if (!next?.runId && !next?.id) return;");
    const controls = read(
      "src/features/spectra/components/context-controls.tsx",
    );
    expect(controls).toContain("if (next?.runId)");
    const bridge = read("src/features/spectra/bridge/use-bridge.ts");
    // Bridge checks start at 15 s and back off while Bridge is unreachable
    // (LV-012); a hidden page is never polled.
    expect(bridge).toContain("bridgeDiscoveryDelay(misses)");
    expect(bridge).toContain(
      'if (document.visibilityState === "visible") void check(false);',
    );
    expect(read("src/features/spectra/bridge/client.ts")).toContain(
      "BRIDGE_DISCOVERY_INTERVAL_MS = 15_000",
    );
  });

  it("keeps the command bar on its established surface and gives it a quiet trigger", () => {
    const kbar = read("src/features/spectra/components/universal-kbar.tsx");
    expect(kbar).toContain('spectraBus.on("shell.openCommandBar", openKBar)');
    // The bar is the shared Dialog (modal layer, focus trap and return),
    // placed high on the page rather than centred.
    expect(kbar).toContain('from "@/components/ui/dialog"');
    expect(kbar).toContain("<DialogTitle className=\"sr-only\">Spectra command bar</DialogTitle>");
    expect(kbar).toContain("top-[12vh] max-w-2xl translate-y-0");
    expect(kbar).not.toContain("useModalFocus");
    expect(kbar).toContain("border-0 bg-transparent");
    expect(kbar).toContain("focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none");
    expect(kbar).not.toContain("spectra-command-palette");
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).toContain('aria-label="Open Spectra command bar"');
    expect(shell).toContain('spectraBus.emit("shell.openCommandBar", {})');
    const shortcuts = read("src/components/keyboard-shortcuts.tsx");
    expect(shortcuts).toContain('keys: ["Mod", "Shift", "F"]');
    expect(shortcuts).toContain('className={compact ? "size-8 border-0" : undefined}');
  });

  it("never shows machine tokens in dock failure copy", () => {
    for (const token of [
      "AI_ARTIFACT_CONNECTION_CLOSED",
      "LOCAL_REPLICA_UNAVAILABLE",
    ]) {
      const spoken = publicSpectraFailureText(token);
      expect(spoken).not.toContain(token);
      expect(spoken).not.toMatch(/[A-Z]{3,}_[A-Z0-9_]{3,}/);
    }
  });

  it("keeps side-panel display separate from composer history and restores saved threads by id", () => {
    const context = read("src/features/spectra/hooks/use-spectra-context.ts");
    expect(context).toContain("{ threadId: next.id }");
    // Opening a thread is not opening a work: the shell routes a thread
    // reference to the side panel and never into the studio, so the panel and
    // the composer's own history stay separate surfaces.
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(shell).toContain('if (artifact.blueprintKey === "thread_reference")');
    expect(shell).toContain("setLiveThread({ id: threadId, title: artifact.title })");
    const panel = read("src/features/spectra/components/live-thread-panel.tsx");
    expect(panel).toContain("Continue this chat in the Live Dock");
  });
});
