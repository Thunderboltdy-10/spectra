"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSpectraRun } from "../ai/use-spectra-run";
import { spectraBus } from "../events";
import { WorkbenchLiveStack } from "../pages/workbench-live-stack";
import {
  CommandBar,
  type CommandAttachment,
} from "./command-bar";
import {
  ContextFocusControl,
  type ComposerFocusMode,
} from "./context-controls";
import { LiveDock } from "./live-dock";

const ROUTES_WITH_LOCAL_WORKBENCH = [
  "/chat",
  "/workspace",
  "/library",
  "/agents",
];

function ownsWorkbench(pathname: string) {
  return ROUTES_WITH_LOCAL_WORKBENCH.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The product-wide work layer for routes whose primary page is not itself a
 * workbench. It keeps runs on the current page, and delegates opened work and
 * conversations to the shared route side-panel host.
 */
export function GlobalRouteWorkbench() {
  const pathname = usePathname();
  const [focusMode, setFocusMode] = useState<ComposerFocusMode>("global");
  const [continuedThread, setContinuedThread] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [attachmentsHost, setAttachmentsHost] =
    useState<HTMLDivElement | null>(null);
  const eligible = !ownsWorkbench(pathname);
  const runEngine = useSpectraRun({
    surface: "chat",
    focusMode,
    currentView: pathname,
    observeDurableRuns: eligible,
    onOpenArtifact: async (workId) => {
      await spectraBus.command("work.open", { workId, surface: "panel" });
    },
    onThreadReady: async (threadId) => {
      await spectraBus.command("run.openConversation", {
        runId: threadId,
        threadId,
      });
    },
  });

  useEffect(() => {
    if (!eligible) return;
    return spectraBus.handle("run.stopRequested", ({ runId }) => {
      if (runId && runEngine.activeRunId && runEngine.activeRunId !== runId) return;
      void runEngine.stop(runId);
    });
  }, [eligible, runEngine]);

  if (!eligible) return null;

  const run = (
    prompt: string,
    attachments: CommandAttachment[],
    threadId?: string,
    continuation?: { clarificationId?: string; choiceKey?: string; choiceMessageId?: string; executionId?: string },
  ) =>
    runEngine.run(
      prompt,
      attachments,
      threadId ? { threadId, ...continuation } : continuation,
    );

  return (
    <WorkbenchLiveStack>
      <div ref={setAttachmentsHost} />
      <LiveDock
        optimistic={runEngine.liveExchange}
        openThreadId={continuedThread?.id}
        onStartNewThread={() => setContinuedThread(null)}
        onOpen={(runId, threadId, title, artifactId) => {
          setContinuedThread({ id: threadId, title });
          void spectraBus.command("run.openConversation", {
            runId,
            threadId,
          });
          if (artifactId)
            void spectraBus.command("work.open", {
              workId: artifactId,
              surface: "panel",
            });
        }}
        onContinue={(_runId, threadId, title) =>
          setContinuedThread({ id: threadId, title })
        }
        onDeselect={() => setContinuedThread(null)}
        onStop={runEngine.stop}
        onRetry={(runId) => void runEngine.retry(runId)}
        onAction={(card, action) =>
          void runEngine.onCardAction(card, action, card.runId)
        }
        onRevise={(card, revision) => void runEngine.revise(card, revision)}
        onInput={(threadId, response, attachments, continuation) =>
          run(response, attachments ?? [], threadId, continuation)
        }
      />
      <CommandBar
        className="pointer-events-auto"
        allowAttachments
        attachmentsPortalTarget={attachmentsHost}
        placeholder={
          continuedThread
            ? `Continue ${continuedThread.title}...`
            : "Ask Spectra from this page..."
        }
        busy={runEngine.submitting}
        allowConcurrent={!continuedThread}
        activeRunId={runEngine.activeRunId}
        onStop={runEngine.stop}
        onSteer={runEngine.steer}
        onSubmit={(prompt, attachments) =>
          run(prompt, attachments, continuedThread?.id)
        }
        context={
          <ContextFocusControl mode={focusMode} onModeChange={setFocusMode} />
        }
      />
    </WorkbenchLiveStack>
  );
}
