import { humanizePublicFailure } from "../../bridge/humanize";

export type LiveDockTruthState =
  | "working"
  | "waiting"
  | "needs_input"
  | "completing"
  | "completed"
  | "completed_limited"
  | "paused"
  | "reconnecting"
  | "cancelled"
  | "failed_terminal";

export type LiveDockInputRequest =
  | { kind: "approval"; prompt: string }
  | {
      kind: "choice";
      messageId?: string;
      clarificationId?: string;
      executionId?: string;
      prompt: string;
      options: Array<{ key?: string; title: string; displayTitle?: string; description?: string | null }>;
    }
  | {
      kind: "choice_batch";
      messageId?: string;
      clarificationId?: string;
      executionId?: string;
      questions: Array<{
        id: string;
        prompt: string;
        options: Array<{ key?: string; title: string; displayTitle?: string; description?: string | null }>;
      }>;
    }
  | { kind: "short_answer"; prompt: string }
  | { kind: "file"; prompt: string; accept?: string };

export type LiveDockTabSource = {
  runId: string;
  threadId: string;
  threadTitle?: string;
  run: {
    status: string;
    phase?: string;
    decision?: string;
    finalSummary?: string;
    error?: string;
    retryable?: boolean;
    traceDegraded?: boolean;
    userPrompt?: string;
  };
  card?: {
    title?: string;
    summary?: string;
    actions?: Array<{ key: string }>;
    provenance?: { attachmentNames?: string[]; artifactTitles?: string[] };
  } | null;
  checkpointSummary?: string;
  recentSteps?: string[];
  inputRequest?: LiveDockInputRequest | null;
};

export type LiveDockLayout = {
  runId: string;
  minWidth: number;
  preferredWidth: number;
  expanded: boolean;
};

const phaseSteps: Record<string, string> = {
  created: "Preparing the run",
  preparing: "Preparing your context",
  planning: "Planning the next useful step",
  reading: "Reading the selected work",
  retrieving: "Finding the relevant context",
  creating: "Creating the requested work",
  updating: "Updating the selected work",
  applying: "Applying the verified changes",
  streaming: "Writing the response",
  checking: "Checking the result",
  approval: "Ready for your confirmation",
  conflict: "Waiting to resolve an edit conflict",
  interrupted: "Reconnecting to continue",
  partial: "Completed with limitations",
  stopped: "Stopped",
  failed: "Could not finish",
  completed: "Completed",
};

/* The one vocabulary for run truth (CANON R13): the dock, the run panel and
   any future surface label the same state with the same plain words. */
export const liveDockStateCopy: Record<LiveDockTruthState, string> = {
  working: "Working",
  waiting: "Waiting",
  needs_input: "Needs input",
  completing: "Checking",
  completed: "Completed",
  completed_limited: "Completed with limits",
  paused: "Paused",
  reconnecting: "Reconnecting",
  // The control says "Stop" and the run reports "Stopped by you": one word.
  cancelled: "Stopped",
  failed_terminal: "Could not finish",
};

function compactText(value: string | undefined) {
  return value
    ?.replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function publicSpectraFailureText(
  value: string | undefined,
  retryable = true,
) {
  const fallback = retryable
    ? "Spectra paused before finishing. Select Retry when you’re ready."
    : "Spectra could not finish this request. Ask again, or rephrase it with more detail.";
  const clean = compactText(value);
  if (!clean) return fallback;
  return humanizePublicFailure(clean);
}

function distinct(value: string | undefined, title: string) {
  const clean = compactText(value);
  return clean && clean.toLocaleLowerCase() !== title.toLocaleLowerCase()
    ? clean
    : null;
}

export function deriveLiveDockTab(source: LiveDockTabSource) {
  const rawTitle =
    source.threadTitle?.trim() || source.card?.title?.trim() || "";
  const genericTitle =
    !rawTitle ||
    ["conversation", "new conversation", "spectra", "starting run"].includes(
      rawTitle.toLocaleLowerCase(),
    );
  const promptTitle = (compactText(source.run.userPrompt) ?? "")
    .replace(/[.!?].*$/, "")
    .slice(0, 56);
  const titlePending =
    genericTitle && ["queued", "running"].includes(source.run.status);
  const title = genericTitle
    ? titlePending
      ? "Starting run"
      : promptTitle || "Completed run"
    : rawTitle;
  const clarification =
    source.run.finalSummary ||
    source.card?.summary ||
    "What should Spectra use to continue?";
  const inputRequest =
    source.inputRequest ??
    (source.run.status === "awaiting_confirmation"
      ? {
          kind: "approval" as const,
          prompt:
            source.card?.summary ||
            "Review the proposed changes before they are applied.",
        }
      : source.run.decision === "clarify"
        ? /\b(?:attach|upload|file|pdf|document|image|spreadsheet|presentation)\b/i.test(
            clarification,
          )
          ? { kind: "file" as const, prompt: clarification }
          : { kind: "short_answer" as const, prompt: clarification }
        : null);
  const checkpointSummary = distinct(
    source.checkpointSummary ?? source.recentSteps?.at(-1),
    title,
  );
  let state: LiveDockTruthState;
  if (inputRequest || source.run.decision === "clarify") state = "needs_input";
  else if (source.run.status === "queued" || source.run.status === "running")
    state =
      source.run.phase === "checking"
        ? "completing"
        : source.run.phase === "interrupted"
          ? "reconnecting"
          : source.run.phase === "conflict"
            ? "waiting"
            : "working";
  else if (source.run.status === "awaiting_resolution") state = "waiting";
  else if (source.run.status === "cancelled") state = "cancelled";
  else if (source.run.status === "failed")
    state = source.run.retryable ? "paused" : "failed_terminal";
  else if (source.run.traceDegraded || source.run.phase === "partial")
    state = "completed_limited";
  else state = "completed";

  const undone = (source.card?.actions ?? []).some(
    (action) => action.key === "undone",
  );
  const cardSummary = distinct(source.card?.summary, title);
  const finalSummary = distinct(source.run.finalSummary, title);
  const semanticStep = undone
    ? "Undone"
    : state === "needs_input"
      ? "Ready for your input"
      : state === "completed" || state === "completed_limited"
        ? finalSummary ||
          cardSummary ||
          phaseSteps[source.run.phase ?? "completed"]
        : checkpointSummary ||
          cardSummary ||
          phaseSteps[source.run.phase ?? source.run.status] ||
          "Working on the request";
  const failureSummary =
    state === "paused" || state === "failed_terminal"
      ? publicSpectraFailureText(source.run.error, state === "paused")
      : null;
  const expandedSummary =
    failureSummary ||
    checkpointSummary ||
    finalSummary ||
    cardSummary ||
    semanticStep;
  return {
    title,
    titlePending,
    state,
    semanticStep: semanticStep.slice(0, 240),
    expandedSummary: expandedSummary.slice(0, 800),
    finalSummary: (
      failureSummary ||
      finalSummary ||
      cardSummary ||
      semanticStep
    ).slice(0, 800),
    hoverSummary: expandedSummary.slice(0, 800),
    undone,
    recentSteps: (source.recentSteps ?? [])
      .flatMap((step) => {
        const clean = distinct(step, title);
        return clean ? [clean] : [];
      })
      .slice(-8),
    inputRequest,
    attachmentNames:
      source.card?.provenance?.attachmentNames?.slice(0, 8) ?? [],
    targetNames: source.card?.provenance?.artifactTitles?.slice(0, 4) ?? [],
  };
}

export function selectExpandedInputRun(
  sources: readonly LiveDockTabSource[],
  current: string | null,
) {
  const waiting = sources.filter(
    (source) => deriveLiveDockTab(source).state === "needs_input",
  );
  if (current && waiting.some((source) => source.runId === current))
    return current;
  return waiting[0]?.runId ?? null;
}

/** Tab geometry is CSS: fixed readable width, then the strip scrolls. */
export function allocateLiveDockWidths(
  sources: readonly LiveDockTabSource[],
  expandedRunId: string | null,
): LiveDockLayout[] {
  return sources.map((source) => ({
    runId: source.runId,
    minWidth: 0,
    preferredWidth: 0,
    expanded: source.runId === expandedRunId,
  }));
}

export function closePreservesRunningJob(source: LiveDockTabSource) {
  return (
    source.run.status === "queued" ||
    source.run.status === "running" ||
    source.run.status === "awaiting_confirmation" ||
    source.run.status === "awaiting_resolution"
  );
}

/** Run persistence and panel visibility are deliberately independent. */
export function shouldAutoOpenConversationAfterSend() {
  return false;
}
