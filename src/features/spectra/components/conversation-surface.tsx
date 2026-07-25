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
  Sparkles,
  Undo2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { useSpectraRun, type SpectraLiveExchange } from "../ai/use-spectra-run";
import { pastTenseProgressTitle } from "./progress-title";
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
import { blueprintMeta } from "./artifact-card";

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
    return `${proposed ? "Create" : "Created"} ${title ?? "artifact"}`;
  if (operation.type === "artifact.update")
    return `${proposed ? "Update" : "Updated"} ${target ?? "focused artifact"}`;
  if (operation.type === "artifact.link")
    return proposed ? "Link the new artifacts" : "Linked the new artifacts";
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

function messageChoices(message: SpectraThreadDetail["messages"][number]) {
  const value = message.metadata?.choices;
  if (!value || typeof value !== "object") return null;
  const row = value as { question?: unknown; options?: unknown };
  if (
    typeof row.question !== "string" ||
    !Array.isArray(row.options) ||
    row.options.length < 2 ||
    row.options.length > 4
  )
    return null;
  const options = row.options.flatMap((option): ConversationChoice[] =>
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
  );
  const selection = message.metadata?.choiceSelection;
  const selectedTitle =
    selection &&
    typeof selection === "object" &&
    typeof (selection as { title?: unknown }).title === "string"
      ? String((selection as { title: string }).title)
      : null;
  return options.length >= 2
    ? { question: row.question, options, selectedTitle }
    : null;
}

function ChoiceBlock({
  question,
  options,
  selectedTitle,
  onChoose,
}: {
  question: string;
  options: ConversationChoice[];
  selectedTitle?: string | null;
  onChoose?: (
    choice: ConversationChoice,
    index: number,
  ) => Promise<void> | void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const selected = selectedTitle ?? pending;
  return (
    <section
      className="mt-4 overflow-hidden rounded-[11px] border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3"
      data-conversation-action="choice"
      aria-label="Choose one response"
    >
      <div className="mb-2 text-[12px] font-semibold text-[var(--text-primary)]">
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
            className={`group min-h-11 rounded-[9px] border px-3 py-2.5 text-left transition ${selected === option.title ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] hover:shadow-[0_5px_18px_rgba(27,20,12,0.06)] disabled:opacity-55"}`}
          >
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              {option.title}
            </span>
            {option.description ? (
              <span className="mt-1 block text-[11px] leading-4 text-[var(--text-secondary)]">
                {option.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {selectedTitle ? (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
          Choice saved for this conversation.
        </p>
      ) : null}
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
      window.dispatchEvent(new CustomEvent("spectra:threads-changed"));
      window.dispatchEvent(new CustomEvent("spectra:runs-changed"));
      toast.success(
        resolution === "apply"
          ? "Spectra's proposal is queued to apply."
          : resolution === "merge"
            ? "Your merged proposal is queued to apply."
            : resolution === "cancel"
              ? "The proposal was cancelled."
              : "The current artifact was kept.",
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
      className="mt-2 overflow-hidden rounded-[9px] border border-[color-mix(in_oklab,#d88922_24%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_4%,var(--bg-elevated))]"
      aria-label="Resolve artifact edit conflict"
    >
      <header className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <GitCompareArrows className="mt-0.5 h-4 w-4 shrink-0 text-[#b46d15]" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--text-primary)]">
            Same-region edit needs your decision
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">
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
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Before Spectra
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(detail.conflict.baseSnapshot)}
            </pre>
          </div>
          <div className="bg-[var(--bg-primary)] p-2.5">
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Current
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(detail.currentSnapshot)}
            </pre>
          </div>
          <div className="bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-primary))] p-2.5">
            <div className="mb-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">
              <Sparkles className="h-3 w-3" />
              Spectra proposal
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-[var(--text-secondary)]">
              {conflictSnapshot(
                detail.conflict.proposedSnapshot ?? detail.input,
              )}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-4 text-[10px] text-[var(--text-tertiary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading current and proposed states
        </div>
      )}
      {mergeOpen ? (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <PencilLine className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-primary)]">
                Edit the merged operation
              </div>
              <p className="mt-0.5 text-[9px] leading-4 text-[var(--text-tertiary)]">
                Adjust only the proposed fields you want Spectra to apply. The
                operation is validated again before it can touch the artifact.
              </p>
            </div>
          </div>
          <textarea
            value={mergeDraft}
            onChange={(event) => setMergeDraft(event.target.value)}
            spellCheck={false}
            aria-label="Merged artifact operation"
            className="min-h-44 w-full resize-y rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 font-mono text-[10px] leading-4 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_15%,transparent)]"
          />
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve("cancel")}
          className="min-h-8 rounded-[7px] px-2.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
        >
          Cancel proposal
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve("keep_current")}
          className="min-h-8 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[10px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
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
          className="min-h-8 rounded-[7px] border border-[color-mix(in_oklab,var(--accent-cyan)_32%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-2.5 text-[10px] font-semibold text-[var(--accent-cyan)] hover:bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] disabled:opacity-45"
        >
          {mergeOpen ? "Close merge" : "Edit & merge"}
        </button>
        {mergeOpen ? (
          <button
            type="button"
            disabled={!available || Boolean(busy)}
            onClick={() => void resolve("merge")}
            className="min-h-8 rounded-[7px] bg-[var(--accent-cyan)] px-3 text-[10px] font-semibold text-white shadow-[0_5px_16px_color-mix(in_oklab,var(--accent-cyan)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
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
            className="min-h-8 rounded-[7px] bg-[var(--accent-cyan)] px-3 text-[10px] font-semibold text-white shadow-[0_5px_16px_color-mix(in_oklab,var(--accent-cyan)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
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
      className="mt-2 overflow-hidden rounded-[9px] border border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-primary))]"
      aria-label="Review Code proposal"
    >
      <header className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--text-primary)]">
            Code proposal
          </div>
          <p className="mt-0.5 text-[9px] leading-4 text-[var(--text-secondary)]">
            Review the project shape and privileged boundaries before anything
            is applied.
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[8px] font-semibold text-[var(--text-tertiary)]">
          {changes.length || paths.length} change
          {(changes.length || paths.length) === 1 ? "" : "s"}
        </span>
      </header>
      {changes.length ? (
        <div className="divide-y divide-[var(--border-subtle)]">
          {changes.slice(0, 12).map((change) => (
            <div
              key={change.id}
              className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[9px]"
            >
              <span
                className={`rounded-full px-1.5 py-0.5 text-center text-[7px] font-bold uppercase tracking-[.08em] ${change.kind === "add" ? "bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]" : change.kind === "remove" ? "bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] text-[var(--danger)]" : "bg-[color-mix(in_oklab,var(--accent-cyan)_9%,transparent)] text-[var(--accent-cyan)]"}`}
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
        <div className="px-3 py-3 text-[9px] text-[var(--text-secondary)]">
          Targeted patch across {paths.length} stable path
          {paths.length === 1 ? "" : "s"}.
        </div>
      )}
      {sensitive.length ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
          <div className="mb-1.5 text-[8px] font-bold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            Requires explicit review
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sensitive.map((item) => (
              <span
                key={item}
                className="rounded-full border border-[color-mix(in_oklab,#d88922_28%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_6%,var(--bg-primary))] px-2 py-1 text-[8px] font-semibold text-[#a86616]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <footer className="border-t border-[var(--border-subtle)] px-3 py-2 text-[8px] text-[var(--text-tertiary)]">
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
          <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
        ) : trace.run.status === "awaiting_confirmation" ? (
          <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
        ) : trace.run.status === "awaiting_resolution" ? (
          <GitCompareArrows className="h-3.5 w-3.5 text-[#b46d15]" />
        ) : (
          <Wrench className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
        )}
        <span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">
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
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {trace.run.error ?? "No changes were applied."}
            </p>
          ) : (
            <div className="space-y-2">
              {trace.operations.map((operation) => (
                <div
                  key={operation._id}
                  className="rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_58%,transparent)] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    {operation.status === "executed" ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                    ) : operation.status === "failed" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
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
                      <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                        {operation.affected.length} affected
                      </span>
                    ) : null}
                  </div>
                  {operation.affected.length > 0 ? (
                    <div className="mt-1.5 pl-5 text-[10px] leading-4 text-[var(--text-tertiary)]">
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

function ProgressTrace({
  steps,
  active,
}: {
  steps: SpectraLiveExchange["steps"];
  active: boolean;
}) {
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  useEffect(() => {
    const running = steps.find((step) => step.status === "running");
    if (running) setOpenStepId(running.id);
    else if (!active) setOpenStepId(null);
  }, [active, steps]);
  if (steps.length === 0) return null;
  return (
    <div
      className="sticky top-0 z-[5] mb-3 space-y-1.5 bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] py-1 backdrop-blur-[2px]"
      aria-label="Spectra progress"
    >
      {steps.map((step, index) => {
        const open = openStepId === step.id;
        return (
          <div
            key={`${step.id}:${index}`}
            className="rounded-[8px] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)] px-2.5 py-1.5"
          >
            <button
              type="button"
              onClick={() => setOpenStepId(open ? null : step.id)}
              className="flex w-full items-center gap-2 text-left"
            >
              {step.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
              ) : step.status === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
              ) : (
                <Check className="h-3.5 w-3.5 text-[var(--success)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--text-secondary)]">
                {pastTenseProgressTitle(
                  step.title,
                  step.status !== "running",
                )}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && step.summary ? (
              <p className="ml-5 mt-1 text-[10px] leading-4 text-[var(--text-tertiary)]">
                {pastTenseProgressTitle(
                  step.summary,
                  step.status !== "running",
                )}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PersistedProgressTrace({ trace }: { trace: SpectraThreadTrace }) {
  const rows = (trace.events ?? []).filter(
    (event) =>
      (!trace.run.executionId || event.executionId === trace.run.executionId) &&
      (event.type === "progress" ||
        event.type === "operation_preview" ||
        event.type === "approval_accepted" ||
        event.type === "approval_rejected" ||
        event.type === "error" ||
        event.type === "stopped" ||
        event.type === "interrupted"),
  );
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
      trace.run.status !== "completed"
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
    if (existingIndex === -1) publicSteps.push(step);
    else publicSteps[existingIndex] = step;
    return publicSteps;
  }, []);
  return (
    <ProgressTrace
      steps={steps}
      active={trace.run.status === "queued" || trace.run.status === "running"}
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
      window.dispatchEvent(new Event("spectra:threads-changed"));
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
        className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
        title={reason}
      >
        <Bot className="h-3 w-3 shrink-0 text-[var(--accent-cyan)]" />
        <span className="truncate font-semibold">{title}</span>
        <span className="shrink-0 text-[9px] text-[var(--text-tertiary)]">
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
            className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-semibold hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-65"
          >
            {feedbackSent ? <Check className="h-2.5 w-2.5" /> : <MessageSquare className="h-2.5 w-2.5" />}
            {feedbackSent ? "Feedback sent" : "Rate"}
          </button>
        ) : null}
        <button
        type="button"
        disabled={busy || ordinaryNext}
        onClick={() => void clearAgent()}
        className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-semibold hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-65"
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
        <div className="mt-1.5 grid gap-2 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-[10px] shadow-[var(--shadow-sm)]">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <label className="grid gap-1">
              <span className="font-semibold text-[var(--text-secondary)]">Rating</span>
              <select value={feedbackRating} onChange={(event) => setFeedbackRating(Number(event.target.value))} className="h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2">
                {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-semibold text-[var(--text-secondary)]">Category</span>
              <select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as typeof feedbackCategory)} className="h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2">
                <option value="helpful">Helpfulness</option><option value="accuracy">Accuracy</option><option value="clarity">Clarity</option><option value="safety">Safety</option><option value="resource_quality">Source quality</option><option value="other">Other</option>
              </select>
            </label>
          </div>
          <textarea value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value)} placeholder="Optional detail — never include private information" className="min-h-16 resize-y rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 outline-none" />
          <label className="flex items-start gap-2 text-[9px] text-[var(--text-tertiary)]">
            <input type="checkbox" checked={shareComment} onChange={(event) => setShareComment(event.target.checked)} />
            Share this comment with the agent creator. The rating and category are aggregated; your prompt, thread, memory, and artifacts are never shared.
          </label>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setFeedbackOpen(false)} className="h-8 rounded-[6px] px-2.5 text-[var(--text-secondary)]">Cancel</button>
            <button type="button" disabled={feedbackBusy} onClick={() => void submitFeedback()} className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-[var(--accent-cyan)] px-2.5 font-semibold text-white disabled:opacity-60">{feedbackBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Share feedback</button>
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
  const meta = blueprintMeta[artifact.blueprintKey];
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
          className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)]"
          style={{ color: meta?.color ?? "#d88922" }}
        >
          <ArtifactIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(artifact._id)}
              className="rounded-[4px] text-left text-[12px] font-semibold text-[var(--text-primary)] outline-none hover:text-[var(--accent-cyan)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
            >
              {artifact.title}
            </button>
          ) : (
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">
              {artifact.title}
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {artifact.summary ?? artifact.blueprintKey.replaceAll("_", " ")}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.(artifact._id);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Open artifact"
          title="Open artifact"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setChoosing((value) => !value);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
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
                        : "Could not add artifact.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
              className="rounded-[6px] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {workspace.title}
            </button>
          ))}
          {workspaces.length === 0 ? (
            <span className="text-[11px] text-[var(--text-tertiary)]">
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
      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[7px] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))] text-[var(--accent-cyan)]">
        <FolderPlus className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
          {workspace.title}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
          {workspace.description ?? "Workspace updated by Spectra."}
        </span>
      </span>
      <ExternalLink className="mt-1 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
    </button>
  );
}

export function ConversationSurface({
  detail,
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
}: {
  detail: SpectraThreadDetail | null;
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
          !persistedAssistantRunIds.has(trace.run._id) &&
          trace.run.status !== "completed",
      ),
    [detail, persistedAssistantRunIds],
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
              <div className="ml-auto h-16 w-[58%] animate-pulse rounded-[16px] bg-[var(--bg-secondary)]" />
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
            .map((message) => {
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
                    <div className="ml-auto max-w-[82%]">
                      <div className="whitespace-pre-wrap rounded-[18px_18px_5px_18px] border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-[13px] leading-6 text-[var(--text-primary)]">
                        {message.content}
                        {messageAttachments(message).length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {messageAttachments(message).map((attachment) => (
                              <span
                                key={`${attachment.name}:${attachment.size ?? 0}`}
                                className="flex max-w-[220px] items-center gap-1.5 rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
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
                      <div className="mt-1.5 text-right text-[10px] text-[var(--text-tertiary)]">
                        {messageMeta(message)}
                      </div>
                    </div>
                  ) : (
                      <div className="relative pl-7">
                      <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]" />
                      {trace && trace.run.providerUsed !== "Spectra" ? (
                        <PersistedProgressTrace trace={trace} />
                      ) : null}
                      <RichText
                        content={message.content}
                        className={cn(
                          "text-[14px] leading-7 text-[var(--text-primary)]",
                          !compact && "sm:text-[15px]",
                        )}
                      />
                      {messageChoices(message) ? (
                        <ChoiceBlock
                          {...messageChoices(message)!}
                          onChoose={async (choice, index) => {
                            await postSpectra({
                              action: "selectMessageChoice",
                              messageId: message._id,
                              choiceKey: `${index}:${choice.title}`,
                              choiceTitle: choice.title,
                            });
                            window.dispatchEvent(
                              new CustomEvent("spectra:threads-changed"),
                            );
                            await onChoice?.(choice);
                          }}
                        />
                      ) : null}
                      <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
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
                      {trace?.artifacts.map((artifact) => (
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
                    <div className="rounded-[18px_18px_5px_18px] border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-[13px] leading-6 text-[var(--text-primary)]">
                      {liveExchange.prompt}
                    </div>
                    <div className="mt-1.5 text-right text-[10px] text-[var(--text-tertiary)]">
                      Sending now
                    </div>
                  </div>
                </article>
              ) : null}
              {!liveExchange.runId ||
              !persistedAssistantRunIds.has(liveExchange.runId) ? (
                <article className={cn("relative", compact ? "mb-7" : "mb-10")}>
                  <div className="relative pl-7">
                    <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]" />
                    <ProgressTrace
                      steps={liveExchange.steps}
                      active={liveExchange.status !== "failed"}
                    />
                    {liveExchange.content ? (
                      <RichText
                        content={liveExchange.content}
                        className={cn(
                          "text-[14px] leading-7 text-[var(--text-primary)]",
                          !compact && "sm:text-[15px]",
                        )}
                      />
                    ) : liveExchange.steps.length === 0 &&
                      liveExchange.status !== "failed" ? (
                      <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--text-tertiary)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Getting started
                      </div>
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
                  className="mb-7 ml-7 rounded-[9px] bg-[var(--bg-secondary)] px-3.5 py-3"
                >
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
                    {trace.run.status === "running" ||
                    trace.run.status === "queued" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
                    ) : trace.run.status === "awaiting_resolution" ? (
                      <GitCompareArrows className="h-3.5 w-3.5 text-[#b46d15]" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
                    )}
                    <span className="capitalize">
                      {trace.run.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--text-tertiary)]">
                    {trace.run.status === "running"
                      ? "This response is still in progress. Saved text and progress will catch up here automatically."
                      : trace.run.status === "awaiting_resolution"
                        ? "The same semantic region changed concurrently. Review the preserved proposal below."
                        : (trace.run.error ??
                          "No incomplete assistant message was saved.")}
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
                </div>
              ))
            : null}
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
          className="absolute bottom-28 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 text-[11px] font-medium text-[var(--text-secondary)] shadow-[0_8px_24px_rgba(27,20,12,0.12)] hover:text-[var(--text-primary)]"
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
  const refresh = useCallback(async () => {
    const [thread, workspaceRows] = await Promise.all([
      getSpectraThread(threadId),
      getSpectraWorkspaces(),
    ]);
    setDetail(thread);
    setWorkspaces(workspaceRows);
  }, [threadId]);
  useEffect(() => {
    setLoading(true);
    void refresh()
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not load thread.",
        ),
      )
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const refreshVisibleThread = () => void refresh().catch(() => undefined);
    window.addEventListener("spectra:threads-changed", refreshVisibleThread);
    return () =>
      window.removeEventListener(
        "spectra:threads-changed",
        refreshVisibleThread,
      );
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
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      2_000,
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
  return (
    <ConversationSurface
      detail={detail}
      loading={loading}
      compact={compact}
      liveExchange={parentLiveExchange ?? runEngine.liveExchange}
      workspaces={workspaces}
      onOpenArtifact={onOpenArtifact}
      onOpenWorkspace={onOpenWorkspace}
      onChoice={(choice) =>
        void runEngine.run(
          choice.description
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
      composer={
        showComposer ? (
          <CommandBar
            placeholder="Continue this thread…"
            busy={runEngine.submitting}
            allowAttachments
            onStop={runEngine.stop}
            onSubmit={(value, attachments) => runEngine.run(value, attachments)}
            context={
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
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
