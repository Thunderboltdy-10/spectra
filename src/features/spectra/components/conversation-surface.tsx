"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  ExternalLink,
  FileText,
  FolderPlus,
  GitCompareArrows,
  Loader2,
  MessageSquare,
  PencilLine,
  ShieldCheck,
  Undo2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { SpectraMark } from "@/components/spectra-mark";
import { PrismLoader } from "@/components/spectra-prism-optic";
import { SpectraRichContent } from "./spectra-rich-content";
import { useStreamingReveal } from "../runs/streaming/use-streaming-reveal";
import { spectraBus } from "../events";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select";
import { useSpectraRun, type SpectraLiveExchange } from "../ai/use-spectra-run";
import { isSettledAiRunStatus } from "../core";
import { operationCounts, useRunLedger } from "../collaboration/run-ledger";
import { ProgressTrace } from "./progress-trace";
import {
  clearSpectraRunAgent,
  getSpectraOperationConflict,
  getSpectraThread,
  getSpectraWorkspaces,
  postSpectra,
  resolveSpectraOperationConflict,
  submitSpectraAgentFeedback,
  type SpectraArtifact,
  type SpectraOperation,
  type SpectraThreadDetail,
  type SpectraThreadTrace,
  type SpectraWorkspace,
} from "../data/api";
import { CommandBar } from "./command-bar";
import { ResultCardStack } from "./result-card";
import { workTypeMeta } from "./artifact-card";
import { ArtifactEmbedList } from "./artifact-embed-host";
import { publicSpectraFailureText } from "../runs/live-dock";

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

export type ConversationChoice = { title: string; description?: string | null };

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

function ChoiceBlock({
  question,
  options,
  selectedTitle,
  onChoose,
  onSkip,
}: {
  question: string;
  options: ConversationChoice[];
  selectedTitle?: string | null;
  onChoose?: (
    choice: ConversationChoice,
    index: number,
  ) => Promise<void> | void;
  onSkip?: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const selected = selectedTitle ?? pending;
  if (selectedTitle)
    return (
      <section
        className="mt-4 border-l-2 border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] py-1 pl-3"
        data-conversation-action="choice-answered"
        aria-label="Answered question"
      >
        <div className="text-caption font-semibold text-[var(--text-primary)]">
          {question}
        </div>
        <p className="mt-1 text-micro text-[var(--text-secondary)]">
          {selectedTitle === "Skipped"
            ? "Skipped"
            : `Answered: ${selectedTitle}`}
        </p>
      </section>
    );
  return (
    <section
      className="mt-4 overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3"
      data-conversation-action="choice"
      aria-label="Choose one response"
    >
      <div className="mb-2 text-caption font-semibold text-[var(--text-primary)]">
        {question}
      </div>
      <div
        className={`grid gap-2 ${options.length === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}
      >
        {options.map((option, index) => (
          <button
            key={`${option.title}:${index}`}
            type="button"
            disabled={Boolean(selected)}
            aria-pressed={selected === option.title}
            onClick={() => {
              setPending(option.title);
              Promise.resolve(onChoose?.(option, index)).catch((error) => {
                setPending(null);
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not save that choice.",
                );
              });
            }}
            className={`group min-h-11 rounded-card border px-3 py-2.5 text-left transition ${selected === option.title ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] hover:shadow-[0_5px_18px_rgba(27,20,12,0.06)] disabled:opacity-55"}`}
          >
            <span className="block text-caption font-semibold text-[var(--text-primary)]">
              {option.title}
            </span>
            {option.description ? (
              <span className="mt-1 block text-micro leading-4 text-[var(--text-secondary)]">
                {option.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {onSkip ? (
        <button
          type="button"
          disabled={Boolean(selected)}
          onClick={() => {
            setPending("Skipped");
            Promise.resolve(onSkip()).catch(() => setPending(null));
          }}
          className="mt-2 h-7 rounded-chip px-2 text-micro font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] disabled:opacity-45"
        >
          Skip for now
        </button>
      ) : null}
    </section>
  );
}

function BatchedChoiceBlock({
  questions,
  selectedTitle,
  onSubmit,
}: {
  questions: Array<{
    id: string;
    question: string;
    options: ConversationChoice[];
  }>;
  selectedTitle?: string | null;
  onSubmit: (answer: string) => Promise<void> | void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  if (selectedTitle)
    return (
      <section
        className="mt-4 border-l-2 border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] py-1 pl-3"
        data-conversation-action="choice-batch-answered"
        aria-label="Answered questions"
      >
        <p className="text-caption font-semibold text-[var(--text-primary)]">
          {questions.length} questions asked
        </p>
        <p className="mt-1 text-micro text-[var(--text-secondary)]">
          {selectedTitle}
        </p>
      </section>
    );
  const complete = questions.every((question) => answers[question.id]);
  return (
    <section
      className="mt-4 rounded-card border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3"
      aria-label="Answer multiple questions"
    >
      <p className="mb-2 text-caption font-bold text-[var(--text-primary)]">
        A few quick questions
      </p>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {questions.map((question, index) => (
          <fieldset key={question.id}>
            <legend className="text-micro font-semibold leading-4 text-[var(--text-primary)]">
              {index + 1}. {question.question}
            </legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {question.options.map((option) => (
                <button
                  key={option.title}
                  type="button"
                  aria-pressed={answers[question.id] === option.title}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option.title,
                    }))
                  }
                  className={`rounded-chip border px-2 py-1.5 text-left text-micro font-semibold ${answers[question.id] === option.title ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:border-[var(--accent-cyan)]"}`}
                >
                  {option.title}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={answers[question.id] === "Skipped"}
                onClick={() =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: "Skipped",
                  }))
                }
                className="rounded-chip px-2 py-1.5 text-left text-micro text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              >
                Skip this question
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={!complete || pending}
        onClick={() => {
          const answer = questions
            .map(
              (question, index) =>
                `${index + 1}) ${answers[question.id] ?? "Skipped"}`,
            )
            .join("; ");
          setPending(true);
          void Promise.resolve(onSubmit(answer)).catch(() => setPending(false));
        }}
        className="mt-3 h-9 w-full rounded-control bg-[var(--text-primary)] text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-40"
      >
        Continue with these answers
      </button>
    </section>
  );
}

function conflictSnapshot(value: unknown) {
  try {
    const formatted = JSON.stringify(value, null, 2);
    return formatted.length > 1_800
      ? `${formatted.slice(0, 1_800)}\n…`
      : formatted;
  } catch {
    return "This state could not be displayed safely.";
  }
}

function ArtifactConflictResolution({
  operation,
}: {
  operation: SpectraOperation;
}) {
  const [detail, setDetail] = useState<
    Awaited<ReturnType<typeof getSpectraOperationConflict>>["conflict"] | null
  >(null);
  const [busy, setBusy] = useState<
    "apply" | "keep_current" | "merge" | "cancel" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeDraft, setMergeDraft] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const result = await getSpectraOperationConflict(operation._id);
        if (!active) return;
        setDetail(result.conflict);
        setMergeDraft(
          (current) =>
            current || JSON.stringify(result.conflict.input, null, 2),
        );
        setError(null);
        if (result.conflict.claimStatus === "queued")
          timer = setTimeout(load, 1_500);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the conflict.",
          );
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [operation._id]);
  const resolve = async (
    resolution: "apply" | "keep_current" | "merge" | "cancel",
  ) => {
    setBusy(resolution);
    setError(null);
    try {
      let mergedInput: unknown;
      if (resolution === "merge") {
        try {
          mergedInput = JSON.parse(mergeDraft);
        } catch {
          throw new Error("The merged proposal is not valid JSON yet.");
        }
        if (
          !mergedInput ||
          typeof mergedInput !== "object" ||
          Array.isArray(mergedInput)
        ) {
          throw new Error(
            "The merged proposal must remain an operation object.",
          );
        }
      }
      await resolveSpectraOperationConflict(
        operation._id,
        resolution,
        mergedInput,
      );
      spectraBus.emit("threads.changed", {});
      toast.success(
        resolution === "apply"
          ? "Spectra's proposal is queued to apply."
          : resolution === "merge"
            ? "Your merged proposal is queued to apply."
            : resolution === "cancel"
              ? "The proposal was cancelled."
              : "The current work was kept.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not resolve the conflict.",
      );
    } finally {
      setBusy(null);
    }
  };
  const available = detail?.claimStatus === "paused";
  return (
    <section
      className="mt-2 overflow-hidden rounded-card border border-[color-mix(in_oklab,var(--accent-gold)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-gold)_4%,var(--bg-elevated))]"
      aria-label="Resolve work edit conflict"
    >
      <header className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <GitCompareArrows className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <div className="text-micro font-semibold text-[var(--text-primary)]">
            Same-region edit needs your decision
          </div>
          <p className="mt-0.5 text-micro leading-4 text-[var(--text-secondary)]">
            {detail?.conflict.regionId ??
              operation.conflict?.regionId ??
              "This region"}{" "}
            {available
              ? "is now available."
              : "is still occupied. Spectra will not overwrite it."}
          </p>
        </div>
      </header>
      {detail ? (
        <div className="grid gap-px bg-[var(--border-subtle)] md:grid-cols-3">
          <div className="bg-[var(--bg-primary)] p-2.5">
            <div className="mb-1.5 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Before Spectra
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(detail.conflict.baseSnapshot)}
            </pre>
          </div>
          <div className="bg-[var(--bg-primary)] p-2.5">
            <div className="mb-1.5 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Current
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(detail.currentSnapshot)}
            </pre>
          </div>
          <div className="bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-primary))] p-2.5">
            <div className="mb-1.5 flex items-center gap-1 text-micro font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
              <SpectraMark mono size={12} />
              Spectra proposal
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-micro leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(
                detail.conflict.proposedSnapshot ?? detail.input,
              )}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-4 text-micro text-[var(--text-tertiary)]">
          <PrismLoader size={14} optics="working" />
          Loading current and proposed states
        </div>
      )}
      {mergeOpen ? (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <PencilLine className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            <div>
              <div className="text-micro font-semibold text-[var(--text-primary)]">
                Edit the merged operation
              </div>
              <p className="mt-0.5 text-micro leading-4 text-[var(--text-tertiary)]">
                Adjust only the proposed fields you want Spectra to apply. The
                operation is validated again before it can touch the work.
              </p>
            </div>
          </div>
          <textarea
            value={mergeDraft}
            onChange={(event) => setMergeDraft(event.target.value)}
            spellCheck={false}
            aria-label="Merged work operation"
            className="min-h-44 w-full resize-y rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 font-mono text-micro leading-4 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_15%,transparent)]"
          />
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-t border-[var(--border-subtle)] px-3 py-2 text-micro text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve("cancel")}
          className="min-h-8 rounded-control px-2.5 text-micro font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
        >
          Cancel proposal
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve("keep_current")}
          className="min-h-8 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
        >
          {busy === "keep_current" ? "Keeping…" : "Keep current"}
        </button>
        <button
          type="button"
          disabled={!detail || Boolean(busy)}
          onClick={() => {
            setError(null);
            setMergeOpen((open) => !open);
          }}
          className="min-h-8 rounded-control border border-[color-mix(in_oklab,var(--accent-cyan)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-2.5 text-micro font-semibold text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] disabled:opacity-45"
        >
          {mergeOpen ? "Close merge" : "Edit & merge"}
        </button>
        {mergeOpen ? (
          <button
            type="button"
            disabled={!available || Boolean(busy)}
            onClick={() => void resolve("merge")}
            className="min-h-8 rounded-control bg-[var(--accent-cyan)] px-3 text-micro font-semibold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "merge"
              ? "Queuing…"
              : available
                ? "Apply merged edit"
                : "Waiting for region"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!available || Boolean(busy)}
            onClick={() => void resolve("apply")}
            className="min-h-8 rounded-control bg-[var(--accent-cyan)] px-3 text-micro font-semibold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "apply"
              ? "Queuing…"
              : available
                ? "Apply proposal"
                : "Waiting for region"}
          </button>
        )}
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
        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-micro font-semibold text-[var(--text-tertiary)]">
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
                className={`rounded-full px-1.5 py-0.5 text-center text-micro font-bold uppercase tracking-[.08em] ${change.kind === "add" ? "bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]" : change.kind === "remove" ? "bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] text-[var(--danger)]" : "bg-[color-mix(in_oklab,var(--accent-cyan)_9%,transparent)] text-[var(--accent-cyan)]"}`}
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
          <div className="mb-1.5 text-micro font-bold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            Requires explicit review
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sensitive.map((item) => (
              <span
                key={item}
                className="rounded-full border border-[color-mix(in_oklab,var(--accent-gold)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-gold)_6%,var(--bg-primary))] px-2 py-1 text-micro font-semibold text-[var(--warning)]"
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
              {publicSpectraFailureText(
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
  onRetry,
}: {
  savedCount: number;
  failedCount: number;
  retrying?: boolean;
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
          Completed work stays saved. Retry continues only the unfinished part.
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
      onRetry={
        onRetryRun
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
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-chip bg-[var(--text-primary)] px-2 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-50"
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PersistedProgressTrace({ trace }: { trace: SpectraThreadTrace }) {
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
      summary={trace.run.finalSummary}
      persistKey={trace.run._id}
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
              <MessageSquare className="h-2.5 w-2.5" />
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
            are aggregated; your prompt, thread, memory, and artifacts are never
            shared.
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
  workspaces,
  onOpen,
}: {
  artifact: SpectraArtifact;
  workspaces: SpectraWorkspace[];
  onOpen?: (id: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
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
          {workspaces.length === 0 ? (
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
}: {
  content: string;
  streaming: boolean;
  compact?: boolean;
}) {
  const { visibleText, active } = useStreamingReveal(content, {
    profile: "conversation",
    enabled: streaming,
  });
  return (
    <div className={active ? "spectra-stream-active" : undefined}>
      <SpectraRichContent
        content={visibleText}
        className={cn(
          "text-body leading-7 text-[var(--text-primary)]",
          !compact && "sm:text-subhead",
        )}
      />
    </div>
  );
}

export function ConversationSurface({
  detail,
  threadId,
  loading = false,
  empty,
  composer,
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
}: {
  detail: SpectraThreadDetail | null;
  threadId?: string;
  loading?: boolean;
  empty?: ReactNode;
  composer?: ReactNode;
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
}) {
  const traceByRun = useMemo(
    () =>
      new Map((detail?.traces ?? []).map((trace) => [trace.run._id, trace])),
    [detail],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const persistedUserRunIds = useMemo(
    () =>
      new Set(
        detail?.messages.flatMap((message) =>
          message.role === "user" && message.runId ? [message.runId] : [],
        ) ?? [],
      ),
    [detail],
  );
  const persistedAssistantRunIds = useMemo(
    () =>
      new Set(
        detail?.messages.flatMap((message) =>
          message.role === "assistant" && message.runId ? [message.runId] : [],
        ) ?? [],
      ),
    [detail],
  );
  const unresolvedTraces = useMemo(
    () =>
      (detail?.traces ?? []).filter(
        (trace) =>
          !persistedUserRunIds.has(trace.run._id) &&
          !persistedAssistantRunIds.has(trace.run._id) &&
          trace.run.status !== "completed",
      ),
    [detail, persistedAssistantRunIds, persistedUserRunIds],
  );
  useEffect(() => {
    if (!following) return;
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
    detail?.messages.length,
    detail?.traces.length,
    detail?.thread._id,
    following,
    liveExchange?.content,
  ]);
  useEffect(() => {
    if (!following || !contentRef.current) return;
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
  }, [detail?.thread._id, following]);
  useEffect(() => setFollowing(true), [detail?.thread._id]);
  const messageMeta = useCallback(
    (message: NonNullable<SpectraThreadDetail>["messages"][number]) => {
      return [
        message.role === "user" ? (detail?.viewerName ?? "You") : "Spectra",
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(message.createdAt),
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [detail?.viewerName],
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
          compact ? "px-5 pb-32 pt-5" : "px-5 pb-40 pt-10 sm:px-8",
        )}
      >
        <div
          ref={contentRef}
          className={cn("mx-auto", compact ? "max-w-[760px]" : "max-w-[820px]")}
        >
          {loading ? (
            <div className="space-y-8 py-10" aria-label="Loading conversation">
              <div className="ml-auto h-16 w-[58%] animate-pulse rounded-surface bg-[var(--bg-secondary)]" />
              <div className="space-y-3">
                <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-secondary)]" />
                <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-secondary)]" />
                <div className="h-3 w-[72%] animate-pulse rounded bg-[var(--bg-secondary)]" />
              </div>
            </div>
          ) : null}
          {!loading && !detail && !liveExchange ? empty : null}
          {detail?.messages
            .filter(
              (message) =>
                message.role === "user" || message.role === "assistant",
            )
            .map((message, messageIndex, visibleMessages) => {
              const trace = message.runId
                ? traceByRun.get(message.runId)
                : undefined;
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
                      <div className="ml-auto max-w-[82%]">
                        <div className="whitespace-pre-wrap rounded-card rounded-br-chip border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-ui leading-6 text-[var(--text-primary)]">
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
                    <div className="relative pl-8">
                      <span className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-chip bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] ring-4 ring-cyan/10">
                        <SpectraMark size={13} />
                      </span>
                      {trace && trace.run.providerUsed !== "Spectra" ? (
                        <PersistedProgressTrace trace={trace} />
                      ) : null}
                      <SpectraRichContent
                        content={message.content}
                        className={cn(
                          "text-body leading-7 text-[var(--text-primary)]",
                          !compact && "sm:text-subhead",
                        )}
                      />
                      {(() => {
                        const choices = messageChoices(
                          message,
                          visibleMessages
                            .slice(messageIndex + 1)
                            .some((candidate) => candidate.role === "user"),
                        );
                        if (!choices) return null;
                        const saveAnswer = async (
                          choiceKey: string,
                          choiceTitle: string,
                        ) => {
                          await postSpectra({
                            action: "selectMessageChoice",
                            messageId: message._id,
                            choiceKey,
                            choiceTitle,
                          });
                          spectraBus.emit("threads.changed", {});
                          await onChoice?.({ title: choiceTitle });
                        };
                        if ("questions" in choices && choices.questions) {
                          return (
                            <BatchedChoiceBlock
                              questions={choices.questions}
                              selectedTitle={choices.selectedTitle}
                              onSubmit={(answer) => saveAnswer("batch", answer)}
                            />
                          );
                        }
                        return (
                          <ChoiceBlock
                            question={choices.question}
                            options={choices.options}
                            selectedTitle={choices.selectedTitle}
                            onChoose={(choice, index) =>
                              saveAnswer(
                                `${index}:${choice.title}`,
                                choice.description
                                  ? `${choice.title}: ${choice.description}`
                                  : choice.title,
                              )
                            }
                            onSkip={() => saveAnswer("skip", "Skipped")}
                          />
                        );
                      })()}
                      <div className="mt-2 text-micro text-[var(--text-tertiary)]">
                        {messageMeta(message)}
                      </div>
                      {trace ? <AgentRoutingControl trace={trace} /> : null}
                      {trace &&
                      (trace.operations.length > 0 ||
                        [
                          "failed",
                          "cancelled",
                          "awaiting_confirmation",
                          "awaiting_resolution",
                        ].includes(trace.run.status)) ? (
                        <OperationalTrace trace={trace} />
                      ) : null}
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
                      {trace?.cards.some((card) =>
                        card.actions.some(
                          (action) =>
                            action.key === "confirm" ||
                            action.key === "cancel" ||
                            action.key === "reject",
                        ),
                      ) ? (
                        <ResultCardStack
                          cards={trace.cards
                            .filter((card) =>
                              card.actions.some(
                                (action) =>
                                  action.key === "confirm" ||
                                  action.key === "cancel" ||
                                  action.key === "reject",
                              ),
                            )
                            .map((card) => ({
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
                      isSettledAiRunStatus(trace.run.status) &&
                      trace.artifacts.map((artifact) => (
                        <ArtifactResult
                          key={artifact._id}
                          artifact={artifact}
                          workspaces={workspaces}
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
                  <div className="ml-auto max-w-[82%]">
                    <div className="rounded-card rounded-br-chip border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-ui leading-6 text-[var(--text-primary)]">
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
                  <div className="relative pl-8">
                    <span className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-chip bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] ring-4 ring-cyan/10">
                      <SpectraMark size={13} />
                    </span>
                    <ProgressTrace
                      steps={liveExchange.steps}
                      active={liveExchange.status !== "failed"}
                      hasOutput={
                        Boolean(liveExchange.content) ||
                        liveExchange.status === "failed"
                      }
                      summary={
                        liveExchange.status === "streaming"
                          ? undefined
                          : liveExchange.content?.slice(0, 180)
                      }
                      persistKey={liveExchange.runId ?? liveExchange.id}
                    />
                    {liveExchange.content ? (
                      <LiveContentReveal
                        content={liveExchange.content}
                        streaming={liveExchange.status === "streaming"}
                        compact={compact}
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
                      ) : trace.run.status === "awaiting_resolution" ? (
                        <GitCompareArrows className="h-3.5 w-3.5 text-[var(--warning)]" />
                      ) : (
                        <AlertCircle
                          className={`h-3.5 w-3.5 ${trace.run.retryable === false ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}
                        />
                      )}
                      <span className="capitalize">
                        {trace.run.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                      {trace.run.status === "running"
                        ? "This response is still in progress. Saved text and progress will catch up here automatically."
                        : trace.run.status === "awaiting_resolution"
                          ? "The same semantic region changed concurrently. Review the preserved proposal below."
                          : publicSpectraFailureText(
                              trace.run.error,
                              trace.run.retryable !== false,
                            )}
                    </p>
                    {trace.operations.length > 0 ||
                    [
                      "failed",
                      "cancelled",
                      "awaiting_confirmation",
                      "awaiting_resolution",
                    ].includes(trace.run.status) ? (
                      <OperationalTrace trace={trace} />
                    ) : null}
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
            />
          ) : null}
          {activeCards?.some((card) =>
            card.actions.some(
              (action) =>
                action.key === "confirm" ||
                action.key === "cancel" ||
                action.key === "reject" ||
                action.key === "retry",
            ),
          ) ? (
            <ResultCardStack
              cards={activeCards
                .filter((card) =>
                  card.actions.some(
                    (action) =>
                      action.key === "confirm" ||
                      action.key === "cancel" ||
                      action.key === "reject" ||
                      action.key === "retry",
                  ),
                )
                .slice(0, 2)}
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
          className="absolute bottom-28 left-1/2 z-chrome flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 text-micro font-medium text-[var(--text-secondary)] shadow-card hover:text-[var(--text-primary)]"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Latest
        </button>
      ) : null}
      {composer ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,var(--bg-primary)_76%,transparent)] px-4 pb-5 pt-14 sm:px-8">
          <div
            className={cn(
              "pointer-events-auto mx-auto",
              compact ? "max-w-[760px]" : "max-w-[820px]",
            )}
          >
            {composer}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ThreadConversation({
  threadId,
  compact = false,
  showComposer = true,
  liveExchange: parentLiveExchange = null,
  onOpenArtifact,
  onOpenWorkspace,
}: {
  threadId: string;
  compact?: boolean;
  showComposer?: boolean;
  liveExchange?: SpectraLiveExchange | null;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const activeThreadIdRef = useRef(threadId);
  const refreshRequestRef = useRef(0);
  activeThreadIdRef.current = threadId;
  const refresh = useCallback(async () => {
    const requestedThreadId = threadId;
    const requestId = ++refreshRequestRef.current;
    const [thread, workspaceRows] = await Promise.all([
      getSpectraThread(requestedThreadId),
      getSpectraWorkspaces(),
    ]);
    // A side-panel switch can finish the previous thread's fetch after the
    // new header has already rendered. Never let that stale response replace
    // the newly selected conversation body (or its workspace links).
    if (
      activeThreadIdRef.current !== requestedThreadId ||
      refreshRequestRef.current !== requestId
    )
      return;
    setDetail(thread);
    setWorkspaces(workspaceRows);
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
    const active = detail?.traces.some(
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
  }, [detail?.traces, refresh]);
  const runEngine = useSpectraRun({
    surface: "chat",
    threadId,
    onDataChanged: refresh,
    onOpenArtifact,
    // When the parent workspace QC already owns the SSE stream, observe durable
    // tabs so this panel can still recover live progress after a refresh.
    observeDurableRuns: !parentLiveExchange,
  });
  const activeRunId =
    parentLiveExchange?.runId ??
    detail?.traces.find((trace) =>
      [
        "queued",
        "running",
        "awaiting_confirmation",
        "awaiting_resolution",
      ].includes(trace.run.status),
    )?.run._id;
  return (
    <ConversationSurface
      detail={detail}
      threadId={threadId}
      loading={loading}
      compact={compact}
      liveExchange={parentLiveExchange ?? runEngine.liveExchange}
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
      composer={
        showComposer ? (
          <CommandBar
            placeholder="Continue this thread…"
            busy={runEngine.submitting}
            allowAttachments
            onStop={runEngine.stop}
            activeRunId={activeRunId}
            onSteer={runEngine.steer}
            onSubmit={(value, attachments) => runEngine.run(value, attachments)}
            context={
              <span className="flex items-center gap-1.5 text-micro text-[var(--text-secondary)]">
                <MessageSquare className="h-3.5 w-3.5" />
                Thread
              </span>
            }
          />
        ) : undefined
      }
    />
  );
}
