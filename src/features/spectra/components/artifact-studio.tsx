"use client";

import {
  AlertCircle,
  Archive,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookOpen,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  FileText,
  GripVertical,
  History,
  ImageIcon,
  Italic,
  Link2,
  List,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Sigma,
  Sparkles,
  Trash2,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Image } from "@tiptap/extension-image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SlashCommand } from "@/components/editor/slash-command-extension";
import { createSlashCommandRenderer } from "@/components/editor/slash-command-renderer";
import { Callout } from "@/components/editor/extensions/callout-node";
import { DragHandle } from "@/components/editor/extensions/drag-handle";
import { Equation } from "@/components/editor/extensions/equation-node";
import { blueprintMeta } from "./artifact-card";
import {
  artifactPlacements,
  formatRelativeTime,
  formatShortDate,
  linkedArtifacts,
} from "./spectra-view-model";
import type { ArtifactPayload } from "./artifact-blueprint-sheet";
import { getSpectraArtifactLinks, getSpectraArtifactVersions, postSpectra, type SpectraArtifact, type SpectraArtifactLink, type SpectraArtifactVersion } from "../data/api";
import { ThreadConversation } from "./conversation-surface";

type StudioMode = "closed" | "split" | "tab";
type StudioTab = { artifactId: string; openedAt: number };

type DeckCard = {
  id: string;
  front: string;
  back: string;
  hint?: string;
  section?: string;
  confidence?: "unknown" | "weak" | "medium" | "strong";
  sourceRefs?: string[];
  review?: { state?: "new" | "learning" | "review" | "mastered"; correctStreak?: number; lastReviewedAt?: number | null; nextReviewAt?: number | null };
};

type QuizQuestion = {
  id: string;
  prompt: string;
  type: "multiple_choice" | "short_answer";
  options: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
};

type PlannerSubtask = { id: string; title: string; done: boolean };
type PlannerAttachment = { id: string; name: string; meta?: string };

type PlannerTask = {
  description?: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  dueAt?: number;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  subtasks: PlannerSubtask[];
  attachments: PlannerAttachment[];
  linkedArtifactIds: string[];
  reminders: string[];
  estimateMinutes?: number;
  progressNote?: string;
  sourceRefs: string[];
};

const storageVersion = 1;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function aiPreviewSections(artifact: SpectraArtifact) {
  const content = record(artifact.aiPreview?.content);
  const rows = Array.isArray(content.blocks) ? content.blocks
    : Array.isArray(content.cards) ? content.cards
      : Array.isArray(content.questions) ? content.questions
        : [];
  return rows.slice(0, 4).flatMap((row): string[] => {
    const item = record(row);
    const label = [item.title, item.heading, item.front, item.prompt, item.text].find((value) => typeof value === "string" && value.trim());
    return typeof label === "string" ? [label.trim().slice(0, 90)] : [];
  });
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function dateInputValue(value?: number) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function timeInputValue(value?: number) {
  if (!value) return "";
  return new Date(value).toISOString().slice(11, 16);
}

function dateTimeValue(date: string, time: string) {
  if (!date) return undefined;
  const normalizedTime = time || "09:00";
  return new Date(`${date}T${normalizedTime}:00`).getTime();
}

function tagsFromDraft(value: string) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

type ArtifactSnapshot = { title: string; summary?: string; content: unknown; tags: string[] };

function snapshotLines(snapshot: ArtifactSnapshot) {
  const content = JSON.stringify(snapshot.content, null, 2).split("\n").slice(0, 420);
  return [`Title: ${snapshot.title}`, `Summary: ${snapshot.summary ?? ""}`, `Tags: ${(snapshot.tags ?? []).join(", ")}`, "", ...content];
}

function lineDiff(current: ArtifactSnapshot, historical: ArtifactSnapshot) {
  const before = snapshotLines(historical);
  const after = snapshotLines(current);
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) for (let right = after.length - 1; right >= 0; right -= 1) rows[left]![right] = before[left] === after[right] ? rows[left + 1]![right + 1]! + 1 : Math.max(rows[left + 1]![right]!, rows[left]![right + 1]!);
  const result: Array<{ kind: "same" | "added" | "removed"; text: string }> = [];
  let left = 0; let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) { result.push({ kind: "same", text: before[left]! }); left += 1; right += 1; }
    else if (right < after.length && (left >= before.length || rows[left]![right + 1]! >= rows[left + 1]![right]!)) { result.push({ kind: "added", text: after[right]! }); right += 1; }
    else { result.push({ kind: "removed", text: before[left]! }); left += 1; }
  }
  return result;
}

function contentTextFromJson(node?: JSONContent): string {
  if (!node) return "";
  const own = typeof node.text === "string" ? node.text : "";
  const childText = Array.isArray(node.content) ? node.content.map(contentTextFromJson).join(" ") : "";
  return `${own} ${childText}`.trim();
}

function documentJsonFromContent(content: unknown, title: string): JSONContent {
  const source = record(content);
  const tiptap = source.tiptap;
  if (tiptap && typeof tiptap === "object" && record(tiptap).type === "doc") return tiptap as JSONContent;
  const blocks = arrayOfRecords(source.blocks);
  const contentNodes = blocks.length > 0
    ? blocks.map((block) => {
      const text = typeof block.text === "string" ? block.text : "";
      if (block.type === "equation" || block.type === "math") {
        const attrs = record(block.attrs);
        return { type: "equation", attrs: { latex: typeof block.latex === "string" ? block.latex : text, display: attrs.display === "inline" ? "inline" : "block", alignment: ["left", "right"].includes(String(attrs.alignment)) ? attrs.alignment : "center" } };
      }
      const type = block.type === "heading" ? "heading" : block.type === "list" ? "bulletList" : block.type === "quote" ? "blockquote" : "paragraph";
      if (type === "heading") return { type: "heading", attrs: { level: 2 }, content: text ? [{ type: "text", text }] : undefined };
      if (type === "bulletList") return { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }] }] };
      if (type === "blockquote") return { type: "blockquote", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }] };
      return { type: "paragraph", content: text ? [{ type: "text", text }] : undefined };
    })
    : [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] },
      { type: "paragraph" },
    ];
  return { type: "doc", content: contentNodes };
}

function blocksFromJson(json: JSONContent) {
  const nodes = Array.isArray(json.content) ? json.content : [];
  return nodes.map((node, index) => {
    if (node.type === "equation") return { id: `block-${index + 1}`, type: "equation", text: typeof node.attrs?.latex === "string" ? node.attrs.latex : "", latex: typeof node.attrs?.latex === "string" ? node.attrs.latex : "", attrs: { display: node.attrs?.display ?? "block", alignment: node.attrs?.alignment ?? "center" } };
    const text = contentTextFromJson(node);
    const type = node.type === "heading" ? "heading" : node.type === "blockquote" ? "quote" : node.type === "bulletList" || node.type === "orderedList" ? "list" : "paragraph";
    return { id: `block-${index + 1}`, type, text };
  }).filter((block) => block.text.length > 0);
}

function documentContentFromJson(json: JSONContent, previous: unknown) {
  const previousRecord = record(previous);
  const blocks = blocksFromJson(json);
  return {
    ...previousRecord,
    tiptap: json,
    blocks: blocks.length > 0 ? blocks : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block, index) => ({ id: block.id, title: block.text || `Section ${index + 1}`, level: 1 })),
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
    sourceRefs: Array.isArray(card.sourceRefs) ? card.sourceRefs.filter((item): item is string => typeof item === "string") : [],
    review: record(card.review) as DeckCard["review"],
  }));
  return cards.length > 0 ? cards : [{ id: "card-1", front: "", back: "", hint: "", section: "Section 1", confidence: "unknown" }];
}

function quizQuestions(content: unknown): QuizQuestion[] {
  const questions = arrayOfRecords(record(content).questions).map((question, index) => {
    const options = Array.isArray(question.options) ? question.options.filter((option): option is string => typeof option === "string") : [];
    return {
      id: typeof question.id === "string" ? question.id : `question-${index + 1}`,
      prompt: typeof question.prompt === "string" ? question.prompt : "",
      type: (question.type === "multiple_choice" || options.length > 0 ? "multiple_choice" : "short_answer") as QuizQuestion["type"],
      options,
      correctAnswer: typeof question.correctAnswer === "string" ? question.correctAnswer : options[0] ?? "",
      explanation: typeof question.explanation === "string" ? question.explanation : "",
      difficulty: (question.difficulty === "easy" || question.difficulty === "hard" ? question.difficulty : "medium") as QuizQuestion["difficulty"],
      points: typeof question.points === "number" ? question.points : 1,
      timeLimitSeconds: typeof question.timeLimitSeconds === "number" ? question.timeLimitSeconds : 90,
      sourceRefs: Array.isArray(question.sourceRefs) ? question.sourceRefs.filter((item): item is string => typeof item === "string") : [],
      feedback: typeof question.feedback === "string" ? question.feedback : "",
    };
  });
  return questions.length > 0
    ? questions
    : [{ id: "question-1", prompt: "", type: "multiple_choice", options: ["", "", "", ""], correctAnswer: "", explanation: "", difficulty: "medium", points: 1, timeLimitSeconds: 90 }];
}

function plannerTask(content: unknown): PlannerTask {
  const task = record(content);
  return {
    description: typeof task.description === "string" ? task.description : "",
    status: task.status === "doing" || task.status === "done" ? task.status : "todo",
    priority: task.priority === "low" || task.priority === "high" ? task.priority : "medium",
    dueAt: typeof task.dueAt === "number" ? task.dueAt : undefined,
    startAt: typeof task.startAt === "number" ? task.startAt : undefined,
    endAt: typeof task.endAt === "number" ? task.endAt : undefined,
    allDay: task.allDay === true,
    subtasks: arrayOfRecords(task.subtasks).map((subtask, index) => ({
      id: typeof subtask.id === "string" ? subtask.id : `subtask-${index + 1}`,
      title: typeof subtask.title === "string" ? subtask.title : "",
      done: subtask.done === true,
    })),
    attachments: arrayOfRecords(task.attachments).map((attachment, index) => ({
      id: typeof attachment.id === "string" ? attachment.id : `attachment-${index + 1}`,
      name: typeof attachment.name === "string" ? attachment.name : "",
      meta: typeof attachment.meta === "string" ? attachment.meta : "",
    })),
    linkedArtifactIds: Array.isArray(task.linkedArtifactIds) ? task.linkedArtifactIds.filter((item): item is string => typeof item === "string") : [],
    reminders: Array.isArray(task.reminders) ? task.reminders.filter((item): item is string => typeof item === "string") : [],
    estimateMinutes: typeof task.estimateMinutes === "number" ? task.estimateMinutes : undefined,
    progressNote: typeof task.progressNote === "string" ? task.progressNote : "",
    sourceRefs: Array.isArray(task.sourceRefs) ? task.sourceRefs.filter((item): item is string => typeof item === "string") : [],
  };
}

function sameTabs(a: StudioTab[], b: StudioTab[]) {
  return a.length === b.length && a.every((tab, index) => tab.artifactId === b[index]?.artifactId && tab.openedAt === b[index]?.openedAt);
}

function artifactEditorSnapshot(artifact: SpectraArtifact) {
  return {
    title: artifact.title,
    summary: artifact.summary ?? "",
    tagDraft: (artifact.tags ?? []).join(", "),
    content: artifact.content,
  };
}

function snapshotKey(snapshot: { title: string; summary: string; tagDraft: string; content: unknown }) {
  return JSON.stringify(snapshot);
}

export function useArtifactStudioState(storageKey: string, artifacts: SpectraArtifact[]) {
  const [mode, setMode] = useState<StudioMode>("closed");
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<StudioTab[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const restoredStorageKeyRef = useRef<string | null>(null);
  const artifactIdSignature = useMemo(() => artifacts.map((artifact) => artifact._id).sort().join("|"), [artifacts]);
  const artifactIds = useMemo(() => new Set(artifactIdSignature ? artifactIdSignature.split("|") : []), [artifactIdSignature]);
  const threadArtifactIds = useMemo(() => new Set(artifacts.filter((artifact) => artifact.blueprintKey === "thread_reference").map((artifact) => artifact._id)), [artifacts]);

  useEffect(() => {
    if (!artifactIdSignature || restoredStorageKeyRef.current === storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      restoredStorageKeyRef.current = storageKey;
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: number; tabs?: StudioTab[]; activeArtifactId?: string | null; mode?: StudioMode };
      if (parsed.version !== storageVersion) return;
      const restoredTabs = (parsed.tabs ?? []).filter((tab) => artifactIds.has(tab.artifactId) && !threadArtifactIds.has(tab.artifactId));
      setTabs((current) => sameTabs(current, restoredTabs) ? current : restoredTabs);
      if (parsed.mode === "tab" && parsed.activeArtifactId && artifactIds.has(parsed.activeArtifactId)) {
        setMode(threadArtifactIds.has(parsed.activeArtifactId) ? "split" : "tab");
        setActiveArtifactId(parsed.activeArtifactId);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [artifactIdSignature, artifactIds, storageKey, threadArtifactIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: storageVersion, tabs, activeArtifactId, mode: mode === "tab" ? "tab" : "closed" }));
    } catch {
      // Local persistence is best-effort UI state.
    }
  }, [activeArtifactId, mode, storageKey, tabs]);

  useEffect(() => {
    setTabs((current) => {
      const next = current.filter((tab) => artifactIds.has(tab.artifactId) && !threadArtifactIds.has(tab.artifactId));
      return sameTabs(current, next) ? current : next;
    });
    setActiveArtifactId((current) => current && artifactIds.has(current) ? current : null);
  }, [artifactIds, threadArtifactIds]);

  const openSplit = useCallback((artifact: SpectraArtifact) => {
    setActiveArtifactId(artifact._id);
    setMode("split");
  }, []);

  const openTab = useCallback((artifact: SpectraArtifact) => {
    if (artifact.blueprintKey === "thread_reference") {
      setActiveArtifactId(artifact._id);
      setMode("split");
      return;
    }
    setTabs((current) => current.some((tab) => tab.artifactId === artifact._id) ? current : [...current, { artifactId: artifact._id, openedAt: Date.now() }]);
    setActiveArtifactId(artifact._id);
    setMode("tab");
  }, []);

  const activateTab = useCallback((artifactId: string) => {
    setActiveArtifactId(artifactId);
    setMode(threadArtifactIds.has(artifactId) ? "split" : "tab");
  }, [threadArtifactIds]);

  const closeTab = useCallback((artifactId: string) => {
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.artifactId === artifactId);
      const next = current.filter((tab) => tab.artifactId !== artifactId);
      setActiveArtifactId((active) => {
        if (active !== artifactId) return active;
        if (next.length === 0) return null;
        const nearestIndex = closingIndex > 0 ? closingIndex - 1 : 0;
        return next[Math.min(nearestIndex, next.length - 1)]?.artifactId ?? null;
      });
      if (next.length === 0) setMode("closed");
      return next;
    });
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(artifactId);
      return next;
    });
  }, []);

  const closeStudio = useCallback(() => {
    setMode("closed");
    setActiveArtifactId(null);
  }, []);

  const setDirty = useCallback((artifactId: string, dirty: boolean) => {
    setDirtyIds((current) => {
      const hasDirty = current.has(artifactId);
      if (hasDirty === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(artifactId);
      else next.delete(artifactId);
      return next;
    });
  }, []);

  const activeArtifact = artifacts.find((artifact) => artifact._id === activeArtifactId) ?? null;

  return {
    mode,
    activeArtifact,
    activeArtifactId,
    tabs,
    dirtyIds,
    isOpen: mode !== "closed" && Boolean(activeArtifact),
    openSplit,
    openTab,
    activateTab,
    closeTab,
    closeStudio,
    setDirty,
  };
}

export function ArtifactStudio({
  mode,
  artifact,
  artifacts,
  busy = false,
  panelWidth,
  sourceLabel,
  onPanelWidthChange,
  onClose,
  onCloseTab,
  onExpand,
  onSave,
  onRevert,
  onArchive,
  onDirtyChange,
  onContinueThread,
  continuedThreadId,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  dirtyIds: Set<string>;
  busy?: boolean;
  panelWidth?: number;
  sourceLabel: string;
  onPanelWidthChange?: (width: number) => void;
  onClose: () => void;
  onExpand: (artifact: SpectraArtifact) => void;
  onActivateTab: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
  onSave: (artifactId: string, payload: ArtifactPayload) => Promise<void> | void;
  onRevert: (artifactId: string, versionId: string) => Promise<void> | void;
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
  continuedThreadId?: string | null;
}) {
  const router = useRouter();
  const width = panelWidth ?? Math.round(typeof window === "undefined" ? 720 : window.innerWidth * 0.5);
  const handleSave = useCallback((payload: ArtifactPayload) => onSave(artifact._id, payload), [artifact._id, onSave]);
  const handleRevert = useCallback((versionId: string) => onRevert(artifact._id, versionId), [artifact._id, onRevert]);
  const handleClose = useCallback(() => mode === "tab" ? onCloseTab(artifact._id) : onClose(), [artifact._id, mode, onClose, onCloseTab]);
  const handleArchive = useMemo(() => onArchive ? () => onArchive(artifact) : undefined, [artifact, onArchive]);
  const handleDirtyChange = useCallback((dirty: boolean) => onDirtyChange(artifact._id, dirty), [artifact._id, onDirtyChange]);

  const threadId = artifact.blueprintKey === "thread_reference" && typeof record(artifact.content).threadId === "string" ? String(record(artifact.content).threadId).trim() : "";
  const body = artifact.blueprintKey === "thread_reference" ? (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="flex min-h-[78px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]"><MessageSquare className="h-5 w-5" /></span>
          <div className="min-w-0"><div className="truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">{artifact.title}</div><div className="mt-0.5 text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">Conversation · {sourceLabel}</div></div>
        </div>
        <div className="flex items-center gap-1">
          {threadId && onContinueThread ? <button type="button" onClick={() => onContinueThread(threadId, artifact.title)} className={`flex h-8 w-8 items-center justify-center rounded-[7px] transition ${continuedThreadId === threadId ? "bg-[color-mix(in_oklab,#8b6ff0_14%,var(--bg-hover))] text-[#7256dc]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`} aria-label={continuedThreadId === threadId ? "Stop continuing this chat" : "Continue chat"} title={continuedThreadId === threadId ? "Stop continuing chat" : "Continue chat"} aria-pressed={continuedThreadId === threadId}><MessageSquarePlus className="h-4 w-4" /></button> : null}
          <IconButton label="Open conversation in Chat" onClick={() => { if (threadId) router.push(`/chat?threadId=${encodeURIComponent(threadId)}`); }} icon={Maximize2} />
          <IconButton label="Close" onClick={handleClose} icon={X} />
        </div>
      </header>
      <div className="min-h-0 flex-1">{threadId ? <ThreadConversation threadId={threadId} compact showComposer={false} /> : <ThreadReferenceStudio content={artifact.content} />}</div>
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <ArtifactStudioEditor
        key={artifact._id}
        mode={mode}
        artifact={artifact}
        artifacts={artifacts}
        busy={busy}
        sourceLabel={sourceLabel}
        onClose={handleClose}
        onExpand={() => onExpand(artifact)}
        onSave={handleSave}
        onRevert={handleRevert}
        onArchive={handleArchive}
        onDirtyChange={handleDirtyChange}
      />
    </div>
  );

  if (mode === "tab") {
    return <section className="min-w-0 flex-1 border-l border-[var(--border-default)]">{body}</section>;
  }

  return <StudioSplitShell width={width} onWidthChange={onPanelWidthChange} ariaLabel="Artifact Studio">{body}</StudioSplitShell>;
}

export function StudioSplitShell({ width, onWidthChange, ariaLabel, cssWidthVariable, children }: { width: number; onWidthChange?: (width: number) => void; ariaLabel: string; cssWidthVariable?: string; children: ReactNode }) {
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (cssWidthVariable) parent?.style.setProperty(cssWidthVariable, `${width}px`);
    return () => { if (cssWidthVariable) parent?.style.removeProperty(cssWidthVariable); };
  }, [cssWidthVariable, width]);
  useEffect(() => {
    if (!onWidthChange) return;
    const updateWidth = onWidthChange;
    function fitPanel() {
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      if (!panel || !parent) return;
      const siblingWidth = Array.from(parent.querySelectorAll<HTMLElement>(":scope > [data-studio-panel]"))
        .filter((candidate) => candidate !== panel)
        .reduce((total, candidate) => total + candidate.getBoundingClientRect().width, 0);
      const maximum = Math.max(360, Math.min(1120, parent.clientWidth - siblingWidth - 320));
      if (width > maximum) updateWidth(maximum);
    }
    const frame = window.requestAnimationFrame(fitPanel);
    const parent = panelRef.current?.parentElement;
    const observer = parent ? new ResizeObserver(fitPanel) : null;
    if (parent) observer?.observe(parent);
    window.addEventListener("resize", fitPanel);
    return () => { window.cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", fitPanel); };
  }, [onWidthChange, width]);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!resizingRef.current || !onWidthChange) return;
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      const panelLeft = panel?.getBoundingClientRect().left ?? 0;
      const siblings = parent ? Array.from(parent.querySelectorAll<HTMLElement>(":scope > [data-studio-panel]")).filter((candidate) => candidate !== panel) : [];
      const rightSiblingWidth = siblings.filter((candidate) => candidate.getBoundingClientRect().left > panelLeft).reduce((total, candidate) => total + candidate.getBoundingClientRect().width, 0);
      const allSiblingWidth = siblings.reduce((total, candidate) => total + candidate.getBoundingClientRect().width, 0);
      const parentRight = parent?.getBoundingClientRect().right ?? window.innerWidth;
      const available = Math.max(360, (parent?.clientWidth ?? window.innerWidth) - allSiblingWidth - 320);
      onWidthChange(Math.max(360, Math.min(Math.round(parentRight - event.clientX - rightSiblingWidth), Math.min(1120, available))));
    }
    function onUp() { resizingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
  }, [onWidthChange]);
  return <aside ref={panelRef} data-studio-panel className="relative z-40 hidden h-full min-w-[360px] max-w-[94vw] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[-18px_0_40px_rgba(27,20,12,0.06)] xl:block" style={{ width, containerType: "inline-size" }} aria-label={ariaLabel}><button type="button" className="absolute -left-1 top-0 z-20 h-full w-2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--text-tertiary)_18%,transparent)]" aria-label={`Resize ${ariaLabel}`} onPointerDown={(event) => { event.preventDefault(); resizingRef.current = true; document.body.style.cursor = "ew-resize"; document.body.style.userSelect = "none"; }} />{children}</aside>;
}

export function StudioTabRail({
  hubTabs,
  activeHubTabId,
  artifacts,
  tabs,
  activeArtifactId = null,
  dirtyIds,
  onActivateHub,
  onCloseHub,
  onAddHub,
  onActivateTab,
  onCloseTab,
}: {
  hubTabs: Array<{ id: string; label: string }>;
  activeHubTabId: string | null;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  activeArtifactId?: string | null;
  dirtyIds: Set<string>;
  onActivateHub: (hubTabId: string) => void;
  onCloseHub: (hubTabId: string) => void;
  onAddHub: () => void;
  onActivateTab: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,var(--bg-primary))] px-3.5">
      {hubTabs.map((hubTab) => {
        const active = activeHubTabId === hubTab.id;
        return (
          <button
            key={hubTab.id}
            type="button"
            className={`group flex h-9 min-w-[112px] max-w-[250px] shrink-0 items-center gap-2 rounded-[8px] border px-2.5 text-[12px] transition ${
              active ? "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => onActivateHub(hubTab.id)}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
            <span className="min-w-0 flex-1 truncate text-left">{hubTab.label}</span>
            <span
              role="button"
              tabIndex={0}
              className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={(event) => { event.stopPropagation(); onCloseHub(hubTab.id); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseHub(hubTab.id);
                }
              }}
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
      {tabs.map((tab) => {
        const artifact = artifacts.find((item) => item._id === tab.artifactId);
        if (!artifact) return null;
        const meta = blueprintMeta[artifact.blueprintKey];
        const Icon = meta.icon;
        const active = activeArtifactId === artifact._id;
        return (
          <button
            key={tab.artifactId}
            type="button"
            className={`group flex h-9 min-w-[112px] max-w-[250px] shrink-0 items-center gap-2 rounded-[8px] border px-2.5 text-[12px] transition ${
              active ? "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => onActivateTab(artifact._id)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
            <span className="truncate">{artifact.title}</span>
            {dirtyIds.has(artifact._id) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d88922]" title="Unsaved changes" /> : null}
            <span
              role="button"
              tabIndex={0}
              className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={(event) => {
                event.stopPropagation();
                if (dirtyIds.has(artifact._id)) {
                  onActivateTab(artifact._id);
                  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("spectra:request-artifact-close", { detail: { artifactId: artifact._id } })));
                } else onCloseTab(artifact._id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dirtyIds.has(artifact._id)) {
                    onActivateTab(artifact._id);
                    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("spectra:request-artifact-close", { detail: { artifactId: artifact._id } })));
                  } else onCloseTab(artifact._id);
                }
              }}
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={onAddHub}
        aria-label="Open a new home view"
        title="Open a new home view"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ArtifactStudioEditor({
  mode,
  artifact,
  artifacts,
  busy,
  sourceLabel,
  onClose,
  onExpand,
  onSave,
  onRevert,
  onArchive,
  onDirtyChange,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  busy: boolean;
  sourceLabel: string;
  onClose: () => void;
  onExpand: () => void;
  onSave: (payload: ArtifactPayload) => Promise<void> | void;
  onRevert: (versionId: string) => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(artifact.title);
  const [summary, setSummary] = useState(artifact.summary ?? "");
  const [tagDraft, setTagDraft] = useState((artifact.tags ?? []).join(", "));
  const [content, setContent] = useState<unknown>(artifact.content);
  const [baseline, setBaseline] = useState(() => artifactEditorSnapshot(artifact));
  const [dirty, setDirty] = useState(false);
  const [closeDecisionOpen, setCloseDecisionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<SpectraArtifactVersion | null>(null);
  const [remoteConflict, setRemoteConflict] = useState<ReturnType<typeof artifactEditorSnapshot> | null>(null);
  const [dismissedRemoteKey, setDismissedRemoteKey] = useState<string | null>(null);
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const dirtyRef = useRef(dirty);
  const activeArtifactIdRef = useRef(artifact._id);
  const incomingSnapshot = useMemo(() => artifactEditorSnapshot(artifact), [artifact]);
  const currentSnapshot = useMemo(() => ({ title, summary, tagDraft, content }), [content, summary, tagDraft, title]);
  const previewDiff = useMemo(() => previewVersion ? lineDiff({ title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags }, previewVersion.before) : [], [artifact, previewVersion]);

  useEffect(() => {
    onDirtyChange(dirty);
    dirtyRef.current = dirty;
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setDirty(snapshotKey(currentSnapshot) !== snapshotKey(baseline));
  }, [baseline, currentSnapshot]);

  useEffect(() => {
    const switchedArtifacts = activeArtifactIdRef.current !== artifact._id;
    if (!switchedArtifacts && dirtyRef.current) {
      const incomingKey = snapshotKey(incomingSnapshot);
      if (incomingKey !== snapshotKey(baseline) && incomingKey !== dismissedRemoteKey) setRemoteConflict(incomingSnapshot);
      return;
    }
    activeArtifactIdRef.current = artifact._id;
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
    setTitle(incomingSnapshot.title);
    setSummary(incomingSnapshot.summary);
    setTagDraft(incomingSnapshot.tagDraft);
    setContent(incomingSnapshot.content);
    setBaseline(incomingSnapshot);
    if (switchedArtifacts) {
      setDirty(false);
      setCloseDecisionOpen(false);
    }
  }, [artifact._id, artifact.updatedAt, baseline, dismissedRemoteKey, incomingSnapshot]);

  useEffect(() => {
    function requestClose(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail?.artifactId;
      if (artifactId === artifact._id) setCloseDecisionOpen(true);
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("spectra:request-artifact-close", requestClose);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("spectra:request-artifact-close", requestClose);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [artifact._id, dirty]);

  function changeBase(next: Partial<{ title: string; summary: string; tagDraft: string }>) {
    if (next.title !== undefined) setTitle(next.title);
    if (next.summary !== undefined) setSummary(next.summary);
    if (next.tagDraft !== undefined) setTagDraft(next.tagDraft);
  }

  function changeContent(next: unknown) {
    setContent(next);
  }

  async function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    await onSave({
      blueprintKey: artifact.blueprintKey,
      title: trimmedTitle,
      summary: summary.trim() || undefined,
      content,
      tags: tagsFromDraft(tagDraft),
    });
    setBaseline({
      title: trimmedTitle,
      summary: summary.trim(),
      tagDraft: tagsFromDraft(tagDraft).join(", "),
      content,
    });
    setDirty(false);
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
  }

  function keepLocalEdits() {
    if (remoteConflict) setDismissedRemoteKey(snapshotKey(remoteConflict));
    setRemoteConflict(null);
  }

  function reloadRemoteVersion() {
    if (!remoteConflict) return;
    setTitle(remoteConflict.title);
    setSummary(remoteConflict.summary);
    setTagDraft(remoteConflict.tagDraft);
    setContent(remoteConflict.content);
    setBaseline(remoteConflict);
    setDirty(false);
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
  }

  function loadFailedAiPreview() {
    if (!artifact.aiPreview) return;
    if (artifact.aiPreview.title !== undefined) setTitle(artifact.aiPreview.title);
    if (artifact.aiPreview.summary !== undefined) setSummary(artifact.aiPreview.summary);
    if (artifact.aiPreview.content !== undefined) setContent(artifact.aiPreview.content);
  }

  const showDetails = mode === "tab";
  const editorLayoutClass = showDetails
    ? mode === "tab"
      ? "mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"
      : "grid gap-5 2xl:grid-cols-[minmax(0,1fr)_280px]"
    : "block";
  const mainClass = artifact.blueprintKey === "document"
    ? "min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3"
    : "min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className={`${mode === "split" ? "hidden" : "mb-3 flex"} items-center gap-2 text-[12px] text-[var(--text-secondary)]`}>
              <span>{sourceLabel}</span>
              <span>/</span>
              <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />{meta.label}</span>
              <span>/</span>
              <span className="truncate text-[var(--text-primary)]">{artifact.title}</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]" style={{ color: meta.color }}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <input
                  value={title}
                  onChange={(event) => changeBase({ title: event.target.value })}
                  className="w-full bg-transparent font-display text-[26px] font-semibold leading-tight text-[var(--text-primary)] outline-none"
                  placeholder="Untitled artifact"
                />
                <input
                  value={summary}
                  onChange={(event) => changeBase({ summary: event.target.value })}
                  className="mt-1 w-full bg-transparent text-[13px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Short useful summary"
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {mode === "tab" ? <span className="hidden items-center gap-1.5 text-[12px] text-[var(--text-secondary)] md:flex">
              {dirty ? <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
              {dirty ? "Unsaved" : "Saved"}
            </span> : null}
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 px-1.5 text-[13px] font-medium text-[var(--text-primary)] hover:text-[var(--accent-cyan)] disabled:opacity-45"
              disabled={!dirty || busy || !title.trim()}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {mode === "tab" ? "Save" : null}
            </button>
            {mode === "split" ? (
              <IconButton label="Open as tab" onClick={onExpand} icon={Maximize2} />
            ) : null}
            <IconButton label="Version history" onClick={() => { setHistoryOpen(true); void getSpectraArtifactVersions(artifact._id).then((result) => setVersions(result.versions)); }} icon={History} />
            <IconButton label="Close" onClick={() => dirty ? setCloseDecisionOpen(true) : onClose()} icon={X} />
          </div>
        </div>
      </header>
      {artifact.aiState === "updating" && artifact.aiPreview ? <section className="relative shrink-0 overflow-hidden border-b border-[color-mix(in_oklab,var(--accent-cyan)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-primary))] px-5 py-3" aria-live="polite"><span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 animate-[spectra-tab-sweep_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent-cyan)_10%,transparent),transparent)] motion-reduce:hidden" /><div className="relative flex items-start gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)]" /><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-[var(--text-primary)]">Spectra is updating this artifact</div><p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">The saved version remains intact until the canonical edit commits.</p>{aiPreviewSections(artifact).length ? <div className="mt-2 flex flex-wrap gap-1.5">{aiPreviewSections(artifact).map((section, index) => <span key={`${index}:${section}`} className="max-w-[260px] truncate rounded-[6px] border border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-elevated))] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{section}</span>)}</div> : null}</div></div></section> : null}
      {artifact.aiState === "failed" && artifact.aiPreview ? <section className="shrink-0 border-b border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] px-5 py-3" aria-live="polite"><div className="flex flex-wrap items-center gap-3"><AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" /><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-[var(--text-primary)]">The AI edit did not finish</div><p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">The proposed content is retained as a recoverable preview. Your saved version was not replaced.</p></div><button type="button" onClick={loadFailedAiPreview} className="min-h-9 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Load preview for review</button></div></section> : null}
      {remoteConflict ? (
        <div className="shrink-0 border-b border-[color-mix(in_oklab,#d88922_28%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#d88922]" />
            <span className="min-w-0 flex-1">A newer saved version arrived while you were editing. Your local changes are still untouched.</span>
            <button type="button" onClick={keepLocalEdits} className="rounded-[7px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Keep local edits</button>
            <button type="button" onClick={reloadRemoteVersion} className="rounded-[7px] bg-[var(--text-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg-primary)]">Reload latest</button>
          </div>
        </div>
      ) : null}
      <main className={mainClass}>
        <div className={editorLayoutClass}>
          <section className="min-w-0">
            {artifact.blueprintKey === "document" ? <DocumentStudio key={`${artifact._id}:document`} title={title} content={content} onChange={changeContent} /> : null}
            {artifact.blueprintKey === "flashcard_deck" ? <FlashcardStudio key={`${artifact._id}:deck`} mode={mode} content={content} onChange={changeContent} /> : null}
            {artifact.blueprintKey === "quiz" ? <QuizStudio key={`${artifact._id}:quiz`} mode={mode} content={content} onChange={changeContent} /> : null}
            {artifact.blueprintKey === "planner_task" ? <PlannerStudio key={`${artifact._id}:planner`} mode={mode} artifact={artifact} artifacts={artifacts} title={title} content={content} onChange={changeContent} onArchive={onArchive} /> : null}
            {artifact.blueprintKey === "thread_reference" ? <ThreadReferenceStudio content={content} /> : null}
          </section>
          {showDetails ? <StudioDetails
            artifact={artifact}
            artifacts={artifacts}
            tagDraft={tagDraft}
            onTagDraftChange={(value) => changeBase({ tagDraft: value })}
          /> : null}
        </div>
      </main>
      {closeDecisionOpen ? <div className="absolute inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_70%,transparent)] p-5 backdrop-blur-[2px]" onPointerDown={() => setCloseDecisionOpen(false)}><div className="w-full max-w-[420px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Save changes to {artifact.title}?</h2><p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">This artifact has edits that have not been saved.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCloseDecisionOpen(false)} className="h-9 px-3 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Keep editing</button><button type="button" onClick={onClose} className="h-9 rounded-[8px] px-3 text-[12px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]">Discard</button><button type="button" disabled={busy || !title.trim()} onClick={() => void save().then(onClose)} className="h-9 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45">Save & close</button></div></div></div> : null}
      {historyOpen ? <div className="absolute inset-0 z-[119] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_70%,transparent)] p-5 backdrop-blur-[2px]" onPointerDown={() => setHistoryOpen(false)}><div className="flex max-h-[min(720px,88vh)] w-full max-w-[980px] flex-col rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]" onPointerDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">Version history</h2><p className="mt-1 text-[11px] text-[var(--text-secondary)]">Preview any state without changing the artifact. Restore only when ready.</p></div><IconButton label="Close history" onClick={() => setHistoryOpen(false)} icon={X} /></div><div className="mt-4 grid min-h-0 flex-1 gap-4 md:grid-cols-[300px_minmax(0,1fr)]"><div className="max-h-[580px] space-y-1.5 overflow-y-auto pr-1">{versions.map((version) => <button type="button" key={version._id} onClick={() => setPreviewVersion(version)} className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left transition ${previewVersion?._id === version._id ? "bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-primary))] shadow-[inset_3px_0_0_var(--accent-cyan)]" : "bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"}`}><span className={`h-2 w-2 shrink-0 rounded-full ${version.source === "ai" ? "bg-[var(--accent-cyan)]" : version.source === "revert" ? "bg-[#d88922]" : "bg-[var(--text-tertiary)]"}`} /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{version.summary ?? `${version.source} edit`}</span><span className="mt-0.5 block text-[10px] capitalize text-[var(--text-tertiary)]">{version.source} · {formatRelativeTime(version.createdAt)}</span></span></button>)}{versions.length === 0 ? <div className="py-8 text-center text-[12px] text-[var(--text-tertiary)]">No saved versions yet.</div> : null}</div><section className="min-h-[300px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)]">{previewVersion ? <div className="flex h-full min-h-0 flex-col"><div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3"><div><div className="text-[12px] font-semibold text-[var(--text-primary)]">Before “{previewVersion.summary ?? `${previewVersion.source} edit`}”</div><div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">Green is current content · red was removed from this historical state</div></div><button type="button" disabled={Boolean(historyBusy) || dirty} onClick={() => { setHistoryBusy(previewVersion._id); void Promise.resolve(onRevert(previewVersion._id)).then(() => setHistoryOpen(false)).finally(() => setHistoryBusy(null)); }} className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-2.5 text-[10px] font-medium text-[var(--bg-primary)] disabled:opacity-35">{historyBusy === previewVersion._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Restore this version</button></div><div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[10px] leading-5">{previewDiff.map((line, index) => <div key={`${index}:${line.text}`} className={`whitespace-pre-wrap break-all px-2 ${line.kind === "added" ? "bg-[color-mix(in_oklab,var(--success)_11%,transparent)] text-[var(--success)]" : line.kind === "removed" ? "bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] text-[var(--danger)] line-through" : "text-[var(--text-tertiary)]"}`}><span className="mr-2 select-none opacity-55">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>{line.text || " "}</div>)}</div></div> : <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center text-[12px] text-[var(--text-secondary)]">Select a version to preview its highlighted changes.</div>}</section></div></div></div> : null}
    </div>
  );
}

function DocumentStudio({ title, content, onChange }: { title: string; content: unknown; onChange: (content: unknown) => void }) {
  const [initialContent] = useState(() => documentJsonFromContent(content, title));
  const [, refreshToolbar] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true, inline: false }),
      Callout,
      Equation,
      DragHandle,
      Placeholder.configure({ placeholder: "Type / for commands" }),
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          render: createSlashCommandRenderer,
        },
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[620px] px-2 pb-24 pt-2 outline-none font-serif text-[17px] leading-8 text-[var(--text-primary)]",
      },
    },
    onUpdate: ({ editor }) => onChange(documentContentFromJson(editor.getJSON(), content)),
    onSelectionUpdate: () => refreshToolbar((value) => value + 1),
  });

  const equationActive = editor?.isActive("equation") ?? false;
  const equationAttrs = equationActive ? editor?.getAttributes("equation") ?? {} : {};

  return (
    <div className="bg-[var(--bg-primary)]">
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-[var(--border-default)] px-3 py-2">
        <ToolbarButton label="Heading 1" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive("heading", { level: 1 })} icon={FileText} />
        <ToolbarButton label="Heading 2" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive("heading", { level: 2 })} icon={BookOpen} />
        <Divider />
        <ToolbarTextButton label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")}><Bold className="h-4 w-4" /></ToolbarTextButton>
        <ToolbarTextButton label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")}><Italic className="h-4 w-4" /></ToolbarTextButton>
        <ToolbarTextButton label="Underline" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline")}><UnderlineIcon className="h-4 w-4" /></ToolbarTextButton>
        <Divider />
        <ToolbarButton label="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")} icon={List} />
        <ToolbarButton label="Quote" onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive("blockquote")} icon={MessageSquare} />
        <ToolbarButton label="Insert equation" onClick={() => editor?.chain().focus().insertContent({ type: "equation", attrs: { latex: "", display: "block", alignment: "center" } }).run()} active={equationActive} icon={Sigma} />
        <ToolbarButton label="Link" disabled icon={Link2} />
        <ToolbarButton label="More" disabled icon={MoreHorizontal} />
      </div>
      {equationActive ? <div className="flex flex-wrap items-center gap-2 border-b border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] px-4 py-2" data-equation-toolbar="true"><Sigma className="h-4 w-4 text-[var(--accent-cyan)]" /><span className="text-[11px] font-semibold text-[var(--text-secondary)]">LaTeX</span><input value={typeof equationAttrs.latex === "string" ? equationAttrs.latex : ""} onChange={(event) => editor?.chain().focus().updateAttributes("equation", { latex: event.target.value }).run()} className="h-8 min-w-[220px] flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 font-mono text-[12px] text-[var(--text-primary)] outline-none" placeholder="E = mc^2" /><ToolbarButton label="Align left" icon={AlignLeft} active={equationAttrs.alignment === "left"} onClick={() => editor?.chain().focus().updateAttributes("equation", { alignment: "left" }).run()} /><ToolbarButton label="Align center" icon={AlignCenter} active={!equationAttrs.alignment || equationAttrs.alignment === "center"} onClick={() => editor?.chain().focus().updateAttributes("equation", { alignment: "center" }).run()} /><ToolbarButton label="Align right" icon={AlignRight} active={equationAttrs.alignment === "right"} onClick={() => editor?.chain().focus().updateAttributes("equation", { alignment: "right" }).run()} /></div> : null}
      <div className="min-h-[680px] px-2 py-4 sm:px-6">
        <EditorContent
          editor={editor}
          className="tiptap-root mx-auto max-w-[1040px] [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-default)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:font-display [&_.ProseMirror_h1]:text-[30px] [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:font-display [&_.ProseMirror_h2]:text-[23px] [&_.ProseMirror_h2]:leading-tight [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p]:my-4"
        />
      </div>
    </div>
  );
}

function FlashcardStudio({ mode, content, onChange }: { mode: "split" | "tab"; content: unknown; onChange: (content: unknown) => void }) {
  const [cards, setCards] = useState(() => deckCards(content));
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState(cards[0]?.section ?? "Section 1");
  const sections = useMemo(() => Array.from(new Set(cards.map((card) => card.section || "Section 1"))), [cards]);
  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];

  function commit(nextCards: DeckCard[]) {
    setCards(nextCards);
    onChange({ ...record(content), cards: nextCards, settings: record(content).settings ?? { shuffle: true, revealMode: "click" } });
  }

  function updateCard(cardId: string, patch: Partial<DeckCard>) {
    commit(cards.map((card) => card.id === cardId ? { ...card, ...patch } : card));
  }

  function addCard(section = activeSection) {
    const card = { id: id("card"), front: "", back: "", hint: "", section, confidence: "unknown" as const };
    commit([...cards, card]);
    setActiveCardId(card.id);
    setActiveSection(section);
  }

  return (
    <div className={`grid min-h-[720px] gap-4 ${mode === "tab" ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "grid-cols-1"}`}>
      <aside className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Cards</h3>
            <p className="text-[11px] text-[var(--text-secondary)]">{cards.length} cards across {sections.length} sections</p>
          </div>
          <button type="button" className={smallActionClass()} onClick={() => addCard()}><Plus className="h-3.5 w-3.5" />Add</button>
        </div>
        <div className="max-h-[650px] overflow-y-auto p-2">
          {sections.map((section) => (
            <section key={section} className="mb-2">
              <button type="button" className="flex h-9 w-full items-center justify-between rounded-[7px] px-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" onClick={() => setActiveSection(section)}>
                <span>{section}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              </button>
              <div className="space-y-1">
                {cards.filter((card) => (card.section || "Section 1") === section).map((card, index) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border px-2 py-2 text-left ${
                      card.id === activeCard?.id ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]" : "border-transparent hover:bg-[var(--bg-hover)]"
                    }`}
                    onClick={() => {
                      setActiveCardId(card.id);
                      setActiveSection(section);
                    }}
                  >
                    <span className="text-center text-[12px] text-[var(--text-secondary)]">{index + 1}</span>
                    <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">{card.front || "Untitled card"}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${card.confidence === "strong" ? "bg-[var(--success)]" : card.confidence === "weak" ? "bg-[var(--danger)]" : "bg-[#d88922]"}`} />
                  </button>
                ))}
              </div>
            </section>
          ))}
          <button type="button" className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => {
            const section = `Section ${sections.length + 1}`;
            setActiveSection(section);
            addCard(section);
          }}>
            <Plus className="h-3.5 w-3.5" />Add section
          </button>
        </div>
      </aside>
      <section className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        {activeCard ? (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[12px] text-[var(--text-secondary)]">Card {cards.findIndex((card) => card.id === activeCard.id) + 1} of {cards.length}</div>
              <div className="flex items-center gap-2">
                <button type="button" className={iconButtonClass()} onClick={() => {
                  const next = cards.filter((card) => card.id !== activeCard.id);
                  commit(next.length > 0 ? next : [{ id: id("card"), front: "", back: "", hint: "", section: activeSection, confidence: "unknown" }]);
                  setActiveCardId(next[0]?.id ?? "");
                }} aria-label="Remove card"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <CardFace label="Front" value={activeCard.front} placeholder="Question or prompt" onChange={(value) => updateCard(activeCard.id, { front: value })} />
            <div className="my-3 flex justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]"><Copy className="h-4 w-4" /></span>
            </div>
            <CardFace label="Back" value={activeCard.back} placeholder="Answer" onChange={(value) => updateCard(activeCard.id, { back: value })} />
            <div className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-[1fr_180px]" : "grid-cols-1"}`}>
              <Field label="Note or hint">
                <input value={activeCard.hint ?? ""} onChange={(event) => updateCard(activeCard.id, { hint: event.target.value })} className={inputClass()} placeholder="Optional hint" />
              </Field>
              <Field label="Confidence">
                <select value={activeCard.confidence ?? "unknown"} onChange={(event) => updateCard(activeCard.id, { confidence: event.target.value as DeckCard["confidence"] })} className={inputClass()}>
                  <option value="unknown">Unknown</option>
                  <option value="weak">Weak</option>
                  <option value="medium">Medium</option>
                  <option value="strong">Strong</option>
                </select>
              </Field>
            </div>
            <div className={`mt-3 grid gap-3 ${mode === "tab" ? "md:grid-cols-3" : "grid-cols-1"}`}>
              <Field label="Section"><input value={activeCard.section ?? ""} onChange={(event) => updateCard(activeCard.id, { section: event.target.value || "Section 1" })} className={inputClass()} placeholder="Section" /></Field>
              <Field label="Review state"><select value={activeCard.review?.state ?? "new"} onChange={(event) => updateCard(activeCard.id, { review: { ...activeCard.review, state: event.target.value as NonNullable<DeckCard["review"]>["state"] } })} className={inputClass()}><option value="new">New</option><option value="learning">Learning</option><option value="review">Review</option><option value="mastered">Mastered</option></select></Field>
              <Field label="Correct streak"><input type="number" min={0} value={activeCard.review?.correctStreak ?? 0} onChange={(event) => updateCard(activeCard.id, { review: { ...activeCard.review, correctStreak: Math.max(0, Number(event.target.value)) } })} className={inputClass()} /></Field>
            </div>
            <div className="mt-3"><Field label="Sources / provenance"><input value={(activeCard.sourceRefs ?? []).join(", ")} onChange={(event) => updateCard(activeCard.id, { sourceRefs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className={inputClass()} placeholder="Chapter 3, lecture notes" /></Field></div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function QuizStudio({ mode, content, onChange }: { mode: "split" | "tab"; content: unknown; onChange: (content: unknown) => void }) {
  const [questions, setQuestions] = useState(() => quizQuestions(content));
  const [activeQuestionId, setActiveQuestionId] = useState(questions[0]?.id ?? "");
  const [view, setView] = useState<"builder" | "preview">("builder");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) ?? questions[0];

  function commit(next: QuizQuestion[]) {
    setQuestions(next);
    onChange({ ...record(content), questions: next, settings: record(content).settings ?? { showAnswersImmediately: true, timed: false } });
  }

  function updateQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    commit(questions.map((question) => question.id === questionId ? { ...question, ...patch } : question));
  }

  function addQuestion() {
    const question = { id: id("question"), prompt: "", type: "multiple_choice" as const, options: ["", "", "", ""], correctAnswer: "", explanation: "", difficulty: "medium" as const, points: 1, timeLimitSeconds: 90 };
    commit([...questions, question]);
    setActiveQuestionId(question.id);
  }

  return (
    <div className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className={tabButtonClass(view === "builder")} onClick={() => setView("builder")}>Builder</button>
          <button type="button" className={tabButtonClass(view === "preview")} onClick={() => setView("preview")}>Preview</button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={smallActionClass()} onClick={addQuestion}><Plus className="h-3.5 w-3.5" />Add question</button>
        </div>
      </div>
      {view === "preview" ? (
        <div className="p-5">
          <div className="mx-auto max-w-[760px] space-y-3">
            <div className="mb-5 flex items-end justify-between"><div><h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">Take quiz</h3><p className="mt-1 text-[12px] text-[var(--text-secondary)]">Answer locally, then submit to mark and review explanations.</p></div>{submitted ? <div className="rounded-[8px] bg-[color-mix(in_oklab,var(--success)_9%,var(--bg-primary))] px-3 py-2 text-[12px] font-semibold text-[var(--success)]">{questions.filter((question) => (answers[question.id] ?? "").trim().toLowerCase() === (question.correctAnswer ?? "").trim().toLowerCase()).length}/{questions.length} correct</div> : null}</div>
            {questions.map((question, index) => (
              <div key={question.id} className={`rounded-[8px] border bg-[var(--bg-primary)] p-4 ${submitted ? (answers[question.id] ?? "").trim().toLowerCase() === (question.correctAnswer ?? "").trim().toLowerCase() ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))]" : "border-[color-mix(in_oklab,var(--danger)_38%,var(--border-default))]" : "border-[var(--border-default)]"}`}>
                <div className="text-[12px] font-semibold text-[var(--text-secondary)]">Question {index + 1}</div>
                <div className="mt-2 text-[15px] font-medium text-[var(--text-primary)]">{question.prompt || "Untitled question"}</div>
                <div className="mt-3 space-y-2">
                  {question.type === "multiple_choice" ? question.options.map((option, optionIndex) => (
                    <button type="button" disabled={submitted} onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))} key={`${question.id}-${optionIndex}`} className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] transition ${answers[question.id] === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}><Radio className="h-3.5 w-3.5" />{option || `Option ${optionIndex + 1}`}</button>
                  )) : <input disabled={submitted} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className={inputClass()} placeholder="Type your answer" />}
                </div>
                {submitted ? <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-5 text-[var(--text-secondary)]"><div><strong className="text-[var(--text-primary)]">Answer:</strong> {question.correctAnswer}</div>{question.explanation ? <div className="mt-1">{question.explanation}</div> : null}{question.sourceRefs?.length ? <div className="mt-1 text-[var(--text-tertiary)]">Sources: {question.sourceRefs.join(" · ")}</div> : null}</div> : null}
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-3">{submitted ? <button type="button" className={smallActionClass()} onClick={() => { setSubmitted(false); setAnswers({}); }}>Try again</button> : <button type="button" className="h-9 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)]" onClick={() => setSubmitted(true)}>Submit answers</button>}</div>
          </div>
        </div>
      ) : (
        <div className={`grid min-h-[680px] ${mode === "tab" ? "lg:grid-cols-[310px_minmax(0,1fr)_220px]" : "grid-cols-1"}`}>
          <aside className={`${mode === "tab" ? "border-r" : "border-b"} border-[var(--border-default)] p-3`}>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Questions ({questions.length})</div>
            <div className="space-y-2">
              {questions.map((question, index) => (
                <button
                  key={question.id}
                  type="button"
                  className={`grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border px-2 py-2 text-left ${
                    activeQuestion?.id === question.id ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                  }`}
                  onClick={() => setActiveQuestionId(question.id)}
                >
                  <span className="rounded-[6px] border border-[var(--border-default)] py-1 text-center text-[12px] text-[var(--text-secondary)]">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{question.prompt || "Untitled question"}</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{question.type === "multiple_choice" ? "MCQ" : "Short answer"}</span>
                  </span>
                  <GripVertical className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </button>
              ))}
            </div>
          </aside>
          <section className={`min-w-0 ${mode === "tab" ? "border-r" : "border-b"} border-[var(--border-default)] p-4`}>
            {activeQuestion ? (
              <QuestionEditor
                question={activeQuestion}
                questionNumber={questions.findIndex((question) => question.id === activeQuestion.id) + 1}
                onChange={(patch) => updateQuestion(activeQuestion.id, patch)}
                onRemove={() => {
                  const next = questions.filter((question) => question.id !== activeQuestion.id);
                  commit(next.length > 0 ? next : quizQuestions({}));
                  setActiveQuestionId(next[0]?.id ?? "");
                }}
              />
            ) : null}
          </section>
          <aside className="p-4">
            {activeQuestion ? (
              <div className="space-y-4">
                <Field label="Difficulty">
                  <select value={activeQuestion.difficulty ?? "medium"} onChange={(event) => updateQuestion(activeQuestion.id, { difficulty: event.target.value as QuizQuestion["difficulty"] })} className={inputClass()}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
                <Field label="Points">
                  <input type="number" value={activeQuestion.points ?? 1} min={1} onChange={(event) => updateQuestion(activeQuestion.id, { points: Number(event.target.value) })} className={inputClass()} />
                </Field>
                <Field label="Time">
                  <input type="number" value={activeQuestion.timeLimitSeconds ?? 90} min={0} onChange={(event) => updateQuestion(activeQuestion.id, { timeLimitSeconds: Number(event.target.value) })} className={inputClass()} />
                </Field>
                <div className="rounded-[8px] border border-dashed border-[var(--border-default)] p-4 text-center text-[12px] text-[var(--text-secondary)]">
                  <ImageIcon className="mx-auto mb-2 h-4 w-4" />
                  Media upload is deferred.
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

function PlannerStudio({
  mode,
  artifact,
  artifacts,
  title,
  content,
  onChange,
  onArchive,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  onArchive?: () => Promise<void> | void;
}) {
  const [task, setTask] = useState(() => plannerTask(content));
  const [dueDate, setDueDate] = useState(dateInputValue(task.dueAt));
  const [startDate, setStartDate] = useState(dateInputValue(task.startAt));
  const [startTime, setStartTime] = useState(timeInputValue(task.startAt));
  const [endDate, setEndDate] = useState(dateInputValue(task.endAt));
  const [endTime, setEndTime] = useState(timeInputValue(task.endAt));

  function commit(next: PlannerTask, nextDates = { dueDate, startDate, startTime, endDate, endTime }) {
    const dueAt = nextDates.dueDate ? new Date(`${nextDates.dueDate}T12:00:00`).getTime() : undefined;
    const startAt = dateTimeValue(nextDates.startDate, nextDates.startTime);
    const endAt = dateTimeValue(nextDates.endDate, nextDates.endTime);
    const full = { ...next, dueAt, startAt, endAt };
    setTask(full);
    onChange({ ...record(content), ...full });
  }

  const linked = task.linkedArtifactIds
    .map((artifactId) => artifacts.find((item) => item._id === artifactId))
    .filter((item): item is SpectraArtifact => Boolean(item));

  return (
    <div className={`grid gap-5 ${mode === "tab" ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"}`}>
      <section className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <div className="mb-5 flex items-center gap-3">
          <CalendarCheck2 className="h-8 w-8 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-1.5 text-[#d88922]" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Planner task</div>
            <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">{title || artifact.title}</h3>
          </div>
        </div>
        <Field label="Description">
          <textarea value={task.description ?? ""} onChange={(event) => commit({ ...task, description: event.target.value })} className={textareaClass("min-h-[136px]")} placeholder="What needs to happen?" />
        </Field>
        <div className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-[160px_minmax(0,1fr)]" : "grid-cols-1"}`}><Field label="Estimate (minutes)"><input type="number" min={1} value={task.estimateMinutes ?? ""} onChange={(event) => commit({ ...task, estimateMinutes: event.target.value ? Number(event.target.value) : undefined })} className={inputClass()} placeholder="45" /></Field><Field label="Progress note"><input value={task.progressNote ?? ""} onChange={(event) => commit({ ...task, progressNote: event.target.value })} className={inputClass()} placeholder="Current blocker or next concrete step" /></Field></div>
        <div className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-4" : "grid-cols-1"}`}>
          <Field label="Status">
            <select value={task.status} onChange={(event) => commit({ ...task, status: event.target.value as PlannerTask["status"] })} className={inputClass()}>
              <option value="todo">Todo</option>
              <option value="doing">In progress</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Priority">
            <select value={task.priority} onChange={(event) => commit({ ...task, priority: event.target.value as PlannerTask["priority"] })} className={inputClass()}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); commit(task, { dueDate: event.target.value, startDate, startTime, endDate, endTime }); }} className={inputClass()} />
          </Field>
          <Field label="All day">
            <button type="button" className={`flex h-10 w-full items-center justify-between rounded-[8px] border border-[var(--border-default)] px-3 text-[13px] ${task.allDay ? "bg-[color-mix(in_oklab,#2fa66f_8%,var(--bg-primary))] text-[var(--text-primary)]" : "bg-[var(--bg-primary)] text-[var(--text-secondary)]"}`} onClick={() => commit({ ...task, allDay: !task.allDay })}>
              {task.allDay ? "Enabled" : "Disabled"}
              <span className={`h-5 w-9 rounded-full p-0.5 ${task.allDay ? "bg-[var(--success)]" : "bg-[var(--bg-secondary)]"}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${task.allDay ? "translate-x-4" : ""}`} /></span>
            </button>
          </Field>
        </div>
        <div className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-2" : "grid-cols-1"}`}>
          <Field label="Starts">
            <div className={`grid gap-2 ${mode === "tab" ? "grid-cols-[1fr_110px]" : "grid-cols-1"}`}>
              <input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); commit(task, { dueDate, startDate: event.target.value, startTime, endDate, endTime }); }} className={inputClass()} />
              <input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); commit(task, { dueDate, startDate, startTime: event.target.value, endDate, endTime }); }} className={inputClass()} />
            </div>
          </Field>
          <Field label="Ends">
            <div className={`grid gap-2 ${mode === "tab" ? "grid-cols-[1fr_110px]" : "grid-cols-1"}`}>
              <input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); commit(task, { dueDate, startDate, startTime, endDate: event.target.value, endTime }); }} className={inputClass()} />
              <input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); commit(task, { dueDate, startDate, startTime, endDate, endTime: event.target.value }); }} className={inputClass()} />
            </div>
          </Field>
        </div>
        <TaskListEditor task={task} commit={commit} />
        <AttachmentEditor task={task} commit={commit} />
        <div className="mt-5"><Field label="Sources / provenance"><input value={task.sourceRefs.join(", ")} onChange={(event) => commit({ ...task, sourceRefs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className={inputClass()} placeholder="Assignment brief, linked document" /></Field></div>
      </section>
      {mode === "tab" ? <aside className="space-y-4">
        <SideCard title="Schedule">
          <MetricRow label="Starts" value={task.startAt ? formatShortDate(task.startAt) : "Not set"} />
          <MetricRow label="Ends" value={task.endAt ? formatShortDate(task.endAt) : "Not set"} />
          <MetricRow label="All day" value={task.allDay ? "Yes" : "No"} />
        </SideCard>
        <SideCard title="Linked to">
          <div className="space-y-2">
            {linked.map((item) => {
              const meta = blueprintMeta[item.blueprintKey];
              const Icon = meta.icon;
              return <div key={item._id} className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]"><Icon className="h-4 w-4" style={{ color: meta.color }} />{item.title}</div>;
            })}
            {linked.length === 0 ? <div className="text-[12px] text-[var(--text-secondary)]">No linked artifacts.</div> : null}
            <select
              className={inputClass()}
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                commit({ ...task, linkedArtifactIds: Array.from(new Set([...task.linkedArtifactIds, event.target.value])) });
              }}
            >
              <option value="">Link artifact</option>
              {artifacts.filter((item) => item._id !== artifact._id && !task.linkedArtifactIds.includes(item._id)).map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
            </select>
          </div>
        </SideCard>
        <SideCard title="Reminders">
          <ReminderEditor task={task} commit={commit} />
        </SideCard>
        <button type="button" className="flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] text-[13px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))]" onClick={() => onArchive ? void onArchive() : undefined} disabled={!onArchive}>
          <Archive className="h-4 w-4" />Archive task
        </button>
      </aside> : null}
    </div>
  );
}

function ThreadReferenceStudio({ content }: { content: unknown }) {
  const threadId = typeof record(content).threadId === "string" ? record(content).threadId as string : "";
  if (threadId.trim()) {
    return (
      <div className="h-[min(760px,calc(100vh-230px))] min-h-[460px] overflow-hidden bg-[var(--bg-primary)]">
        <ThreadConversation threadId={threadId.trim()} compact showComposer={false} />
      </div>
    );
  }
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-[var(--bg-primary)] p-8 text-center">
      <div className="max-w-[420px]">
        <MessageSquare className="mx-auto h-10 w-10 rounded-[10px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] p-2.5 text-[#8b6ff0]" />
        <div>
          <h3 className="mt-4 font-display text-[22px] font-semibold text-[var(--text-primary)]">Conversation unavailable</h3>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">This older artifact is a disconnected reference, not a conversation. Keep a current run or place a chat thread to create a working thread artifact.</p>
        </div>
      </div>
    </div>
  );
}

function QuestionEditor({ question, questionNumber, onChange, onRemove }: { question: QuizQuestion; questionNumber: number; onChange: (patch: Partial<QuizQuestion>) => void; onRemove: () => void }) {
  function updateOption(index: number, value: string) {
    const options = [...question.options];
    options[index] = value;
    onChange({ options, correctAnswer: question.correctAnswer === question.options[index] ? value : question.correctAnswer });
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">Question {questionNumber}</div>
        <button type="button" className={iconButtonClass()} onClick={onRemove} aria-label="Remove question"><Trash2 className="h-4 w-4" /></button>
      </div>
      <Field label="Type">
        <select value={question.type} onChange={(event) => onChange({ type: event.target.value as QuizQuestion["type"], options: event.target.value === "multiple_choice" && question.options.length === 0 ? ["", "", "", ""] : question.options })} className={inputClass()}>
          <option value="multiple_choice">Multiple choice</option>
          <option value="short_answer">Short answer</option>
        </select>
      </Field>
      <div className="mt-4">
        <Field label="Question">
          <textarea value={question.prompt} onChange={(event) => onChange({ prompt: event.target.value })} className={textareaClass("min-h-[110px]")} placeholder="Write a clear question" />
        </Field>
      </div>
      {question.type === "multiple_choice" ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">Answer options</h4>
            <button type="button" className={smallActionClass()} onClick={() => onChange({ options: [...question.options, ""] })}><Plus className="h-3.5 w-3.5" />Add option</button>
          </div>
          <div className="space-y-2">
            {question.options.map((option, index) => (
              <div key={index} className="grid grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-2">
                <button type="button" className={`flex h-8 w-8 items-center justify-center rounded-full border ${question.correctAnswer === option && option ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]"}`} onClick={() => onChange({ correctAnswer: option })} aria-label={`Mark option ${index + 1} correct`}>
                  {question.correctAnswer === option && option ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </button>
                <input value={option} onChange={(event) => updateOption(index, event.target.value)} className={inputClass()} placeholder={`Option ${index + 1}`} />
                <button type="button" className={iconButtonClass()} onClick={() => onChange({ options: question.options.filter((_, candidate) => candidate !== index) })} aria-label="Remove option"><Minus className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Field label="Correct answer">
            <select value={question.correctAnswer ?? ""} onChange={(event) => onChange({ correctAnswer: event.target.value })} className={`${inputClass()} mt-3`}>
              <option value="">Choose correct answer</option>
              {question.options.filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        </section>
      ) : (
        <div className="mt-4">
          <Field label="Expected answer">
            <input value={question.correctAnswer ?? ""} onChange={(event) => onChange({ correctAnswer: event.target.value })} className={inputClass()} placeholder="Short answer key" />
          </Field>
        </div>
      )}
      <div className="mt-4">
        <Field label="Explanation">
          <textarea value={question.explanation ?? ""} onChange={(event) => onChange({ explanation: event.target.value })} className={textareaClass("min-h-[110px]")} placeholder="Optional answer explanation" />
        </Field>
      </div>
      <div className="mt-4"><Field label="Sources / provenance"><input value={(question.sourceRefs ?? []).join(", ")} onChange={(event) => onChange({ sourceRefs: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} className={inputClass()} placeholder="Textbook p. 42, class notes" /></Field></div>
    </div>
  );
}

function TaskListEditor({ task, commit }: { task: PlannerTask; commit: (task: PlannerTask) => void }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">Subtasks {task.subtasks.filter((item) => item.done).length}/{task.subtasks.length}</h4>
        <button type="button" className={smallActionClass()} onClick={() => commit({ ...task, subtasks: [...task.subtasks, { id: id("subtask"), title: "", done: false }] })}><Plus className="h-3.5 w-3.5" />Add subtask</button>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
        {(task.subtasks.length > 0 ? task.subtasks : [{ id: "empty", title: "", done: false }]).map((subtask) => (
          <div key={subtask.id} className="grid grid-cols-[32px_minmax(0,1fr)_34px] items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 last:border-b-0">
            <button type="button" className="text-[var(--text-secondary)]" onClick={() => commit({ ...task, subtasks: task.subtasks.map((item) => item.id === subtask.id ? { ...item, done: !item.done } : item) })}>
              {subtask.done ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <Circle className="h-4 w-4" />}
            </button>
            <input value={subtask.title} onChange={(event) => commit({ ...task, subtasks: task.subtasks.map((item) => item.id === subtask.id ? { ...item, title: event.target.value } : item) })} className="h-8 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="Subtask" />
            <button type="button" className="text-[var(--text-tertiary)] hover:text-[var(--danger)]" onClick={() => commit({ ...task, subtasks: task.subtasks.filter((item) => item.id !== subtask.id) })}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttachmentEditor({ task, commit }: { task: PlannerTask; commit: (task: PlannerTask) => void }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">Attachments</h4>
        <button type="button" className={smallActionClass()} onClick={() => commit({ ...task, attachments: [...task.attachments, { id: id("attachment"), name: "", meta: "" }] })}><Plus className="h-3.5 w-3.5" />Add</button>
      </div>
      <div className="space-y-2">
        {task.attachments.map((attachment) => (
          <div key={attachment.id} className="grid grid-cols-[minmax(0,1fr)_130px_34px] gap-2">
            <input value={attachment.name} onChange={(event) => commit({ ...task, attachments: task.attachments.map((item) => item.id === attachment.id ? { ...item, name: event.target.value } : item) })} className={inputClass()} placeholder="Attachment name" />
            <input value={attachment.meta ?? ""} onChange={(event) => commit({ ...task, attachments: task.attachments.map((item) => item.id === attachment.id ? { ...item, meta: event.target.value } : item) })} className={inputClass()} placeholder="Meta" />
            <button type="button" className={iconButtonClass()} onClick={() => commit({ ...task, attachments: task.attachments.filter((item) => item.id !== attachment.id) })} aria-label="Remove attachment"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {task.attachments.length === 0 ? <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-4 text-center text-[12px] text-[var(--text-secondary)]">Attach files later, or add a reference now.</div> : null}
      </div>
    </section>
  );
}

function ReminderEditor({ task, commit }: { task: PlannerTask; commit: (task: PlannerTask) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      {task.reminders.map((reminder) => (
        <div key={reminder} className="flex items-center justify-between gap-2 rounded-[7px] border border-[var(--border-default)] px-2 py-2 text-[12px] text-[var(--text-primary)]">
          <span className="truncate">{reminder}</span>
          <button type="button" onClick={() => commit({ ...task, reminders: task.reminders.filter((item) => item !== reminder) })}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_34px] gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} className={inputClass()} placeholder="e.g. 30 min before" />
        <button type="button" className={iconButtonClass()} onClick={() => {
          if (!draft.trim()) return;
          commit({ ...task, reminders: [...task.reminders, draft.trim()] });
          setDraft("");
        }} aria-label="Add reminder"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function StudioDetails({ artifact, artifacts, tagDraft, onTagDraftChange }: { artifact: SpectraArtifact; artifacts: SpectraArtifact[]; tagDraft: string; onTagDraftChange: (value: string) => void }) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const placements = artifactPlacements(artifact);
  const links = linkedArtifacts(artifact, artifacts);
  const [durableLinks, setDurableLinks] = useState<SpectraArtifactLink[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const visibleTags = tagsFromDraft(tagDraft);
  useEffect(() => {
    void getSpectraArtifactLinks(artifact._id).then((result) => setDurableLinks(result.links)).catch(() => setDurableLinks([]));
  }, [artifact._id]);
  const linkedIds = new Set(durableLinks.flatMap((link) => link.artifact?.id ? [link.artifact.id] : []));
  const suggestions = artifacts.filter((candidate) => candidate._id !== artifact._id && !linkedIds.has(candidate._id)).map((candidate) => {
    const sharedWorkspace = artifactPlacements(candidate).some((placement) => placements.some((source) => source.workspaceId === placement.workspaceId));
    const sharedTags = candidate.tags.filter((tag) => artifact.tags.includes(tag)).length;
    const titleWords = artifact.title.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const titleMatch = titleWords.some((word) => `${candidate.title} ${candidate.summary ?? ""}`.toLowerCase().includes(word));
    return { candidate, score: Number(sharedWorkspace) * 5 + sharedTags * 3 + Number(titleMatch) * 2 + Number(candidate.blueprintKey === artifact.blueprintKey) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.candidate.updatedAt - a.candidate.updatedAt).slice(0, 3);

  async function confirmLink(target: SpectraArtifact) {
    setLinkingId(target._id);
    try {
      await postSpectra({ action: "createArtifactLink", sourceArtifactId: artifact._id, targetArtifactId: target._id, relationType: "related", workspaceId: placements[0]?.workspaceId, explanation: "Confirmed from a related-artifact suggestion" });
      const result = await getSpectraArtifactLinks(artifact._id);
      setDurableLinks(result.links);
    } finally { setLinkingId(null); }
  }
  async function removeLink(linkId: string) {
    await postSpectra({ action: "removeArtifactLink", linkId });
    const result = await getSpectraArtifactLinks(artifact._id);
    setDurableLinks(result.links);
  }
  return (
    <aside className="space-y-4">
      <SideCard title="Details">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
          <Icon className="h-4 w-4" style={{ color: meta.color }} />
          {meta.label}
          <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklab,var(--success)_11%,var(--bg-primary))] px-2 py-1 text-[11px] text-[var(--success)]">Active</span>
        </div>
      </SideCard>
      <SideCard title="Placement">
        <div className="space-y-2">
          {placements.length > 0 ? placements.map((placement) => (
            <div key={placement.workspaceItemId} className="rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] font-medium text-[var(--text-primary)]">
              {placement.workspaceTitle}
              <div className="text-[11px] font-normal text-[var(--text-secondary)]">Workspace</div>
            </div>
          )) : <div className="text-[13px] text-[var(--text-secondary)]">Library inbox</div>}
        </div>
      </SideCard>
      <SideCard title="Linked artifacts">
        <div className="space-y-2">
          {durableLinks.slice(0, 8).map((link) => link.artifact ? <div key={link._id} className="group rounded-[7px] bg-[var(--bg-primary)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]" data-link-direction={link.direction}><div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" /><span className="min-w-0 flex-1 truncate font-medium">{link.artifact.title}</span><span className="text-[9px] text-[var(--text-tertiary)]">{link.direction === "incoming" ? "←" : "→"} {link.relationType.replaceAll("_", " ")}</span><button type="button" onClick={() => void removeLink(link._id)} className="text-[var(--text-tertiary)] opacity-0 transition hover:text-[var(--danger)] group-hover:opacity-100" aria-label={`Remove link to ${link.artifact.title}`}><X className="h-3 w-3" /></button></div>{link.explanation ? <div className="mt-1 line-clamp-2 pl-3.5 text-[9px] leading-4 text-[var(--text-tertiary)]">{link.explanation}</div> : null}</div> : null)}
          {links.slice(0, 4).map(({ artifact: linked }) => {
            const linkedMeta = blueprintMeta[linked.blueprintKey];
            const LinkedIcon = linkedMeta.icon;
            return (
              <div key={linked._id} className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]">
                <LinkedIcon className="h-4 w-4" style={{ color: linkedMeta.color }} />
                <span className="min-w-0 flex-1 truncate">{linked.title}</span>
              </div>
            );
          })}
          {links.length === 0 && durableLinks.length === 0 ? <div className="text-[12px] text-[var(--text-secondary)]">No confirmed links yet.</div> : null}
        </div>
      </SideCard>
      {suggestions.length > 0 ? <SideCard title="Related suggestions"><div className="space-y-1.5">{suggestions.map(({ candidate }) => <div key={candidate._id} className="group flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 hover:bg-[var(--bg-primary)]"><span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">{candidate.title}</span><button type="button" disabled={linkingId === candidate._id} onClick={() => void confirmLink(candidate)} className="rounded-[5px] px-1.5 py-1 text-[9px] font-medium text-[var(--accent-cyan)] opacity-70 hover:bg-[var(--bg-hover)] group-hover:opacity-100">{linkingId === candidate._id ? "Linking…" : "Confirm link"}</button></div>)}</div></SideCard> : null}
      {artifact.createdFrom ? <SideCard title="Provenance"><div className="text-[11px] leading-5 text-[var(--text-secondary)]"><div className="font-medium text-[var(--text-primary)]">{artifact.createdFrom.contextSummary ?? `Created from ${artifact.createdFrom.source}`}</div>{artifact.createdFrom.sourceArtifactIds?.length ? <div className="mt-1">Used {artifact.createdFrom.sourceArtifactIds.length} source artifact{artifact.createdFrom.sourceArtifactIds.length === 1 ? "" : "s"}</div> : null}{artifact.createdFrom.threadId ? <div>Includes conversation context</div> : null}{artifact.createdFrom.sourceAttachmentNames?.length ? <div>{artifact.createdFrom.sourceAttachmentNames.length} attachment{artifact.createdFrom.sourceAttachmentNames.length === 1 ? "" : "s"}</div> : null}</div></SideCard> : null}
      <SideCard title="Tags">
        <div className="flex flex-wrap gap-1.5">{visibleTags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]" data-artifact-tag={tag}><span>{tag}</span><button type="button" onClick={() => onTagDraftChange(visibleTags.filter((item) => item !== tag).join(", "))} aria-label={`Remove ${tag}`}><X className="h-3 w-3" /></button></span>)}</div><div className="mt-2 flex gap-1.5"><input value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && newTag.trim()) { event.preventDefault(); onTagDraftChange(Array.from(new Set([...visibleTags, newTag.trim()])).join(", ")); setNewTag(""); } }} className="h-8 min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="Add a tag" /><button type="button" className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]" onClick={() => { if (!newTag.trim()) return; onTagDraftChange(Array.from(new Set([...visibleTags, newTag.trim()])).join(", ")); setNewTag(""); }} aria-label="Add tag"><Plus className="h-3.5 w-3.5" /></button></div>
      </SideCard>
      <SideCard title="Activity">
        <MetricRow label="Last edited" value={formatRelativeTime(artifact.updatedAt)} />
        <MetricRow label="Created" value={formatShortDate(artifact.createdAt)} />
      </SideCard>
    </aside>
  );
}

function CardFace({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[180px] w-full resize-none rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-6 py-8 text-center font-serif text-[24px] leading-snug text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]"
        placeholder={placeholder}
      />
    </section>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-spectra-card="side" className="p-4">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between py-1 text-[13px]"><span className="text-[var(--text-secondary)]">{label}</span><strong className="font-medium text-[var(--text-primary)]">{value}</strong></div>;
}

function ToolbarButton({ label, icon: Icon, active, disabled, onClick }: { label: string; icon: LucideIcon; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={toolbarClass(active)} onClick={onClick} disabled={disabled} title={label}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ToolbarTextButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick?: () => void; children: ReactNode }) {
  return <button type="button" className={toolbarClass(active)} onClick={onClick} title={label}>{children}</button>;
}

function IconButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return <button type="button" className={iconButtonClass()} onClick={onClick} aria-label={label} title={label}><Icon className="h-4 w-4" /></button>;
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-[var(--border-default)]" />;
}

function inputClass() {
  return "h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]";
}

function textareaClass(extra = "") {
  return `w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))] ${extra}`;
}

function iconButtonClass() {
  return "flex h-9 w-9 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function smallActionClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-transparent px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function toolbarClass(active?: boolean) {
  return `flex h-8 min-w-8 items-center justify-center rounded-[7px] px-2 text-[12px] font-medium transition disabled:opacity-40 ${
    active ? "bg-[var(--text-primary)] text-[var(--bg-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;
}

function tabButtonClass(active: boolean) {
  return `h-9 rounded-[8px] px-3 text-[13px] font-medium transition ${active ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:text-[var(--text-tertiary)]"}`;
}
