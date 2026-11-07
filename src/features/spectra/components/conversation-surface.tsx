"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Code2, Loader2, ShieldCheck, AlertCircle, Bot, Check, ChevronDown, ExternalLink, FileText, FolderPlus, Star, ArrowDown, CircleDot, GitCompareArrows, Undo2, Wrench } from "@/components/icons/glyph-icons";
import { toast } from "@/components/ui/toast";
import { SpectraMark } from "@/components/spectra-mark";
import { PrismLoader, type PrismOptics } from "@/components/spectra-prism-optic";
import { SpectraRichContent, type CitationSource } from "./spectra-rich-content";
import { useStreamingReveal } from "../runs/streaming/use-streaming-reveal";
import { spectraBus } from "../events";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select";
import { useSpectraRun, type SpectraLiveExchange } from "../ai/use-spectra-run";
import { isSettledAiRunStatus, isWorkingAiRunStatus } from "../core";
import { operationCounts, useRunLedger } from "../collaboration/run-ledger";
import { openTraceWhenShown, ProgressTrace, WorkedForReveal } from "./progress-trace";
import {
  clearSpectraRunAgent,
  getSpectraOperationConflict,
  getSpectraThread,
  getSpectraThreadMessages,
  getSpectraThreadRunTrace,
  postSpectra,
  resolveSpectraOperationConflict,
  submitSpectraAgentFeedback,
  type SpectraArtifact,
  type SpectraOperation,
  type SpectraRun,
  type SpectraThreadDetail,
  type SpectraThreadTrace,
  type SpectraWorkspace,
} from "../data/api";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { useWorkspaceCatalog } from "../data/use-catalog-pages";
import { CatalogProgress } from "./catalog-progress";
import { ResultCardStack } from "./result-card";
import { workTypeMeta } from "./artifact-card";
import { ArtifactEmbedList, useArtifactEmbedContainer } from "./artifact-embed-host";
import { isReplyEmbedRegion, replyEmbedRegion } from "../../../../shared/artifact-embed";
import { publicSpectraFailureText } from "../runs/live-dock";
import { BatchedChoiceBlock, ChoiceBlock } from "./conversation-choice";
import { compareConflictRegions } from "../collaboration/region-text";
import { Icon } from "@/components/icons";
import { runTabCard, useRunTabs } from "../island/run-tabs";
import { AnsweredInputs, HarnessInputPanel, WorkTouchCards, messageTouches } from "./harness-run-parts";
import { HarnessWidgets, messageWidgets } from "./thread-widget";
import { answerLabel, forgetAnswered, liveAnswerKey, noteAnswered, useAnsweredNotes } from "../ai/answered-inputs";
import { applyHarnessEvent, isHarnessExchangeEvent, replyBlocks, type HarnessAnswerValue, type HarnessExchangeFields } from "../ai/harness-exchange";
import { parseSpectraStreamEvent, type HarnessArtifactTouchView } from "../ai/stream-events";

function operationLabel(
  operation: SpectraThreadTrace["operations"][number],
  artifacts: SpectraArtifact[],
) {
  const input =
    operation.input &&
    typeof operation.input === "object" &&
    !Array.isArray(operation.input)
      ? (operation.input as Record<string, unknown>)
      : {};
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : null;
  const targetId =
    typeof input.artifactId === "string" ? input.artifactId : null;
  const target = targetId
    ? artifacts.find((artifact) => artifact._id === targetId)?.title
    : null;
  const proposed = operation.status === "proposed";
  if (operation.type === "artifact.create")
    return `${proposed ? "Create" : "Created"} ${title ?? "work"}`;
  if (operation.type === "artifact.update")
    return `${proposed ? "Update" : "Updated"} ${target ?? "focused work"}`;
  if (operation.type === "artifact.link")
    return proposed ? "Link the new work" : "Linked the new work";
  if (operation.type === "workspaceItem.add")
    return proposed ? "Add to workspace" : "Added to workspace";
  if (operation.type === "workspaceItem.hide")
    return proposed
      ? "Remove workspace placement"
      : "Removed workspace placement";
  if (operation.type === "workspaceItem.setPinned")
    return proposed ? "Update important item" : "Updated important item";
  if (operation.type === "workspace.create")
    return `${proposed ? "Create" : "Created"} ${title ?? "workspace"}`;
  return operation.type.replaceAll(".", " ");
}

type TraceLoadState = {
  sourceRevision: string;
  trace?: SpectraThreadTrace;
  loading: boolean;
  error?: string;
};

function runTraceSourceRevision(
  detail: (Pick<SpectraThreadDetail, "thread" | "messages"> & {
    activeExecution?: { run: Pick<SpectraRun, "_id" | "executionId"> } | null;
  }) | null,
  runId: string,
) {
  const message = detail?.messages.filter((row) => row.runId === runId).at(-1);
  const active = detail?.activeExecution?.run;
  return JSON.stringify([detail?.thread._id, message?._id, active?._id === runId ? active.executionId : null]);
}

type TraceFamily = "operations" | "cards" | "events";

function mergeTracePage(
  previous: SpectraThreadTrace | undefined,
  page: Awaited<ReturnType<typeof getSpectraThreadRunTrace>>,
  family: TraceFamily,
  append: boolean,
): SpectraThreadTrace {
  return {
    run: page.run,
    operations:
      family === "operations"
        ? append
          ? [...page.operations, ...(previous?.operations ?? [])]
          : page.operations
        : (previous?.operations ?? []),
    cards:
      family === "cards"
        ? append
          ? [...page.cards, ...(previous?.cards ?? [])]
          : page.cards
        : (previous?.cards ?? []),
    events:
      family === "events"
        ? append
          ? [...(previous?.events ?? []), ...page.events]
          : page.events
        : (previous?.events ?? []),
    artifacts: page.artifacts.length
      ? page.artifacts
      : (previous?.artifacts ?? []),
    eventPage: page.eventPage ?? previous?.eventPage,
    operationPage: page.operationPage ?? previous?.operationPage,
    cardPage: page.cardPage ?? previous?.cardPage,
  };
}

function runDetailsStatusCopy(
  run: Pick<SpectraRun, "status" | "phase"> | undefined,
) {
  if (!run) return undefined;
  if (run.status === "awaiting_confirmation") return "Waiting for your approval";
  if (run.status === "awaiting_resolution")
    return run.phase === "conflict"
      ? "Waiting for a conflict to be resolved"
      : "Waiting for your choice";
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Still running";
  if (run.status === "completed") return "Completed result";
  if (run.status === "cancelled") return "Run stopped";
  return "Recovery details";
}

function RunDetailsDisclosure({
  run,
  state,
  onLoad,
}: {
  run?: Pick<SpectraRun, "status" | "phase">;
  state?: TraceLoadState;
  onLoad: () => void;
}) {
  if (state?.trace) return null;
  const status = state?.error ?? runDetailsStatusCopy(run);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status ? (
        <span className="min-w-0 text-micro text-[var(--text-secondary)]">
          {status}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onLoad}
        disabled={state?.loading}
        className="shrink-0 rounded-chip px-2 py-1 text-micro font-semibold text-[var(--accent-cyan)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
      >
        {state?.loading ? "Loading…" : state?.error ? "Try again" : "Show details"}
      </button>
    </div>
  );
}

function messageAttachments(message: SpectraThreadDetail["messages"][number]) {
  const rows = message.metadata?.attachments;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is { name: string; size?: number; handling?: string } =>
          Boolean(row) &&
          typeof row === "object" &&
          typeof (row as { name?: unknown }).name === "string",
      )
    : [];
}

const NO_SOURCES: readonly CitationSource[] = [];

/** How the prism beside a reply being written shows where the run is. */
const LIVE_OPTICS: Record<SpectraLiveExchange["status"], PrismOptics> = {
  starting: "working",
  streaming: "working",
  waiting: "waiting",
  failed: "failed",
  stopped: "dormant",
};

/** Spectra beside its reply: the live prism, turning while it works, leaning toward a near pointer and turning when pressed. */
function ReplyMark({ optics = "dormant" }: { optics?: PrismOptics }) {
  return (
    <span aria-hidden data-prism-host className="absolute left-0 top-0.5 flex size-6 items-center justify-center">
      <PrismLoader size={20} optics={optics} interactive />
    </span>
  );
}

/** What a result card asks the user to decide; a card with one of these is never folded away. */
const DECISION_ACTIONS = new Set(["confirm", "cancel", "reject", "retry"]);

/** The sources a saved reply cites: each opens where it lives. */
function messageSources(message: SpectraThreadDetail["messages"][number]): readonly CitationSource[] {
  const rows = message.metadata?.sources;
  if (!Array.isArray(rows) || !rows.length) return NO_SOURCES;
  return rows.filter(
    (row): row is CitationSource =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string" &&
      (typeof (row as { workId?: unknown }).workId === "string" || typeof (row as { url?: unknown }).url === "string"),
  );
}

export type ConversationBatchSelection = {
  questionId: string;
  choiceKey: string;
  choiceTitle: string;
};
export type ConversationChoice = { key?: string; title: string; description?: string | null; clarificationId?: string; executionId?: string; choiceMessageId?: string; batchSelections?: ConversationBatchSelection[] };

function messageChoices(
  message: SpectraThreadDetail["messages"][number],
  answeredByLaterMessage = false,
) {
  const value = message.metadata?.choices;
  if (!value || typeof value !== "object") return null;
  const row = value as {
    question?: unknown;
    options?: unknown;
    questions?: unknown;
  };
  const options = Array.isArray(row.options)
    ? row.options.flatMap((option): ConversationChoice[] =>
        option &&
        typeof option === "object" &&
        typeof (option as { title?: unknown }).title === "string"
          ? [
              {
                key: typeof (option as { key?: unknown }).key === "string" ? (option as { key: string }).key : undefined,
                title: (option as { title: string }).title,
                description:
                  typeof (option as { description?: unknown }).description ===
                  "string"
                    ? (option as { description: string }).description
                    : null,
              },
            ]
          : [],
      )
    : [];
  const selection = message.metadata?.choiceSelection;
  const selectedTitle =
    selection &&
    typeof selection === "object" &&
    typeof (selection as { title?: unknown }).title === "string"
      ? String((selection as { title: string }).title)
      : answeredByLaterMessage
        ? "Answered in the next message"
        : null;
  const batchQuestions = Array.isArray(row.questions)
    ? row.questions.flatMap((question, index) => {
        if (!question || typeof question !== "object") return [];
        const item = question as {
          id?: unknown;
          question?: unknown;
          options?: unknown;
        };
        if (typeof item.question !== "string" || !Array.isArray(item.options))
          return [];
        const itemOptions = item.options.flatMap(
          (option): ConversationChoice[] =>
            option &&
            typeof option === "object" &&
            typeof (option as { title?: unknown }).title === "string"
              ? [
                  {
                    key: typeof (option as { key?: unknown }).key === "string" ? (option as { key: string }).key : undefined,
                    title: (option as { title: string }).title,
                    description:
                      typeof (option as { description?: unknown })
                        .description === "string"
                        ? (option as { description: string }).description
                        : null,
                  },
                ]
              : [],
        );
        return itemOptions.length >= 2 && itemOptions.length <= 6
          ? [
              {
                id:
                  typeof item.id === "string" && item.id.trim()
                    ? item.id
                    : `question-${index + 1}`,
                question: item.question,
                options: itemOptions,
              },
            ]
          : [];
      })
    : [];
  if (batchQuestions.length >= 2)
    return { questions: batchQuestions.slice(0, 4), selectedTitle };
  return typeof row.question === "string" &&
    options.length >= 2 &&
    options.length <= 6
    ? { question: row.question, options, selectedTitle }
    : null;
}

/** Resolution errors come back as codes; say what the student can do. */
export function conflictFailureText(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : "";
  if (/REGION_CONFLICT_STILL_OCCUPIED/.test(message))
    return "The other edit is still going. Try again when it finishes.";
  if (/REGION_CONFLICT_(?:NOT_RESOLVED|UNAVAILABLE|RUN_STALE|BASE_REQUIRED)/.test(message))
    return "This choice is no longer available. Spectra has already moved on from it.";
  if (/check your connection/i.test(message)) return message;
  return fallback;
}

function ConflictText({ text }: { text: string | undefined }) {
  return (
    <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-caption leading-5 text-[var(--text-primary)]">
      {text === undefined ? (
        <span className="text-[var(--text-tertiary)]">No preview available.</span>
      ) : text ? (
        text
      ) : (
        <span className="text-[var(--text-tertiary)]">Empty</span>
      )}
    </p>
  );
}

export function ArtifactConflictResolution({
  operation,
}: {
  operation: SpectraOperation;
}) {
  const [detail, setDetail] = useState<
    Awaited<ReturnType<typeof getSpectraOperationConflict>>["conflict"] | null
  >(null);
  const [busy, setBusy] = useState<"apply" | "keep_current" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewBoth, setReviewBoth] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const result = await getSpectraOperationConflict(operation._id);
        if (!active) return;
        setDetail(result.conflict);
        setError(null);
        if (result.conflict.claimStatus === "queued")
          timer = setTimeout(load, 1_500);
      } catch (cause) {
        if (active)
          setError(conflictFailureText(cause, "Spectra could not load this conflict. Try again in a moment."));
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [operation._id]);
  const resolve = async (resolution: "apply" | "keep_current") => {
    setBusy(resolution);
    setError(null);
    try {
      await resolveSpectraOperationConflict(operation._id, resolution);
      spectraBus.emit("threads.changed", {});
      toast.success(
        resolution === "apply"
          ? "Spectra will apply its change now."
          : "The saved version was kept. Spectra did not change it.",
      );
    } catch (cause) {
      setError(conflictFailureText(cause, "Spectra could not save your choice. Try again."));
    } finally {
      setBusy(null);
    }
  };
  const available = detail?.claimStatus === "paused";
  const rows = detail
    ? compareConflictRegions({
        before: detail.conflict.baseSnapshot,
        saved: detail.currentSnapshot,
        proposed: detail.conflict.proposedSnapshot,
      })
    : [];
  const canReviewBoth = rows.some((row) => row.before !== undefined);
  const byPerson = (detail?.conflict ?? operation.conflict)?.blockerActorKind !== "ai";
  return (
    <section
      className="mt-2 overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--accent-gold)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-gold)_4%,var(--bg-elevated))]"
      aria-label="Choose which version to keep"
    >
      <header className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <GitCompareArrows className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <div className="text-micro font-semibold text-[var(--text-primary)]">
            {byPerson
              ? "This part changed while Spectra was working"
              : "Another Spectra edit is using this part"}
          </div>
          <p className="mt-0.5 text-micro leading-4 text-[var(--text-secondary)]">
            {available
              ? "Choose which version to keep. Nothing changes until you choose."
              : "Spectra is waiting for the other edit to finish and won't overwrite it."}
          </p>
        </div>
      </header>
      {detail ? (
        rows.length ? (
          <div className="grid gap-px bg-[var(--border-subtle)]">
            {rows.map((row) => (
              <div key={row.regionId} className="bg-[var(--bg-primary)] px-3 py-2.5">
                <div className="text-micro font-semibold text-[var(--text-secondary)]">
                  {row.label}
                </div>
                {reviewBoth ? (
                  <div className="mt-2">
                    <div className="text-micro font-medium text-[var(--text-tertiary)]">
                      Before Spectra started
                    </div>
                    <ConflictText text={row.before} />
                  </div>
                ) : null}
                <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-micro font-medium text-[var(--text-tertiary)]">
                      Saved version
                      {reviewBoth && row.before !== undefined && row.saved === row.before
                        ? " (unchanged)"
                        : ""}
                    </div>
                    <ConflictText text={row.saved} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-micro font-medium text-[var(--accent-cyan)]">
                      <SpectraMark mono size={12} />
                      Spectra&apos;s change
                    </div>
                    <ConflictText text={row.proposed} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-3 text-micro text-[var(--text-secondary)]">
            No preview is available for this part. Open the work to look at it before you choose.
          </p>
        )
      ) : error ? null : (
        <div className="flex items-center gap-2 px-3 py-4 text-micro text-[var(--text-tertiary)]">
          <PrismLoader size={14} optics="working" />
          Loading both versions
        </div>
      )}
      {error ? (
        <p
          role="alert"
          className="border-t border-[var(--border-subtle)] px-3 py-2 text-micro text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
        {canReviewBoth ? (
          <button
            type="button"
            aria-pressed={reviewBoth}
            onClick={() => setReviewBoth((open) => !open)}
            className="mr-auto min-h-8 rounded-control px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {reviewBoth ? "Hide the original" : "Review both"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve("keep_current")}
          className={buttonVariants({ variant: "secondary" })}
        >
          {busy === "keep_current" ? "Keeping…" : "Keep the saved version"}
        </button>
        <button
          type="button"
          disabled={!available || Boolean(busy)}
          onClick={() => void resolve("apply")}
          className="min-h-8 rounded-control bg-[var(--accent-cyan)] px-3 text-micro font-semibold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "apply"
            ? "Applying…"
            : available
              ? "Use Spectra’s change"
              : "Waiting for the other edit"}
        </button>
      </footer>
    </section>
  );
}

type CodeProposalFileChange = {
  id: string;
  kind: "add" | "remove" | "change";
  path: string;
  beforeLines: number;
  afterLines: number;
};

function CodeProposalReview({
  operation,
  artifacts,
}: {
  operation: SpectraOperation;
  artifacts: SpectraArtifact[];
}) {
  if (
    operation.type !== "artifact.create" &&
    operation.type !== "artifact.update"
  )
    return null;
  const input =
    operation.input &&
    typeof operation.input === "object" &&
    !Array.isArray(operation.input)
      ? (operation.input as Record<string, unknown>)
      : null;
  if (!input || input.blueprintKey !== "code") return null;
  const proposed =
    input.content &&
    typeof input.content === "object" &&
    !Array.isArray(input.content)
      ? (input.content as Record<string, unknown>)
      : null;
  const target =
    typeof input.artifactId === "string"
      ? artifacts.find((artifact) => artifact._id === input.artifactId)
      : null;
  const current =
    target?.content &&
    typeof target.content === "object" &&
    !Array.isArray(target.content)
      ? (target.content as Record<string, unknown>)
      : null;
  const fileRows = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((candidate, index) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate)
            ? [{ ...(candidate as Record<string, unknown>), _index: index }]
            : [],
        )
      : [];
  const currentFiles = fileRows(current?.files);
  const proposedFiles = fileRows(proposed?.files);
  const byId = (files: Array<Record<string, unknown>>) =>
    new Map(
      files.map((file, index) => [String(file.id ?? file.path ?? index), file]),
    );
  const before = byId(currentFiles);
  const after = byId(proposedFiles);
  const changes = [
    ...new Set([...before.keys(), ...after.keys()]),
  ].flatMap<CodeProposalFileChange>((id) => {
    const oldFile = before.get(id);
    const newFile = after.get(id);
    if (!oldFile)
      return [
        {
          id,
          kind: "add" as const,
          path: String(newFile?.path ?? "New file"),
          beforeLines: 0,
          afterLines: String(newFile?.source ?? "").split("\n").length,
        },
      ];
    if (!newFile)
      return [
        {
          id,
          kind: "remove" as const,
          path: String(oldFile.path ?? "Removed file"),
          beforeLines: String(oldFile.source ?? "").split("\n").length,
          afterLines: 0,
        },
      ];
    if (
      oldFile.path === newFile.path &&
      oldFile.source === newFile.source &&
      oldFile.language === newFile.language
    )
      return [];
    return [
      {
        id,
        kind: "change" as const,
        path: String(newFile.path ?? oldFile.path ?? "Changed file"),
        beforeLines: String(oldFile.source ?? "").split("\n").length,
        afterLines: String(newFile.source ?? "").split("\n").length,
      },
    ];
  });
  const patch =
    input.contentPatch &&
    typeof input.contentPatch === "object" &&
    !Array.isArray(input.contentPatch)
      ? (input.contentPatch as { changes?: Array<{ path?: unknown }> })
      : null;
  const paths = (patch?.changes ?? []).flatMap((change) =>
    typeof change.path === "string" ? [change.path] : [],
  );
  const sensitive = [
    proposed?.networkPolicy ||
    paths.some((path) => path.startsWith("/networkPolicy"))
      ? "Network policy"
      : null,
    proposed?.dependencies ||
    paths.some((path) => path.startsWith("/dependencies"))
      ? "Dependencies"
      : null,
    proposed?.resourceBindings ||
    paths.some((path) => path.startsWith("/resourceBindings"))
      ? "Permissioned resources"
      : null,
    proposed?.assets || paths.some((path) => path.startsWith("/assets"))
      ? "Immutable assets"
      : null,
  ].filter((value): value is string => Boolean(value));
  if (!proposed && paths.length === 0) return null;
  return (
    <section
      className="mt-2 overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-primary))]"
      aria-label="Review Code proposal"
    >
      <header className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
        <div className="min-w-0 flex-1">
          <div className="text-micro font-semibold text-[var(--text-primary)]">
            Code proposal
          </div>
          <p className="mt-0.5 text-micro leading-4 text-[var(--text-secondary)]">
            Review the project shape and privileged boundaries before anything
            is applied.
          </p>
        </div>
        <span className="rounded-chip bg-[var(--bg-elevated)] px-2 py-1 text-micro font-semibold text-[var(--text-tertiary)]">
          {changes.length || paths.length} change
          {(changes.length || paths.length) === 1 ? "" : "s"}
        </span>
      </header>
      {changes.length ? (
        <div className="divide-y divide-[var(--border-subtle)]">
          {changes.slice(0, 12).map((change) => (
            <div
              key={change.id}
              className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-micro"
            >
              <span
                className={`rounded-chip px-1.5 py-0.5 text-center text-micro font-bold  ${change.kind === "add" ? "bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]" : change.kind === "remove" ? "bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] text-[var(--danger)]" : "bg-[color-mix(in_oklab,var(--accent-cyan)_9%,transparent)] text-[var(--accent-cyan)]"}`}
              >
                {change.kind}
              </span>
              <span className="min-w-0 truncate font-mono text-[var(--text-primary)]">
                {change.path}
              </span>
              <span className="text-[var(--text-tertiary)]">
                {change.beforeLines} → {change.afterLines} lines
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-3 text-micro text-[var(--text-secondary)]">
          Targeted patch across {paths.length} stable path
          {paths.length === 1 ? "" : "s"}.
        </div>
      )}
      {sensitive.length ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <div className="mb-1.5 text-micro font-bold text-[var(--text-tertiary)]">
            Requires explicit review
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sensitive.map((item) => (
              <span
                key={item}
                className="rounded-chip border border-[color-mix(in_oklab,var(--accent-gold)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-gold)_6%,var(--bg-primary))] px-2 py-1 text-micro font-semibold text-[var(--warning)]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <footer className="border-t border-[var(--border-subtle)] px-3 py-2 text-micro text-[var(--text-tertiary)]">
        Source, published builds, and the running preview remain unchanged until
        the proposal is confirmed.
      </footer>
    </section>
  );
}

/**
 * The work one reply made or showed: the works Spectra placed live under it
 * (show_work), then a card for each other work it touched. A work shown live
 * needs no card as well. Every reply shares the thread's one embed subscription.
 */
function ReplyWork({
  threadId,
  runId,
  touches,
  onOpen,
  currentTitles,
  undone,
  onUndo,
}: {
  threadId?: string;
  runId?: string;
  touches: readonly HarnessArtifactTouchView[];
  onOpen?: (artifactId: string) => void;
  currentTitles?: ReadonlyMap<string, string>;
  undone?: boolean;
  /** Offered when the run can still be reversed. */
  onUndo?: () => void;
}) {
  const region = runId ? replyEmbedRegion(runId) : undefined;
  const container = useArtifactEmbedContainer("thread", threadId ?? "", Boolean(threadId && region));
  const shown = new Set(
    container?.embeds.filter((embed) => embed.containerRegionId === region).map((embed) => String(embed.sourceArtifactId)),
  );
  return (
    <>
      {threadId && region ? (
        <ArtifactEmbedList
          containerType="thread"
          containerId={threadId}
          className="mt-4 space-y-3"
          onOpenSource={onOpen}
          region={(regionId) => regionId === region}
        />
      ) : null}
      <WorkTouchCards touches={shown.size ? touches.filter((touch) => !shown.has(touch.id)) : touches} onOpen={onOpen} currentTitles={currentTitles} undone={undone} />
      {onUndo ? (
        <button type="button" onClick={onUndo} className="reply-undo">
          <Icon name="undoSpectra" size={15} aria-hidden />
          Undo Spectra&apos;s changes
        </button>
      ) : null}
    </>
  );
}

/**
 * The operations ledger belongs to plan-style runs. A harness run already shows
 * its approval, its work cards and its outcome note, so a second card would
 * only repeat them, worse; it keeps the ledger only for a conflict to resolve.
 */
function showsOperationalTrace(trace: SpectraThreadTrace) {
  if (harnessTraceFields(trace))
    return trace.operations.some((operation) => operation.status === "waiting" && operation.conflict);
  return (
    trace.operations.length > 0 ||
    ["failed", "cancelled", "awaiting_confirmation", "awaiting_resolution"].includes(trace.run.status)
  );
}

function OperationalTrace({ trace }: { trace: SpectraThreadTrace }) {
  const [open, setOpen] = useState(
    trace.run.status === "awaiting_confirmation" ||
      trace.run.status === "awaiting_resolution" ||
      trace.run.status === "failed",
  );
  const failed = trace.run.status === "failed";
  return (
    <div
      data-spectra-card="result"
      data-card-state={
        failed
          ? "failed"
          : trace.run.status === "awaiting_confirmation" ||
              trace.run.status === "awaiting_resolution"
            ? "confirmation"
            : "normal"
      }
      className="mt-4 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
      >
        {failed ? (
          <AlertCircle
            className={`h-3.5 w-3.5 ${trace.run.retryable === false ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
          />
        ) : trace.run.status === "awaiting_confirmation" ? (
          <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
        ) : trace.run.status === "awaiting_resolution" ? (
          <GitCompareArrows className="h-3.5 w-3.5 text-[var(--warning)]" />
        ) : (
          <Wrench className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
        )}
        <span className="flex-1 text-micro font-semibold text-[var(--text-secondary)]">
          {trace.operations.length === 0
            ? "Run"
            : `${trace.operations.length} ${trace.operations.length === 1 ? "action" : "actions"}`}
          <span className="ml-2 font-normal capitalize text-[var(--text-tertiary)]">
            {trace.run.status.replaceAll("_", " ")}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[var(--text-tertiary)] transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          {trace.operations.length === 0 ? (
            <p className="text-micro text-[var(--text-tertiary)]">
              {trace.run.status === "awaiting_confirmation"
                ? "Review the proposed changes before applying them."
                : trace.run.status === "awaiting_resolution"
                  ? trace.run.phase === "conflict"
                    ? "Review the preserved conflict proposal before choosing how to continue."
                    : "Choose an option above to continue."
                  : publicSpectraFailureText(
                      trace.run.error,
                      trace.run.retryable !== false,
                    )}
            </p>
          ) : (
            <div className="space-y-2">
              {trace.operations.map((operation) => (
                <div
                  key={operation._id}
                  className="rounded-control bg-[color-mix(in_oklab,var(--bg-primary)_58%,transparent)] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2 text-micro">
                    {operation.status === "executed" ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                    ) : operation.status === "failed" ? (
                      <AlertCircle
                        className={`h-3.5 w-3.5 ${trace.run.retryable === false ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
                      />
                    ) : (
                      <CircleDot className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
                      {operationLabel(operation, trace.artifacts)}
                    </span>
                    <span className="capitalize text-[var(--text-tertiary)]">
                      {operation.status}
                    </span>
                    {operation.affected.length > 0 ? (
                      <span className="ml-auto text-micro text-[var(--text-tertiary)]">
                        {operation.affected.length} affected
                      </span>
                    ) : null}
                  </div>
                  {operation.affected.length > 0 ? (
                    <div className="mt-1.5 pl-5 text-micro leading-4 text-[var(--text-tertiary)]">
                      Updated {operation.affected.length} workspace object
                      {operation.affected.length === 1 ? "" : "s"}.
                    </div>
                  ) : null}
                  {trace.run.status === "awaiting_confirmation" &&
                  operation.status === "proposed" ? (
                    <CodeProposalReview
                      operation={operation}
                      artifacts={trace.artifacts}
                    />
                  ) : null}
                  {operation.status === "waiting" && operation.conflict ? (
                    <ArtifactConflictResolution operation={operation} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The compact partial-failure note. A run is a ledger, not an all-or-nothing
 * request: when one part cannot be finished, everything completed stays saved
 * and ordinary. The note says exactly that, in one calm row — bronze, not red,
 * because nothing the user made is at risk — and offers to continue only the
 * unfinished part.
 */
function RunOutcomeNote({
  savedCount,
  failedCount,
  retrying = false,
  retryAvailable = true,
  onRetry,
}: {
  savedCount: number;
  failedCount: number;
  retrying?: boolean;
  retryAvailable?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="mt-3 flex items-start gap-2.5 rounded-card border border-[color-mix(in_oklab,var(--accent-gold)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-gold)_4%,var(--bg-primary))] px-3 py-2.5">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
      <div className="min-w-0 flex-1">
        <p className="text-micro font-semibold text-[var(--text-primary)]">
          {savedCount > 0
            ? `${savedCount} ${savedCount === 1 ? "change" : "changes"} saved`
            : "Partly completed"}
          {" · "}
          {failedCount === 1
            ? "one part could not be finished"
            : `${failedCount} parts could not be finished`}
        </p>
        <p className="mt-0.5 text-micro leading-4 text-[var(--text-tertiary)]">
          {retryAvailable
            ? "Completed work stays saved. Retry continues only the unfinished part."
            : "Completed work stays saved. Continue in this thread to finish the remaining part."}
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="flex shrink-0 items-center gap-1.5 rounded-chip border border-[color-mix(in_oklab,var(--accent-gold)_32%,var(--border-default))] px-2 py-1 text-micro font-semibold text-[var(--warning)] transition hover:bg-[color-mix(in_oklab,var(--accent-gold)_8%,var(--bg-primary))] disabled:opacity-50"
        >
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Retry unfinished part
        </button>
      ) : null}
    </div>
  );
}

/** The live variant, driven by the client ledger for the active run. */
function LiveRunOutcomeNote({
  runId,
  onRetryRun,
}: {
  runId: string;
  onRetryRun?: (runId: string) => Promise<unknown> | unknown;
}) {
  const entry = useRunLedger(runId);
  const [retrying, setRetrying] = useState(false);
  if (!entry || entry.phase !== "partial") return null;
  const counts = operationCounts(entry);
  return (
    <RunOutcomeNote
      savedCount={counts.committed}
      failedCount={Math.max(1, counts.failed)}
      retrying={retrying}
      onRetry={
        onRetryRun
          ? () => {
              setRetrying(true);
              void Promise.resolve(onRetryRun(runId)).finally(() =>
                setRetrying(false),
              );
            }
          : undefined
      }
    />
  );
}

/** The persisted variant, driven by the server's own operation records. */
function PersistedRunOutcomeNote({
  trace,
  onRetryRun,
}: {
  trace: SpectraThreadTrace;
  onRetryRun?: (runId: string) => Promise<unknown> | unknown;
}) {
  const [retrying, setRetrying] = useState(false);
  if (trace.run.status !== "failed") return null;
  const savedCount = trace.operations.filter(
    (operation) => operation.status === "executed",
  ).length;
  if (savedCount === 0) return null;
  const failedCount = Math.max(
    1,
    trace.operations.filter((operation) => operation.status === "failed")
      .length,
  );
  return (
    <RunOutcomeNote
      savedCount={savedCount}
      failedCount={failedCount}
      retrying={retrying}
      retryAvailable={trace.run.retryable !== false}
      onRetry={
        onRetryRun && trace.run.retryable !== false
          ? () => {
              setRetrying(true);
              void Promise.resolve(onRetryRun(trace.run._id)).finally(() =>
                setRetrying(false),
              );
            }
          : undefined
      }
    />
  );
}

function TerminalRunFailureNote({
  trace,
  onRetryRun,
}: {
  trace: SpectraThreadTrace;
  onRetryRun?: (runId: string) => Promise<unknown> | unknown;
}) {
  const [retrying, setRetrying] = useState(false);
  if (
    trace.run.status !== "failed" ||
    trace.operations.some((operation) => operation.status === "executed")
  )
    return null;
  return (
    <div
      className={`mt-3 rounded-card border px-3 py-2.5 ${trace.run.retryable === false ? "border-[color-mix(in_oklab,var(--danger)_20%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))]" : "border-[color-mix(in_oklab,var(--warning)_22%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--warning)_4%,var(--bg-primary))]"}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className={`mt-px h-3.5 w-3.5 shrink-0 ${trace.run.retryable === false ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold text-[var(--text-primary)]">
            {trace.run.retryable === false
              ? "Spectra could not complete this request"
              : "Spectra paused this run"}
          </p>
          <p className="mt-0.5 text-micro leading-4 text-[var(--text-tertiary)]">
            {publicSpectraFailureText(
              trace.run.error,
              trace.run.retryable !== false,
            )}
          </p>
        </div>
        {onRetryRun && trace.run.retryable !== false ? (
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void Promise.resolve(onRetryRun(trace.run._id)).finally(() =>
                setRetrying(false),
              );
            }}
            className={buttonVariants({ variant: "primary" })}
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A harness run's trace, rebuilt from its saved events. */
function harnessTraceFields(trace: SpectraThreadTrace): HarnessExchangeFields | null {
  const events = (trace.events ?? []).filter(
    (event) => !trace.run.executionId || event.executionId === trace.run.executionId,
  );
  if (!events.some((event) => event.type === "caption" || event.type === "step" || event.type === "reasoning_delta")) return null;
  let fields: HarnessExchangeFields = { steps: [], written: 0 };
  for (const row of [...events].sort((a, b) => a.sequence - b.sequence)) {
    try {
      const event = parseSpectraStreamEvent(row.payload);
      if (event.type === "text_delta") fields = { ...fields, written: (fields.written ?? 0) + event.content.length };
      // The last one is the whole reply, which by then has no more work after it.
      else if (event.type === "text_replace") fields = { ...fields, written: event.content.length };
      else if (isHarnessExchangeEvent(event)) fields = applyHarnessEvent(fields, event, row.createdAt);
    } catch {
      // A malformed row never hides the rest of the trace.
    }
  }
  const settled = trace.run.status !== "queued" && trace.run.status !== "running";
  return settled
    ? { ...fields, steps: fields.steps.map((step) => (step.status === "running" ? { ...step, status: "done" as const } : step)) }
    : fields;
}

/** What a run did while this page watched it, so the reply keeps its shape once it is saved. */
const watchedRuns = new Map<string, { steps: SpectraLiveExchange["steps"]; answers?: SpectraLiveExchange["answers"]; startedAt: number }>();

function rememberWatchedRun(exchange: SpectraLiveExchange) {
  if (!exchange.runId) return null;
  watchedRuns.delete(exchange.runId);
  watchedRuns.set(exchange.runId, { steps: exchange.steps, answers: exchange.answers, startedAt: exchange.startedAt });
  if (watchedRuns.size > 40) watchedRuns.delete(watchedRuns.keys().next().value!);
  return null;
}

/**
 * A reply in the order it happened: the words the run wrote, with the work done
 * between them sitting where it was done. Each stretch folds when the reply moves
 * past it, and the run's time shows only on the first.
 */
function ChronologicalReply({
  content,
  steps,
  answers,
  active,
  hasOutput,
  persistKey,
  startedAt,
  endedAt,
  renderText,
}: {
  content: string;
  steps: SpectraLiveExchange["steps"];
  answers?: SpectraLiveExchange["answers"];
  active: boolean;
  hasOutput: boolean;
  persistKey: string;
  startedAt?: number;
  endedAt?: number;
  renderText: (text: string, last: boolean) => ReactNode;
}) {
  const blocks = replyBlocks(content, steps);
  const lastIndex = blocks.length - 1;
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <Fragment key={index}>{renderText(block.text, index === lastIndex)}</Fragment>
        ) : (
          <ProgressTrace
            key={index}
            steps={block.steps}
            answers={index === 0 ? answers : undefined}
            active={active}
            hasOutput={hasOutput}
            persistKey={index === 0 ? persistKey : `${persistKey}:${index}`}
            startedAt={index === 0 ? startedAt : undefined}
            endedAt={index === 0 ? endedAt : undefined}
            continuation={index > 0}
            current={index === lastIndex}
          />
        ),
      )}
    </>
  );
}

/** Questions a finished run asked, each with its answer, as they were at the time. */
function SavedAnswers({ trace }: { trace: SpectraThreadTrace }) {
  const answers = useMemo(() => harnessTraceFields(trace)?.answers ?? [], [trace]);
  return <AnsweredInputs answers={answers.map((answer) => ({ ...answer, key: answer.toolCallId }))} />;
}

function PersistedProgressTrace({ trace }: { trace: SpectraThreadTrace }) {
  const harness = harnessTraceFields(trace);
  if (harness)
    return (
      <ProgressTrace
        steps={harness.steps}
        answers={harness.answers}
        active={trace.run.status === "queued" || trace.run.status === "running"}
        hasOutput={Boolean(trace.run.finalSummary) || !["queued", "running"].includes(trace.run.status)}
        persistKey={trace.run._id}
        {...traceTiming(trace)}
      />
    );
  return <LegacyProgressTrace trace={trace} />;
}

/** When a stored run began and settled: its last event, or its last change. */
function traceTiming(trace: SpectraThreadTrace) {
  if (trace.run.status === "queued" || trace.run.status === "running") return { startedAt: trace.run.createdAt };
  const lastEvent = (trace.events ?? []).reduce((latest, event) => Math.max(latest, event.createdAt), 0);
  return { startedAt: trace.run.createdAt, endedAt: lastEvent || trace.run.updatedAt };
}

function LegacyProgressTrace({ trace }: { trace: SpectraThreadTrace }) {
  const rows = (trace.events ?? []).filter((event) => {
    if (trace.run.executionId && event.executionId !== trace.run.executionId)
      return false;
    if (
      ![
        "progress",
        "operation_preview",
        "approval_accepted",
        "approval_rejected",
        "error",
        "stopped",
        "interrupted",
      ].includes(event.type)
    )
      return false;
    // An intentional stop is authoritative over a late provider/error event
    // from the same execution. A proposal cancelled before execution must also
    // never be rendered in the past tense as though the edit landed.
    if (
      trace.run.status === "cancelled" &&
      (event.type === "error" || event.type === "interrupted")
    )
      return false;
    if (event.type === "operation_preview") {
      const preview =
        event.payload.preview &&
        typeof event.payload.preview === "object" &&
        !Array.isArray(event.payload.preview)
          ? (event.payload.preview as { operationIndex?: unknown })
          : null;
      const operationIndex =
        typeof preview?.operationIndex === "number"
          ? preview.operationIndex
          : null;
      if (
        operationIndex !== null &&
        trace.operations[operationIndex]?.status === "cancelled"
      )
        return false;
    }
    return true;
  });
  if (rows.length === 0) return null;
  const rawSteps = rows.map((event, index) => {
    const payload = event.payload;
    const preview =
      event.type === "operation_preview" &&
      payload.preview &&
      typeof payload.preview === "object"
        ? (payload.preview as { title?: unknown; action?: unknown })
        : null;
    const previewAction =
      preview?.action === "create"
        ? "Creating"
        : preview?.action === "update"
          ? "Updating"
          : preview?.action === "archive"
            ? "Preparing archive"
            : preview?.action === "workspace"
              ? "Organizing"
              : "Connecting";
    const previewTitle =
      preview && typeof preview.title === "string"
        ? /^(creating|updating|organizing|connecting|preparing)\b/i.test(
            preview.title,
          )
          ? preview.title.replace(/^Preparing\b/i, previewAction)
          : `${previewAction} ${preview.title}`
        : null;
    const nativeTitle =
      event.type === "progress" && typeof payload.title === "string"
        ? payload.title
        : null;
    const nativeDetail =
      event.type === "progress" && typeof payload.detail === "string"
        ? payload.detail
        : null;
    const terminalTitle =
      event.type === "approval_accepted"
        ? "Changes approved"
        : event.type === "approval_rejected"
          ? "Proposal rejected"
          : event.type === "stopped"
            ? "Run stopped"
            : event.type === "interrupted"
              ? "Run interrupted"
              : event.type === "error"
                ? "Could not finish this run"
                : null;
    const message = nativeTitle
      ? `${nativeTitle}${nativeDetail ? ` · ${nativeDetail}` : ""}`
      : (previewTitle ?? terminalTitle ?? "");
    const publicMessage =
      typeof payload.message === "string" ? payload.message : "";
    const summary =
      nativeDetail ??
      (message.includes(" · ")
        ? message.slice(message.indexOf(" · ") + 3).trim()
        : publicMessage || message);
    return {
      id: `${event._id}:${index}`,
      title: nativeTitle ?? previewTitle ?? terminalTitle ?? message,
      summary,
      status: ((event.type === "error" || event.type === "interrupted") &&
      trace.run.status !== "completed" &&
      trace.run.retryable === false
        ? "error"
        : index === rows.length - 1 &&
            (trace.run.status === "queued" || trace.run.status === "running")
          ? "running"
          : "done") as "running" | "done" | "error",
      createdAt: event.createdAt,
    };
  });
  const steps = rawSteps.reduce<typeof rawSteps>((publicSteps, step) => {
    const existingIndex = publicSteps.findIndex(
      (candidate) => candidate.title === step.title,
    );
    const evolvingIndex = publicSteps.findIndex(
      (candidate) =>
        step.title
          .toLocaleLowerCase()
          .startsWith(candidate.title.toLocaleLowerCase()) ||
        candidate.title
          .toLocaleLowerCase()
          .startsWith(step.title.toLocaleLowerCase()),
    );
    if (existingIndex === -1 && evolvingIndex === -1) publicSteps.push(step);
    else publicSteps[existingIndex >= 0 ? existingIndex : evolvingIndex] = step;
    return publicSteps;
  }, []);
  return (
    <ProgressTrace
      steps={steps}
      active={trace.run.status === "queued" || trace.run.status === "running"}
      hasOutput={
        Boolean(trace.run.finalSummary) ||
        !["queued", "running"].includes(trace.run.status)
      }
      persistKey={trace.run._id}
      {...traceTiming(trace)}
    />
  );
}

function AgentRoutingControl({ trace }: { trace: SpectraThreadTrace }) {
  const [busy, setBusy] = useState(false);
  const [ordinaryNext, setOrdinaryNext] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackCategory, setFeedbackCategory] = useState<
    "helpful" | "accuracy" | "clarity" | "safety" | "resource_quality" | "other"
  >("helpful");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [shareComment, setShareComment] = useState(false);
  const event = [...(trace.events ?? [])]
    .reverse()
    .find((candidate) => candidate.type === "agent_routed");
  const title =
    event && typeof event.payload.title === "string"
      ? event.payload.title
      : trace.cards.find((card) => card.provenance?.agentTitle)?.provenance
          ?.agentTitle;
  const reason =
    event && typeof event.payload.reason === "string"
      ? event.payload.reason
      : trace.cards.find((card) => card.provenance?.agentRoutingReason)
          ?.provenance?.agentRoutingReason;
  const source =
    event && typeof event.payload.source === "string"
      ? event.payload.source
      : trace.cards.find((card) => card.provenance?.agentRoutingSource)
          ?.provenance?.agentRoutingSource;
  const agentId =
    event && typeof event.payload.agentId === "string"
      ? event.payload.agentId
      : trace.run.selectedAgentId;
  const agentVersionId =
    event && typeof event.payload.agentVersionId === "string"
      ? event.payload.agentVersionId
      : trace.run.selectedAgentVersionId;
  if (!title) return null;

  async function clearAgent() {
    if (busy || ordinaryNext) return;
    setBusy(true);
    try {
      await clearSpectraRunAgent(trace.run._id);
      setOrdinaryNext(true);
      spectraBus.emit("threads.changed", {});
      toast.success("This thread will use ordinary Spectra next.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not change the thread agent.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback() {
    if (
      feedbackBusy ||
      feedbackSent ||
      !agentId ||
      !agentVersionId ||
      trace.run.status !== "completed"
    )
      return;
    setFeedbackBusy(true);
    try {
      await submitSpectraAgentFeedback({
        agentId,
        agentVersionId,
        runId: trace.run._id,
        rating: feedbackRating,
        category: feedbackCategory,
        comment: shareComment ? feedbackComment.trim() || undefined : undefined,
        consentToShareComment: shareComment,
      });
      setFeedbackSent(true);
      setFeedbackOpen(false);
      toast.success("Feedback shared without your prompt or thread content.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not share feedback.",
      );
    } finally {
      setFeedbackBusy(false);
    }
  }

  return (
    <div className="mt-2 max-w-[560px]">
      <div
        className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-2 py-1 text-micro text-[var(--text-secondary)]"
        title={reason}
      >
        <Bot className="h-3 w-3 shrink-0 text-[var(--accent-cyan)]" />
        <span className="truncate font-semibold">{title}</span>
        <span className="shrink-0 text-micro text-[var(--text-tertiary)]">
          {source === "continued"
            ? "retained"
            : source === "explicit"
              ? "selected"
              : "auto-routed"}
        </span>
        {trace.run.status === "completed" && agentId && agentVersionId ? (
          <button
            type="button"
            disabled={feedbackSent}
            onClick={() => setFeedbackOpen((value) => !value)}
            className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 font-semibold hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-65"
          >
            {feedbackSent ? (
              <Check className="h-2.5 w-2.5" />
            ) : (
              <Star className="h-2.5 w-2.5" />
            )}
            {feedbackSent ? "Feedback sent" : "Rate"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || ordinaryNext}
          onClick={() => void clearAgent()}
          className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 font-semibold hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-65"
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : ordinaryNext ? (
            <Check className="h-2.5 w-2.5" />
          ) : (
            <Undo2 className="h-2.5 w-2.5" />
          )}
          {ordinaryNext ? "Ordinary next" : "Use ordinary Spectra"}
        </button>
      </div>
      {feedbackOpen ? (
        <div className="mt-1.5 grid gap-2 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-micro shadow-[var(--shadow-sm)]">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div className="grid gap-1">
              <span className="font-semibold text-[var(--text-secondary)]">
                Rating
              </span>
              <SelectField
                ariaLabel="Rating"
                value={String(feedbackRating)}
                onChange={(next) => setFeedbackRating(Number(next))}
                options={[5, 4, 3, 2, 1].map((rating) => ({
                  value: String(rating),
                  label: `${rating} / 5`,
                }))}
                size="sm"
                triggerClassName="w-[84px]"
              />
            </div>
            <div className="grid gap-1">
              <span className="font-semibold text-[var(--text-secondary)]">
                Category
              </span>
              <SelectField
                ariaLabel="Category"
                value={feedbackCategory}
                onChange={(next) =>
                  setFeedbackCategory(next as typeof feedbackCategory)
                }
                options={[
                  { value: "helpful", label: "Helpfulness" },
                  { value: "accuracy", label: "Accuracy" },
                  { value: "clarity", label: "Clarity" },
                  { value: "safety", label: "Safety" },
                  { value: "resource_quality", label: "Source quality" },
                  { value: "other", label: "Other" },
                ]}
                size="sm"
                triggerClassName="w-full"
              />
            </div>
          </div>
          <textarea
            value={feedbackComment}
            onChange={(event) => setFeedbackComment(event.target.value)}
            placeholder="Optional detail — never include private information"
            className="min-h-16 resize-y rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 outline-none"
          />
          <label className="flex items-start gap-2 text-micro text-[var(--text-tertiary)]">
            <input
              type="checkbox"
              checked={shareComment}
              onChange={(event) => setShareComment(event.target.checked)}
            />
            Share this comment with the agent creator. The rating and category
            are aggregated; your prompt, thread, memory, and work are never shared.
          </label>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setFeedbackOpen(false)}
              className="h-8 rounded-chip px-2.5 text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={feedbackBusy}
              onClick={() => void submitFeedback()}
              className="inline-flex h-8 items-center gap-1 rounded-chip bg-[var(--accent-cyan)] px-2.5 font-semibold text-white disabled:opacity-60"
            >
              {feedbackBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}{" "}
              Share feedback
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactResult({
  artifact,
  onOpen,
}: {
  artifact: SpectraArtifact;
  onOpen?: (id: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const workspaceCatalog = useWorkspaceCatalog(undefined, choosing);
  const workspaces = workspaceCatalog.items;
  const [busy, setBusy] = useState(false);
  const meta = workTypeMeta[artifact.blueprintKey];
  const ArtifactIcon = meta?.icon ?? FileText;
  return (
    <div
      data-spectra-card="result"
      data-card-state="normal"
      data-interactive={onOpen ? "true" : undefined}
      className="mt-4 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_44%,transparent)]"
      style={{ "--card-accent": "var(--card-pinned)" } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)]"
          style={{ color: meta?.color ?? "var(--accent-gold)" }}
        >
          <ArtifactIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(artifact._id)}
              className="rounded-chip text-left text-caption font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
            >
              {artifact.title}
            </button>
          ) : (
            <div className="text-caption font-semibold text-[var(--text-primary)]">
              {artifact.title}
            </div>
          )}
          <div className="mt-0.5 text-micro text-[var(--text-secondary)]">
            {artifact.summary ?? artifact.blueprintKey.replaceAll("_", " ")}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(artifact._id);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Open work"
          title="Open work"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setChoosing((value) => !value);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Add to workspace"
          title="Add to workspace"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>
      {choosing ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] pt-3"
          onClick={(event) => event.stopPropagation()}
        >
          {workspaces.map((workspace) => (
            <button
              key={workspace._id}
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void postSpectra({
                  action: "addArtifactToWorkspace",
                  artifactId: artifact._id,
                  workspaceId: workspace._id,
                })
                  .then(() => {
                    toast.success(`Added to ${workspace.title}`);
                    setChoosing(false);
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Could not add work.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
              className="rounded-chip bg-[var(--bg-primary)] px-2.5 py-1.5 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {workspace.title}
            </button>
          ))}
          <CatalogProgress catalog={workspaceCatalog} />
          {workspaces.length === 0 && workspaceCatalog.status === "ready" && workspaceCatalog.isDone ? (
            <span className="text-micro text-[var(--text-tertiary)]">
              Create a workspace first.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceResult({
  workspace,
  onOpen,
}: {
  workspace: SpectraWorkspace;
  onOpen?: (workspaceId: string) => void;
}) {
  return (
    <button
      type="button"
      data-spectra-card="result"
      data-card-state="normal"
      data-interactive="true"
      className="mt-3 flex w-full items-start gap-3 px-4 py-3 text-left"
      onClick={() => onOpen?.(workspace._id)}
    >
      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-control bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))] text-[var(--accent-cyan)]">
        <FolderPlus className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-semibold text-[var(--text-primary)]">
          {workspace.title}
        </span>
        <span className="mt-0.5 line-clamp-2 text-micro leading-4 text-[var(--text-secondary)]">
          {workspace.description ?? "Workspace updated by Spectra."}
        </span>
      </span>
      <ExternalLink className="mt-1 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
    </button>
  );
}

/**
 * Live streamed assistant content.
 *
 * Canonical text is always complete in state; this component only schedules
 * the *visible* window (Phase 14.2). While the reveal is unresolved, the
 * container carries `spectra-stream-active`, so the CSS active-tail shimmer
 * attaches to the last block only — completed output never shimmers
 * (POLISH-005). Reduced motion / streaming-reveal off renders canonical text
 * directly; data and accessibility state never wait for animation (INV-22).
 */
function LiveContentReveal({
  content,
  streaming,
  compact,
  sources,
}: {
  content: string;
  streaming: boolean;
  compact?: boolean;
  sources?: readonly CitationSource[];
}) {
  const { visibleText, active } = useStreamingReveal(content, {
    profile: "conversation",
    enabled: streaming,
  });
  return (
    <div className={active ? "spectra-stream-active" : undefined}>
      <SpectraRichContent
        content={visibleText}
        sources={sources}
        className={cn(
          "text-body leading-7 text-[var(--text-primary)]",
          !compact && "sm:text-subhead",
        )}
      />
    </div>
  );
}

const NO_ARTIFACTS: readonly SpectraArtifact[] = [];

export function ConversationSurface({
  detail,
  artifacts = NO_ARTIFACTS,
  threadId,
  loading = false,
  loadError,
  empty,
  lead,
  activeCards,
  onCardOpen,
  onCardAction,
  onCardRevise,
  workspaces = [],
  onOpenArtifact,
  onOpenWorkspace,
  compact = false,
  liveExchange,
  onChoice,
  onRetryRun,
  onAnswer,
}: {
  detail: SpectraThreadDetail | null;
  /** The catalog, when the host has one: result slips name works as they are now. */
  artifacts?: readonly SpectraArtifact[];
  threadId?: string;
  loading?: boolean;
  /** A retryable refresh notice that must remain visible beside old messages. */
  loadError?: ReactNode;
  empty?: ReactNode;
  /** Shown above the conversation, full width, before one begins (Home's day). */
  lead?: ReactNode;
  activeCards?: Parameters<typeof ResultCardStack>[0]["cards"];
  onCardOpen?: Parameters<typeof ResultCardStack>[0]["onOpen"];
  onCardAction?: Parameters<typeof ResultCardStack>[0]["onAction"];
  onCardRevise?: Parameters<typeof ResultCardStack>[0]["onRevise"];
  workspaces?: SpectraWorkspace[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  compact?: boolean;
  liveExchange?: SpectraLiveExchange | null;
  onChoice?: (choice: ConversationChoice) => Promise<void> | void;
  onRetryRun?: (runId: string) => Promise<unknown> | unknown;
  /** Answers the run's open question or approval. */
  onAnswer?: (runId: string, toolCallId: string, value: HarnessAnswerValue) => Promise<boolean> | boolean;
}) {
  const observedThreadId = threadId ?? detail?.thread._id;
  // Approvals and retries the thread can act on. The open question of the
  // run shown live is answered in its own panel, not repeated as a card.
  const answeredNotes = useAnsweredNotes();
  const liveAnswerKeys = new Set(answeredNotes.map((note) => note.key));
  const openLiveInput =
    liveExchange?.input && liveExchange.runId && !liveAnswerKeys.has(liveAnswerKey(liveExchange.runId, liveExchange.input.toolCallId))
      ? liveExchange.input
      : null;
  const liveAnswers = liveExchange?.runId
    ? [
        // The note carries the words of the question even when the run's own event arrives first.
        ...answeredNotes.filter((note) => note.runId === liveExchange.runId),
        ...(liveExchange.answers ?? [])
          .map((answer) => ({ ...answer, key: liveAnswerKey(liveExchange.runId!, answer.toolCallId) }))
          .filter((answer) => !liveAnswerKeys.has(answer.key)),
      ]
    : [];
  const actionableCards = (activeCards ?? []).filter(
    (card) =>
      card.actions.some((action) => DECISION_ACTIONS.has(action.key)) &&
      !(liveExchange?.input && card.runId === liveExchange.runId) &&
      // A failed run already says so, with its own retry, in the thread above.
      !(card.actions.every((action) => action.key === "retry" || !DECISION_ACTIONS.has(action.key)) &&
        detail?.traces.some((trace) => trace.run._id === card.runId && trace.run.status === "failed")),
  );
  const observedActiveExecution = useQuery(
    api.spectraThreads.getActiveExecution,
    useAuthedArgs(
      observedThreadId
        ? { threadId: observedThreadId as Id<"spectraThreads"> }
        : "skip",
    ),
  );
  const currentTitles = useMemo(() => new Map(artifacts.map((artifact) => [artifact._id, artifact.title] as const)), [artifacts]);
  const renderedDetail = useMemo(() => {
    if (!detail || observedActiveExecution === undefined) return detail;
    return {
      ...detail,
      activeExecution: observedActiveExecution
        ? { run: observedActiveExecution.run }
        : null,
    };
  }, [detail, observedActiveExecution]);
  const [traceCache, setTraceStates] = useState<Record<string, TraceLoadState>>({});
  const traceSourceRef = useRef(renderedDetail);
  traceSourceRef.current = renderedDetail;
  // A run ID survives Retry. Cached details belong to the execution and
  // message projection that loaded them, including requests still in flight.
  const traceStates = useMemo(() => Object.fromEntries(
    Object.entries(traceCache).filter(([runId, state]) =>
      state.sourceRevision === runTraceSourceRevision(renderedDetail, runId)),
  ), [renderedDetail, traceCache]);
  const traceRequestRef = useRef(new Map<string, number>());
  const traceRequestSequenceRef = useRef(0);
  useEffect(() => {
    const stale = Object.keys(traceCache).filter((runId) => !traceStates[runId]);
    if (!stale.length) return;
    for (const runId of stale)
      traceRequestRef.current.delete(observedThreadId + ":" + runId);
    setTraceStates((current) => Object.fromEntries(
      Object.entries(current).filter(([runId, state]) =>
        state.sourceRevision === runTraceSourceRevision(traceSourceRef.current, runId)),
    ));
  }, [observedThreadId, traceCache, traceStates]);
  useEffect(() => {
    traceRequestRef.current.clear();
    setTraceStates({});
  }, [renderedDetail?.thread._id]);
  const requestRunTrace = useCallback(
    async (
      runId: string,
      options: {
        family?: TraceFamily;
        eventAfter?: number;
        eventsCursor?: string;
        operationsBefore?: string;
        cardsBefore?: string;
        skipOperations?: boolean;
        skipCards?: boolean;
        skipEvents?: boolean;
        includeArtifacts?: boolean;
      } = {},
    ) => {
      if (!observedThreadId) return;
      const key = `${observedThreadId}:${runId}`;
      const sourceRevision = runTraceSourceRevision(traceSourceRef.current, runId);
      const requestId = ++traceRequestSequenceRef.current;
      traceRequestRef.current.set(key, requestId);
      const families: TraceFamily[] = options.family
        ? [options.family]
        : options.eventsCursor || options.operationsBefore || options.cardsBefore
          ? [
              ...(options.skipOperations ? [] : (["operations"] as const)),
              ...(options.skipCards ? [] : (["cards"] as const)),
              ...(options.skipEvents ? [] : (["events"] as const)),
            ]
          : ["operations", "cards", "events"];
      if (!families.length) return;
      setTraceStates((current) => ({
        ...current,
        [runId]: { ...(current[runId]?.sourceRevision === sourceRevision ? current[runId] : {}), sourceRevision, loading: true, error: undefined },
      }));
      try {
        const pages = await Promise.all(
          families.map(async (family) => ({
            family,
            page: await getSpectraThreadRunTrace(observedThreadId, runId, {
              family,
              eventAfter: family === "events" ? options.eventAfter : undefined,
              eventsCursor: family === "events" ? options.eventsCursor : undefined,
              operationsBefore:
                family === "operations" ? options.operationsBefore : undefined,
              cardsBefore: family === "cards" ? options.cardsBefore : undefined,
              includeArtifacts:
                options.includeArtifacts ??
                (family === "operations" && !options.operationsBefore),
            }),
          })),
        );
        if (
          traceRequestRef.current.get(key) !== requestId ||
          runTraceSourceRevision(traceSourceRef.current, runId) !== sourceRevision ||
          (renderedDetail?.thread._id ?? observedThreadId) !== observedThreadId
        )
          return;
        setTraceStates((current) => {
          let trace = current[runId]?.sourceRevision === sourceRevision ? current[runId]?.trace : undefined;
          for (const result of pages) {
            const append =
              result.family === "operations"
                ? Boolean(options.operationsBefore)
                : result.family === "cards"
                  ? Boolean(options.cardsBefore)
                  : Boolean(options.eventsCursor);
            trace = mergeTracePage(trace, result.page, result.family, append);
          }
          return {
            ...current,
            [runId]: { sourceRevision, loading: false, trace },
          };
        });
      } catch (error) {
        if (traceRequestRef.current.get(key) !== requestId ||
          runTraceSourceRevision(traceSourceRef.current, runId) !== sourceRevision) return;
        setTraceStates((current) => ({
          ...current,
          [runId]: {
            ...current[runId],
            sourceRevision,
            loading: false,
            error: readConvexError(error).message || "Could not load saved run details.",
          },
        }));
      }
    },
    [observedThreadId, renderedDetail?.thread._id],
  );
  const runTabs = useRunTabs();
  const runTabCardByRun = useMemo(
    () => new Map(runTabs.flatMap((tab) => {
      const card = runTabCard(tab);
      return card ? [[tab.runId, card] as const] : [];
    })),
    [runTabs],
  );
  const traceByRun = useMemo(
    () => {
      const traces = new Map(
        (renderedDetail?.traces ?? []).map((trace) => [trace.run._id, trace]),
      );
      for (const [runId, state] of Object.entries(traceStates))
        if (state.trace) traces.set(runId, state.trace);
      return traces;
    },
    [renderedDetail?.traces, traceStates],
  );
  useEffect(() => {
    const runId = renderedDetail?.thread.lastRunId;
    if (!runId || renderedDetail.activeExecution !== null ||
      traceByRun.has(runId) || traceStates[runId]) return;
    const lastMessage = renderedDetail.messages.at(-1);
    if (lastMessage?.role !== "user" || lastMessage.runId !== runId) return;
    // A settled run with no assistant reply needs its saved outcome now.
    // Reuse the bounded trace loader; completed history remains on demand.
    void requestRunTrace(runId);
  }, [renderedDetail, requestRunTrace, traceByRun, traceStates]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const olderRequestRef = useRef(0);
  const [olderMessages, setOlderMessages] = useState<
    SpectraThreadDetail["messages"]
  >([]);
  const [olderPage, setOlderPage] = useState<
    SpectraThreadDetail["messagePage"]
  >();
  useEffect(() => {
    olderRequestRef.current += 1;
    setOlderMessages([]);
    setOlderPage(undefined);
    setOlderError(null);
  }, [renderedDetail?.thread._id]);
  const displayedMessages = useMemo(() => {
    const rows = [...olderMessages, ...(renderedDetail?.messages ?? [])];
    return [...new Map(rows.map((message) => [message._id, message])).values()];
  }, [renderedDetail?.messages, olderMessages]);
  const loadOlder = useCallback(async () => {
    const pageState = olderPage ?? renderedDetail?.messagePage;
    if (!renderedDetail || !pageState?.hasOlder || loadingOlder) return;
    const before = pageState.olderBefore;
    if (before === undefined) return;
    const requestedThreadId = renderedDetail.thread._id;
    const requestId = ++olderRequestRef.current;
    const beforeHeight = scrollRef.current?.scrollHeight ?? 0;
    const beforeTop = scrollRef.current?.scrollTop ?? 0;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await getSpectraThreadMessages(requestedThreadId, before);
      if (olderRequestRef.current !== requestId || renderedDetail.thread._id !== requestedThreadId) return;
      setOlderMessages((current) => [...page.messages, ...current]);
      setOlderPage({ hasOlder: page.hasOlder, olderBefore: page.olderBefore });
      requestAnimationFrame(() => {
        if (olderRequestRef.current !== requestId || !scrollRef.current) return;
        scrollRef.current.scrollTop = beforeTop + (scrollRef.current.scrollHeight - beforeHeight);
      });
    } catch (error) {
      if (olderRequestRef.current === requestId)
        setOlderError(error instanceof Error ? error.message : "Could not load older messages.");
    } finally {
      if (olderRequestRef.current === requestId) setLoadingOlder(false);
    }
  }, [loadingOlder, olderPage, renderedDetail]);
  const persistedUserRunIds = useMemo(
    () =>
      new Set(
        displayedMessages.flatMap((message) =>
          message.role === "user" && message.runId ? [message.runId] : [],
        ) ?? [],
      ),
    [displayedMessages],
  );
  const persistedAssistantRunIds = useMemo(
    () =>
      new Set(
        displayedMessages.flatMap((message) =>
          message.role === "assistant" && message.runId ? [message.runId] : [],
        ) ?? [],
      ),
    [displayedMessages],
  );
  const unresolvedTraces = useMemo(
    () =>
      [...traceByRun.values()].filter(
        (trace) =>
          !persistedUserRunIds.has(trace.run._id) &&
          !persistedAssistantRunIds.has(trace.run._id) &&
          trace.run.status !== "completed",
      ),
    [persistedAssistantRunIds, persistedUserRunIds, traceByRun],
  );
  // A lead with nothing under it yet is a page read from the top, not a conversation to follow.
  const resting = Boolean(lead) && !renderedDetail && !liveExchange && !loading;
  useEffect(() => {
    if (!following || resting) return;
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "auto",
        }),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
    };
  }, [
    displayedMessages.length,
    traceByRun.size,
    renderedDetail?.thread._id,
    following,
    resting,
    liveExchange?.content,
  ]);
  useEffect(() => {
    if (!following || resting || !contentRef.current) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (following)
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "auto",
          });
      });
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [renderedDetail?.thread._id, following, resting]);
  useEffect(() => setFollowing(true), [renderedDetail?.thread._id]);
  const messageMeta = useCallback(
    (message: NonNullable<SpectraThreadDetail>["messages"][number]) => {
      return [
        message.role === "user" ? (renderedDetail?.viewerName ?? "You") : "Spectra",
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(message.createdAt),
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [renderedDetail?.viewerName],
  );
  return (
    <div className="spectra-conversation relative flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowing(
            element.scrollHeight - element.scrollTop - element.clientHeight <
              72,
          );
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          // Full page, it scrolls clear of the island like any page; in the Side the island is not below it.
          compact ? "px-5 pb-8 pt-5" : "spectra-page-scroll px-5 pt-10 sm:px-8",
        )}
      >
        {lead}
        <div
          ref={contentRef}
          className={cn("mx-auto", compact ? "max-w-[760px]" : "max-w-[820px]")}
        >
          {loading ? (
            <div className="space-y-8 py-10" aria-label="Loading conversation">
              <div data-life-ghost className="ml-auto h-16 w-[58%] animate-pulse rounded-surface bg-[var(--bg-secondary)]" />
              {/* One ghost for the reply: its lines are bars of the same figure, so they settle as lines together. */}
              <div data-life-ghost className="space-y-3">
                <div data-life-ghost-bar className="h-3 w-24 animate-pulse rounded bg-[var(--bg-secondary)]" />
                <div data-life-ghost-bar className="h-3 w-full animate-pulse rounded bg-[var(--bg-secondary)]" />
                <div data-life-ghost-bar className="h-3 w-[72%] animate-pulse rounded bg-[var(--bg-secondary)]" />
              </div>
            </div>
          ) : null}
          {!loading && loadError ? loadError : null}
          {!loading && !renderedDetail && !liveExchange ? empty : null}
          {(olderPage ?? renderedDetail?.messagePage)?.hasOlder ? (
            <div className="mb-6 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className={buttonVariants({ variant: "ghost" })}
              >
                {loadingOlder ? "Loading older messages…" : olderError ? "Retry older messages" : "Load older messages"}
              </button>
              {olderError ? <span role="status" className="ml-2 text-micro text-[var(--danger)]">{olderError}</span> : null}
            </div>
          ) : null}
          {displayedMessages
            .filter(
              (message) =>
                message.role === "user" || message.role === "assistant",
            )
            .map((message, messageIndex, visibleMessages) => {
              const trace = message.runId
                ? traceByRun.get(message.runId)
                : undefined;
              const traceState = message.runId
                ? traceStates[message.runId]
                : undefined;
              const activeRun =
                message.runId &&
                renderedDetail?.activeExecution?.run._id === message.runId
                  ? renderedDetail.activeExecution.run
                  : undefined;
              const shouldOfferTrace = Boolean(
                message.runId &&
                  !trace &&
                  (message.role === "assistant" ||
                    !persistedAssistantRunIds.has(message.runId)),
              );
              const touches = message.role === "assistant" ? messageTouches(message.metadata) : [];
              // A trace loads when it's opened; the thread's tab already knows about its latest run.
              const tabCard = message.runId ? runTabCardByRun.get(message.runId) : undefined;
              const runCards = trace
                ? trace.cards.map((card) => ({
                    id: card._id,
                    runId: card.runId,
                    status: card.status,
                    title: card.title,
                    summary: card.summary,
                    variant: card.variant,
                    actions: card.actions,
                    provenance: card.provenance,
                    updatedAt: card.updatedAt,
                  }))
                : tabCard ? [tabCard] : [];
              const undone = runCards.some((card) => card.actions.some((action) => action.key === "undone"));
              // The work behind a reply, however this page knows about it. Without
              // any of these the reply shows "Worked for", which loads it on request.
              const replyWork = (() => {
                if (message.role !== "assistant" || !message.runId) return null;
                if (
                  liveExchange && liveExchange.runId === message.runId &&
                  !visibleMessages.slice(messageIndex + 1).some((other) => other.role === "assistant" && other.runId === message.runId)
                )
                  return {
                    steps: liveExchange.steps,
                    answers: liveExchange.answers,
                    active: liveExchange.status !== "failed" && liveExchange.status !== "waiting" && liveExchange.status !== "stopped",
                    startedAt: liveExchange.startedAt as number | undefined,
                    endedAt: undefined as number | undefined,
                  };
                if (trace) {
                  const fields = harnessTraceFields(trace);
                  if (fields)
                    return {
                      steps: fields.steps,
                      answers: fields.answers,
                      active: trace.run.status === "queued" || trace.run.status === "running",
                      ...traceTiming(trace),
                    };
                  return null;
                }
                const watched = !activeRun ? watchedRuns.get(message.runId) : undefined;
                return watched
                  ? { steps: watched.steps, answers: watched.answers, active: false, startedAt: watched.startedAt, endedAt: message.createdAt }
                  : null;
              })();
              const undoable = !undone && onCardAction ? runCards.find((card) => card.actions.some((action) => action.key === "revert")) : undefined;
              const conversationCards = (trace?.cards ?? []).flatMap((card) => {
                const repeatsAnswer = Boolean(message.content.trim()) &&
                  card.summary?.trim() === message.content.trim();
                if (repeatsAnswer && card.status === "completed" &&
                  card.variant === "status" && card.actions.length === 0) return [];
                // A finished run whose works are already shown under the reply says nothing more:
                // the work card nearest the message stays, this one goes. Questions and recovery stay.
                if (touches.length && card.status === "completed" && card.variant !== "error" &&
                  !card.actions.some((action) => DECISION_ACTIONS.has(action.key))) return [];
                // Keep work links, recovery and approval controls without
                // repeating prose already owned by the assistant message.
                const actions = touches.length ? card.actions.filter((action) => action.key !== "open") : card.actions;
                if (repeatsAnswer && card.status === "completed" && card.variant !== "error" && actions.length === 0) return [];
                return [{ ...card, actions, summary: repeatsAnswer ? undefined : card.summary }];
              });
              const affectedWorkspaceIds = trace
                ? [
                    ...new Set(
                      trace.operations
                        .flatMap((operation) => operation.affected)
                        .filter((affected) => affected.type === "workspace")
                        .map((affected) => affected.id),
                    ),
                  ]
                : [];
              const affectedWorkspaces = affectedWorkspaceIds.flatMap(
                (workspaceId) => {
                  const workspace = workspaces.find(
                    (candidate) => candidate._id === workspaceId,
                  );
                  return workspace ? [workspace] : [];
                },
              );
              return (
                <article
                  key={message._id}
                  className={cn("group relative", compact ? "mb-7" : "mb-10")}
                >
                  {message.role === "user" ? (
                    <>
                      <div className="ml-auto w-fit max-w-[82%]">
                        <div className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-card rounded-br-chip border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-ui leading-6 text-[var(--text-primary)]">
                          {message.content}
                          {messageAttachments(message).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {messageAttachments(message).map((attachment) => (
                                <span
                                  key={`${attachment.name}:${attachment.size ?? 0}`}
                                  className="flex max-w-[220px] items-center gap-1.5 rounded-control bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] px-2 py-1 text-micro text-[var(--text-secondary)]"
                                >
                                  <FileText className="h-3 w-3 shrink-0" />
                                  <span className="truncate">
                                    {attachment.name}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1.5 text-right text-micro text-[var(--text-tertiary)]">
                          {messageMeta(message)}
                        </div>
                        {/* A question still being answered shows its answer coming; details are for one left without a reply. */}
                        {shouldOfferTrace && message.runId && !(activeRun && isWorkingAiRunStatus(activeRun.status)) ? (
                          <RunDetailsDisclosure
                            run={activeRun}
                            state={traceState}
                            onLoad={() => void requestRunTrace(message.runId!)}
                          />
                        ) : null}
                      </div>
                      {trace &&
                      trace.run.status === "failed" &&
                      liveExchange?.runId !== trace.run._id &&
                      !persistedAssistantRunIds.has(trace.run._id) ? (
                        <div className="relative mt-4 pl-7">
                          <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-gold)] ring-4 ring-[color-mix(in_oklab,var(--accent-gold)_10%,transparent)]" />
                          <PersistedProgressTrace trace={trace} />
                          <PersistedRunOutcomeNote
                            trace={trace}
                            onRetryRun={onRetryRun}
                          />
                          <TerminalRunFailureNote
                            trace={trace}
                            onRetryRun={onRetryRun}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="relative pl-9">
                      <ReplyMark />
                      {replyWork ? null : trace ? (
                        <PersistedProgressTrace trace={trace} />
                      ) : !activeRun && message.runId ? (
                        (() => {
                          const asked = visibleMessages.find((other) => other.role === "user" && other.runId === message.runId);
                          if (!asked || message.createdAt <= asked.createdAt) return null;
                          const runId = message.runId;
                          return (
                            <WorkedForReveal
                              durationMs={message.createdAt - asked.createdAt}
                              loading={traceState?.loading === true}
                              error={traceState?.error}
                              onReveal={() => {
                                openTraceWhenShown(runId);
                                void requestRunTrace(runId);
                              }}
                            />
                          );
                        })()
                      ) : null}
                      {replyWork ? (
                        <ChronologicalReply
                          content={message.content}
                          steps={replyWork.steps}
                          answers={replyWork.answers}
                          active={replyWork.active}
                          hasOutput
                          persistKey={message.runId!}
                          startedAt={replyWork.startedAt}
                          endedAt={replyWork.endedAt}
                          renderText={(text) => (
                            <SpectraRichContent
                              content={text}
                              sources={messageSources(message)}
                              className={cn(
                                "text-body leading-7 text-[var(--text-primary)]",
                                !compact && "sm:text-subhead",
                              )}
                            />
                          )}
                        />
                      ) : (
                        <SpectraRichContent
                          content={message.content}
                          sources={messageSources(message)}
                          className={cn(
                            "text-body leading-7 text-[var(--text-primary)]",
                            !compact && "sm:text-subhead",
                          )}
                        />
                      )}
                      {/* A finished reply is its own account; the trace is offered only while its run is still live. */}
                      {shouldOfferTrace && activeRun && message.runId ? (
                        <RunDetailsDisclosure
                          run={activeRun}
                          state={traceState}
                          onLoad={() => void requestRunTrace(message.runId!)}
                        />
                      ) : null}
                      {trace ? <SavedAnswers trace={trace} /> : null}
                      {message.role === "assistant" ? (
                        <HarnessWidgets widgets={messageWidgets(message.metadata)} threadId={observedThreadId} onOpenArtifact={onOpenArtifact} />
                      ) : null}
                      <ReplyWork
                        threadId={observedThreadId}
                        runId={message.role === "assistant" ? message.runId : undefined}
                        touches={touches}
                        onOpen={onOpenArtifact}
                        currentTitles={currentTitles}
                        undone={undone}
                        // With no slips the result card is still on show, and it has this button.
                        onUndo={undoable && touches.length ? () => onCardAction?.(undoable, "revert") : undefined}
                      />
                      {(() => {
                        const choices = messageChoices(
                          message,
                          visibleMessages
                            .slice(messageIndex + 1)
                            .some((candidate) => candidate.role === "user"),
                        );
                        if (!choices) return null;
                        const clarification = message.metadata?.clarification && typeof message.metadata.clarification === "object"
                          ? (message.metadata.clarification as { id?: unknown; executionId?: unknown })
                          : {};
                        const saveAnswer = async (
                          choiceKey: string,
                          choiceTitle: string,
                          batchSelections?: ConversationBatchSelection[],
                        ) => {
                          await postSpectra({
                            action: "selectMessageChoice",
                            messageId: message._id,
                            ...(typeof clarification.id === "string" ? { clarificationId: clarification.id } : {}),
                            ...(typeof clarification.executionId === "string" ? { executionId: clarification.executionId } : {}),
                            choiceMessageId: message._id,
                            choiceKey,
                            choiceTitle,
                            ...(batchSelections ? { batchSelections } : {}),
                          });
                          noteAnswered({ key: `message:${message._id}`, messageId: message._id, question: "", label: choiceTitle });
                          spectraBus.emit("threads.changed", {});
                          // The island's copy of this question is settled too.
                          if (message.runId) void postSpectra({ action: "hideRunTab", runId: message.runId }).catch(() => undefined);
                          await onChoice?.({
                            title: choiceTitle,
                            key: choiceKey,
                            choiceMessageId: message._id,
                            ...(typeof clarification.id === "string" ? { clarificationId: clarification.id } : {}),
                            ...(typeof clarification.executionId === "string" ? { executionId: clarification.executionId } : {}),
                            ...(batchSelections ? { batchSelections } : {}),
                          });
                        };
                        if ("questions" in choices && choices.questions) {
                          return (
                            <BatchedChoiceBlock
                              questions={choices.questions}
                              selectedTitle={choices.selectedTitle}
                              onSubmit={(answer, selections) => saveAnswer("batch", answer, selections)}
                            />
                          );
                        }
                        return (
                          <ChoiceBlock
                            question={choices.question}
                            options={choices.options}
                            selectedTitle={choices.selectedTitle}
                            onChoose={(choice) =>
                              choice.key
                                ? saveAnswer(choice.key, choice.title)
                                : Promise.reject(new Error("This clarification is no longer available. Reload the conversation and try again."))
                            }
                            onSkip={() => saveAnswer("skip", "Skipped")}
                          />
                        );
                      })()}
                      <div className="mt-2 text-micro text-[var(--text-tertiary)]">
                        {messageMeta(message)}
                      </div>
                      {trace ? <AgentRoutingControl trace={trace} /> : null}
                      {trace && showsOperationalTrace(trace) ? <OperationalTrace trace={trace} /> : null}
                      {trace ? (
                        <>
                          <PersistedRunOutcomeNote
                            trace={trace}
                            onRetryRun={onRetryRun}
                          />
                          <TerminalRunFailureNote
                            trace={trace}
                            onRetryRun={onRetryRun}
                          />
                        </>
                      ) : null}
                      {conversationCards.length ? (
                        <ResultCardStack
                          cards={conversationCards.map((card) => ({
                              id: card._id,
                              runId: card.runId,
                              status: card.status,
                              title: card.title,
                              summary: card.summary,
                              variant: card.variant,
                              actions: card.actions,
                              provenance: card.provenance,
                              updatedAt: card.updatedAt,
                            }))}
                          className="mt-4 !max-h-none"
                          onOpen={onCardOpen}
                          onAction={onCardAction}
                          onRevise={onCardRevise}
                        />
                      ) : null}
                      {trace &&
                      (trace.eventPage?.hasMore ||
                        trace.operationPage?.hasMore ||
                        trace.cardPage?.hasMore) &&
                      message.runId ? (
                        <button
                          type="button"
                          disabled={traceState?.loading}
                          onClick={() =>
                            void requestRunTrace(message.runId!, {
                              operationsBefore: trace.operationPage?.hasMore
                                ? trace.operationPage.before ?? undefined
                                : undefined,
                              cardsBefore: trace.cardPage?.hasMore
                                ? trace.cardPage.before ?? undefined
                                : undefined,
                              eventsCursor: trace.eventPage?.hasMore
                                ? trace.eventPage.nextCursor ?? undefined
                                : undefined,
                              skipOperations: !trace.operationPage?.hasMore,
                              skipCards: !trace.cardPage?.hasMore,
                              skipEvents: !trace.eventPage?.hasMore,
                            })
                          }
                          className="mt-3 rounded-chip px-2.5 py-1 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                        >
                          {traceState?.loading ? "Loading run history…" : "Load more run history"}
                        </button>
                      ) : null}
                      {trace &&
                      touches.length === 0 &&
                      isSettledAiRunStatus(trace.run.status) &&
                      trace.artifacts.map((artifact) => (
                        <ArtifactResult
                          key={artifact._id}
                          artifact={artifact}
                          onOpen={onOpenArtifact}
                        />
                      ))}
                      {affectedWorkspaces.map((workspace) => (
                        <WorkspaceResult
                          key={workspace._id}
                          workspace={workspace}
                          onOpen={onOpenWorkspace}
                        />
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          {liveExchange ? (
            <>
              {!liveExchange.runId ||
              !persistedUserRunIds.has(liveExchange.runId) ? (
                <article className={cn("relative", compact ? "mb-7" : "mb-10")}>
                  <div className="ml-auto w-fit max-w-[82%]">
                    <div className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-card rounded-br-chip border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-ui leading-6 text-[var(--text-primary)]">
                      {liveExchange.prompt}
                    </div>
                    <div className="mt-1.5 text-right text-micro text-[var(--text-tertiary)]">
                      Sending now
                    </div>
                  </div>
                </article>
              ) : null}
              {!liveExchange.runId ||
              !persistedAssistantRunIds.has(liveExchange.runId) ? (
                <article className={cn("relative", compact ? "mb-7" : "mb-10")}>
                  <div className="relative pl-9">
                    <ReplyMark optics={LIVE_OPTICS[liveExchange.status]} />
                    {rememberWatchedRun(liveExchange)}
                    <ChronologicalReply
                      content={liveExchange.content}
                      steps={liveExchange.steps}
                      answers={liveExchange.answers}
                      active={liveExchange.status !== "failed" && liveExchange.status !== "waiting" && liveExchange.status !== "stopped"}
                      hasOutput={
                        Boolean(liveExchange.content) ||
                        liveExchange.status === "failed" ||
                        liveExchange.status === "stopped"
                      }
                      persistKey={liveExchange.runId ?? liveExchange.id}
                      startedAt={liveExchange.startedAt}
                      renderText={(text, last) => (
                        <LiveContentReveal
                          content={text}
                          streaming={last && liveExchange.status === "streaming"}
                          compact={compact}
                          sources={liveExchange.sources}
                        />
                      )}
                    />
                    <HarnessWidgets widgets={liveExchange.widgets} threadId={observedThreadId} onOpenArtifact={onOpenArtifact} />
                    <ReplyWork
                      threadId={observedThreadId}
                      runId={liveExchange.runId}
                      touches={liveExchange.artifacts ?? []}
                      onOpen={onOpenArtifact}
                    />
                    <AnsweredInputs answers={liveAnswers} />
                    {openLiveInput && liveExchange.runId && onAnswer ? (
                      <HarnessInputPanel
                        key={openLiveInput.toolCallId}
                        input={openLiveInput}
                        onAnswer={async (value) => {
                          const key = liveAnswerKey(liveExchange.runId!, openLiveInput.toolCallId);
                          noteAnswered({ key, runId: liveExchange.runId!, question: openLiveInput.question, label: answerLabel(openLiveInput, value) });
                          const accepted = await onAnswer(liveExchange.runId!, openLiveInput.toolCallId, value);
                          if (!accepted) forgetAnswered(key);
                          return accepted;
                        }}
                      />
                    ) : null}
                    {liveExchange.runId ? (
                      <LiveRunOutcomeNote
                        runId={liveExchange.runId}
                        onRetryRun={onRetryRun}
                      />
                    ) : null}
                  </div>
                </article>
              ) : null}
            </>
          ) : null}
          {!liveExchange
            ? unresolvedTraces
                .filter(
                  (trace, index, all) =>
                    all.findIndex(
                      (candidate) => candidate.run._id === trace.run._id,
                    ) === index,
                )
                .map((trace) => (
                  <div
                    key={`unresolved:${trace.run._id}`}
                    className="mb-7 ml-7 rounded-card bg-[var(--bg-secondary)] px-3.5 py-3"
                  >
                    <div className="flex items-center gap-2 text-micro font-semibold text-[var(--text-secondary)]">
                      {trace.run.status === "running" ||
                      trace.run.status === "queued" ? (
                        <PrismLoader size={14} optics="working" />
                      ) : (
                        // The prism's own states: it faces you while it waits on you, and greys on a problem.
                        <PrismLoader size={14} optics={trace.run.status === "awaiting_resolution" ? "waiting" : "failed"} />
                      )}
                      <span className="capitalize">
                        {trace.run.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                      {trace.run.status === "running"
                        ? "This response is still in progress. Saved text and progress will catch up here automatically."
                          : trace.run.status === "awaiting_resolution"
                            ? trace.run.phase === "conflict"
                              ? "The same semantic region changed concurrently. Review the preserved proposal below."
                              : "Choose an option above to continue."
                          : publicSpectraFailureText(
                              trace.run.error,
                              trace.run.retryable !== false,
                            )}
                    </p>
                    {showsOperationalTrace(trace) ? <OperationalTrace trace={trace} /> : null}
                    <PersistedRunOutcomeNote
                      trace={trace}
                      onRetryRun={onRetryRun}
                    />
                    <TerminalRunFailureNote
                      trace={trace}
                      onRetryRun={onRetryRun}
                    />
                  </div>
                ))
            : null}
          {threadId ? (
            <ArtifactEmbedList
              containerType="thread"
              containerId={threadId}
              className="mb-8 space-y-3"
              onOpenSource={onOpenArtifact}
              region={(regionId) => !isReplyEmbedRegion(regionId)}
            />
          ) : null}
          {actionableCards.length ? (
            <ResultCardStack
              cards={actionableCards.slice(0, 2)}
              className="mt-5"
              onOpen={onCardOpen}
              onAction={onCardAction}
              onRevise={onCardRevise}
            />
          ) : null}
        </div>
      </div>
      {!following ? (
        <button
          type="button"
          onClick={() => {
            setFollowing(true);
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }}
          aria-label="Go to the latest message"
          className="absolute bottom-28 right-4 z-chrome grid size-8 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-card transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function ThreadConversation({
  threadId,
  compact = false,
  liveExchange: parentLiveExchange = null,
  onOpenArtifact,
  onOpenWorkspace,
}: {
  threadId: string;
  compact?: boolean;
  liveExchange?: SpectraLiveExchange | null;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const workspaceCatalog = useWorkspaceCatalog();
  const workspaces = workspaceCatalog.items;
  const [loading, setLoading] = useState(true);
  const activeThreadIdRef = useRef(threadId);
  const refreshRequestRef = useRef(0);
  activeThreadIdRef.current = threadId;
  const refresh = useCallback(async () => {
    const requestedThreadId = threadId;
    const requestId = ++refreshRequestRef.current;
    const thread = await getSpectraThread(requestedThreadId);
    // A side-panel switch can finish the previous thread's fetch after the
    // new header has already rendered. Never let that stale response replace
    // the newly selected conversation body (or its workspace links).
    if (
      activeThreadIdRef.current !== requestedThreadId ||
      refreshRequestRef.current !== requestId
    )
      return;
    setDetail(thread);
  }, [threadId]);
  useEffect(() => {
    setDetail(null);
    setLoading(true);
    void refresh()
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not load thread.",
        ),
      )
      .finally(() => {
        if (activeThreadIdRef.current === threadId) setLoading(false);
      });
  }, [refresh, threadId]);
  useEffect(() => {
    const refreshVisibleThread = () => void refresh().catch(() => undefined);
    return spectraBus.on("threads.changed", refreshVisibleThread);
  }, [refresh]);
  useEffect(() => {
    const active = Boolean(detail?.activeExecution) || detail?.traces.some(
      (trace) =>
        trace.run.status === "queued" ||
        trace.run.status === "running" ||
        trace.run.status === "awaiting_confirmation" ||
        trace.run.status === "awaiting_resolution",
    );
    if (!active) return;
    // Durable run events are cursor-polled by useSpectraRun. Keep this full
    // thread projection as a slow recovery refresh rather than re-reading all
    // messages and events every two seconds.
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      10_000,
    );
    return () => window.clearInterval(timer);
  }, [detail?.activeExecution, detail?.traces, refresh]);
  const runEngine = useSpectraRun({
    surface: "chat",
    threadId,
    onDataChanged: refresh,
    onOpenArtifact,
    // When the parent workspace QC already owns the SSE stream, observe durable
    // tabs so this panel can still recover live progress after a refresh.
    observeDurableRuns: !parentLiveExchange,
  });
  return (
    <ConversationSurface
      detail={detail}
      threadId={threadId}
      loading={loading}
      compact={compact}
      liveExchange={runEngine.liveExchange ?? parentLiveExchange}
      onAnswer={runEngine.answer}
      workspaces={workspaces}
      onOpenArtifact={onOpenArtifact}
      onOpenWorkspace={onOpenWorkspace}
      onChoice={(choice) =>
        void runEngine.run(
          choice.title === "Skipped"
            ? "Skip that question and continue with reasonable defaults."
            : choice.description
              ? `${choice.title}: ${choice.description}`
              : choice.title,
          [],
          {
            // A clarification is a follow-up in the conversation that asked
            // it, independent of the user's default new-chat preference.
            threadId,
            clarificationId: choice.clarificationId,
            choiceKey: choice.key,
            choiceMessageId: choice.choiceMessageId,
            executionId: choice.executionId,
            batchSelections: choice.batchSelections,
          },
        )
      }
      activeCards={runEngine.cards.filter((card) =>
        card.actions.some(
          (action) =>
            action.key === "confirm" ||
            action.key === "cancel" ||
            action.key === "reject" ||
            action.key === "retry",
        ),
      )}
      onCardAction={(card, action, target) =>
        void runEngine.onCardAction(card, action, target)
      }
      onRetryRun={runEngine.retry}
    />
  );
}
