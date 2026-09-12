"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  BookOpen,
  Bot,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Code2,
  Copy,
  Eye,
  FileText,
  HelpCircle,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  MessageSquare,
  Plus,
  Presentation,
  Quote,
  RotateCcw,
  Sparkles,
  Table2,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { workTypeMeta, type ArtifactCardView } from "./artifact-card";
import type { SpectraArtifact} from "../data/api";
import { requireBlueprint, requireArtifactTypeManifest } from "../artifacts/blueprint-catalog";
import type { ArtifactTypeKey } from "../artifacts/types";
import { isArtifactTypeKey } from "../artifacts/registry";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { normalizePresentationContent } from "../presentation/model";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";
import { SelectField } from "@/components/ui/select";
import {
  formatMinutesBefore,
  parseLegacyReminderLabel,
  REMINDER_MINUTE_OPTIONS,
} from "../reminders/minutes-before";

type EditableBlueprintKey = ArtifactTypeKey;
type SheetMode = "create" | "edit";

export type ArtifactPayload = {
  blueprintKey: EditableBlueprintKey;
  title: string;
  summary?: string;
  content: unknown;
  tags?: string[];
};

type DocumentBlock = { id: string; type?: string; text?: string };
type DeckCard = {
  id: string;
  front: string;
  back: string;
  hint?: string;
  section?: string;
  confidence?: "unknown" | "weak" | "medium" | "strong";
  tags?: string[];
  sourceRefs?: string[];
  review?: {
    state?: "new" | "learning" | "review" | "mastered";
    correctStreak?: number;
    lastReviewedAt?: number | null;
    nextReviewAt?: number | null;
  };
};
type QuizQuestion = {
  id: string;
  prompt: string;
  type?: "multiple_choice" | "short_answer";
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
};

type PlannerSubtask = { id: string; title: string; done: boolean };
type PlannerAttachment = { id: string; name: string; meta?: string; url?: string };
type PlannerTaskContent = {
  description?: string;
  dueAt?: number;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  status?: "todo" | "doing" | "done";
  priority?: "low" | "medium" | "high";
  subtasks?: PlannerSubtask[];
  attachments?: PlannerAttachment[];
  linkedArtifactIds?: string[];
  linkedThreadIds?: string[];
  reminders?: Array<{ id: string; minutesBefore: number; enabled?: boolean }>;
  estimateMinutes?: number;
  progressNote?: string;
  sourceRefs?: string[];
};
type ThreadReferenceContent = { threadId?: string | null; summary?: string; linkedArtifactIds?: string[] };
export const blueprintChoices: Array<{ key: EditableBlueprintKey; label: string; icon: LucideIcon; description: string }> = [
  { key: "document", label: "Document", icon: FileText, description: "Notes, essay plans, and structured writing." },
  { key: "flashcard_deck", label: "Flashcard deck", icon: BookOpen, description: "A real deck with editable cards." },
  { key: "quiz", label: "Quiz", icon: HelpCircle, description: "Questions, answers, and review notes." },
  { key: "planner_task", label: "Planner task", icon: CalendarCheck2, description: "Status, due date, and priority." },
  { key: "agent", label: "Agent", icon: Bot, description: "A specialist with a purpose, skills, and sources." },
  { key: "presentation", label: "Presentation", icon: Presentation, description: "Slides for a talk or explanation." },
  { key: "sheets", label: "Sheets", icon: Table2, description: "A workbook with cells, formulas, and charts." },
  { key: "code", label: "Code", icon: Code2, description: "Source and a preview you can run." },
  { key: "whiteboard", label: "Whiteboard", icon: Workflow, description: "A spatial board for notes and diagrams." },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultArtifactSummary(blueprintKey: EditableBlueprintKey) {
  return requireArtifactTypeManifest(blueprintKey).identity.description;
}

export function defaultArtifactTitle(blueprintKey: EditableBlueprintKey) {
  return `New ${workTypeMeta[blueprintKey].label}`;
}

export function createDefaultArtifactPayload(blueprintKey: EditableBlueprintKey): ArtifactPayload {
  const content = structuredClone(requireBlueprint(blueprintKey).defaultContent);
  return {
    blueprintKey,
    title: defaultArtifactTitle(blueprintKey),
    summary: defaultArtifactSummary(blueprintKey),
    content:
      blueprintKey === "whiteboard"
        ? normalizeWhiteboardContent(content)
        : blueprintKey === "presentation"
          ? normalizePresentationContent(content)
          : content,
    tags: [],
  };
}

function dateInputValue(value?: number) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function dateTimeInputValue(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(value - offset).toISOString().slice(0, 16);
}

function dateValue(value: string) {
  return value ? new Date(`${value}T12:00:00`).getTime() : undefined;
}

function dateTimeValue(value: string) {
  return value ? new Date(value).getTime() : undefined;
}

function documentText(content: unknown) {
  const blocks = arrayOfRecords(record(content).blocks);
  if (blocks.length === 0) return "";
  return blocks.map((block) => typeof block.text === "string" ? block.text : "").join("\n\n");
}

function documentContent(text: string, previous: unknown) {
  const previousRecord = record(previous);
  const spectraDemo = previousRecord.spectraDemo;
  const blocks = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((textBlock, index): DocumentBlock => ({
      id: `block-${index + 1}`,
      type: index === 0 && textBlock.length < 90 ? "heading" : "paragraph",
      text: textBlock,
    }));
  return {
    ...previousRecord,
    blocks: blocks.length > 0 ? blocks : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks.filter((block) => block.type === "heading").map((block, index) => ({ id: block.id, title: block.text ?? `Section ${index + 1}`, level: 1 })),
    ...(spectraDemo ? { spectraDemo } : {}),
  };
}

function deckCards(content: unknown): DeckCard[] {
  const cards = arrayOfRecords(record(content).cards).map((card, index) => ({
    id: typeof card.id === "string" ? card.id : `card-${index + 1}`,
    front: typeof card.front === "string" ? card.front : "",
    back: typeof card.back === "string" ? card.back : "",
    hint: typeof card.hint === "string" ? card.hint : "",
    section: typeof card.section === "string" ? card.section : "Section 1",
    confidence: (card.confidence === "weak" || card.confidence === "medium" || card.confidence === "strong" ? card.confidence : "unknown") as DeckCard["confidence"],
    tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === "string") : [],
    sourceRefs: Array.isArray(card.sourceRefs) ? card.sourceRefs.filter((source): source is string => typeof source === "string") : [],
    review: record(card.review) as DeckCard["review"],
  }));
  return cards.length > 0 ? cards : [{ id: "card-1", front: "", back: "", hint: "", section: "Section 1", confidence: "unknown" }];
}

function quizQuestions(content: unknown): QuizQuestion[] {
  const questions = arrayOfRecords(record(content).questions).map((question, index) => ({
    id: typeof question.id === "string" ? question.id : `question-${index + 1}`,
    prompt: typeof question.prompt === "string" ? question.prompt : "",
    type: (question.type === "multiple_choice" ? "multiple_choice" : "short_answer") as QuizQuestion["type"],
    options: Array.isArray(question.options) ? question.options.filter((option): option is string => typeof option === "string") : [],
    correctAnswer: typeof question.correctAnswer === "string" ? question.correctAnswer : "",
    explanation: typeof question.explanation === "string" ? question.explanation : "",
    difficulty: (question.difficulty === "easy" || question.difficulty === "hard" ? question.difficulty : "medium") as QuizQuestion["difficulty"],
    points: typeof question.points === "number" ? question.points : 1,
    timeLimitSeconds: typeof question.timeLimitSeconds === "number" ? question.timeLimitSeconds : 90,
    sourceRefs: Array.isArray(question.sourceRefs) ? question.sourceRefs.filter((source): source is string => typeof source === "string") : [],
    feedback: typeof question.feedback === "string" ? question.feedback : "",
  }));
  return questions.length > 0 ? questions : [{ id: "question-1", prompt: "", type: "multiple_choice", options: ["", "", "", ""], correctAnswer: "", explanation: "", difficulty: "medium", points: 1, timeLimitSeconds: 90 }];
}

type PlannerTask = Required<Pick<PlannerTaskContent, "status" | "priority" | "allDay" | "subtasks" | "attachments" | "linkedArtifactIds" | "linkedThreadIds" | "reminders" | "sourceRefs">> & PlannerTaskContent;

function plannerTask(content: unknown): PlannerTask {
  const task = record(content);
  const status = task.status === "doing" || task.status === "done" ? task.status : "todo";
  const priority = task.priority === "low" || task.priority === "high" ? task.priority : "medium";
  return {
    description: typeof task.description === "string" ? task.description : "",
    dueAt: typeof task.dueAt === "number" ? task.dueAt : undefined,
    startAt: typeof task.startAt === "number" ? task.startAt : undefined,
    endAt: typeof task.endAt === "number" ? task.endAt : undefined,
    allDay: task.allDay === true,
    status,
    priority,
    subtasks: arrayOfRecords(task.subtasks).map((subtask, index) => ({
      id: typeof subtask.id === "string" ? subtask.id : `subtask-${index + 1}`,
      title: typeof subtask.title === "string" ? subtask.title : "",
      done: subtask.done === true,
    })),
    attachments: arrayOfRecords(task.attachments).map((attachment, index) => ({
      id: typeof attachment.id === "string" ? attachment.id : `attachment-${index + 1}`,
      name: typeof attachment.name === "string" ? attachment.name : "",
      meta: typeof attachment.meta === "string" ? attachment.meta : "",
      url: typeof attachment.url === "string" ? attachment.url : undefined,
    })),
    linkedArtifactIds: Array.isArray(task.linkedArtifactIds) ? task.linkedArtifactIds.filter((value): value is string => typeof value === "string") : [],
    linkedThreadIds: Array.isArray(task.linkedThreadIds) ? task.linkedThreadIds.filter((value): value is string => typeof value === "string") : [],
    reminders: Array.isArray(task.reminders)
      ? task.reminders.flatMap((candidate, index) => {
          if (typeof candidate === "string") {
            const minutes = parseLegacyReminderLabel(candidate);
            if (minutes === null) return [];
            return [{ id: `reminder-${index + 1}`, minutesBefore: minutes, enabled: true }];
          }
          const row = record(candidate);
          if (row.enabled === false) return [];
          const minutesBefore = Number(row.minutesBefore);
          if (!Number.isFinite(minutesBefore) || minutesBefore < 0 || minutesBefore > 525_600)
            return [];
          return [{
            id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `reminder-${index + 1}`,
            minutesBefore: Math.round(minutesBefore),
            enabled: row.enabled !== false,
          }];
        })
      : [],
    estimateMinutes: typeof task.estimateMinutes === "number" ? task.estimateMinutes : undefined,
    progressNote: typeof task.progressNote === "string" ? task.progressNote : "",
    sourceRefs: Array.isArray(task.sourceRefs) ? task.sourceRefs.filter((value): value is string => typeof value === "string") : [],
  };
}

function threadReference(content: unknown): ThreadReferenceContent {
  const thread = record(content);
  return {
    threadId: typeof thread.threadId === "string" ? thread.threadId : null,
    summary: typeof thread.summary === "string" ? thread.summary : "",
    linkedArtifactIds: Array.isArray(thread.linkedArtifactIds) ? thread.linkedArtifactIds.filter((item): item is string => typeof item === "string") : [],
  };
}

function metricPreview(artifact: SpectraArtifact | null, blueprintKey: EditableBlueprintKey, draftContent: unknown) {
  if (blueprintKey === "document") return `${documentText(draftContent || artifact?.content).split(/\s+/).filter(Boolean).length} words`;
  if (blueprintKey === "flashcard_deck") return `${deckCards(draftContent || artifact?.content).length} cards`;
  if (blueprintKey === "quiz") return `${quizQuestions(draftContent || artifact?.content).length} questions`;
  if (blueprintKey === "planner_task") return plannerTask(draftContent || artifact?.content).status;
  return "reference";
}

export function ArtifactBlueprintSheet({
  mode,
  artifact,
  initialBlueprintKey = "document",
  busy = false,
  onClose,
  onSubmit,
}: {
  mode: SheetMode;
  artifact?: SpectraArtifact | null;
  initialBlueprintKey?: EditableBlueprintKey;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (payload: ArtifactPayload) => Promise<void> | void;
}) {
  const artifactBlueprintKey = artifact && isArtifactTypeKey(artifact.blueprintKey) ? artifact.blueprintKey : initialBlueprintKey;
  const [blueprintKey, setBlueprintKey] = useState<EditableBlueprintKey>(artifactBlueprintKey ?? initialBlueprintKey);
  const [title, setTitle] = useState(artifact?.title ?? defaultArtifactTitle(initialBlueprintKey));
  const [summary, setSummary] = useState(artifact?.summary ?? defaultArtifactSummary(initialBlueprintKey));
  const [documentDraft, setDocumentDraft] = useState(documentText(artifact?.content) || "");
  const [cards, setCards] = useState<DeckCard[]>(deckCards(artifact?.content));
  const [questions, setQuestions] = useState<QuizQuestion[]>(quizQuestions(artifact?.content));
  const [task, setTask] = useState(plannerTask(artifact?.content));
  const [thread] = useState(threadReference(artifact?.content));
  const [tagDraft, setTagDraft] = useState((artifact?.tags ?? []).join(", "));
  const dialogTitleId = useId();

  const meta = workTypeMeta[blueprintKey];
  const Icon = meta.icon;

  const previewContent = useMemo(() => {
    if (blueprintKey === "document") return documentContent(documentDraft, artifact?.content);
    if (blueprintKey === "flashcard_deck") return { ...record(artifact?.content), cards, settings: record(artifact?.content).settings ?? { shuffle: true, revealMode: "click" } };
    if (blueprintKey === "quiz") return { ...record(artifact?.content), questions: questions.map((question) => ({ ...question, type: (question.options?.length ?? 0) > 0 ? "multiple_choice" : "short_answer" })), settings: record(artifact?.content).settings ?? { showAnswersImmediately: true, timed: false } };
    if (blueprintKey === "planner_task") return { ...record(artifact?.content), ...task };
    return { ...record(artifact?.content), ...thread, summary };
  }, [artifact?.content, blueprintKey, cards, documentDraft, questions, summary, task, thread]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onClose]);

  function selectBlueprint(nextKey: EditableBlueprintKey) {
    setBlueprintKey(nextKey);
    if (mode === "create") {
      setTitle(defaultArtifactTitle(nextKey));
      setSummary(defaultArtifactSummary(nextKey));
    }
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const tags = tagDraft.split(",").map((tag) => tag.trim()).filter(Boolean);
    await onSubmit({
      blueprintKey,
      title: trimmedTitle,
      summary: summary.trim() || undefined,
      content: previewContent,
      tags,
    });
  }

  return (
    <div className="fixed inset-0 z-modal bg-[var(--bg-overlay)]" onPointerDown={() => { if (!busy) onClose(); }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="spectra-blueprint-sheet absolute right-0 top-0 flex h-[100dvh] w-full max-w-[1120px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[var(--shadow-lg)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[var(--border-default)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-control border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]" style={{ color: meta.color }}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{mode === "create" ? "Create work" : "Work details"}</div>
                  <h2 id={dialogTitleId} className="font-display text-metric font-semibold leading-tight text-[var(--text-primary)]">{mode === "create" ? `New ${meta.label}` : artifact?.title ?? "Untitled work"}</h2>
                </div>
              </div>
            </div>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={onClose} aria-label="Close artifact detail">
              <X className="h-4 w-4" />
            </button>
          </div>
          {mode === "create" ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {blueprintChoices.map((choice) => {
                const ChoiceIcon = choice.icon;
                const selected = blueprintKey === choice.key;
                return (
                  <button
                    key={choice.key}
                    type="button"
                    className={`min-h-[86px] rounded-control border p-2.5 text-left transition ${selected ? "border-[var(--brand-primary)] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-elevated))]" : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]"}`}
                    onClick={() => selectBlueprint(choice.key)}
                  >
                    <ChoiceIcon className="h-4 w-4" style={{ color: workTypeMeta[choice.key].color }} />
                    <div className="mt-2 text-caption font-semibold text-[var(--text-primary)]">{choice.label}</div>
                    <div className="mt-1 line-clamp-2 text-micro leading-4 text-[var(--text-secondary)]">{choice.description}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
            <section className="min-w-0 space-y-4">
              <Field label="Title">
                <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass()} placeholder="Artifact title" />
              </Field>
              <Field label="Summary">
                <LocalAutocompleteTextarea surface="description" value={summary} onValueChange={setSummary} className="w-full" textareaClassName={textareaClass("min-h-[78px]")} placeholder="Short useful summary" />
              </Field>
              {blueprintKey === "document" ? <DocumentEditor value={documentDraft} onChange={setDocumentDraft} /> : null}
              {blueprintKey === "flashcard_deck" ? <DeckEditor cards={cards} setCards={setCards} /> : null}
              {blueprintKey === "quiz" ? <QuizEditor questions={questions} setQuestions={setQuestions} /> : null}
              {blueprintKey === "planner_task" ? <TaskEditor task={task} setTask={setTask} /> : null}
              {artifact?.blueprintKey === "thread_reference" ? <div className="flex min-h-[220px] items-center justify-center rounded-card bg-[var(--bg-elevated)] p-6 text-center"><div><MessageSquare className="mx-auto h-8 w-8 text-[var(--brand-primary)]" /><p className="mt-3 text-ui leading-6 text-[var(--text-secondary)]">Linked chat</p></div></div> : null}
            </section>
            <aside className="space-y-4">
              <div className="rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <div className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Blueprint</div>
                <div className="mt-3 flex items-center gap-2 text-body font-semibold text-[var(--text-primary)]">
                  <Icon className="h-4 w-4" style={{ color: meta.color }} />
                  {meta.label}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMetric label="State" value={mode === "create" ? "Draft" : "Active"} />
                  <MiniMetric label="Object" value={metricPreview(artifact ?? null, blueprintKey, previewContent)} />
                </div>
              </div>
              <div className="rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
                <Field label="Tags">
                  <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} className={inputClass()} placeholder="biology, revision" />
                </Field>
              </div>
              <div className="rounded-control border border-dashed border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_54%,transparent)] p-4 text-caption leading-5 text-[var(--text-secondary)]">
                <Sparkles className="mb-2 h-4 w-4 text-[var(--text-tertiary)]" />
                Changes stay in this draft until you save. You can keep working across every section without losing the rest of the artifact.
              </div>
            </aside>
          </div>
        </main>
        <footer className="flex items-center justify-between gap-4 border-t border-[var(--border-default)] px-6 py-4">
          <div className="hidden items-center gap-2 text-caption text-[var(--text-secondary)] sm:flex">
            <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            Saves to the shared artifact object.
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={secondaryButtonClass()} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryButtonClass()} disabled={!title.trim() || busy} onClick={() => void submit()} aria-live="polite">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "create" ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {mode === "create" ? "Create" : "Save"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-2">
      <div className="truncate text-ui font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="text-micro text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}

function DocumentEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const selectedCount = Math.max(0, selection.end - selection.start);

  function rememberSelection(target: HTMLTextAreaElement) {
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  }

  function replaceSelection(before: string, after = before) {
    const target = textareaRef.current;
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(next);
    const nextStart = start + before.length;
    const nextEnd = nextStart + selected.length;
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(nextStart, nextEnd || nextStart);
      setSelection({ start: nextStart, end: nextEnd });
    });
  }

  function prefixLines(prefix: string | ((index: number) => string)) {
    const target = textareaRef.current;
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const selected = value.slice(lineStart, end || value.indexOf("\n", start) < 0 ? value.length : value.indexOf("\n", start));
    const nextBlock = selected.split("\n").map((line, index) => `${typeof prefix === "function" ? prefix(index) : prefix}${line}`).join("\n");
    onChange(`${value.slice(0, lineStart)}${nextBlock}${value.slice(lineStart + selected.length)}`);
    requestAnimationFrame(() => target.focus());
  }

  return (
    <section className="spectra-sheet-document overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-default)] px-2 py-2" role="toolbar" aria-label="Document formatting">
        <button type="button" className="mr-1 h-8 rounded-control px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" onClick={() => prefixLines("## ")} title="Heading 2">Heading 2</button>
        <ToolbarButton label="Bold" icon={Bold} onClick={() => replaceSelection("**")} />
        <ToolbarButton label="Italic" icon={Italic} onClick={() => replaceSelection("_")} />
        <ToolbarButton label="Bulleted list" icon={List} onClick={() => prefixLines("- ")} />
        <ToolbarButton label="Numbered list" icon={ListOrdered} onClick={() => prefixLines((index) => `${index + 1}. `)} />
        <ToolbarButton label="Quote" icon={Quote} onClick={() => prefixLines("> ")} />
        <ToolbarButton label="Link" icon={Link2} onClick={() => replaceSelection("[", "](https://)")} />
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-primary))] px-2.5 py-1 text-micro text-[var(--text-secondary)]" aria-live="polite">
          <Sparkles className="h-3 w-3 text-[var(--accent-cyan)]" />
          AI focus: {selectedCount > 0 ? `${selectedCount} selected` : "whole document"}
        </span>
      </div>
      <div className="mx-auto max-w-[760px] px-4 py-5 sm:px-8 sm:py-8">
        <label className="sr-only" htmlFor="spectra-document-body">Document body</label>
        <textarea
          ref={textareaRef}
          id="spectra-document-body"
          value={value}
          onChange={(event) => { onChange(event.target.value); rememberSelection(event.target); }}
          onSelect={(event) => rememberSelection(event.currentTarget)}
          className="min-h-[440px] w-full resize-y bg-transparent font-serif text-editor leading-8 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Start writing, or paste notes here. Separate sections with a blank line."
        />
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-default)] pt-3 text-micro text-[var(--text-tertiary)]">
          <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
          <span>{value.length} characters</span>
        </div>
      </div>
    </section>
  );
}

function DeckEditor({ cards, setCards }: { cards: DeckCard[]; setCards: (cards: DeckCard[]) => void }) {
  const [activeId, setActiveId] = useState(cards[0]?.id ?? "");
  const [mode, setMode] = useState<"edit" | "study">("edit");
  const [revealed, setRevealed] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const activeIndex = Math.max(0, cards.findIndex((card) => card.id === activeId));
  const activeCard = cards[activeIndex] ?? cards[0];

  useEffect(() => {
    if (cards.length > 0 && !cards.some((card) => card.id === activeId)) setActiveId(cards[0]!.id);
  }, [activeId, cards]);

  function updateCard(cardId: string, patch: Partial<DeckCard>) {
    setCards(cards.map((card) => card.id === cardId ? { ...card, ...patch } : card));
  }

  function addCard() {
    const next = { id: id("card"), front: "", back: "", hint: "", section: activeCard?.section ?? "Section 1", confidence: "unknown" as const };
    setCards([...cards, next]);
    setActiveId(next.id);
    setMode("edit");
  }

  function moveCard(direction: -1 | 1) {
    const nextIndex = activeIndex + direction;
    if (!activeCard || nextIndex < 0 || nextIndex >= cards.length) return;
    const next = [...cards];
    next.splice(activeIndex, 1);
    next.splice(nextIndex, 0, activeCard);
    setCards(next);
  }

  function removeCard() {
    if (!activeCard || cards.length <= 1) return;
    const next = cards.filter((card) => card.id !== activeCard.id);
    setCards(next);
    setActiveId(next[Math.min(activeIndex, next.length - 1)]!.id);
  }

  function moveStudyCard(direction: -1 | 1) {
    if (cards.length === 0) return;
    const nextIndex = (activeIndex + direction + cards.length) % cards.length;
    setActiveId(cards[nextIndex]!.id);
    setRevealed(false);
  }

  function markConfidence(confidence: NonNullable<DeckCard["confidence"]>) {
    if (!activeCard) return;
    updateCard(activeCard.id, {
      confidence,
      review: {
        ...activeCard.review,
        state: confidence === "strong" ? "mastered" : confidence === "weak" ? "learning" : "review",
        correctStreak: confidence === "strong" ? (activeCard.review?.correctStreak ?? 0) + 1 : 0,
        lastReviewedAt: Date.now(),
      },
    });
    setReviewedIds((current) => new Set(current).add(activeCard.id));
    moveStudyCard(1);
  }

  return (
    <section className="spectra-sheet-deck overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] px-3 py-2.5">
        <div className="flex rounded-control bg-[var(--bg-primary)] p-1 ring-1 ring-[var(--border-default)]" role="tablist" aria-label="Deck mode">
          {(["edit", "study"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={`h-7 rounded-chip px-3 text-micro font-medium capitalize ${mode === value ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`} onClick={() => { setMode(value); setRevealed(false); }}>{value}</button>)}
        </div>
        <span className="text-micro text-[var(--text-secondary)]">{cards.length} {cards.length === 1 ? "card" : "cards"}</span>
        {mode === "study" ? <div className="ml-auto flex min-w-[150px] items-center gap-2 text-micro text-[var(--text-tertiary)]"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]"><span className="block h-full rounded-full bg-[var(--brand-primary)] transition-[width] motion-reduce:transition-none" style={{ width: `${cards.length ? reviewedIds.size / cards.length * 100 : 0}%` }} /></div>{reviewedIds.size}/{cards.length}</div> : <button type="button" className={`${secondaryButtonClass()} ml-auto`} onClick={addCard}><Plus className="h-3.5 w-3.5" />Add card</button>}
      </div>
      <div className="grid min-h-[500px] md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="max-h-[560px] overflow-y-auto border-b border-[var(--border-default)] p-2 md:border-b-0 md:border-r">
          {cards.map((card, index) => (
            <button key={card.id} type="button" onClick={() => { setActiveId(card.id); setRevealed(false); }} className={`mb-1 flex w-full items-start gap-2 rounded-control border px-2.5 py-2 text-left ${card.id === activeCard?.id ? "border-[color-mix(in_oklab,var(--brand-primary)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_6%,var(--bg-primary))]" : "border-transparent hover:bg-[var(--bg-hover)]"}`} aria-current={card.id === activeCard?.id ? "true" : undefined}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-chip bg-[var(--bg-secondary)] font-sans text-micro font-normal text-[var(--text-secondary)]">{index + 1}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-micro font-medium text-[var(--text-primary)]">{card.front || "Untitled card"}</span><span className="mt-0.5 block truncate text-micro text-[var(--text-tertiary)]">{card.section || "Section 1"}</span></span>
              {card.confidence && card.confidence !== "unknown" ? <span className={`mt-1 h-1.5 w-1.5 rounded-full ${card.confidence === "strong" ? "bg-[var(--success)]" : card.confidence === "weak" ? "bg-[var(--warning)]" : "bg-[var(--brand-primary)]"}`} /> : null}
            </button>
          ))}
        </aside>
        <div className="min-w-0 p-3 sm:p-5">
          {activeCard && mode === "edit" ? <div className="space-y-4">
            <div className="flex items-center gap-1">
              <span className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Card {activeIndex + 1} of {cards.length}</span>
              <div className="ml-auto flex items-center gap-1">
                <ToolbarButton label="Move card up" icon={ArrowUp} disabled={activeIndex === 0} onClick={() => moveCard(-1)} />
                <ToolbarButton label="Move card down" icon={ArrowDown} disabled={activeIndex === cards.length - 1} onClick={() => moveCard(1)} />
                <ToolbarButton label="Duplicate card" icon={Copy} onClick={() => { const copy = { ...activeCard, id: id("card"), review: undefined }; const next = [...cards]; next.splice(activeIndex + 1, 0, copy); setCards(next); setActiveId(copy.id); }} />
                <ToolbarButton label="Delete card" icon={Trash2} disabled={cards.length <= 1} danger onClick={removeCard} />
              </div>
            </div>
            <Field label="Section"><input value={activeCard.section ?? ""} onChange={(event) => updateCard(activeCard.id, { section: event.target.value })} className={inputClass()} placeholder="Section 1" /></Field>
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Front"><LocalAutocompleteTextarea surface="quiz_card_text" value={activeCard.front} onValueChange={(front) => updateCard(activeCard.id, { front })} className="w-full" textareaClassName={textareaClass("min-h-[180px] font-serif text-heading leading-7")} placeholder="Write the prompt" /></Field>
              <Field label="Back"><LocalAutocompleteTextarea surface="quiz_card_text" value={activeCard.back} onValueChange={(back) => updateCard(activeCard.id, { back })} className="w-full" textareaClassName={textareaClass("min-h-[180px] font-serif text-heading leading-7")} placeholder="Write the answer" /></Field>
            </div>
            <Field label="Hint (optional)"><input value={activeCard.hint ?? ""} onChange={(event) => updateCard(activeCard.id, { hint: event.target.value })} className={inputClass()} placeholder="A useful nudge, without giving away the answer" /></Field>
          </div> : null}
          {activeCard && mode === "study" ? <div className="flex min-h-[450px] flex-col">
            <div className="flex items-center justify-between text-micro text-[var(--text-tertiary)]"><button type="button" className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]" onClick={() => moveStudyCard(-1)}><ArrowLeft className="h-3.5 w-3.5" />Previous</button><span>Card {activeIndex + 1} of {cards.length}</span><button type="button" className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]" onClick={() => moveStudyCard(1)}>Next<ArrowRight className="h-3.5 w-3.5" /></button></div>
            <button type="button" className="mt-4 flex min-h-[280px] flex-1 flex-col items-center justify-center rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-8 text-center shadow-hover" onClick={() => setRevealed((value) => !value)} aria-label={revealed ? "Hide answer" : "Reveal answer"}>
              <span className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{revealed ? "Answer" : "Prompt"}</span>
              <span className="mt-6 max-w-[560px] font-serif text-metric leading-9 text-[var(--text-primary)]">{revealed ? activeCard.back || "No answer yet" : activeCard.front || "No prompt yet"}</span>
              {!revealed && activeCard.hint ? <span className="mt-8 text-micro text-[var(--text-secondary)]">Hint: {activeCard.hint}</span> : null}
              <span className="mt-8 inline-flex items-center gap-1.5 text-micro text-[var(--text-tertiary)]">{revealed ? <RotateCcw className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{revealed ? "Tap to see the prompt" : "Tap to reveal"}</span>
            </button>
            {revealed ? <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Rate this card"><button type="button" className={`${secondaryButtonClass()} justify-center border-[color-mix(in_oklab,var(--warning)_32%,var(--border-default))]`} onClick={() => markConfidence("weak")}>Again</button><button type="button" className={`${secondaryButtonClass()} justify-center`} onClick={() => markConfidence("medium")}>Learning</button><button type="button" className={`${secondaryButtonClass()} justify-center border-[color-mix(in_oklab,var(--success)_32%,var(--border-default))]`} onClick={() => markConfidence("strong")}>Got it</button></div> : null}
          </div>
          : null}
        </div>
      </div>
    </section>
  );
}

function QuizEditor({ questions, setQuestions }: { questions: QuizQuestion[]; setQuestions: (questions: QuizQuestion[]) => void }) {
  const [activeId, setActiveId] = useState(questions[0]?.id ?? "");
  const [view, setView] = useState<"builder" | "preview">("builder");
  const activeIndex = Math.max(0, questions.findIndex((question) => question.id === activeId));
  const activeQuestion = questions[activeIndex] ?? questions[0];
  const completeCount = questions.filter(questionIsComplete).length;

  useEffect(() => {
    if (questions.length > 0 && !questions.some((question) => question.id === activeId)) setActiveId(questions[0]!.id);
  }, [activeId, questions]);

  function updateQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    setQuestions(questions.map((question) => question.id === questionId ? { ...question, ...patch } : question));
  }

  function addQuestion() {
    const next: QuizQuestion = { id: id("question"), prompt: "", type: "multiple_choice", options: ["", "", "", ""], correctAnswer: "", explanation: "", difficulty: "medium", points: 1, timeLimitSeconds: 90 };
    setQuestions([...questions, next]);
    setActiveId(next.id);
    setView("builder");
  }

  function moveQuestion(direction: -1 | 1) {
    const nextIndex = activeIndex + direction;
    if (!activeQuestion || nextIndex < 0 || nextIndex >= questions.length) return;
    const next = [...questions];
    next.splice(activeIndex, 1);
    next.splice(nextIndex, 0, activeQuestion);
    setQuestions(next);
  }

  function removeQuestion() {
    if (!activeQuestion || questions.length <= 1) return;
    const next = questions.filter((question) => question.id !== activeQuestion.id);
    setQuestions(next);
    setActiveId(next[Math.min(activeIndex, next.length - 1)]!.id);
  }

  return (
    <section className="spectra-sheet-quiz overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] px-3 py-2.5">
        <div className="flex rounded-control bg-[var(--bg-primary)] p-1 ring-1 ring-[var(--border-default)]" role="tablist" aria-label="Quiz view">
          {(["builder", "preview"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={view === value} className={`h-7 rounded-chip px-3 text-micro font-medium capitalize ${view === value ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`} onClick={() => setView(value)}>{value}</button>)}
        </div>
        <span className="text-micro text-[var(--text-secondary)]">{completeCount} of {questions.length} ready</span>
        <div className="h-1.5 min-w-[90px] flex-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]" role="progressbar" aria-label="Quiz completion" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={completeCount}><span className="block h-full rounded-full bg-[var(--mode-quiz)] transition-[width] motion-reduce:transition-none" style={{ width: `${questions.length ? completeCount / questions.length * 100 : 0}%` }} /></div>
        <button type="button" className={secondaryButtonClass()} onClick={addQuestion}><Plus className="h-3.5 w-3.5" />Add question</button>
      </div>
      {view === "builder" ? <div className="grid min-h-[540px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="max-h-[620px] overflow-y-auto border-b border-[var(--border-default)] p-2 lg:border-b-0 lg:border-r">
          {questions.map((question, index) => <button key={question.id} type="button" onClick={() => setActiveId(question.id)} className={`mb-1 flex w-full items-start gap-2 rounded-control border px-2.5 py-2 text-left ${question.id === activeQuestion?.id ? "border-[color-mix(in_oklab,var(--mode-quiz)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--mode-quiz)_6%,var(--bg-primary))]" : "border-transparent hover:bg-[var(--bg-hover)]"}`} aria-current={question.id === activeQuestion?.id ? "true" : undefined}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-chip bg-[var(--bg-secondary)] font-sans text-micro font-normal text-[var(--text-secondary)]">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-micro font-medium text-[var(--text-primary)]">{question.prompt || "Untitled question"}</span><span className="mt-0.5 block text-micro capitalize text-[var(--text-tertiary)]">{(question.type ?? "short_answer").replace("_", " ")}</span></span>{questionIsComplete(question) ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-[var(--success)]" /> : <Circle className="mt-0.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />}</button>)}
        </aside>
        {activeQuestion ? <div className="min-w-0 space-y-4 p-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Question {activeIndex + 1} of {questions.length}</span>
            <div className="ml-auto flex items-center gap-1">
              <ToolbarButton label="Move question up" icon={ArrowUp} disabled={activeIndex === 0} onClick={() => moveQuestion(-1)} />
              <ToolbarButton label="Move question down" icon={ArrowDown} disabled={activeIndex === questions.length - 1} onClick={() => moveQuestion(1)} />
              <ToolbarButton label="Duplicate question" icon={Copy} onClick={() => { const copy = { ...activeQuestion, id: id("question") }; const next = [...questions]; next.splice(activeIndex + 1, 0, copy); setQuestions(next); setActiveId(copy.id); }} />
              <ToolbarButton label="Delete question" icon={Trash2} disabled={questions.length <= 1} danger onClick={removeQuestion} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Type" value={activeQuestion.type ?? "short_answer"} onChange={(next) => { const type = next as QuizQuestion["type"]; updateQuestion(activeQuestion.id, type === "multiple_choice" ? { type, options: (activeQuestion.options?.length ?? 0) >= 2 ? activeQuestion.options : ["", "", "", ""] } : { type, options: [] }); }} options={[{ value: "multiple_choice", label: "Multiple choice" }, { value: "short_answer", label: "Short answer" }]} size="lg" />
            <SelectField label="Difficulty" value={activeQuestion.difficulty ?? "medium"} onChange={(next) => updateQuestion(activeQuestion.id, { difficulty: next as QuizQuestion["difficulty"] })} options={[{ value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]} size="lg" />
            <Field label="Points"><input type="number" min={1} max={100} value={activeQuestion.points ?? 1} onChange={(event) => updateQuestion(activeQuestion.id, { points: Math.max(1, Number(event.target.value) || 1) })} className={inputClass()} /></Field>
          </div>
          <Field label="Question"><LocalAutocompleteTextarea surface="quiz_card_text" value={activeQuestion.prompt} onValueChange={(prompt) => updateQuestion(activeQuestion.id, { prompt })} className="w-full" textareaClassName={textareaClass("min-h-[100px] text-subhead leading-6")} placeholder="What should the learner answer?" /></Field>
          {activeQuestion.type === "multiple_choice" ? <fieldset className="space-y-2"><legend className="mb-1.5 text-caption font-semibold text-[var(--text-secondary)]">Answer options</legend>{(activeQuestion.options ?? []).map((option, optionIndex) => <div key={`${activeQuestion.id}-option-${optionIndex}`} className="flex items-center gap-2"><input type="radio" name={`correct-${activeQuestion.id}`} checked={Boolean(option.trim()) && activeQuestion.correctAnswer === option} onChange={() => { if (option.trim()) updateQuestion(activeQuestion.id, { correctAnswer: option }); }} aria-label={`Mark option ${optionIndex + 1} correct`} /><input value={option} onChange={(event) => { const nextOptions = [...(activeQuestion.options ?? [])]; const wasCorrect = Boolean(option.trim()) && activeQuestion.correctAnswer === option; nextOptions[optionIndex] = event.target.value; updateQuestion(activeQuestion.id, { options: nextOptions, ...(wasCorrect ? { correctAnswer: event.target.value } : {}) }); }} className={inputClass()} placeholder={`Option ${optionIndex + 1}`} /><ToolbarButton label={`Remove option ${optionIndex + 1}`} icon={X} disabled={(activeQuestion.options?.length ?? 0) <= 2} onClick={() => { const nextOptions = (activeQuestion.options ?? []).filter((_, index) => index !== optionIndex); updateQuestion(activeQuestion.id, { options: nextOptions, correctAnswer: activeQuestion.correctAnswer === option ? "" : activeQuestion.correctAnswer }); }} /></div>)}<button type="button" className={secondaryButtonClass()} onClick={() => updateQuestion(activeQuestion.id, { options: [...(activeQuestion.options ?? []), ""] })}><Plus className="h-3.5 w-3.5" />Add option</button></fieldset> : <Field label="Correct answer"><input value={activeQuestion.correctAnswer ?? ""} onChange={(event) => updateQuestion(activeQuestion.id, { correctAnswer: event.target.value })} className={inputClass()} placeholder="Expected answer or key phrase" /></Field>}
          <Field label="Explanation (shown during review)"><LocalAutocompleteTextarea surface="quiz_card_text" value={activeQuestion.explanation ?? ""} onValueChange={(explanation) => updateQuestion(activeQuestion.id, { explanation })} className="w-full" textareaClassName={textareaClass("min-h-[90px]")} placeholder="Explain why the answer is correct" /></Field>
          <Field label="Time guide (seconds)"><input type="number" min={5} max={3600} value={activeQuestion.timeLimitSeconds ?? 90} onChange={(event) => updateQuestion(activeQuestion.id, { timeLimitSeconds: Math.max(5, Number(event.target.value) || 90) })} className={inputClass()} /></Field>
        </div> : null}
      </div> : <div className="mx-auto max-w-[720px] space-y-4 p-4 sm:p-7">{questions.map((question, index) => <article key={question.id} className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"><div className="flex items-center gap-2 text-micro text-[var(--text-tertiary)]"><span>Question {index + 1}</span><span>•</span><span className="capitalize">{question.difficulty ?? "medium"}</span><span className="ml-auto">{question.points ?? 1} {(question.points ?? 1) === 1 ? "point" : "points"}</span></div><h4 className="mt-3 font-serif text-heading leading-7 text-[var(--text-primary)]">{question.prompt || "Untitled question"}</h4>{question.type === "multiple_choice" ? <div className="mt-4 space-y-2">{(question.options ?? []).map((option, optionIndex) => <div key={optionIndex} className="flex items-center gap-2 rounded-control border border-[var(--border-default)] px-3 py-2 text-caption text-[var(--text-secondary)]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-micro font-semibold">{String.fromCharCode(65 + optionIndex)}</span>{option || `Option ${optionIndex + 1}`}</div>)}</div> : <div className="mt-4 h-16 rounded-control border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)]" />}</article>)}</div>}
    </section>
  );
}

function TaskEditor({ task, setTask }: { task: PlannerTask; setTask: (task: PlannerTask) => void }) {
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const completed = task.subtasks.filter((subtask) => subtask.done).length;
  const progress = task.subtasks.length ? Math.round(completed / task.subtasks.length * 100) : task.status === "done" ? 100 : task.status === "doing" ? 50 : 0;

  function addSubtask() {
    const title = subtaskDraft.trim();
    if (!title) return;
    setTask({ ...task, subtasks: [...task.subtasks, { id: id("subtask"), title, done: false }] });
    setSubtaskDraft("");
  }

  function toggleSubtask(subtaskId: string) {
    const nextSubtasks = task.subtasks.map((subtask) => subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask);
    const nextCompleted = nextSubtasks.filter((subtask) => subtask.done).length;
    const nextStatus = nextSubtasks.length > 0 && nextCompleted === nextSubtasks.length ? "done" : nextCompleted > 0 || task.status === "doing" || task.status === "done" ? "doing" : task.status;
    setTask({ ...task, subtasks: nextSubtasks, status: nextStatus });
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    setTask({ ...task, attachments: [...task.attachments, { id: id("link"), name: linkName.trim() || url, url: normalizedUrl, meta: normalizedUrl }] });
    setLinkName("");
    setLinkUrl("");
  }

  return (
    <section className="spectra-sheet-task space-y-5 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5">
      <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-control bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-elevated))] text-[var(--warning)]"><CalendarCheck2 className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2 text-micro"><span className="font-semibold text-[var(--text-primary)]">Task progress</span><span className="text-[var(--text-tertiary)]">{progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span className="block h-full rounded-full bg-[var(--warning)] transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div></div></div>
      </div>
      <Field label="Task description">
        <LocalAutocompleteTextarea surface="description" value={task.description ?? ""} onValueChange={(description) => setTask({ ...task, description })} className="w-full" textareaClassName={textareaClass("min-h-[130px] text-body leading-6")} placeholder="What needs to happen? Add context, notes, and a clear outcome." />
      </Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Segmented label="Status" value={task.status} options={["todo", "doing", "done"]} onChange={(value) => setTask({ ...task, status: value as "todo" | "doing" | "done" })} />
        <Segmented label="Priority" value={task.priority} options={["low", "medium", "high"]} onChange={(value) => setTask({ ...task, priority: value as "low" | "medium" | "high" })} />
        <Field label="Due date">
          <input type="date" value={dateInputValue(task.dueAt)} onChange={(event) => setTask({ ...task, dueAt: dateValue(event.target.value) })} className={inputClass()} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Starts"><input type="datetime-local" value={dateTimeInputValue(task.startAt)} onChange={(event) => setTask({ ...task, startAt: dateTimeValue(event.target.value) })} className={inputClass()} /></Field>
        <Field label="Ends"><input type="datetime-local" value={dateTimeInputValue(task.endAt)} min={dateTimeInputValue(task.startAt)} onChange={(event) => setTask({ ...task, endAt: dateTimeValue(event.target.value) })} className={inputClass()} /></Field>
        <Field label="Estimate (minutes)"><div className="relative"><Clock3 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--text-tertiary)]" /><input type="number" min={1} max={100000} value={task.estimateMinutes ?? ""} onChange={(event) => setTask({ ...task, estimateMinutes: event.target.value ? Math.max(1, Number(event.target.value)) : undefined })} className={`${inputClass()} pl-9`} placeholder="90" /></div></Field>
      </div>
      <label className="inline-flex items-center gap-2 text-caption text-[var(--text-secondary)]"><input type="checkbox" checked={task.allDay} onChange={(event) => setTask({ ...task, allDay: event.target.checked })} />All-day task</label>
      <section>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-caption font-semibold text-[var(--text-secondary)]">Subtasks <span className="font-normal text-[var(--text-tertiary)]">{completed}/{task.subtasks.length}</span></h3></div>
        <div className="overflow-hidden rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)]">
          {task.subtasks.map((subtask) => <div key={subtask.id} className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2 last:border-b-0"><button type="button" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${subtask.done ? "border-[var(--success)] bg-[var(--success)] text-white" : "border-[var(--border-default)] text-transparent hover:border-[var(--success)]"}`} onClick={() => toggleSubtask(subtask.id)} aria-label={subtask.done ? `Mark ${subtask.title} incomplete` : `Complete ${subtask.title}`}><Check className="h-3 w-3" /></button><input value={subtask.title} onChange={(event) => setTask({ ...task, subtasks: task.subtasks.map((item) => item.id === subtask.id ? { ...item, title: event.target.value } : item) })} className={`min-w-0 flex-1 bg-transparent text-caption outline-none ${subtask.done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]"}`} aria-label="Subtask title" /><ToolbarButton label={`Delete ${subtask.title || "subtask"}`} icon={Trash2} danger onClick={() => setTask({ ...task, subtasks: task.subtasks.filter((item) => item.id !== subtask.id) })} /></div>)}
          <div className="flex items-center gap-2 px-3 py-2"><Plus className="h-4 w-4 text-[var(--text-tertiary)]" /><input value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSubtask(); } }} className="min-w-0 flex-1 bg-transparent text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="Add a subtask and press Enter" /><button type="button" onClick={addSubtask} disabled={!subtaskDraft.trim()} className="text-micro font-medium text-[var(--accent-cyan)] disabled:opacity-35">Add</button></div>
        </div>
      </section>
      <Field label="Progress note"><LocalAutocompleteTextarea surface="plan_note" value={task.progressNote ?? ""} onValueChange={(progressNote) => setTask({ ...task, progressNote })} className="w-full" textareaClassName={textareaClass("min-h-[90px]")} placeholder="Capture the latest decision, blocker, or next step" /></Field>
      <section>
        <h3 className="mb-2 text-caption font-semibold text-[var(--text-secondary)]">Notes and links</h3>
        {task.attachments.length > 0 ? <div className="mb-2 space-y-1.5">{task.attachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2"><Link2 className="h-3.5 w-3.5 text-[var(--warning)]" /><a href={attachment.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--text-primary)] hover:text-[var(--accent-cyan)]">{attachment.name || attachment.url}</a><ToolbarButton label={`Remove ${attachment.name || "link"}`} icon={Trash2} danger onClick={() => setTask({ ...task, attachments: task.attachments.filter((item) => item.id !== attachment.id) })} /></div>)}</div> : null}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)_auto]"><input value={linkName} onChange={(event) => setLinkName(event.target.value)} className={inputClass()} placeholder="Link label" /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink(); } }} className={inputClass()} inputMode="url" placeholder="https://…" /><button type="button" className={secondaryButtonClass()} disabled={!linkUrl.trim()} onClick={addLink}><Link2 className="h-3.5 w-3.5" />Add</button></div>
      </section>
      <section>
        <h3 className="mb-2 text-caption font-semibold text-[var(--text-secondary)]">Reminders</h3>
        <div className="flex flex-wrap gap-2">
          {task.reminders.map((reminder) => (
            <button
              key={reminder.id}
              type="button"
              onClick={() =>
                setTask({
                  ...task,
                  reminders: task.reminders.filter((item) => item.id !== reminder.id),
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro text-[var(--text-secondary)]"
              title="Remove reminder"
            >
              <Clock3 className="h-3 w-3" />
              {formatMinutesBefore(reminder.minutesBefore)}
              <X className="h-3 w-3" />
            </button>
          ))}
          <select
            className="h-8 rounded-full border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-micro text-[var(--text-secondary)]"
            value=""
            aria-label="Add reminder"
            onChange={(event) => {
              const minutes = Number(event.target.value);
              event.target.value = "";
              if (!Number.isFinite(minutes) || minutes < 0) return;
              if (task.reminders.some((item) => item.minutesBefore === minutes)) return;
              setTask({
                ...task,
                reminders: [
                  ...task.reminders,
                  {
                    id: id("reminder"),
                    minutesBefore: minutes,
                    enabled: true,
                  },
                ],
              });
            }}
          >
            <option value="">Add reminder…</option>
            {REMINDER_MINUTE_OPTIONS.map((option) => (
              <option
                key={option.minutesBefore}
                value={option.minutesBefore}
                disabled={task.reminders.some(
                  (item) => item.minutesBefore === option.minutesBefore,
                )}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>
    </section>
  );
}

function questionIsComplete(question: QuizQuestion) {
  if (!question.prompt.trim() || !(question.correctAnswer ?? "").trim()) return false;
  if (question.type !== "multiple_choice") return true;
  const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
  return options.length >= 2 && options.includes((question.correctAnswer ?? "").trim());
}

function ToolbarButton({ label, icon: Icon, onClick, disabled = false, danger = false }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-[var(--text-tertiary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent-cyan)_34%,transparent)] disabled:opacity-30 ${danger ? "hover:!bg-[color-mix(in_oklab,var(--danger)_7%,transparent)] hover:!text-[var(--danger)]" : ""}`} aria-label={label} title={label}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></button>;
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-caption font-semibold text-[var(--text-secondary)]">{label}</div>
      <div className="flex rounded-control bg-[color-mix(in_oklab,var(--bg-elevated)_74%,transparent)] p-1 ring-1 ring-[var(--border-default)]">
        {options.map((option) => (
          <button key={option} type="button" className={`h-8 flex-1 rounded-control px-2 text-caption font-medium capitalize ${value === option ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_5px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function inputClass() {
  return "h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))]";
}

function textareaClass(extra = "") {
  return `w-full resize-none rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))] ${extra}`;
}

function secondaryButtonClass() {
  return "inline-flex h-9 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function primaryButtonClass() {
  return "inline-flex h-9 items-center gap-1.5 rounded-control bg-[var(--text-primary)] px-3 text-ui font-medium text-[var(--bg-primary)] disabled:opacity-45";
}

export function blueprintKeyForCard(card: ArtifactCardView): EditableBlueprintKey {
  if (!isArtifactTypeKey(card.blueprintKey)) throw new Error("Native resources and threads use their dedicated surfaces.");
  return card.blueprintKey;
}
