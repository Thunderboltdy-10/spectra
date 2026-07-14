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
  Import,
  Italic,
  Link2,
  List,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Share2,
  Sigma,
  Sparkles,
  Table2,
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
import TiptapLink from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Image } from "@tiptap/extension-image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SlashCommand } from "../editor/slash-command-extension";
import { createSlashCommandRenderer } from "../editor/slash-command-renderer";
import {
  spectraObjectKey,
  useSpectraContextStore,
} from "@/stores/spectra-context-store";
import { Callout } from "../editor/callout-node";
import { DragHandle } from "../editor/drag-handle";
import { Equation, InlineEquation } from "../editor/equation-node";
import { blueprintMeta } from "./artifact-card";
import {
  artifactPlacements,
  formatRelativeTime,
  formatShortDate,
  linkedArtifacts,
} from "./spectra-view-model";
import {
  getSpectraArtifactLinks,
  getSpectraArtifactVersions,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactLink,
  type SpectraArtifactVersion,
} from "../data/api";
import { ThreadConversation } from "./conversation-surface";
import { Tooltip } from "@/components/ui/tooltip";
import { useArtifactLiveModel } from "../collaboration/use-artifact-live-model";
import { ArtifactCommentsPanel, type ArtifactCommentRegion } from "./artifact-comments-panel";
import { ArtifactEmbedsPanel } from "./artifact-embeds-panel";
import { CollaborationPresenceIndicator } from "./collaboration-presence";
import { changedArtifactRegionIds } from "../collaboration/artifact-yjs-model";
import { isArtifactTypeKey } from "../artifacts/registry";

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
  tags?: string[];
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
  type:
    | "multiple_choice"
    | "short_answer"
    | "true_false"
    | "select_all"
    | "ordering";
  options: string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
  bloomLevel?:
    | "remember"
    | "understand"
    | "apply"
    | "analyze"
    | "evaluate"
    | "create";
  standards?: string[];
  tags?: string[];
};

type PlannerSubtask = { id: string; title: string; done: boolean };
type PlannerAttachment = {
  id: string;
  name: string;
  meta?: string;
  url?: string;
};

type PlannerTask = {
  taskTitle?: string;
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
  linkedThreadIds: string[];
  reminders: string[];
  estimateMinutes?: number;
  progressNote?: string;
  sourceRefs: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function pointerSegments(path: string) {
  return path === "/"
    ? []
    : path
        .split("/")
        .slice(1)
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function valueAtPointer(value: unknown, path: string) {
  let current = value;
  for (const segment of pointerSegments(path)) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setAtPointer(target: unknown, path: string, value: unknown) {
  const segments = pointerSegments(path);
  if (segments.length === 0) return structuredClone(value);
  const root =
    target && typeof target === "object" ? structuredClone(target) : {};
  let current = root as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const nextSegment = segments[index + 1]!;
    const existing = current[segment];
    current[segment] =
      existing && typeof existing === "object"
        ? existing
        : /^\d+$/.test(nextSegment)
          ? []
          : {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = structuredClone(value);
  return root;
}

function mergeAiRegions(
  local: unknown,
  preview: unknown,
  changedPaths: string[],
) {
  if (preview === undefined) return local;
  if (!changedPaths.length || changedPaths.includes("/")) return preview;
  return changedPaths.reduce(
    (next, path) => setAtPointer(next, path, valueAtPointer(preview, path)),
    local,
  );
}

function pathTouches(paths: string[], prefix: string) {
  return (
    paths.includes("/") ||
    paths.some((path) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

function aiPreviewSections(artifact: SpectraArtifact) {
  const content = record(artifact.aiPreview?.content);
  const rows = Array.isArray(content.blocks)
    ? content.blocks
    : Array.isArray(content.cards)
      ? content.cards
      : Array.isArray(content.questions)
        ? content.questions
        : [];
  return rows.slice(0, 4).flatMap((row): string[] => {
    const item = record(row);
    const label = [
      item.title,
      item.heading,
      item.front,
      item.prompt,
      item.text,
    ].find((value) => typeof value === "string" && value.trim());
    return typeof label === "string" ? [label.trim().slice(0, 90)] : [];
  });
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function dateInputValue(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeInputValue(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeValue(date: string, time: string) {
  if (!date) return undefined;
  const normalizedTime = time || "09:00";
  return new Date(`${date}T${normalizedTime}:00`).getTime();
}

function formatScheduleDateTime(value?: number) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function tagsFromDraft(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

type ArtifactSnapshot = {
  title: string;
  summary?: string;
  content: unknown;
  tags: string[];
};

function snapshotLines(snapshot: ArtifactSnapshot) {
  const content = JSON.stringify(snapshot.content, null, 2)
    .split("\n")
    .slice(0, 420);
  return [
    `Title: ${snapshot.title}`,
    `Summary: ${snapshot.summary ?? ""}`,
    `Tags: ${(snapshot.tags ?? []).join(", ")}`,
    "",
    ...content,
  ];
}

function lineDiff(current: ArtifactSnapshot, historical: ArtifactSnapshot) {
  const before = snapshotLines(historical);
  const after = snapshotLines(current);
  const rows = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );
  for (let left = before.length - 1; left >= 0; left -= 1)
    for (let right = after.length - 1; right >= 0; right -= 1)
      rows[left]![right] =
        before[left] === after[right]
          ? rows[left + 1]![right + 1]! + 1
          : Math.max(rows[left + 1]![right]!, rows[left]![right + 1]!);
  const result: Array<{ kind: "same" | "added" | "removed"; text: string }> =
    [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (
      left < before.length &&
      right < after.length &&
      before[left] === after[right]
    ) {
      result.push({ kind: "same", text: before[left]! });
      left += 1;
      right += 1;
    } else if (
      right < after.length &&
      (left >= before.length ||
        rows[left]![right + 1]! >= rows[left + 1]![right]!)
    ) {
      result.push({ kind: "added", text: after[right]! });
      right += 1;
    } else {
      result.push({ kind: "removed", text: before[left]! });
      left += 1;
    }
  }
  return result;
}

function ReadonlyArtifactSnapshot({
  blueprintKey,
  snapshot,
}: {
  blueprintKey: SpectraArtifact["blueprintKey"];
  snapshot: ArtifactSnapshot;
}) {
  const body = record(snapshot.content);
  const cards = blueprintKey === "flashcard_deck" ? deckCards(snapshot.content) : [];
  const questions = blueprintKey === "quiz" ? quizQuestions(snapshot.content) : [];
  const blocks = blueprintKey === "document" ? arrayOfRecords(body.blocks) : [];
  const subtasks = blueprintKey === "planner_task" ? arrayOfRecords(body.subtasks) : [];
  return (
    <article className="min-h-full bg-[var(--bg-primary)] px-5 py-6 text-[var(--text-primary)]">
      <h3 className="font-display text-[24px] font-semibold leading-tight">{snapshot.title}</h3>
      {snapshot.summary ? <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">{snapshot.summary}</p> : null}
      {blueprintKey === "document" ? (
        <div className="mt-7 space-y-4 text-[13px] leading-6">
          {blocks.map((block, index) => {
            const text = typeof block.text === "string" ? block.text : "";
            const type = typeof block.type === "string" ? block.type : "paragraph";
            if (type === "heading") return <h4 key={String(block.id ?? index)} className="pt-3 font-display text-[20px] font-semibold">{text}</h4>;
            if (type === "callout") return <aside key={String(block.id ?? index)} className="rounded-[9px] border border-[color-mix(in_oklab,var(--accent-mint)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-mint)_6%,var(--bg-primary))] px-4 py-3">{text}</aside>;
            return <p key={String(block.id ?? index)} className="whitespace-pre-wrap">{text}</p>;
          })}
        </div>
      ) : null}
      {blueprintKey === "flashcard_deck" ? (
        <div className="mt-6 grid gap-3">
          {cards.map((card, index) => <section key={card.id} className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#7560e8]">Card {index + 1} · {card.section}</div><div className="mt-2 font-display text-[17px] font-semibold">{card.front}</div><div className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">{card.back}</div>{card.hint ? <div className="mt-3 rounded-[7px] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))] px-3 py-2 text-[11px] text-[var(--text-secondary)]">{card.hint}</div> : null}</section>)}
        </div>
      ) : null}
      {blueprintKey === "quiz" ? (
        <div className="mt-6 grid gap-3">
          {questions.map((question, index) => <section key={question.id} className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--accent-mint)]">Question {index + 1}</div><div className="mt-2 font-display text-[17px] font-semibold">{question.prompt}</div>{question.options?.length ? <ol className="mt-3 space-y-1.5 text-[12px] text-[var(--text-secondary)]">{question.options.map((option, optionIndex) => <li key={`${question.id}:${optionIndex}`} className="rounded-[7px] border border-[var(--border-subtle)] px-3 py-2">{String.fromCharCode(65 + optionIndex)}. {option}</li>)}</ol> : null}</section>)}
        </div>
      ) : null}
      {blueprintKey === "planner_task" ? (
        <div className="mt-6 space-y-4"><section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"><div className="grid grid-cols-2 gap-4 text-[11px]"><div><span className="block text-[var(--text-tertiary)]">Status</span><strong className="mt-1 block capitalize">{String(body.status ?? "Not set")}</strong></div><div><span className="block text-[var(--text-tertiary)]">Priority</span><strong className="mt-1 block capitalize">{String(body.priority ?? "Not set")}</strong></div></div></section>{subtasks.map((task, index) => <div key={String(task.id ?? index)} className="flex items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[12px]"><span className={`h-4 w-4 rounded-full border ${task.completed ? "border-[var(--success)] bg-[var(--success)]" : "border-[var(--border-default)]"}`} /><span>{String(task.title ?? task.text ?? "Untitled step")}</span></div>)}</div>
      ) : null}
    </article>
  );
}

type HumanChange = { label: string; before: string; after: string; path: string[]; regionId?: string };

function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function humanValue(value: unknown) {
  if (value == null || value === "") return "Not set";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ") || "None";
  return JSON.stringify(value, null, 2);
}

function humanFieldLabel(path: string[]) {
  const clean = path[0] === "content" ? path.slice(1) : path;
  if (clean[0] === "cards" && /^\d+$/.test(clean[1] ?? ""))
    return `Card ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "questions" && /^\d+$/.test(clean[1] ?? ""))
    return `Question ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "blocks" && /^\d+$/.test(clean[1] ?? ""))
    return `Document block ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "subtasks" && /^\d+$/.test(clean[1] ?? ""))
    return `Subtask ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  return clean.map(humanizeKey).join(" · ") || "Artifact";
}

function humanDiff(
  current: ArtifactSnapshot,
  historical: ArtifactSnapshot,
): HumanChange[] {
  const changes: HumanChange[] = [];
  const visit = (before: unknown, after: unknown, path: string[]) => {
    if (Object.is(before, after)) return;
    if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      const keys = new Set([
        ...Object.keys(before as Record<string, unknown>),
        ...Object.keys(after as Record<string, unknown>),
      ]);
      for (const key of keys)
        visit(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          [...path, key],
        );
      return;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      Math.max(before.length, after.length) <= 60
    ) {
      const primitiveArray = [...before, ...after].every(
        (item) =>
          item == null || ["string", "number", "boolean"].includes(typeof item),
      );
      if (!primitiveArray) {
        for (
          let index = 0;
          index < Math.max(before.length, after.length);
          index += 1
        )
          visit(before[index], after[index], [...path, String(index)]);
        return;
      }
    }
    if (
      JSON.stringify(before) === JSON.stringify(after) ||
      path.at(-1) === "id"
    )
      return;
    changes.push({
      label: humanFieldLabel(path),
      before: humanValue(before),
      after: humanValue(after),
      path,
    });
  };
  visit(historical, current, []);
  return changes.slice(0, 120);
}

function contentTextFromJson(node?: JSONContent): string {
  if (!node) return "";
  const own = typeof node.text === "string" ? node.text : "";
  const childText = Array.isArray(node.content)
    ? node.content.map(contentTextFromJson).join(" ")
    : "";
  return `${own} ${childText}`.trim();
}

function inlineMathContent(text: string): JSONContent[] | undefined {
  if (!text) return undefined;
  const nodes: JSONContent[] = [];
  // The canonical document model deliberately remains transport-friendly:
  // model-authored emphasis and inline maths are stored as lightweight
  // markup, then compiled to editor nodes at the UI boundary. Parsing both in
  // one pass ensures an AI update looks identical immediately, after refresh,
  // and when viewed from history.
  const pattern = /(\*\*(.+?)\*\*)|\\\((.+?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push({ type: "text", text: text.slice(cursor, start) });
    if (match[2] !== undefined)
      nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    else
      nodes.push({ type: "inlineEquation", attrs: { latex: (match[3] ?? match[4] ?? "").trim() } });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", text }];
}

function calloutInlineContent(text: string): JSONContent[] | undefined {
  const prefix = text.match(/^(Key idea|Remember|Note|Tip):\s*/i);
  if (!prefix) return inlineMathContent(text);
  const label = `${prefix[1]}:`;
  const rest = text.slice(prefix[0].length);
  return [
    { type: "text", text: label, marks: [{ type: "bold" }] },
    ...(rest ? [{ type: "text", text: " " } as JSONContent, ...(inlineMathContent(rest) ?? [])] : []),
  ];
}

function normalizeDocumentInlineMarkup(node: JSONContent): JSONContent {
  if (node.type === "text" && typeof node.text === "string") {
    const pattern = /(\*\*(.+?)\*\*)|\\\((.+?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
    const content: JSONContent[] = [];
    let cursor = 0;
    for (const match of node.text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > cursor) content.push({ ...node, text: node.text.slice(cursor, start) });
      if (match[2] !== undefined) {
        content.push({ ...node, text: match[2], marks: [...(node.marks ?? []), { type: "bold" }] });
      } else {
        content.push({ type: "inlineEquation", attrs: { latex: (match[3] ?? match[4] ?? "").trim() } });
      }
      cursor = start + match[0].length;
    }
    if (!content.length) return node;
    if (cursor < node.text.length) content.push({ ...node, text: node.text.slice(cursor) });
    return { type: "inlineMarkupFragment", content };
  }
  if (!Array.isArray(node.content)) return node;
  const content = node.content.flatMap((child) => {
    const normalized = normalizeDocumentInlineMarkup(child);
    return normalized.type === "inlineMarkupFragment" ? normalized.content ?? [] : [normalized];
  });
  return { ...node, content };
}

function documentJsonFromContent(content: unknown, title: string): JSONContent {
  const source = record(content);
  const tiptap = source.tiptap;
  if (tiptap && typeof tiptap === "object" && record(tiptap).type === "doc")
    return normalizeDocumentInlineMarkup(tiptap as JSONContent);
  const blocks = arrayOfRecords(source.blocks);
  const contentNodes =
    blocks.length > 0
      ? blocks.map((block) => {
          const text = typeof block.text === "string" ? block.text : "";
          if (block.type === "equation" || block.type === "math") {
            const attrs = record(block.attrs);
            return {
              type: "equation",
              attrs: {
                latex: typeof block.latex === "string" ? block.latex : text,
                display: attrs.display === "inline" ? "inline" : "block",
                alignment: ["left", "right"].includes(String(attrs.alignment))
                  ? attrs.alignment
                  : "center",
              },
            };
          }
          if (block.type === "callout") {
            const attrs = record(block.attrs);
            const semanticType = /^(remember|warning|important)/i.test(text)
              ? "warning"
              : /^(tip|key idea)/i.test(text)
                ? "tip"
                : attrs.tone === "warning"
                  ? "warning"
                  : attrs.tone === "success"
                    ? "tip"
                    : "info";
            return {
              type: "callout",
              attrs: { type: semanticType },
              content: [
                { type: "paragraph", content: calloutInlineContent(text) },
              ],
            };
          }
          if (block.type === "table") {
            const rows = text
              .split(/\r?\n/)
              .map((line) => {
                const clean = line.trim().replace(/^\|/, "").replace(/\|$/, "");
                const cells = clean.includes("|")
                  ? clean.split("|")
                  : clean.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
                return cells.map((cell) => cell.trim().replace(/^\"|\"$/g, ""));
              })
              .filter(
                (row) =>
                  row.some(Boolean) &&
                  !row.every((cell) => /^:?-{3,}:?$/.test(cell)),
              );
            const normalizedRows = rows.length > 0 ? rows : [[""]];
            return {
              type: "table",
              content: normalizedRows.map((row, rowIndex) => ({
                type: "tableRow",
                content: row.map((cell) => ({
                  type: rowIndex === 0 ? "tableHeader" : "tableCell",
                  content: [
                    { type: "paragraph", content: inlineMathContent(cell) },
                  ],
                })),
              })),
            };
          }
          const type =
            block.type === "heading"
              ? "heading"
              : block.type === "list"
                ? "bulletList"
                : block.type === "quote"
                  ? "blockquote"
                  : "paragraph";
          if (type === "heading")
            return {
              type: "heading",
              attrs: {
                level: [1, 2, 3].includes(Number(record(block.attrs).level))
                  ? Number(record(block.attrs).level)
                  : 2,
              },
              content: inlineMathContent(text),
            };
          if (type === "bulletList") {
            const items = text
              .split(/\r?\n/)
              .map((line) =>
                line.replace(/^\s*(?:[-*â€¢]|\d+[.)])\s+/, "").trim(),
              )
              .filter(Boolean);
            return {
              type: "bulletList",
              content: (items.length > 0 ? items : [text]).map((item) => ({
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: inlineMathContent(item),
                  },
                ],
              })),
            };
          }
          if (type === "blockquote")
            return {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: inlineMathContent(text),
                },
              ],
            };
          return {
            type: "paragraph",
            content: inlineMathContent(text),
          };
        })
      : [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: title }],
          },
          { type: "paragraph" },
        ];
  return { type: "doc", content: contentNodes };
}

function blocksFromJson(json: JSONContent) {
  const nodes = Array.isArray(json.content) ? json.content : [];
  return nodes
    .map((node, index) => {
      if (node.type === "equation")
        return {
          id: `block-${index + 1}`,
          type: "equation",
          text: typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          latex: typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          attrs: {
            display: node.attrs?.display ?? "block",
            alignment: node.attrs?.alignment ?? "center",
          },
        };
      if (node.type === "callout")
        return {
          id: `block-${index + 1}`,
          type: "callout",
          text: contentTextFromJson(node),
          attrs: { tone: node.attrs?.tone ?? "info" },
        };
      if (node.type === "table") {
        const rows = (node.content ?? [])
          .map((row) =>
            (row.content ?? [])
              .map((cell) => contentTextFromJson(cell).trim())
              .join(" | "),
          )
          .filter(Boolean);
        return {
          id: `block-${index + 1}`,
          type: "table",
          text: rows.join("\n"),
        };
      }
      const text =
        node.type === "bulletList" || node.type === "orderedList"
          ? (node.content ?? [])
              .map((item) => contentTextFromJson(item))
              .filter(Boolean)
              .join("\n")
          : contentTextFromJson(node);
      const type =
        node.type === "heading"
          ? "heading"
          : node.type === "blockquote"
            ? "quote"
            : node.type === "bulletList" || node.type === "orderedList"
              ? "list"
              : "paragraph";
      return {
        id: `block-${index + 1}`,
        type,
        text,
        ...(node.type === "heading"
          ? { attrs: { level: Number(node.attrs?.level) || 2 } }
          : {}),
      };
    })
    .filter((block) => block.text.length > 0);
}

function documentContentFromJson(json: JSONContent, previous: unknown) {
  const previousRecord = record(previous);
  const blocks = blocksFromJson(json);
  return {
    ...previousRecord,
    tiptap: json,
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block, index) => ({
        id: block.id,
        title: block.text || `Section ${index + 1}`,
        level: 1,
      })),
  };
}

function deckCards(content: unknown): DeckCard[] {
  const cards = arrayOfRecords(record(content).cards).map((card, index) => ({
    id: typeof card.id === "string" ? card.id : `card-${index + 1}`,
    front: typeof card.front === "string" ? card.front : "",
    back: typeof card.back === "string" ? card.back : "",
    hint: typeof card.hint === "string" ? card.hint : "",
    section: typeof card.section === "string" ? card.section : "Section 1",
    confidence: (card.confidence === "weak" ||
    card.confidence === "medium" ||
    card.confidence === "strong"
      ? card.confidence
      : "unknown") as DeckCard["confidence"],
    sourceRefs: Array.isArray(card.sourceRefs)
      ? card.sourceRefs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    tags: Array.isArray(card.tags)
      ? card.tags.filter((item): item is string => typeof item === "string")
      : [],
    review: record(card.review) as DeckCard["review"],
  }));
  return cards.length > 0
    ? cards
    : [
        {
          id: "card-1",
          front: "",
          back: "",
          hint: "",
          section: "Section 1",
          confidence: "unknown",
        },
      ];
}

function quizQuestions(content: unknown): QuizQuestion[] {
  const questions = arrayOfRecords(record(content).questions).map(
    (question, index) => {
      const options = Array.isArray(question.options)
        ? question.options.filter(
            (option): option is string => typeof option === "string",
          )
        : [];
      return {
        id:
          typeof question.id === "string"
            ? question.id
            : `question-${index + 1}`,
        prompt: typeof question.prompt === "string" ? question.prompt : "",
        type: ([
          "multiple_choice",
          "short_answer",
          "true_false",
          "select_all",
          "ordering",
        ].includes(String(question.type))
          ? question.type
          : options.length > 0
            ? "multiple_choice"
            : "short_answer") as QuizQuestion["type"],
        options,
        correctAnswer:
          typeof question.correctAnswer === "string"
            ? question.correctAnswer
            : (options[0] ?? ""),
        explanation:
          typeof question.explanation === "string" ? question.explanation : "",
        difficulty: (question.difficulty === "easy" ||
        question.difficulty === "hard"
          ? question.difficulty
          : "medium") as QuizQuestion["difficulty"],
        points: typeof question.points === "number" ? question.points : 1,
        timeLimitSeconds:
          typeof question.timeLimitSeconds === "number"
            ? question.timeLimitSeconds
            : 90,
        sourceRefs: Array.isArray(question.sourceRefs)
          ? question.sourceRefs.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        feedback:
          typeof question.feedback === "string" ? question.feedback : "",
        bloomLevel: ([
          "remember",
          "understand",
          "apply",
          "analyze",
          "evaluate",
          "create",
        ].includes(String(question.bloomLevel))
          ? question.bloomLevel
          : "remember") as QuizQuestion["bloomLevel"],
        standards: Array.isArray(question.standards)
          ? question.standards.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        tags: Array.isArray(question.tags)
          ? question.tags.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
      };
    },
  );
  return questions.length > 0
    ? questions
    : [
        {
          id: "question-1",
          prompt: "",
          type: "multiple_choice",
          options: ["", "", "", ""],
          correctAnswer: "",
          explanation: "",
          difficulty: "medium",
          points: 1,
          timeLimitSeconds: 90,
        },
      ];
}

function plannerTask(content: unknown): PlannerTask {
  const task = record(content);
  return {
    taskTitle: typeof task.taskTitle === "string" ? task.taskTitle : "",
    description: typeof task.description === "string" ? task.description : "",
    status:
      task.status === "doing" || task.status === "done" ? task.status : "todo",
    priority:
      task.priority === "low" || task.priority === "high"
        ? task.priority
        : "medium",
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
      id:
        typeof attachment.id === "string"
          ? attachment.id
          : `attachment-${index + 1}`,
      name: typeof attachment.name === "string" ? attachment.name : "",
      meta: typeof attachment.meta === "string" ? attachment.meta : "",
      url: typeof attachment.url === "string" ? attachment.url : undefined,
    })),
    linkedArtifactIds: Array.isArray(task.linkedArtifactIds)
      ? task.linkedArtifactIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    linkedThreadIds: Array.isArray(task.linkedThreadIds)
      ? task.linkedThreadIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    reminders: Array.isArray(task.reminders)
      ? task.reminders.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    estimateMinutes:
      typeof task.estimateMinutes === "number"
        ? task.estimateMinutes
        : undefined,
    progressNote:
      typeof task.progressNote === "string" ? task.progressNote : "",
    sourceRefs: Array.isArray(task.sourceRefs)
      ? task.sourceRefs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
}

function artifactEditorSnapshot(artifact: SpectraArtifact) {
  return {
    title: artifact.title,
    summary: artifact.summary ?? "",
    tagDraft: (artifact.tags ?? []).join(", "),
    content: artifact.content,
  };
}

function snapshotKey(snapshot: {
  title: string;
  summary: string;
  tagDraft: string;
  content: unknown;
}) {
  return JSON.stringify(snapshot);
}

export function useArtifactStudioState(
  _storageKey: string,
  artifacts: SpectraArtifact[],
) {
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const activeOpenObjectKey = useSpectraContextStore(
    (state) => state.activeOpenObjectKey,
  );
  const dirtyArtifactIds = useSpectraContextStore(
    (state) => state.dirtyArtifactIds,
  );
  const openObject = useSpectraContextStore((state) => state.openObject);
  const focusObject = useSpectraContextStore((state) => state.focusObject);
  const deactivateObject = useSpectraContextStore(
    (state) => state.deactivateObject,
  );
  const closeObject = useSpectraContextStore((state) => state.closeObject);
  const setArtifactDirty = useSpectraContextStore(
    (state) => state.setArtifactDirty,
  );
  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact._id, artifact])),
    [artifacts],
  );
  const studioObjects = useMemo(
    () =>
      openObjects.filter(
        (object) =>
          object.type === "artifact" &&
          (object.presentation === "split" || object.presentation === "tab") &&
          artifactById.has(object.id),
      ),
    [artifactById, openObjects],
  );
  const activeObject =
    studioObjects.find(
      (object) => spectraObjectKey(object) === activeOpenObjectKey,
    ) ?? null;
  const mode: StudioMode =
    activeObject?.presentation === "split" ||
    activeObject?.presentation === "tab"
      ? activeObject.presentation
      : "closed";
  const activeArtifactId = activeObject?.id ?? null;
  const activeArtifact = activeArtifactId
    ? (artifactById.get(activeArtifactId) ?? null)
    : null;
  const tabs = useMemo<StudioTab[]>(
    () =>
      studioObjects
        .filter((object) => object.presentation === "tab")
        .map((object, index) => ({ artifactId: object.id, openedAt: index })),
    [studioObjects],
  );
  const dirtyIds = useMemo(
    () => new Set(dirtyArtifactIds.filter((id) => artifactById.has(id))),
    [artifactById, dirtyArtifactIds],
  );

  const openSplit = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation: "split",
      });
    },
    [openObject],
  );

  const openTab = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation:
          artifact.blueprintKey === "thread_reference" ? "split" : "tab",
      });
    },
    [openObject],
  );

  const activateTab = useCallback(
    (artifactId: string) => {
      if (focusObject("artifact", artifactId)) return;
      const artifact = artifactById.get(artifactId);
      if (artifact) openTab(artifact);
    },
    [artifactById, focusObject, openTab],
  );

  const closeTab = useCallback(
    (artifactId: string) => {
      closeObject("artifact", artifactId);
    },
    [closeObject],
  );

  const closeStudio = useCallback(() => {
    if (activeArtifactId && mode === "split")
      closeObject("artifact", activeArtifactId);
    else deactivateObject();
  }, [activeArtifactId, closeObject, deactivateObject, mode]);

  const setDirty = useCallback(
    (artifactId: string, dirty: boolean) => {
      setArtifactDirty(artifactId, dirty);
    },
    [setArtifactDirty],
  );

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
  dirtyIds,
  busy = false,
  panelWidth,
  sourceLabel,
  onPanelWidthChange,
  onClose,
  onCloseTab,
  onExpand,
  onArchive,
  onShare,
  onDirtyChange,
  onContinueThread,
  continuedThreadId,
  compact = false,
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
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onShare?: (artifact: SpectraArtifact) => void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
  continuedThreadId?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const width =
    panelWidth ??
    Math.round(typeof window === "undefined" ? 720 : window.innerWidth * 0.5);
  const handleClose = useCallback(
    () => (mode === "tab" ? onCloseTab(artifact._id) : onClose()),
    [artifact._id, mode, onClose, onCloseTab],
  );
  const handleArchive = useMemo(
    () => (onArchive ? () => onArchive(artifact) : undefined),
    [artifact, onArchive],
  );
  const handleDirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(artifact._id, dirty),
    [artifact._id, onDirtyChange],
  );

  const threadId =
    artifact.blueprintKey === "thread_reference" &&
    typeof record(artifact.content).threadId === "string"
      ? String(record(artifact.content).threadId).trim()
      : "";
  const body =
    artifact.blueprintKey === "thread_reference" ? (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex min-h-[78px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">
                {artifact.title}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
                Conversation · {sourceLabel}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {threadId && onContinueThread ? (
              <button
                type="button"
                onClick={() => onContinueThread(threadId, artifact.title)}
                className={`flex h-8 w-8 items-center justify-center rounded-[7px] transition ${continuedThreadId === threadId ? "bg-[color-mix(in_oklab,#8b6ff0_14%,var(--bg-hover))] text-[#7256dc]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
                aria-label={
                  continuedThreadId === threadId
                    ? "Stop continuing this chat"
                    : "Continue chat"
                }
                title={
                  continuedThreadId === threadId
                    ? "Stop continuing chat"
                    : "Continue chat"
                }
                aria-pressed={continuedThreadId === threadId}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            ) : null}
            <IconButton
              label="Open conversation in Chat"
              onClick={() => {
                if (threadId)
                  router.push(`/chat?threadId=${encodeURIComponent(threadId)}`);
              }}
              icon={Maximize2}
            />
            <IconButton label="Close" onClick={handleClose} icon={X} />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {threadId ? (
            <ThreadConversation
              threadId={threadId}
              compact
              showComposer={false}
            />
          ) : (
            <ThreadReferenceStudio content={artifact.content} />
          )}
        </div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <ArtifactStudioEditor
          // A clean editor may safely rehydrate at a new remote revision or
          // staged AI-preview boundary. Keeping only the artifact id here left
          // the local rich-editor state pinned to the version that was open
          // when a run began; the card and backend advanced while the visible
          // document stayed stale until close/reopen. A locally dirty editor
          // deliberately keeps a stable key so region-aware merging can
          // preserve the student's unrelated work.
          key={`${artifact._id}:${dirtyIds.has(artifact._id) ? "local" : `${artifact.updatedAt}:${artifact.aiPreview?.startedAt ?? 0}`}`}
          mode={mode}
          artifact={artifact}
          artifacts={artifacts}
          busy={busy}
          sourceLabel={sourceLabel}
          onClose={handleClose}
          onExpand={() => onExpand(artifact)}
          onOpenArtifact={(artifactId) => {
            const source = artifacts.find((candidate) => candidate._id === artifactId);
            if (source) onExpand(source);
          }}
          onArchive={handleArchive}
          onShare={onShare ? () => onShare(artifact) : undefined}
          onDirtyChange={handleDirtyChange}
          compact={compact}
        />
      </div>
    );

  if (mode === "tab") {
    return (
      <section className="min-w-0 flex-1 border-l border-[var(--border-default)]">
        {body}
      </section>
    );
  }

  return (
    <StudioSplitShell
      width={width}
      onWidthChange={onPanelWidthChange}
      ariaLabel="Artifact Studio"
      cssWidthVariable="--spectra-studio-width"
    >
      {body}
    </StudioSplitShell>
  );
}

export function StudioSplitShell({
  width,
  onWidthChange,
  ariaLabel,
  cssWidthVariable,
  children,
}: {
  width: number;
  onWidthChange?: (width: number) => void;
  ariaLabel: string;
  cssWidthVariable?: string;
  children: ReactNode;
}) {
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host =
      panelRef.current?.closest<HTMLElement>(".spectra-wave-y") ??
      panelRef.current?.parentElement;
    if (cssWidthVariable)
      host?.style.setProperty(cssWidthVariable, `${width}px`);
    return () => {
      if (cssWidthVariable) host?.style.removeProperty(cssWidthVariable);
    };
  }, [cssWidthVariable, width]);
  useEffect(() => {
    if (!onWidthChange) return;
    const updateWidth = onWidthChange;
    function fitPanel() {
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      if (!panel || !parent) return;
      const siblingWidth = Array.from(
        parent.querySelectorAll<HTMLElement>(":scope > [data-studio-panel]"),
      )
        .filter((candidate) => candidate !== panel)
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const maximum = Math.max(
        360,
        Math.min(1120, parent.clientWidth - siblingWidth - 560),
      );
      if (width > maximum) updateWidth(maximum);
    }
    const frame = window.requestAnimationFrame(fitPanel);
    const parent = panelRef.current?.parentElement;
    const observer = parent ? new ResizeObserver(fitPanel) : null;
    if (parent) observer?.observe(parent);
    window.addEventListener("resize", fitPanel);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", fitPanel);
    };
  }, [onWidthChange, width]);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!resizingRef.current || !onWidthChange) return;
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      const panelLeft = panel?.getBoundingClientRect().left ?? 0;
      const siblings = parent
        ? Array.from(
            parent.querySelectorAll<HTMLElement>(
              ":scope > [data-studio-panel]",
            ),
          ).filter((candidate) => candidate !== panel)
        : [];
      const rightSiblingWidth = siblings
        .filter(
          (candidate) => candidate.getBoundingClientRect().left > panelLeft,
        )
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const allSiblingWidth = siblings.reduce(
        (total, candidate) => total + candidate.getBoundingClientRect().width,
        0,
      );
      const parentRight =
        parent?.getBoundingClientRect().right ?? window.innerWidth;
      const available = Math.max(
        360,
        (parent?.clientWidth ?? window.innerWidth) - allSiblingWidth - 560,
      );
      onWidthChange(
        Math.max(
          360,
          Math.min(
            Math.round(parentRight - event.clientX - rightSiblingWidth),
            Math.min(1120, available),
          ),
        ),
      );
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [onWidthChange]);
  return (
    <aside
      ref={panelRef}
      data-studio-panel
      className="fixed inset-y-0 right-0 z-[90] flex h-full min-w-[320px] max-w-[94vw] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[-18px_0_40px_rgba(27,20,12,0.10)] min-[1920px]:relative min-[1920px]:inset-auto min-[1920px]:z-40 min-[1920px]:min-w-[360px]"
      style={{ width, containerType: "inline-size" }}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="absolute -left-1 top-0 z-20 h-full w-2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--text-tertiary)_18%,transparent)]"
        aria-label={`Resize ${ariaLabel}`}
        onPointerDown={(event) => {
          event.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }}
      />
      {children}
    </aside>
  );
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
              active
                ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[inset_0_2px_var(--accent-cyan),0_1px_6px_rgba(27,20,12,0.08)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => onActivateHub(hubTab.id)}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
            <span className="min-w-0 flex-1 truncate text-left">
              {hubTab.label}
            </span>
            <span
              role="button"
              tabIndex={0}
              className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={(event) => {
                event.stopPropagation();
                onCloseHub(hubTab.id);
              }}
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
              active
                ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[inset_0_2px_var(--accent-cyan),0_1px_6px_rgba(27,20,12,0.08)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            onClick={() => onActivateTab(artifact._id)}
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: meta.color }}
            />
            <span className="truncate">{artifact.title}</span>
            {dirtyIds.has(artifact._id) ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d88922]"
                title="Unsaved changes"
              />
            ) : null}
            <span
              role="button"
              tabIndex={0}
              className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={(event) => {
                event.stopPropagation();
                if (dirtyIds.has(artifact._id)) {
                  onActivateTab(artifact._id);
                  requestAnimationFrame(() =>
                    window.dispatchEvent(
                      new CustomEvent("spectra:request-artifact-close", {
                        detail: { artifactId: artifact._id },
                      }),
                    ),
                  );
                } else onCloseTab(artifact._id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dirtyIds.has(artifact._id)) {
                    onActivateTab(artifact._id);
                    requestAnimationFrame(() =>
                      window.dispatchEvent(
                        new CustomEvent("spectra:request-artifact-close", {
                          detail: { artifactId: artifact._id },
                        }),
                      ),
                    );
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
  onOpenArtifact,
  onArchive,
  onShare,
  onDirtyChange,
  compact,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  busy: boolean;
  sourceLabel: string;
  onClose: () => void;
  onExpand: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onArchive?: () => Promise<void> | void;
  onShare?: () => void;
  onDirtyChange: (dirty: boolean) => void;
  compact: boolean;
}) {
  const permissionReadOnly = artifact.accessLevel === "read";
  const initialLiveValue = useMemo(
    () => ({
      title: artifact.title,
      ...(artifact.summary ? { summary: artifact.summary } : {}),
      tags: artifact.tags ?? [],
      content: artifact.content,
    }),
    [artifact.content, artifact.summary, artifact.tags, artifact.title],
  );
  const live = useArtifactLiveModel(
    artifact._id,
    artifact.blueprintKey,
    initialLiveValue,
  );
  const readOnly = permissionReadOnly || (live.supported && !live.canEdit);
  const [title, setTitle] = useState(artifact.title);
  const [summary, setSummary] = useState(artifact.summary ?? "");
  const [tagDraft, setTagDraft] = useState((artifact.tags ?? []).join(", "));
  const [content, setContent] = useState<unknown>(artifact.content);
  const [baseline, setBaseline] = useState(() =>
    artifactEditorSnapshot(artifact),
  );
  const [dirty, setDirty] = useState(false);
  const [closeDecisionOpen, setCloseDecisionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<"changes" | "artifacts">("changes");
  const [previewVersion, setPreviewVersion] =
    useState<SpectraArtifactVersion | null>(null);
  const [selectedRestoreRegions, setSelectedRestoreRegions] = useState<Set<string>>(() => new Set());
  const [remoteConflict, setRemoteConflict] = useState<ReturnType<
    typeof artifactEditorSnapshot
  > | null>(null);
  const [dismissedRemoteKey, setDismissedRemoteKey] = useState<string | null>(
    null,
  );
  const [previewClock, setPreviewClock] = useState(() => Date.now());
  const [syncBusy, setSyncBusy] = useState(false);
  const [liveConflict, setLiveConflict] = useState<{
    message: string;
    claimId?: string;
    regionId?: string;
    queuePosition?: number;
  } | null>(null);
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const dirtyRef = useRef(dirty);
  // A snapshot difference is not, by itself, evidence of a local edit. Rich
  // editors normalize their document during hydration and streamed AI updates
  // reconcile several fields across separate React commits. Track user intent
  // explicitly so a freshly opened or AI-updated artifact never advertises
  // unsaved work that the student did not create.
  const userHasEditedRef = useRef(false);
  // Updating the four editor fields and their baseline is intentionally a
  // single logical reconciliation, but React commits those state updates
  // independently. Without this guard the intermediate render (new baseline,
  // old fields) marks the editor dirty and the next streamed AI patch is then
  // mistaken for a user/remote conflict. The visible editor consequently stays
  // stale until it is closed and reopened.
  const reconcilingRemoteRef = useRef(false);
  const activeArtifactIdRef = useRef(artifact._id);
  const currentSnapshotRef = useRef(artifactEditorSnapshot(artifact));
  const aiMergeRef = useRef<{
    paths: string[];
    title: boolean;
    summary: boolean;
    tags: boolean;
  } | null>(null);
  const localSyncKeysRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const reconciliationFrameRef = useRef<number | null>(null);
  const incomingSnapshot = useMemo(
    () => ({
      title: live.liveValue.title,
      summary: live.liveValue.summary ?? "",
      tagDraft: live.liveValue.tags.join(", "),
      content: live.liveValue.content,
    }),
    [live.liveValue],
  );
  const currentSnapshot = useMemo(
    () => ({ title, summary, tagDraft, content }),
    [content, summary, tagDraft, title],
  );
  const synchronizeDraft = useCallback(async (snapshot = currentSnapshotRef.current) => {
    if (artifact.blueprintKey === "thread_reference" || permissionReadOnly || syncingRef.current || !snapshot.title.trim()) return;
    const key = snapshotKey(snapshot);
    syncingRef.current = true;
    localSyncKeysRef.current.add(key);
    setSyncBusy(true);
    setLiveConflict(null);
    try {
      if (!live.supported) throw new Error("ARTIFACT_LIVE_MODEL_UNAVAILABLE");
      const result = await live.synchronize({
        title: snapshot.title.trim(),
        ...(snapshot.summary.trim() ? { summary: snapshot.summary.trim() } : {}),
        content: snapshot.content,
        tags: tagsFromDraft(snapshot.tagDraft),
      });
      if (result && "applied" in result && result.applied === false) {
        localSyncKeysRef.current.delete(key);
        const claim = "claim" in result ? result.claim : undefined;
        setLiveConflict({
          message: "This region is being edited by another collaborator. Your draft is preserved and queued without overwriting their work.",
          claimId: claim?.claimId,
          regionId: claim?.conflict?.regionId,
          queuePosition: claim?.conflict?.queuePosition,
        });
      }
    } catch (error) {
      localSyncKeysRef.current.delete(key);
      setLiveConflict({ message: error instanceof Error ? error.message : "This change could not be synchronized." });
    } finally {
      syncingRef.current = false;
      setSyncBusy(false);
    }
  }, [artifact.blueprintKey, live, permissionReadOnly]);
  const previewDiff = useMemo(() => {
    if (!previewVersion) return [];
    return humanDiff(
            {
              title: artifact.title,
              summary: artifact.summary,
              content: artifact.content,
              tags: artifact.tags,
            },
            previewVersion.after,
          ).map((change) => {
            if (change.path[0] === "title") return { ...change, regionId: "metadata:title" };
            if (change.path[0] === "summary") return { ...change, regionId: "metadata:summary" };
            if (change.path[0] === "tags") return { ...change, regionId: "metadata:tags" };
            const contentPath = change.path[0] === "content" ? change.path.slice(1) : change.path;
            const descriptor = live.modelSnapshot.regionIds.map((regionId) => live.model?.descriptor(regionId)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).filter((entry) => entry.path.every((segment, index) => String(contentPath[index]) === String(segment))).sort((left, right) => right.path.length - left.path.length)[0];
            return { ...change, regionId: descriptor?.regionId ?? "artifact:structure" };
          });
  }, [artifact, live.model, live.modelSnapshot.regionIds, previewVersion]);

  useEffect(() => setSelectedRestoreRegions(new Set()), [previewVersion?._id]);
  const aiPreviewActive = Boolean(artifact.aiPreview) && (
    artifact.aiState === "creating" ||
    artifact.aiState === "updating" ||
    (artifact.aiState === "edited" && (artifact.aiStateExpiresAt ?? 0) > previewClock)
  );
  const liveCreationPaths = useMemo(() => {
    if (artifact.aiState !== "creating") return [];
    const value = record(content);
    const collection =
      artifact.blueprintKey === "document"
        ? "blocks"
        : artifact.blueprintKey === "flashcard_deck"
          ? "cards"
          : artifact.blueprintKey === "quiz"
            ? "questions"
            : "subtasks";
    const items = Array.isArray(value[collection]) ? value[collection] : [];
    return items.length ? [`/${collection}/${items.length - 1}`] : [];
  }, [artifact.aiState, artifact.blueprintKey, content]);
  const aiChangedPaths = aiPreviewActive
    ? (artifact.aiPreview?.changedPaths ?? [])
    : liveCreationPaths;
  const editorContent =
    aiPreviewActive && artifact.aiPreview?.content !== undefined
      ? mergeAiRegions(content, artifact.aiPreview.content, aiChangedPaths)
      : content;
  const editorChange =
    aiPreviewActive && artifact.aiPreview?.content !== undefined
      ? (next: unknown) =>
          changeContent(
            mergeAiRegions(next, artifact.aiPreview?.content, aiChangedPaths),
          )
      : changeContent;

  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);
  useEffect(() => {
    if (artifact.aiState !== "edited" || !artifact.aiPreview || !artifact.aiStateExpiresAt) return;
    setPreviewClock(Date.now());
    const remaining = Math.max(0, artifact.aiStateExpiresAt - Date.now());
    const timer = window.setTimeout(() => setPreviewClock(Date.now()), remaining + 24);
    return () => window.clearTimeout(timer);
  }, [artifact.aiPreview, artifact.aiState, artifact.aiStateExpiresAt]);
  useEffect(() => {
    if (!aiPreviewActive || !artifact.aiPreview) return;
    aiMergeRef.current = {
      paths: artifact.aiPreview.changedPaths ?? [],
      title: artifact.aiPreview.title !== undefined,
      summary: artifact.aiPreview.summary !== undefined,
      tags: artifact.aiPreview.tags !== undefined,
    };
  }, [aiPreviewActive, artifact.aiPreview]);

  useEffect(() => {
    onDirtyChange(dirty);
    dirtyRef.current = dirty;
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const snapshotsDiffer =
      snapshotKey(currentSnapshot) !== snapshotKey(baseline);
    const nextDirty = userHasEditedRef.current && snapshotsDiffer;
    if (reconcilingRemoteRef.current) {
      if (!nextDirty) reconcilingRemoteRef.current = false;
      dirtyRef.current = false;
      setDirty(false);
      return;
    }
    if (!snapshotsDiffer) userHasEditedRef.current = false;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, [baseline, currentSnapshot]);

  useEffect(() => {
    if (!closeDecisionOpen || dirty || busy) return;
    setCloseDecisionOpen(false);
    onClose();
  }, [busy, closeDecisionOpen, dirty, onClose]);

  useEffect(() => {
    const switchedArtifacts = activeArtifactIdRef.current !== artifact._id;
    if (!switchedArtifacts && dirtyRef.current) {
      const incomingKey = snapshotKey(incomingSnapshot);
      if (
        incomingKey !== snapshotKey(baseline) &&
        incomingKey !== dismissedRemoteKey
      ) {
        if (localSyncKeysRef.current.delete(incomingKey)) {
          setBaseline(incomingSnapshot);
          setLiveConflict(null);
          return;
        }
        const aiMerge = aiMergeRef.current;
        if (aiMerge) {
          const local = currentSnapshotRef.current;
          setTitle(aiMerge.title ? incomingSnapshot.title : local.title);
          setSummary(
            aiMerge.summary ? incomingSnapshot.summary : local.summary,
          );
          setTagDraft(
            aiMerge.tags ? incomingSnapshot.tagDraft : local.tagDraft,
          );
          setContent(
            mergeAiRegions(
              local.content,
              incomingSnapshot.content,
              aiMerge.paths,
            ),
          );
          setBaseline(incomingSnapshot);
          setRemoteConflict(null);
          aiMergeRef.current = null;
        } else setRemoteConflict(incomingSnapshot);
      }
      return;
    }
    activeArtifactIdRef.current = artifact._id;
    reconcilingRemoteRef.current = true;
    userHasEditedRef.current = false;
    dirtyRef.current = false;
    setDirty(false);
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
    setTitle(incomingSnapshot.title);
    setSummary(incomingSnapshot.summary);
    setTagDraft(incomingSnapshot.tagDraft);
    setContent(incomingSnapshot.content);
    setBaseline(incomingSnapshot);
    // Reconciliation is a bounded render-cycle guard, not an editor mode. A
    // previously unbounded flag could swallow the first real keystroke after
    // opening or refreshing an artifact and leave Save permanently disabled.
    if (reconciliationFrameRef.current !== null)
      window.cancelAnimationFrame(reconciliationFrameRef.current);
    reconciliationFrameRef.current = window.requestAnimationFrame(() => {
      reconcilingRemoteRef.current = false;
      reconciliationFrameRef.current = null;
    });
    if (switchedArtifacts) {
      setCloseDecisionOpen(false);
    }
  }, [
    artifact._id,
    artifact.updatedAt,
    baseline,
    dismissedRemoteKey,
    incomingSnapshot,
  ]);

  useEffect(
    () => () => {
      if (reconciliationFrameRef.current !== null)
        window.cancelAnimationFrame(reconciliationFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    function requestClose(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      if (artifactId === artifact._id) setCloseDecisionOpen(true);
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("spectra:request-artifact-close", requestClose);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener(
        "spectra:request-artifact-close",
        requestClose,
      );
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [artifact._id, dirty]);

  useEffect(() => {
    if (!dirty || readOnly || busy || aiPreviewActive || liveConflict || syncBusy) return;
    const timer = window.setTimeout(() => void synchronizeDraft(currentSnapshotRef.current), 650);
    return () => window.clearTimeout(timer);
  }, [aiPreviewActive, busy, dirty, liveConflict, readOnly, syncBusy, synchronizeDraft]);

  useEffect(() => {
    if (!liveConflict?.claimId || !live.transport) return;
    const renew = () => void postSpectra({ action: "renewRegionClaim", claimId: liveConflict.claimId, clientId: live.transport!.clientId }).catch(() => undefined);
    const timer = window.setInterval(renew, 9_000);
    return () => window.clearInterval(timer);
  }, [live.transport, liveConflict?.claimId]);

  function changeBase(
    next: Partial<{ title: string; summary: string; tagDraft: string }>,
  ) {
    if (readOnly) return;
    userHasEditedRef.current = true;
    if (next.title !== undefined) {
      live.transport?.setPresence({ activeRegionId: "metadata:title" });
      setTitle(next.title);
    }
    if (next.summary !== undefined) {
      live.transport?.setPresence({ activeRegionId: "metadata:summary" });
      setSummary(next.summary);
    }
    if (next.tagDraft !== undefined) {
      live.transport?.setPresence({ activeRegionId: "metadata:tags" });
      setTagDraft(next.tagDraft);
    }
  }

  function changeContent(next: unknown) {
    if (readOnly) return;
    userHasEditedRef.current = true;
    if (isArtifactTypeKey(artifact.blueprintKey)) {
      try {
        const regions = changedArtifactRegionIds(artifact.blueprintKey, content, next);
        live.transport?.setPresence({ activeRegionId: regions[0] ?? "artifact:structure" });
      } catch {
        live.transport?.setPresence({ activeRegionId: "artifact:structure" });
      }
    }
    setContent(next);
  }

  async function save() {
    if (readOnly || syncBusy) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (artifact.blueprintKey === "thread_reference") return;
    const snapshot = {
      title: trimmedTitle,
      summary: summary.trim(),
      tagDraft: tagsFromDraft(tagDraft).join(", "),
      content,
    };
    await synchronizeDraft(snapshot);
  }

  async function discardQueuedDraft() {
    if (liveConflict?.claimId && live.transport) {
      await postSpectra({ action: "releaseRegionClaim", claimId: liveConflict.claimId, clientId: live.transport.clientId, resolution: "keep_current" }).catch(() => undefined);
    }
    reconcilingRemoteRef.current = true;
    setTitle(incomingSnapshot.title);
    setSummary(incomingSnapshot.summary);
    setTagDraft(incomingSnapshot.tagDraft);
    setContent(incomingSnapshot.content);
    setBaseline(incomingSnapshot);
    setDirty(false);
    userHasEditedRef.current = false;
    setLiveConflict(null);
    window.requestAnimationFrame(() => { reconcilingRemoteRef.current = false; });
  }

  async function restoreVersion(version: SpectraArtifactVersion, regionIds?: readonly string[]) {
    if (readOnly || dirty) return;
    setHistoryBusy(version._id);
    try {
      if (!live.supported) throw new Error("ARTIFACT_LIVE_MODEL_UNAVAILABLE");
      const target = {
        title: version.after.title,
        ...(version.after.summary ? { summary: version.after.summary } : {}),
        content: version.after.content,
        tags: version.after.tags,
      };
      const incoming = {
        title: target.title,
        summary: target.summary ?? "",
        tagDraft: target.tags.join(", "),
        content: target.content,
      };
      if (!regionIds?.length) localSyncKeysRef.current.add(snapshotKey(incoming));
      const result = regionIds?.length ? await live.restoreRegions(target, regionIds) : await live.synchronize(target);
      if (result && "applied" in result && result.applied === false) {
        const claim = "claim" in result ? result.claim : undefined;
        setLiveConflict({ message: "A collaborator is editing a region included in this restore. Nothing was overwritten; the restore remains queued for review.", claimId: claim?.claimId, regionId: claim?.conflict?.regionId, queuePosition: claim?.conflict?.queuePosition });
        return;
      }
      await postSpectra({
        action: "commitArtifactRestore",
        artifactId: artifact._id,
        sourceVersionId: version._id,
      });
      setHistoryOpen(false);
    } catch (error) {
      setLiveConflict({ message: error instanceof Error ? error.message : "This restore could not be applied safely." });
    } finally {
      setHistoryBusy(null);
    }
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
    userHasEditedRef.current = false;
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
  }

  // Planner tasks already provide the purpose-built schedule/links sidebar
  // shown in their source-of-truth layout. Nesting the generic artifact
  // details rail beside it creates an unusable three-column editor.
  const showDetails =
    mode === "tab" && !compact && artifact.blueprintKey !== "planner_task";
  const contentMode = compact ? ("split" as const) : mode;
  const editorLayoutClass = showDetails
    ? mode === "tab"
      ? "mx-auto grid w-full max-w-[1680px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"
      : "grid gap-5 2xl:grid-cols-[minmax(0,1fr)_280px]"
    : "block";
  const mainClass =
    artifact.blueprintKey === "document"
      ? "min-h-0 flex-1 overflow-y-auto pb-5"
      : "min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5";
  const collaboratorCount = live.presence.filter(
    (person) => person.clientId !== live.transport?.clientId,
  ).length;
  const currentAccountId = live.presence.find(
    (person) => person.clientId === live.transport?.clientId,
  )?.accountId;
  const commentRegions = useMemo<ArtifactCommentRegion[]>(() => {
    const semantic = live.modelSnapshot.regionIds.map((regionId) => {
      const descriptor = live.model?.descriptor(regionId);
      return {
        regionId,
        label: descriptor?.label || descriptor?.kind || regionId,
        kind: descriptor?.kind,
      };
    });
    return [
      { regionId: "metadata:title", label: "Artifact title", kind: "metadata" },
      { regionId: "metadata:summary", label: "Artifact summary", kind: "metadata" },
      ...semantic,
    ];
  }, [live.model, live.modelSnapshot.regionIds]);
  const syncLabel = permissionReadOnly
    ? "Read-only"
    : live.state === "permission_lost"
      ? "Access removed"
      : live.state === "reconnecting" || live.state === "unsynchronized"
        ? "Reconnecting"
        : live.state === "connecting" || live.state === "synchronizing"
          ? "Synchronizing"
          : syncBusy || live.unsynchronizedChanges > 0
            ? "Synchronizing"
            : dirty
              ? "Waiting to sync"
              : live.modelSnapshot.validity === "invalid"
                ? "Needs attention"
                : "Synchronized";
  const identityBlock = (
    <div className={`mx-auto flex w-full max-w-[1120px] items-start ${compact ? "gap-3 px-5 pb-5 pt-5" : "gap-4 px-7 pb-7 pt-8 sm:px-10"}`}>
      <span
        className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]"
        style={{ color: meta.color }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <textarea
          value={title}
          readOnly={readOnly}
          onChange={(event) => changeBase({ title: event.target.value })}
          rows={1}
          onFocus={() => live.transport?.setPresence({ activeRegionId: "metadata:title" })}
          className={`min-h-10 w-full resize-none overflow-hidden bg-transparent font-display font-semibold leading-tight text-[var(--text-primary)] outline-none [field-sizing:content] ${compact ? "text-[26px]" : "text-[clamp(24px,2vw,34px)]"}`}
          placeholder="Untitled artifact"
        />
        <input
          value={summary}
          readOnly={readOnly}
          onFocus={() => live.transport?.setPresence({ activeRegionId: "metadata:summary" })}
          onChange={(event) => changeBase({ summary: event.target.value })}
          className="mt-1.5 w-full bg-transparent text-[13px] leading-6 text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-tertiary)]"
          placeholder="Short useful summary"
        />
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          {syncLabel === "Synchronized" ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : syncBusy || live.state === "connecting" || live.state === "synchronizing" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" /> : <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" />}
          {syncLabel}
          {collaboratorCount > 0 ? ` · ${collaboratorCount} here` : ""}
        </span>
        <button
          type="button"
          aria-label="Synchronize changes"
          disabled={readOnly || !dirty || busy || syncBusy || !title.trim()}
          onClick={() => void save()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
        >
          {busy || syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : syncLabel === "Synchronized" ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {permissionReadOnly ? "Read-only" : syncBusy ? "Syncing" : dirty ? "Sync now" : "Synced"}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="spectra-artifact-studio relative flex h-full min-h-0 flex-col"
      data-ai-state={artifact.aiState}
      data-blueprint={artifact.blueprintKey}
      style={{ "--studio-accent": meta.color } as CSSProperties}
    >
      <header className="spectra-artifact-header flex h-12 shrink-0 items-center justify-between gap-4 bg-transparent px-5">
          <div
              className={`${compact ? "hidden" : "flex"} min-w-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]`}
          >
              <span>{sourceLabel}</span>
              <span>/</span>
              <span className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                {meta.label}
              </span>
              <span>/</span>
              <span className="truncate text-[var(--text-primary)]">
                {artifact.title}
              </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CollaborationPresenceIndicator presence={live.presence} currentClientId={live.transport?.clientId} regions={commentRegions} />
            {onShare ? <IconButton label="Share artifact" onClick={onShare} icon={Share2} /> : null}
            <IconButton label="Comments" onClick={() => setCommentsOpen(true)} icon={MessageSquare} />
            <IconButton label="Embedded artifacts" onClick={() => setEmbedsOpen(true)} icon={Link2} />
            {mode === "split" ? (
              <IconButton
                label="Open as tab"
                onClick={onExpand}
                icon={Maximize2}
              />
            ) : null}
            <IconButton
              label="History and more"
              onClick={() => {
                setHistoryOpen(true);
                setHistoryView("changes");
                void getSpectraArtifactVersions(artifact._id).then((result) => {
                  setVersions(result.versions);
                  setPreviewVersion(result.versions[0] ?? null);
                });
              }}
              icon={MoreHorizontal}
            />
            <IconButton
              label={dirty ? "Save and close" : "Close"}
              onClick={() => (dirty ? void save().then(onClose) : onClose())}
              icon={X}
            />
          </div>
      </header>
      {permissionReadOnly ? <div className="shrink-0 border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-2 text-[11px] text-[var(--text-secondary)]">Read-only access · You can inspect, comment, and place this artifact, but only a collaborator with modify access can change it.</div> : null}
      {!permissionReadOnly && live.state === "permission_lost" ? <div role="alert" className="shrink-0 border-y border-[color-mix(in_oklab,var(--danger)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--danger)]">Your access changed while this artifact was open. Editing has stopped and no further changes will be queued.</div> : null}
      {!permissionReadOnly && (live.state === "reconnecting" || live.state === "unsynchronized") ? <div role="status" className="shrink-0 border-y border-[color-mix(in_oklab,#d88922_26%,var(--border-subtle))] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--text-secondary)]">Connection interrupted. Spectra is preserving the current visible draft, but editing is paused until synchronization is restored.</div> : null}
      {liveConflict ? <div role="alert" className="flex shrink-0 items-center gap-3 border-y border-[color-mix(in_oklab,#d88922_28%,var(--border-subtle))] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--text-secondary)]"><span className="min-w-0 flex-1">{liveConflict.message}{liveConflict.queuePosition ? ` · Queue position ${liveConflict.queuePosition}` : ""}</span><button type="button" onClick={() => void synchronizeDraft(currentSnapshotRef.current)} className="font-semibold text-[var(--text-primary)]">Try now</button><button type="button" onClick={() => void discardQueuedDraft()} className="font-semibold text-[var(--text-secondary)]">Keep current</button></div> : null}
      {live.initializationError || live.modelSnapshot.validity === "invalid" ? <div role="alert" className="shrink-0 border-y border-[color-mix(in_oklab,var(--danger)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--danger)]">{live.initializationError ?? live.modelSnapshot.error ?? "The live artifact state needs recovery before editing can continue."}</div> : null}
      {remoteConflict ? (
        <div className="shrink-0 border-b border-[color-mix(in_oklab,#d88922_28%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#d88922]" />
            <span className="min-w-0 flex-1">
              A newer saved version arrived while you were editing. Your local
              changes are still untouched.
            </span>
            <button
              type="button"
              onClick={keepLocalEdits}
              className="rounded-[7px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Keep local edits
            </button>
            <button
              type="button"
              onClick={reloadRemoteVersion}
              className="rounded-[7px] bg-[var(--text-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg-primary)]"
            >
              Reload latest
            </button>
          </div>
        </div>
      ) : null}
      <main
        className={`spectra-artifact-main ${mainClass}`}
        data-ai-preview={aiPreviewActive || undefined}
      >
        <div className={editorLayoutClass}>
          <section className="min-w-0">
            {artifact.blueprintKey === "document" ? (
              <DocumentStudio
                key={`${artifact._id}:document`}
                title={title}
                content={editorContent}
                onChange={editorChange}
                aiChangedPaths={aiChangedPaths}
                header={identityBlock}
              />
            ) : null}
            {artifact.blueprintKey !== "document" ? identityBlock : null}
            {artifact.blueprintKey === "flashcard_deck" ? (
              <FlashcardStudio
                key={`${artifact._id}:deck`}
                mode={contentMode}
                content={editorContent}
                onChange={editorChange}
                aiChangedPaths={aiChangedPaths}
              />
            ) : null}
            {artifact.blueprintKey === "quiz" ? (
              <QuizStudio
                key={`${artifact._id}:quiz`}
                mode={contentMode}
                content={editorContent}
                onChange={editorChange}
                aiChangedPaths={aiChangedPaths}
              />
            ) : null}
            {artifact.blueprintKey === "planner_task" ? (
              <PlannerStudio
                key={`${artifact._id}:planner`}
                mode={contentMode}
                artifact={artifact}
                artifacts={artifacts}
                tagDraft={tagDraft}
                onTagDraftChange={(value) => changeBase({ tagDraft: value })}
                content={editorContent}
                onChange={editorChange}
                onArchive={onArchive}
              />
            ) : null}
            {artifact.blueprintKey === "thread_reference" ? (
              <ThreadReferenceStudio content={content} />
            ) : null}
          </section>
          {showDetails ? (
            <StudioDetails
              artifact={artifact}
              artifacts={artifacts}
              tagDraft={tagDraft}
              onTagDraftChange={(value) => changeBase({ tagDraft: value })}
            />
          ) : null}
        </div>
      </main>
      <ArtifactCommentsPanel
        open={commentsOpen}
        artifactId={artifact._id}
        artifactTitle={title || artifact.title}
        regions={commentRegions}
        currentAccountId={currentAccountId}
        onClose={() => setCommentsOpen(false)}
      />
      <ArtifactEmbedsPanel
        open={embedsOpen}
        containerId={artifact._id}
        containerTitle={title || artifact.title}
        artifacts={artifacts}
        regions={commentRegions}
        onOpenSource={onOpenArtifact}
        onClose={() => setEmbedsOpen(false)}
      />
      {closeDecisionOpen ? (
        <div
          className="absolute inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_70%,transparent)] p-5 backdrop-blur-[2px]"
          onPointerDown={() => setCloseDecisionOpen(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_24px_70px_rgba(27,20,12,0.2)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 className="font-display text-[20px] font-semibold text-[var(--text-primary)]">
              Save changes to {artifact.title}?
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
              This artifact has edits that have not been saved.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseDecisionOpen(false)}
                className="h-9 px-3 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[8px] px-3 text-[12px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={busy || !title.trim()}
                onClick={() => void save().then(onClose)}
                className="h-9 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)] disabled:opacity-45"
              >
                Save & close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {historyOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[180] flex items-center justify-center bg-[rgba(25,22,18,.26)] p-5 backdrop-blur-[3px]"
              onPointerDown={() => setHistoryOpen(false)}
            >
              <div
                className="flex h-[min(760px,90vh)] w-[min(1180px,94vw)] flex-col rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[0_28px_90px_rgba(27,20,12,0.24)]"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-[25px] font-semibold text-[var(--text-primary)]">
                      Version history
                    </h2>
                    <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                      Inspect what changed. Restoring creates a new version, so
                      nothing in the timeline is erased.
                    </p>
                  </div>
                  <IconButton
                    label="Close history"
                    onClick={() => setHistoryOpen(false)}
                    icon={X}
                  />
                </div>
                <div className="mt-5 grid min-h-0 flex-1 gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="space-y-2 overflow-y-auto pr-1">
                    {versions.map((version) => (
                      <button
                        type="button"
                        key={version._id}
                        onClick={() => setPreviewVersion(version)}
                        className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-3 text-left transition ${previewVersion?._id === version._id ? "border-[color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] shadow-[inset_3px_0_0_var(--accent-cyan)]" : "border-transparent bg-[var(--bg-primary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"}`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${version.source === "ai" ? "bg-[var(--accent-cyan)]" : version.source === "revert" || version.source === "restore" ? "bg-[#d88922]" : version.source === "checkpoint" ? "bg-[#8b6ff0]" : "bg-[var(--text-tertiary)]"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">
                            {version.source === "ai"
                              ? "Spectra edit"
                              : version.source === "revert" || version.source === "restore"
                                ? "Restored version"
                                : version.source === "checkpoint"
                                  ? "Before Spectra edit"
                                  : "User edit"}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">
                            {version.summary ?? "Saved artifact changes"} ·{" "}
                            {formatRelativeTime(version.createdAt)}
                          </span>
                        </span>
                      </button>
                    ))}
                    {versions.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-[var(--text-tertiary)]">
                        No saved versions yet.
                      </div>
                    ) : null}
                  </div>
                  <section className="min-h-0 overflow-hidden rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
                    {previewVersion ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
                          <div>
                            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                              {previewDiff.length} changed field
                              {previewDiff.length === 1 ? "" : "s"}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                              Earlier value on the left · current value on the
                              right
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setHistoryView((value) => value === "changes" ? "artifacts" : "changes")} className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                            {historyView === "changes" ? "Open artifacts side by side" : "Show changed fields"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(historyBusy) || dirty || selectedRestoreRegions.size === 0}
                            onClick={() => {
                              void restoreVersion(previewVersion, [...selectedRestoreRegions]);
                            }}
                            className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Restore {selectedRestoreRegions.size} selected
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(historyBusy) || dirty}
                            onClick={() => {
                              void restoreVersion(previewVersion);
                            }}
                            className="flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--text-primary)] px-3 text-[11px] font-medium text-[var(--bg-primary)] disabled:opacity-35"
                          >
                            {historyBusy === previewVersion._id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Restore as new version
                          </button>
                          </div>
                        </div>
                        {historyView === "artifacts" ? (
                          <div className="grid min-h-0 flex-1 overflow-hidden md:grid-cols-2">
                            <section className="min-h-0 overflow-auto border-b border-[var(--border-default)] md:border-b-0 md:border-r"><div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,transparent)] px-5 py-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--danger)] backdrop-blur">Selected version · read only</div><ReadonlyArtifactSnapshot blueprintKey={artifact.blueprintKey} snapshot={previewVersion.after} /></section>
                            <section className="min-h-0 overflow-auto"><div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,transparent)] px-5 py-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)] backdrop-blur">Current artifact · read only</div><ReadonlyArtifactSnapshot blueprintKey={artifact.blueprintKey} snapshot={{ title: artifact.title, summary: artifact.summary, content: artifact.content, tags: artifact.tags }} /></section>
                          </div>
                        ) : <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
                          {previewDiff.map((change, index) => (
                            <article
                              key={`${index}:${change.label}`}
                              className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                            >
                              <header className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-semibold text-[var(--text-primary)]">
                                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={Boolean(change.regionId && selectedRestoreRegions.has(change.regionId))} onChange={(event) => { if (!change.regionId) return; setSelectedRestoreRegions((current) => { const next = new Set(current); if (event.target.checked) next.add(change.regionId!); else next.delete(change.regionId!); return next; }); }} className="h-3.5 w-3.5 accent-[var(--accent-cyan)]" />{change.label}</label>
                              </header>
                              <div className="grid md:grid-cols-2">
                                <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))] p-4 md:border-b-0 md:border-r">
                                  <div className="mb-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--danger)]">
                                    Earlier
                                  </div>
                                  <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">
                                    {change.before}
                                  </div>
                                </div>
                                <div className="bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-primary))] p-4">
                                  <div className="mb-2 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)]">
                                    Current
                                  </div>
                                  <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-primary)]">
                                    {change.after}
                                  </div>
                                </div>
                              </div>
                            </article>
                          ))}
                          {previewDiff.length === 0 ? (
                            <div className="flex min-h-[260px] items-center justify-center text-[12px] text-[var(--text-secondary)]">
                              This saved state matches the current artifact.
                            </div>
                          ) : null}
                        </div>}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center text-[12px] text-[var(--text-secondary)]">
                        Select a version to preview its highlighted changes.
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function DocumentStudio({
  title,
  content,
  onChange,
  aiChangedPaths = [],
  header,
}: {
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  header: ReactNode;
}) {
  const [initialContent] = useState(() =>
    documentJsonFromContent(content, title),
  );
  const [, refreshToolbar] = useState(0);
  const [importing, setImporting] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("https://");
  const importRef = useRef<HTMLInputElement>(null);
  const editorReadyForUserChanges = useRef(false);
  const editorJsonKeyRef = useRef(JSON.stringify(initialContent));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
      }),
      Underline,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true, inline: false }),
      Callout,
      Equation,
      InlineEquation,
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
        class:
          "min-h-[620px] px-2 pb-24 pt-2 outline-none font-serif text-[17px] leading-8 text-[var(--text-primary)]",
      },
    },
    onUpdate: ({ editor }) => {
      const nextJson = editor.getJSON();
      editorJsonKeyRef.current = JSON.stringify(nextJson);
      // Extension normalization can emit an update during the editor's mount
      // frame even when the user changed nothing. Treat that frame as editor
      // hydration; genuine input begins immediately afterward.
      if (!editorReadyForUserChanges.current) return;
      onChange(documentContentFromJson(nextJson, content));
    },
    onSelectionUpdate: () => refreshToolbar((value) => value + 1),
  });

  useEffect(() => {
    if (!editor) return;
    const markUserInput = () => {
      editorReadyForUserChanges.current = true;
    };
    const element = editor.view.dom;
    element.addEventListener("pointerdown", markUserInput, { once: true });
    element.addEventListener("keydown", markUserInput, { once: true });
    element.addEventListener("beforeinput", markUserInput, { once: true });
    element.addEventListener("paste", markUserInput, { once: true });
    return () => {
      element.removeEventListener("pointerdown", markUserInput);
      element.removeEventListener("keydown", markUserInput);
      element.removeEventListener("beforeinput", markUserInput);
      element.removeEventListener("paste", markUserInput);
    };
  }, [editor]);

  const incomingEditorJson = useMemo(
    () => documentJsonFromContent(content, title),
    [content, title],
  );
  useEffect(() => {
    if (!editor) return;
    const incomingKey = JSON.stringify(incomingEditorJson);
    if (incomingKey === editorJsonKeyRef.current) return;
    editorJsonKeyRef.current = incomingKey;
    // Tiptap may flush synchronously while React is reconciling a streamed
    // artifact subscription. Move the external-content reconciliation to the
    // next microtask so live AI blocks do not trigger React's nested flushSync
    // warning or fight the current render.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && !editor.isDestroyed)
        editor.commands.setContent(incomingEditorJson, { emitUpdate: false });
    });
    return () => {
      cancelled = true;
    };
  }, [editor, incomingEditorJson]);

  useEffect(() => {
    if (!editor) return;
    const blocks = Array.from(editor.view.dom.children) as HTMLElement[];
    blocks.forEach((block) => block.removeAttribute("data-ai-region"));
    if (!aiChangedPaths.length) return;
    if (aiChangedPaths.includes("/")) {
      blocks.forEach((block) => block.setAttribute("data-ai-region", "true"));
      return;
    }
    const indices = new Set(aiChangedPaths.flatMap((path) => {
      const match = path.match(/^\/(?:content\/)?blocks\/(\d+)/);
      return match ? [Number(match[1])] : [];
    }));
    indices.forEach((index) => blocks[index]?.setAttribute("data-ai-region", "true"));
  }, [aiChangedPaths, content, editor]);

  const equationActive = editor?.isActive("equation") ?? false;
  const equationAttrs = equationActive
    ? (editor?.getAttributes("equation") ?? {})
    : {};

  async function importDocument(file: File) {
    if (!editor) return;
    editorReadyForUserChanges.current = true;
    setImporting(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({
          arrayBuffer: await file.arrayBuffer(),
        });
        editor.commands.setContent(result.value || "<p></p>");
      } else {
        const text = await file.text();
        editor.commands.setContent(
          name.endsWith(".html") || name.endsWith(".htm")
            ? text
            : `<p>${text
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replace(/\n{2,}/g, "</p><p>")
                .replace(/\n/g, "<br>")}</p>`,
        );
      }
      onChange(documentContentFromJson(editor.getJSON(), content));
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div className="spectra-document-studio bg-[var(--bg-primary)]">
      <div className="spectra-document-toolbar sticky top-0 z-30 mx-5 flex min-h-11 flex-wrap items-center gap-1 rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] px-2 py-1.5 shadow-[0_8px_24px_-22px_rgba(27,20,12,.5)] backdrop-blur sm:mx-8">
        <select
          aria-label="Text style"
          value={
            editor?.isActive("heading", { level: 1 })
              ? "h1"
              : editor?.isActive("heading", { level: 2 })
                ? "h2"
                : editor?.isActive("heading", { level: 3 })
                  ? "h3"
                  : "paragraph"
          }
          onChange={(event) => {
            const value = event.target.value;
            if (value === "paragraph")
              editor?.chain().focus().setParagraph().run();
            else
              editor
                ?.chain()
                .focus()
                .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                .run();
          }}
          className="h-8 min-w-[126px] bg-transparent px-2 text-[12px] font-medium text-[var(--text-primary)] outline-none"
        >
          <option value="paragraph">Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <Divider />
        <ToolbarTextButton
          label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive("bold")}
        >
          <Bold className="h-4 w-4" />
        </ToolbarTextButton>
        <ToolbarTextButton
          label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive("italic")}
        >
          <Italic className="h-4 w-4" />
        </ToolbarTextButton>
        <ToolbarTextButton
          label="Underline"
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          active={editor?.isActive("underline")}
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarTextButton>
        <Divider />
        <ToolbarButton
          label="Bullet list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive("bulletList")}
          icon={List}
        />
        <ToolbarButton
          label="Quote"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          active={editor?.isActive("blockquote")}
          icon={MessageSquare}
        />
        <ToolbarButton
          label="Insert equation"
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "equation",
                attrs: { latex: "", display: "block", alignment: "center" },
              })
              .run()
          }
          active={equationActive}
          icon={Sigma}
        />
        <ToolbarButton
          label="Link"
          icon={Link2}
          active={linkEditorOpen || editor?.isActive("link")}
          onClick={() => {
            setLinkDraft(
              String(editor?.getAttributes("link").href ?? "https://"),
            );
            setLinkEditorOpen((open) => !open);
          }}
        />
        <ToolbarButton
          label="Insert callout"
          icon={Sparkles}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "callout",
                attrs: { tone: "info" },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Key idea" }],
                  },
                ],
              })
              .run()
          }
        />
        <ToolbarButton
          label="Insert table"
          icon={Table2}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        />
        {editor?.isActive("table") ? (
          <>
            <ToolbarButton
              label="Add table column"
              icon={Plus}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            />
            <ToolbarButton
              label="Delete table"
              icon={Trash2}
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          </>
        ) : null}
        <span className="ml-auto" />
        <input
          ref={importRef}
          type="file"
          accept=".docx,.html,.htm,.txt,.md"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importDocument(file);
          }}
        />
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Import className="h-3.5 w-3.5" />
          )}
          Import
        </button>
        <ToolbarButton
          label="More formatting options"
          icon={MoreHorizontal}
          onClick={() => editor?.chain().focus().run()}
        />
      </div>
      {header}
      {linkEditorOpen ? (
        <div className="mx-5 mt-2 flex items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_12px_30px_-24px_rgba(27,20,12,.4)]">
          <Link2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <input
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLinkEditorOpen(false);
              if (event.key === "Enter" && linkDraft.trim()) {
                event.preventDefault();
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: linkDraft.trim() })
                  .run();
                setLinkEditorOpen(false);
              }
            }}
            className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-[var(--text-primary)] outline-none"
            aria-label="Link URL"
          />
          <button
            type="button"
            className={smallActionClass()}
            onClick={() => {
              if (!linkDraft.trim()) return;
              editor
                ?.chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: linkDraft.trim() })
                .run();
              setLinkEditorOpen(false);
            }}
          >
            Apply link
          </button>
          {editor?.isActive("link") ? (
            <button
              type="button"
              className={smallActionClass()}
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setLinkEditorOpen(false);
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
      {equationActive ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] px-4 py-2"
          data-equation-toolbar="true"
        >
          <Sigma className="h-4 w-4 text-[var(--accent-cyan)]" />
          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
            LaTeX
          </span>
          <input
            value={
              typeof equationAttrs.latex === "string" ? equationAttrs.latex : ""
            }
            onChange={(event) =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { latex: event.target.value })
                .run()
            }
            className="h-8 min-w-[220px] flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 font-mono text-[12px] text-[var(--text-primary)] outline-none"
            placeholder="E = mc^2"
          />
          <ToolbarButton
            label="Align left"
            icon={AlignLeft}
            active={equationAttrs.alignment === "left"}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "left" })
                .run()
            }
          />
          <ToolbarButton
            label="Align center"
            icon={AlignCenter}
            active={
              !equationAttrs.alignment || equationAttrs.alignment === "center"
            }
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "center" })
                .run()
            }
          />
          <ToolbarButton
            label="Align right"
            icon={AlignRight}
            active={equationAttrs.alignment === "right"}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "right" })
                .run()
            }
          />
        </div>
      ) : null}
      <div className="min-h-[680px] px-2 pb-8 pt-1 sm:px-6">
        <div className="mx-auto max-w-[1040px] px-2 pb-1 pt-3 text-[11px] text-[var(--text-tertiary)]">
          Type{" "}
          <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1 py-0.5">
            /
          </kbd>{" "}
          for commands
        </div>
        <EditorContent
          editor={editor}
          className="tiptap-root mx-auto max-w-[1040px] [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-default)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:font-display [&_.ProseMirror_h1]:text-[30px] [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:font-display [&_.ProseMirror_h2]:text-[23px] [&_.ProseMirror_h2]:leading-tight [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p]:my-4"
        />
      </div>
    </div>
  );
}

function FlashcardStudio({
  mode,
  content,
  onChange,
  aiChangedPaths = [],
}: {
  mode: "split" | "tab";
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
}) {
  const [cards, setCards] = useState(() => deckCards(content));
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState(
    cards[0]?.section ?? "Section 1",
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const sections = useMemo(
    () => Array.from(new Set(cards.map((card) => card.section || "Section 1"))),
    [cards],
  );
  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const deckImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextCards = deckCards(content);
    setCards(nextCards);
    setActiveCardId((current) =>
      nextCards.some((card) => card.id === current)
        ? current
        : (nextCards[0]?.id ?? ""),
    );
  }, [content]);

  function commit(nextCards: DeckCard[]) {
    setCards(nextCards);
    onChange({
      ...record(content),
      cards: nextCards,
      settings: record(content).settings ?? {
        shuffle: true,
        revealMode: "click",
      },
    });
  }

  function updateCard(cardId: string, patch: Partial<DeckCard>) {
    commit(
      cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  }

  function addCard(section = activeSection) {
    const card = {
      id: id("card"),
      front: "",
      back: "",
      hint: "",
      section,
      confidence: "unknown" as const,
    };
    commit([...cards, card]);
    setActiveCardId(card.id);
    setActiveSection(section);
  }

  async function importCards(file: File) {
    const text = await file.text();
    const imported = text
      .split(/\r?\n/)
      .map((line) =>
        line
          .split(/\t|,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
          .map((cell) => cell.trim().replace(/^\"|\"$/g, "")),
      )
      .filter((row) => row[0] && row[1])
      .map((row, index) => ({
        id: id(`card-${index + 1}`),
        front: row[0]!,
        back: row[1]!,
        hint: row[2] ?? "",
        section: row[3] || "Imported",
        confidence: "unknown" as const,
      }));
    if (imported.length) {
      commit([...cards, ...imported]);
      setActiveCardId(imported[0]!.id);
      setActiveSection(imported[0]!.section ?? "Imported");
    }
    if (deckImportRef.current) deckImportRef.current.value = "";
  }

  return (
    <div
      className={`spectra-flashcard-studio grid min-h-[720px] min-w-0 gap-4 ${mode === "tab" ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "grid-cols-1"}`}
    >
      <div
        className={`grid min-w-0 grid-cols-2 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] ${mode === "tab" ? "sm:grid-cols-4 lg:col-span-2" : ""}`}
      >
        <div className="px-4 py-3">
          <strong className="block font-display text-[18px] text-[var(--text-primary)]">
            {cards.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">Cards</span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[18px] text-[var(--text-primary)]">
            {sections.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Sections
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[18px] text-[var(--text-primary)]">
            {Math.round(
              (cards.filter((card) => card.review?.state === "mastered")
                .length /
                Math.max(1, cards.length)) *
                100,
            )}
            %
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Mastery
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-4 py-3">
          <strong className="block font-display text-[18px] text-[var(--text-primary)]">
            ~{Math.max(1, Math.ceil(cards.length * 0.75))} min
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Study time
          </span>
        </div>
      </div>
      <div
        className={`flex min-w-0 flex-wrap items-center gap-2 ${mode === "tab" ? "lg:col-span-2" : ""}`}
      >
        <button
          type="button"
          onClick={() => addCard()}
          className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#7560e8] px-3 text-[12px] font-semibold text-white shadow-[0_8px_20px_-14px_#5f49d4]"
        >
          <Plus className="h-4 w-4" />
          Add card
        </button>
        <button
          type="button"
          onClick={() => {
            const section = `Section ${sections.length + 1}`;
            setActiveSection(section);
            addCard(section);
          }}
          className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
        >
          <Plus className="h-4 w-4" />
          Add section
        </button>
        <input
          ref={deckImportRef}
          type="file"
          accept=".csv,.tsv,.txt"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importCards(file);
          }}
        />
        <button
          type="button"
          onClick={() => deckImportRef.current?.click()}
          className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
        >
          <Import className="h-4 w-4" />
          Import
        </button>
        <div className={`${mode === "split" ? "w-full justify-between border-t border-[var(--border-subtle)] pt-2" : "ml-auto"} flex min-w-0 items-center gap-1 text-[11px] text-[var(--text-secondary)]`}>
          <button
            type="button"
            aria-label="Previous card"
            disabled={
              !activeCard ||
              cards.findIndex((card) => card.id === activeCard.id) === 0
            }
            onClick={() => {
              const index = cards.findIndex(
                (card) => card.id === activeCard?.id,
              );
              if (index > 0) setActiveCardId(cards[index - 1]!.id);
            }}
            className={iconButtonClass()}
          >
            <ChevronDown className="h-4 w-4 rotate-90" />
          </button>
          <span>
            Card{" "}
            {Math.max(
              1,
              cards.findIndex((card) => card.id === activeCard?.id) + 1,
            )}{" "}
            of {cards.length}
          </span>
          <button
            type="button"
            aria-label="Next card"
            disabled={
              !activeCard ||
              cards.findIndex((card) => card.id === activeCard.id) ===
                cards.length - 1
            }
            onClick={() => {
              const index = cards.findIndex(
                (card) => card.id === activeCard?.id,
              );
              if (index >= 0 && index < cards.length - 1)
                setActiveCardId(cards[index + 1]!.id);
            }}
            className={iconButtonClass()}
          >
            <ChevronDown className="h-4 w-4 -rotate-90" />
          </button>
        </div>
      </div>
      <aside className="min-w-0 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Cards
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {cards.length} {cards.length === 1 ? "card" : "cards"} across{" "}
              {sections.length} {sections.length === 1 ? "section" : "sections"}
            </p>
          </div>
          <button
            type="button"
            className={smallActionClass()}
            onClick={() => addCard()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <div className="max-h-[650px] overflow-y-auto p-2">
          {sections.map((section) => (
            <section key={section} className="mb-2">
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-[7px] px-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                aria-expanded={!collapsedSections.has(section)}
                onClick={() => {
                  setActiveSection(section);
                  setCollapsedSections((current) => {
                    const next = new Set(current);
                    if (next.has(section)) next.delete(section);
                    else next.add(section);
                    return next;
                  });
                }}
              >
                <span>
                  {section}
                  <span className="ml-2 text-[10px] font-normal text-[var(--text-tertiary)]">
                    {(() => {
                      const count = cards.filter(
                        (card) => (card.section || "Section 1") === section,
                      ).length;
                      return `${count} ${count === 1 ? "card" : "cards"}`;
                    })()}
                  </span>
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${collapsedSections.has(section) ? "-rotate-90" : ""}`}
                />
              </button>
              {!collapsedSections.has(section) ? (
                <div className="space-y-1">
                  {cards
                    .filter((card) => (card.section || "Section 1") === section)
                    .map((card, index) => {
                      const canonicalIndex = cards.findIndex(
                        (item) => item.id === card.id,
                      );
                      const aiChanging = pathTouches(
                        aiChangedPaths,
                        `/cards/${canonicalIndex}`,
                      );
                      return (
                        <button
                          key={card.id}
                          type="button"
                          className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border px-2 py-2 text-left ${
                            card.id === activeCard?.id
                              ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]"
                              : "border-transparent hover:bg-[var(--bg-hover)]"
                          }`}
                          onClick={() => {
                            setActiveCardId(card.id);
                            setActiveSection(section);
                          }}
                          data-ai-region={aiChanging || undefined}
                        >
                          <span className="text-center text-[12px] text-[var(--text-secondary)]">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
                            {card.front || "Untitled card"}
                          </span>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${card.confidence === "strong" ? "bg-[var(--success)]" : card.confidence === "weak" ? "bg-[var(--danger)]" : "bg-[#d88922]"}`}
                          />
                        </button>
                      );
                    })}
                </div>
              ) : null}
            </section>
          ))}
          <button
            type="button"
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            onClick={() => {
              const section = `Section ${sections.length + 1}`;
              setActiveSection(section);
              addCard(section);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add section
          </button>
        </div>
      </aside>
      <section
        data-ai-region={
          activeCard
            ? pathTouches(
                aiChangedPaths,
                `/cards/${cards.findIndex((card) => card.id === activeCard.id)}`,
              ) || undefined
            : undefined
        }
        className="min-w-0 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
      >
        {activeCard ? (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[12px] text-[var(--text-secondary)]">
                Card {cards.findIndex((card) => card.id === activeCard.id) + 1}{" "}
                of {cards.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={iconButtonClass()}
                  onClick={() => {
                    const next = cards.filter(
                      (card) => card.id !== activeCard.id,
                    );
                    commit(
                      next.length > 0
                        ? next
                        : [
                            {
                              id: id("card"),
                              front: "",
                              back: "",
                              hint: "",
                              section: activeSection,
                              confidence: "unknown",
                            },
                          ],
                    );
                    setActiveCardId(next[0]?.id ?? "");
                  }}
                  aria-label="Remove card"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <CardFace
              label="Front"
              value={activeCard.front}
              placeholder="Question or prompt"
              onChange={(value) => updateCard(activeCard.id, { front: value })}
            />
            <div className="my-3 flex justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                <Copy className="h-4 w-4" />
              </span>
            </div>
            <CardFace
              label="Back"
              value={activeCard.back}
              placeholder="Answer"
              onChange={(value) => updateCard(activeCard.id, { back: value })}
            />
            <div
              className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-[1fr_180px]" : "grid-cols-1"}`}
            >
              <Field label="Note or hint">
                <input
                  value={activeCard.hint ?? ""}
                  onChange={(event) =>
                    updateCard(activeCard.id, { hint: event.target.value })
                  }
                  className={inputClass()}
                  placeholder="Optional hint"
                />
              </Field>
              <Field label="Confidence">
                <select
                  value={activeCard.confidence ?? "unknown"}
                  onChange={(event) =>
                    updateCard(activeCard.id, {
                      confidence: event.target.value as DeckCard["confidence"],
                    })
                  }
                  className={inputClass()}
                >
                  <option value="unknown">Unknown</option>
                  <option value="weak">Weak</option>
                  <option value="medium">Medium</option>
                  <option value="strong">Strong</option>
                </select>
              </Field>
            </div>
            <div
              className={`mt-3 grid gap-3 ${mode === "tab" ? "md:grid-cols-3" : "grid-cols-1"}`}
            >
              <Field label="Section">
                <input
                  value={activeCard.section ?? ""}
                  onChange={(event) =>
                    updateCard(activeCard.id, {
                      section: event.target.value || "Section 1",
                    })
                  }
                  className={inputClass()}
                  placeholder="Section"
                />
              </Field>
              <Field label="Review state">
                <select
                  value={activeCard.review?.state ?? "new"}
                  onChange={(event) =>
                    updateCard(activeCard.id, {
                      review: {
                        ...activeCard.review,
                        state: event.target.value as NonNullable<
                          DeckCard["review"]
                        >["state"],
                      },
                    })
                  }
                  className={inputClass()}
                >
                  <option value="new">New</option>
                  <option value="learning">Learning</option>
                  <option value="review">Review</option>
                  <option value="mastered">Mastered</option>
                </select>
              </Field>
              <Field label="Correct streak">
                <input
                  type="number"
                  min={0}
                  value={activeCard.review?.correctStreak ?? 0}
                  onChange={(event) =>
                    updateCard(activeCard.id, {
                      review: {
                        ...activeCard.review,
                        correctStreak: Math.max(0, Number(event.target.value)),
                      },
                    })
                  }
                  className={inputClass()}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Sources / provenance">
                <input
                  value={(activeCard.sourceRefs ?? []).join(", ")}
                  onChange={(event) =>
                    updateCard(activeCard.id, {
                      sourceRefs: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  className={inputClass()}
                  placeholder="Chapter 3, lecture notes"
                />
              </Field>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function QuizStudio({
  mode,
  content,
  onChange,
  aiChangedPaths = [],
}: {
  mode: "split" | "tab";
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
}) {
  const [questions, setQuestions] = useState(() => quizQuestions(content));
  const [activeQuestionId, setActiveQuestionId] = useState(
    questions[0]?.id ?? "",
  );
  const [view, setView] = useState<
    "builder" | "settings" | "preview" | "responses"
  >("builder");
  const [quizSettings, setQuizSettings] = useState(() => ({
    showAnswersImmediately:
      record(record(content).settings).showAnswersImmediately !== false,
    timed: record(record(content).settings).timed === true,
    shuffleQuestions:
      record(record(content).settings).shuffleQuestions === true,
    passingScore:
      typeof record(record(content).settings).passingScore === "number"
        ? Number(record(record(content).settings).passingScore)
        : 70,
  }));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [published, setPublished] = useState(
    record(content).published === true,
  );
  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) ??
    questions[0];

  useEffect(() => {
    const nextQuestions = quizQuestions(content);
    setQuestions(nextQuestions);
    setActiveQuestionId((current) =>
      nextQuestions.some((question) => question.id === current)
        ? current
        : (nextQuestions[0]?.id ?? ""),
    );
  }, [content]);

  function commit(next: QuizQuestion[]) {
    setQuestions(next);
    onChange({
      ...record(content),
      questions: next,
      settings: quizSettings,
      published,
    });
  }

  function commitSettings(patch: Partial<typeof quizSettings>) {
    const next = { ...quizSettings, ...patch };
    setQuizSettings(next);
    onChange({ ...record(content), questions, settings: next, published });
  }

  function updateQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    commit(
      questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    );
  }

  function addQuestion() {
    const question = {
      id: id("question"),
      prompt: "",
      type: "multiple_choice" as const,
      options: ["", "", "", ""],
      correctAnswer: "",
      explanation: "",
      difficulty: "medium" as const,
      points: 1,
      timeLimitSeconds: 90,
      bloomLevel: "remember" as const,
      standards: [],
      tags: [],
    };
    commit([...questions, question]);
    setActiveQuestionId(question.id);
  }

  return (
    <div className="spectra-quiz-studio rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={tabButtonClass(view === "builder")}
            onClick={() => setView("builder")}
          >
            Builder
          </button>
          <button
            type="button"
            className={tabButtonClass(view === "settings")}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
          <button
            type="button"
            className={tabButtonClass(view === "preview")}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={tabButtonClass(view === "responses")}
            onClick={() => setView("responses")}
          >
            Responses
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-1.5 text-[10px] text-[var(--text-tertiary)] md:flex">
            <strong className="font-display text-[16px] text-[var(--text-primary)]">
              {questions.length}
            </strong>{" "}
            questions{" "}
            <strong className="font-display text-[16px] text-[var(--text-primary)]">
              {Math.max(
                1,
                Math.ceil(
                  questions.reduce(
                    (total, question) =>
                      total + (question.timeLimitSeconds ?? 90),
                    0,
                  ) / 60,
                ),
              )}{" "}
              min
            </strong>
            <strong className="font-display text-[14px] capitalize text-[var(--text-primary)]">
              {questions.some((question) => question.difficulty === "hard")
                ? "Hard"
                : questions.every((question) => question.difficulty === "easy")
                  ? "Easy"
                  : "Medium"}
            </strong>
          </span>
          <button
            type="button"
            className={smallActionClass()}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={`h-8 rounded-[7px] px-3 text-[12px] font-semibold ${published ? "border border-[var(--success)] text-[var(--success)]" : "bg-[#7560e8] text-white"}`}
            onClick={() => {
              const next = !published;
              setPublished(next);
              onChange({
                ...record(content),
                questions,
                settings: quizSettings,
                published: next,
              });
            }}
          >
            {published ? "Published" : "Publish"}
          </button>
          <button
            type="button"
            className={smallActionClass()}
            onClick={addQuestion}
          >
            <Plus className="h-3.5 w-3.5" />
            Add question
          </button>
        </div>
      </div>
      {view === "preview" ? (
        <div className="p-5">
          <div className="mx-auto max-w-[760px] space-y-3">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                  Take quiz
                </h3>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  Answer locally, then submit to mark and review explanations.
                </p>
              </div>
              {submitted ? (
                <div className="rounded-[8px] bg-[color-mix(in_oklab,var(--success)_9%,var(--bg-primary))] px-3 py-2 text-[12px] font-semibold text-[var(--success)]">
                  {
                    questions.filter(
                      (question) =>
                        (answers[question.id] ?? "").trim().toLowerCase() ===
                        (question.correctAnswer ?? "").trim().toLowerCase(),
                    ).length
                  }
                  /{questions.length} correct
                </div>
              ) : null}
            </div>
            {questions.map((question, index) => (
              <div
                key={question.id}
                className={`rounded-[8px] border bg-[var(--bg-primary)] p-4 ${submitted ? ((answers[question.id] ?? "").trim().toLowerCase() === (question.correctAnswer ?? "").trim().toLowerCase() ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))]" : "border-[color-mix(in_oklab,var(--danger)_38%,var(--border-default))]") : "border-[var(--border-default)]"}`}
              >
                <div className="text-[12px] font-semibold text-[var(--text-secondary)]">
                  Question {index + 1}
                </div>
                <div className="mt-2 text-[15px] font-medium text-[var(--text-primary)]">
                  {question.prompt || "Untitled question"}
                </div>
                <div className="mt-3 space-y-2">
                  {question.type === "multiple_choice" ? (
                    question.options.map((option, optionIndex) => (
                      <button
                        type="button"
                        disabled={submitted}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option,
                          }))
                        }
                        key={`${question.id}-${optionIndex}`}
                        className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] transition ${answers[question.id] === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                      >
                        <Radio className="h-3.5 w-3.5" />
                        {option || `Option ${optionIndex + 1}`}
                      </button>
                    ))
                  ) : (
                    <input
                      disabled={submitted}
                      value={answers[question.id] ?? ""}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      className={inputClass()}
                      placeholder="Type your answer"
                    />
                  )}
                </div>
                {submitted ? (
                  <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                    <div>
                      <strong className="text-[var(--text-primary)]">
                        Answer:
                      </strong>{" "}
                      {question.correctAnswer}
                    </div>
                    {question.explanation ? (
                      <div className="mt-1">{question.explanation}</div>
                    ) : null}
                    {question.sourceRefs?.length ? (
                      <div className="mt-1 text-[var(--text-tertiary)]">
                        Sources: {question.sourceRefs.join(" · ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-3">
              {submitted ? (
                <button
                  type="button"
                  className={smallActionClass()}
                  onClick={() => {
                    setSubmitted(false);
                    setAnswers({});
                  }}
                >
                  Try again
                </button>
              ) : (
                <button
                  type="button"
                  className="h-9 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)]"
                  onClick={() => setSubmitted(true)}
                >
                  Submit answers
                </button>
              )}
            </div>
          </div>
        </div>
      ) : view === "settings" ? (
        <div className="mx-auto grid max-w-[900px] gap-4 p-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              commitSettings({
                showAnswersImmediately: !quizSettings.showAnswersImmediately,
              })
            }
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Immediate answer feedback
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Reveal the correct answer and explanation after each response.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.showAnswersImmediately ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <button
            type="button"
            onClick={() => commitSettings({ timed: !quizSettings.timed })}
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Timed quiz
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Use each question&apos;s configured time limit.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.timed ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <button
            type="button"
            onClick={() =>
              commitSettings({
                shuffleQuestions: !quizSettings.shuffleQuestions,
              })
            }
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Shuffle questions
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Present a different order on each attempt.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.shuffleQuestions ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <Field label="Passing score">
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <input
                type="range"
                min={0}
                max={100}
                value={quizSettings.passingScore}
                onChange={(event) =>
                  commitSettings({ passingScore: Number(event.target.value) })
                }
                className="w-full accent-[var(--accent-cyan)]"
              />
              <div className="mt-2 text-right font-display text-[20px] font-semibold text-[var(--text-primary)]">
                {quizSettings.passingScore}%
              </div>
            </div>
          </Field>
        </div>
      ) : view === "responses" ? (
        <div className="mx-auto max-w-[760px] p-6">
          <div data-spectra-card="result" className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-[var(--success)]" />
            <h3 className="mt-3 font-display text-[22px] font-semibold text-[var(--text-primary)]">
              No submitted responses yet
            </h3>
            <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[var(--text-secondary)]">
              Attempts will appear here with score, completion time, and
              per-question review. Use Preview to test the quiz without creating
              a response.
            </p>
            <button
              type="button"
              onClick={() => setView("preview")}
              className="mt-4 rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-medium text-[var(--bg-primary)]"
            >
              Open preview
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`grid min-h-[680px] ${mode === "tab" ? "lg:grid-cols-[310px_minmax(0,1fr)_220px]" : "grid-cols-1"}`}
        >
          <aside
            className={`${mode === "tab" ? "border-r" : "border-b"} border-[var(--border-default)] p-3`}
          >
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Questions ({questions.length})
            </div>
            <div className="space-y-2">
              {questions.map((question, index) => (
                <button
                  key={question.id}
                  type="button"
                  className={`grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border px-2 py-2 text-left ${
                    activeQuestion?.id === question.id
                      ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]"
                      : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                  }`}
                  onClick={() => setActiveQuestionId(question.id)}
                  data-ai-region={
                    pathTouches(aiChangedPaths, `/questions/${index}`) ||
                    undefined
                  }
                >
                  <span className="rounded-[6px] border border-[var(--border-default)] py-1 text-center text-[12px] text-[var(--text-secondary)]">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {question.prompt || "Untitled question"}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {
                        {
                          multiple_choice: "MCQ",
                          short_answer: "Short answer",
                          true_false: "True / False",
                          select_all: "Select all",
                          ordering: "Ordering",
                        }[question.type]
                      }
                    </span>
                  </span>
                  <GripVertical className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </button>
              ))}
            </div>
          </aside>
          <section
            data-ai-region={
              activeQuestion
                ? pathTouches(
                    aiChangedPaths,
                    `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}`,
                  ) || undefined
                : undefined
            }
            className={`min-w-0 ${mode === "tab" ? "border-r" : "border-b"} border-[var(--border-default)] p-4`}
          >
            {activeQuestion ? (
              <QuestionEditor
                question={activeQuestion}
                questionNumber={
                  questions.findIndex(
                    (question) => question.id === activeQuestion.id,
                  ) + 1
                }
                onChange={(patch) => updateQuestion(activeQuestion.id, patch)}
                onRemove={() => {
                  const next = questions.filter(
                    (question) => question.id !== activeQuestion.id,
                  );
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
                  <select
                    value={activeQuestion.difficulty ?? "medium"}
                    onChange={(event) =>
                      updateQuestion(activeQuestion.id, {
                        difficulty: event.target
                          .value as QuizQuestion["difficulty"],
                      })
                    }
                    className={inputClass()}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
                <Field label="Points">
                  <input
                    type="number"
                    value={activeQuestion.points ?? 1}
                    min={1}
                    onChange={(event) =>
                      updateQuestion(activeQuestion.id, {
                        points: Number(event.target.value),
                      })
                    }
                    className={inputClass()}
                  />
                </Field>
                <Field label="Time">
                  <input
                    type="number"
                    value={activeQuestion.timeLimitSeconds ?? 90}
                    min={0}
                    onChange={(event) =>
                      updateQuestion(activeQuestion.id, {
                        timeLimitSeconds: Number(event.target.value),
                      })
                    }
                    className={inputClass()}
                  />
                </Field>
                <Field label="Bloom's taxonomy">
                  <select
                    value={activeQuestion.bloomLevel ?? "remember"}
                    onChange={(event) =>
                      updateQuestion(activeQuestion.id, {
                        bloomLevel: event.target.value as NonNullable<
                          QuizQuestion["bloomLevel"]
                        >,
                      })
                    }
                    className={inputClass()}
                  >
                    <option value="remember">Remember</option>
                    <option value="understand">Understand</option>
                    <option value="apply">Apply</option>
                    <option value="analyze">Analyze</option>
                    <option value="evaluate">Evaluate</option>
                    <option value="create">Create</option>
                  </select>
                </Field>
                <label className="block cursor-pointer rounded-[8px] border border-dashed border-[var(--border-default)] p-4 text-center text-[12px] text-[var(--text-secondary)] transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] hover:bg-[var(--bg-hover)]">
                  <ImageIcon className="mx-auto mb-2 h-4 w-4" />
                  Add media reference
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file)
                        updateQuestion(activeQuestion.id, {
                          sourceRefs: Array.from(
                            new Set([
                              ...(activeQuestion.sourceRefs ?? []),
                              `Media: ${file.name}`,
                            ]),
                          ),
                        });
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
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
  tagDraft,
  onTagDraftChange,
  content,
  onChange,
  onArchive,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  content: unknown;
  onChange: (content: unknown) => void;
  onArchive?: () => Promise<void> | void;
}) {
  const [task, setTask] = useState(() => plannerTask(content));
  const [dueDate, setDueDate] = useState(dateInputValue(task.dueAt));
  const [dueTime, setDueTime] = useState(timeInputValue(task.dueAt));
  const [startDate, setStartDate] = useState(dateInputValue(task.startAt));
  const [startTime, setStartTime] = useState(timeInputValue(task.startAt));
  const [endDate, setEndDate] = useState(dateInputValue(task.endAt));
  const [endTime, setEndTime] = useState(timeInputValue(task.endAt));
  const scheduleDraftRef = useRef({
    dueDate,
    dueTime,
    startDate,
    startTime,
    endDate,
    endTime,
  });
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [newPlannerTag, setNewPlannerTag] = useState("");
  const [newSourceRef, setNewSourceRef] = useState("");

  useEffect(() => {
    const nextTask = plannerTask(content);
    const nextDates = {
      dueDate: dateInputValue(nextTask.dueAt),
      dueTime: timeInputValue(nextTask.dueAt),
      startDate: dateInputValue(nextTask.startAt),
      startTime: timeInputValue(nextTask.startAt),
      endDate: dateInputValue(nextTask.endAt),
      endTime: timeInputValue(nextTask.endAt),
    };
    setTask(nextTask);
    setDueDate(nextDates.dueDate);
    setDueTime(nextDates.dueTime);
    setStartDate(nextDates.startDate);
    setStartTime(nextDates.startTime);
    setEndDate(nextDates.endDate);
    setEndTime(nextDates.endTime);
    scheduleDraftRef.current = nextDates;
  }, [content]);

  function formatDescription(prefix: string, suffix = prefix) {
    const input = descriptionRef.current;
    if (!input) return;
    const current = task.description ?? "";
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = current.slice(start, end) || "text";
    const next = `${current.slice(0, start)}${prefix}${selected}${suffix}${current.slice(end)}`;
    commit({ ...task, description: next });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length,
      );
    });
  }

  function commit(
    next: PlannerTask,
    nextDates = { dueDate, dueTime, startDate, startTime, endDate, endTime },
  ) {
    const dueAt = nextDates.dueDate
      ? dateTimeValue(nextDates.dueDate, nextDates.dueTime || "12:00")
      : undefined;
    const startAt = dateTimeValue(nextDates.startDate, nextDates.startTime);
    const endAt = dateTimeValue(nextDates.endDate, nextDates.endTime);
    const full = { ...next, dueAt, startAt, endAt };
    setTask(full);
    onChange({ ...record(content), ...full });
  }

  function updateSchedule(patch: Partial<typeof scheduleDraftRef.current>) {
    const nextDates = { ...scheduleDraftRef.current, ...patch };
    scheduleDraftRef.current = nextDates;
    setDueDate(nextDates.dueDate);
    setDueTime(nextDates.dueTime);
    setStartDate(nextDates.startDate);
    setStartTime(nextDates.startTime);
    setEndDate(nextDates.endDate);
    setEndTime(nextDates.endTime);
    commit(task, nextDates);
  }

  const linked = task.linkedArtifactIds
    .map((artifactId) => artifacts.find((item) => item._id === artifactId))
    .filter((item): item is SpectraArtifact => Boolean(item));

  return (
    <div
      className={`spectra-planner-studio grid gap-5 ${mode === "tab" ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"}`}
    >
      <section className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <Field label="Task title">
          <input
            value={task.taskTitle || artifact.title}
            onChange={(event) =>
              commit({ ...task, taskTitle: event.target.value })
            }
            className={inputClass()}
            placeholder="What needs to be done?"
          />
        </Field>
        <Field label="Description">
          <div className="overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] focus-within:border-[color-mix(in_oklab,#d88922_45%,var(--border-default))]">
            <div
              className="flex h-10 items-center gap-1 border-b border-[var(--border-subtle)] px-2"
              aria-label="Description formatting"
            >
              <button
                type="button"
                className={iconButtonClass()}
                onClick={() => formatDescription("**")}
                aria-label="Bold description"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconButtonClass()}
                onClick={() => formatDescription("_")}
                aria-label="Italic description"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconButtonClass()}
                onClick={() => formatDescription("[", "](https://)")}
                aria-label="Link description"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={iconButtonClass()}
                onClick={() => formatDescription("\n- ", "")}
                aria-label="Add description list item"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                Supports Markdown
              </span>
            </div>
            <textarea
              ref={descriptionRef}
              value={task.description ?? ""}
              onChange={(event) =>
                commit({ ...task, description: event.target.value })
              }
              className="min-h-[136px] w-full resize-y bg-transparent px-3 py-3 text-[13px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              placeholder="What needs to happen?"
            />
          </div>
        </Field>
        <div
          className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-[160px_minmax(0,1fr)]" : "grid-cols-1"}`}
        >
          <Field label="Estimate (minutes)">
            <input
              type="number"
              min={1}
              value={task.estimateMinutes ?? ""}
              onChange={(event) =>
                commit({
                  ...task,
                  estimateMinutes: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
              className={inputClass()}
              placeholder="45"
            />
          </Field>
          <Field label="Progress note">
            <input
              value={task.progressNote ?? ""}
              onChange={(event) =>
                commit({ ...task, progressNote: event.target.value })
              }
              className={inputClass()}
              placeholder="Current blocker or next concrete step"
            />
          </Field>
        </div>
        <div
          className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-5" : "grid-cols-1"}`}
        >
          <Field label="Status">
            <select
              value={task.status}
              onChange={(event) =>
                commit({
                  ...task,
                  status: event.target.value as PlannerTask["status"],
                })
              }
              className={inputClass()}
            >
              <option value="todo">Todo</option>
              <option value="doing">In progress</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={task.priority}
              onChange={(event) =>
                commit({
                  ...task,
                  priority: event.target.value as PlannerTask["priority"],
                })
              }
              className={inputClass()}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onInput={(event) =>
                updateSchedule({ dueDate: event.currentTarget.value })
              }
              className={inputClass()}
            />
          </Field>
          <Field label="Due time">
            <input
              type="time"
              value={dueTime}
              disabled={task.allDay}
              onInput={(event) =>
                updateSchedule({ dueTime: event.currentTarget.value })
              }
              className={inputClass()}
            />
          </Field>
          <Field label="All day">
            <button
              type="button"
              className={`flex h-10 w-full items-center justify-between rounded-[8px] border border-[var(--border-default)] px-3 text-[13px] ${task.allDay ? "bg-[color-mix(in_oklab,#2fa66f_8%,var(--bg-primary))] text-[var(--text-primary)]" : "bg-[var(--bg-primary)] text-[var(--text-secondary)]"}`}
              onClick={() => commit({ ...task, allDay: !task.allDay })}
            >
              {task.allDay ? "Enabled" : "Disabled"}
              <span
                className={`h-5 w-9 rounded-full p-0.5 ${task.allDay ? "bg-[var(--success)]" : "bg-[var(--bg-secondary)]"}`}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white transition ${task.allDay ? "translate-x-4" : ""}`}
                />
              </span>
            </button>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Tags">
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
              {tagsFromDraft(tagDraft).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    onTagDraftChange(
                      tagsFromDraft(tagDraft)
                        .filter((item) => item !== tag)
                        .join(", "),
                    )
                  }
                  className="rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                  title={`Remove ${tag}`}
                >
                  {tag} <span aria-hidden="true">×</span>
                </button>
              ))}
              <input
                value={newPlannerTag}
                onChange={(event) => setNewPlannerTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !newPlannerTag.trim()) return;
                  event.preventDefault();
                  onTagDraftChange(
                    Array.from(
                      new Set([
                        ...tagsFromDraft(tagDraft),
                        newPlannerTag.trim(),
                      ]),
                    ).join(", "),
                  );
                  setNewPlannerTag("");
                }}
                className="h-7 min-w-[100px] flex-1 bg-transparent px-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                placeholder="Add tag"
                aria-label="New task tag"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newPlannerTag.trim()) return;
                  onTagDraftChange(
                    Array.from(
                      new Set([
                        ...tagsFromDraft(tagDraft),
                        newPlannerTag.trim(),
                      ]),
                    ).join(", "),
                  );
                  setNewPlannerTag("");
                }}
                className="rounded-[6px] px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              >
                Add
              </button>
            </div>
          </Field>
        </div>
        <div
          className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-2" : "grid-cols-1"}`}
        >
          <Field label="Starts">
            <div
              className={`grid gap-2 ${mode === "tab" ? "grid-cols-[1fr_110px]" : "grid-cols-1"}`}
            >
              <input
                type="date"
                value={startDate}
                onInput={(event) =>
                  updateSchedule({ startDate: event.currentTarget.value })
                }
                className={inputClass()}
              />
              <input
                type="time"
                value={startTime}
                onInput={(event) =>
                  updateSchedule({ startTime: event.currentTarget.value })
                }
                className={inputClass()}
              />
            </div>
          </Field>
          <Field label="Ends">
            <div
              className={`grid gap-2 ${mode === "tab" ? "grid-cols-[1fr_110px]" : "grid-cols-1"}`}
            >
              <input
                type="date"
                value={endDate}
                onInput={(event) =>
                  updateSchedule({ endDate: event.currentTarget.value })
                }
                className={inputClass()}
              />
              <input
                type="time"
                value={endTime}
                onInput={(event) =>
                  updateSchedule({ endTime: event.currentTarget.value })
                }
                className={inputClass()}
              />
            </div>
          </Field>
        </div>
        <TaskListEditor task={task} commit={commit} />
        <AttachmentEditor task={task} commit={commit} />
        <div className="mt-5">
          <Field label="Sources / provenance">
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
              {task.sourceRefs.map((sourceRef) => {
                const sourceArtifact = artifacts.find((item) => item._id === sourceRef);
                const label = sourceArtifact?.title ?? sourceRef;
                return (
                  <button
                    key={sourceRef}
                    type="button"
                    onClick={() => commit({ ...task, sourceRefs: task.sourceRefs.filter((item) => item !== sourceRef) })}
                    className="inline-flex max-w-full items-center gap-1 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                    title={`Remove source ${label}`}
                  >
                    <span className="truncate">{label}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                );
              })}
              <input
                value={newSourceRef}
                onChange={(event) => setNewSourceRef(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !newSourceRef.trim()) return;
                  event.preventDefault();
                  commit({ ...task, sourceRefs: Array.from(new Set([...task.sourceRefs, newSourceRef.trim()])) });
                  setNewSourceRef("");
                }}
                className="h-7 min-w-[150px] flex-1 bg-transparent px-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                placeholder="Add a source or linked artifact"
                aria-label="Add source"
              />
            </div>
          </Field>
        </div>
      </section>
      {mode === "tab" ? (
        <aside className="space-y-4">
          <SideCard title="Task blueprint">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#d88922_10%,var(--bg-primary))] text-[#d88922]">
                <CalendarCheck2 className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Planner task
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                  Active blueprint
                </div>
              </div>
              <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklab,var(--success)_11%,var(--bg-primary))] px-2 py-1 text-[10px] text-[var(--success)]">
                Active
              </span>
            </div>
          </SideCard>
          <SideCard title="Schedule">
            <MetricRow
              label="Starts"
              value={formatScheduleDateTime(task.startAt)}
            />
            <MetricRow
              label="Ends"
              value={formatScheduleDateTime(task.endAt)}
            />
            <MetricRow label="All day" value={task.allDay ? "Yes" : "No"} />
          </SideCard>
          <SideCard title="Linked to">
            <div className="space-y-2">
              {linked.map((item) => {
                const meta = blueprintMeta[item.blueprintKey];
                const Icon = meta.icon;
                return (
                  <div
                    key={item._id}
                    className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]"
                  >
                    <Icon className="h-4 w-4" style={{ color: meta.color }} />
                    {item.title}
                  </div>
                );
              })}
              {linked.length === 0 ? (
                <div className="text-[12px] text-[var(--text-secondary)]">
                  No linked artifacts.
                </div>
              ) : null}
              <select
                className={inputClass()}
                value=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  commit({
                    ...task,
                    linkedArtifactIds: Array.from(
                      new Set([...task.linkedArtifactIds, event.target.value]),
                    ),
                  });
                }}
              >
                <option value="">Link artifact</option>
                {artifacts
                  .filter(
                    (item) =>
                      item._id !== artifact._id &&
                      !task.linkedArtifactIds.includes(item._id),
                  )
                  .map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </div>
          </SideCard>
          <SideCard title="Reminders">
            <ReminderEditor task={task} commit={commit} />
          </SideCard>
          <SideCard title="Created">
            <MetricRow
              label="Created"
              value={formatShortDate(artifact.createdAt)}
            />
            <MetricRow
              label="Updated"
              value={formatShortDate(artifact.updatedAt)}
            />
          </SideCard>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] text-[13px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))]"
            onClick={() => (onArchive ? void onArchive() : undefined)}
            disabled={!onArchive}
          >
            <Archive className="h-4 w-4" />
            Move to trash
          </button>
        </aside>
      ) : null}
    </div>
  );
}

function ThreadReferenceStudio({ content }: { content: unknown }) {
  const threadId =
    typeof record(content).threadId === "string"
      ? (record(content).threadId as string)
      : "";
  if (threadId.trim()) {
    return (
      <div className="h-[min(760px,calc(100vh-230px))] min-h-[460px] overflow-hidden bg-[var(--bg-primary)]">
        <ThreadConversation
          threadId={threadId.trim()}
          compact
          showComposer={false}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-[var(--bg-primary)] p-8 text-center">
      <div className="max-w-[420px]">
        <MessageSquare className="mx-auto h-10 w-10 rounded-[10px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] p-2.5 text-[#8b6ff0]" />
        <div>
          <h3 className="mt-4 font-display text-[22px] font-semibold text-[var(--text-primary)]">
            Conversation unavailable
          </h3>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
            This older artifact is a disconnected reference, not a conversation.
            Keep a current run or place a chat thread to create a working thread
            artifact.
          </p>
        </div>
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  questionNumber,
  onChange,
  onRemove,
}: {
  question: QuizQuestion;
  questionNumber: number;
  onChange: (patch: Partial<QuizQuestion>) => void;
  onRemove: () => void;
}) {
  function updateOption(index: number, value: string) {
    const options = [...question.options];
    options[index] = value;
    onChange({
      options,
      correctAnswer:
        question.correctAnswer === question.options[index]
          ? value
          : question.correctAnswer,
    });
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">
          Question {questionNumber}
        </div>
        <button
          type="button"
          className={iconButtonClass()}
          onClick={onRemove}
          aria-label="Remove question"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <Field label="Type">
        <select
          value={question.type}
          onChange={(event) => {
            const type = event.target.value as QuizQuestion["type"];
            onChange({
              type,
              options:
                type === "true_false"
                  ? ["True", "False"]
                  : type !== "short_answer" && question.options.length === 0
                    ? ["", "", "", ""]
                    : question.options,
            });
          }}
          className={inputClass()}
        >
          <option value="multiple_choice">Multiple choice</option>
          <option value="true_false">True / false</option>
          <option value="select_all">Select all that apply</option>
          <option value="ordering">Ordering</option>
          <option value="short_answer">Short answer</option>
        </select>
      </Field>
      <div className="mt-4">
        <Field label="Question">
          <textarea
            value={question.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            className={textareaClass("min-h-[110px]")}
            placeholder="Write a clear question"
          />
        </Field>
      </div>
      {question.type !== "short_answer" ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
              Answer options
            </h4>
            <button
              type="button"
              className={smallActionClass()}
              onClick={() => onChange({ options: [...question.options, ""] })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add option
            </button>
          </div>
          <div className="space-y-2">
            {question.options.map((option, index) => (
              <div
                key={index}
                className="grid grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-2"
              >
                <button
                  type="button"
                  className={`flex h-8 w-8 items-center justify-center rounded-full border ${question.correctAnswer === option && option ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]"}`}
                  onClick={() => onChange({ correctAnswer: option })}
                  aria-label={`Mark option ${index + 1} correct`}
                >
                  {question.correctAnswer === option && option ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </button>
                <input
                  value={option}
                  onChange={(event) => updateOption(index, event.target.value)}
                  className={inputClass()}
                  placeholder={`Option ${index + 1}`}
                />
                <button
                  type="button"
                  className={iconButtonClass()}
                  onClick={() =>
                    onChange({
                      options: question.options.filter(
                        (_, candidate) => candidate !== index,
                      ),
                    })
                  }
                  aria-label="Remove option"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Field label="Correct answer">
            <select
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={`${inputClass()} mt-3`}
            >
              <option value="">Choose correct answer</option>
              {question.options.filter(Boolean).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
        </section>
      ) : (
        <div className="mt-4">
          <Field label="Expected answer">
            <input
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={inputClass()}
              placeholder="Short answer key"
            />
          </Field>
        </div>
      )}
      <div className="mt-4">
        <Field label="Explanation">
          <textarea
            value={question.explanation ?? ""}
            onChange={(event) => onChange({ explanation: event.target.value })}
            className={textareaClass("min-h-[110px]")}
            placeholder="Optional answer explanation"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Sources / provenance">
          <input
            value={(question.sourceRefs ?? []).join(", ")}
            onChange={(event) =>
              onChange({
                sourceRefs: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            className={inputClass()}
            placeholder="Textbook p. 42, class notes"
          />
        </Field>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Tags / topics">
          <input
            value={(question.tags ?? []).join(", ")}
            onChange={(event) =>
              onChange({
                tags: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            className={inputClass()}
            placeholder="glycolysis, basics"
          />
        </Field>
        <Field label="Standards">
          <input
            value={(question.standards ?? []).join(", ")}
            onChange={(event) =>
              onChange({
                standards: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            className={inputClass()}
            placeholder="IB Biology C1.2"
          />
        </Field>
      </div>
    </div>
  );
}

function TaskListEditor({
  task,
  commit,
}: {
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Subtasks {task.subtasks.filter((item) => item.done).length}/
          {task.subtasks.length}
        </h4>
        <button
          type="button"
          className={smallActionClass()}
          onClick={() =>
            commit({
              ...task,
              subtasks: [
                ...task.subtasks,
                { id: id("subtask"), title: "", done: false },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add subtask
        </button>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
        {(task.subtasks.length > 0
          ? task.subtasks
          : [{ id: "empty", title: "", done: false }]
        ).map((subtask) => (
          <div
            key={subtask.id}
            className="grid grid-cols-[32px_minmax(0,1fr)_34px] items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 last:border-b-0"
          >
            <button
              type="button"
              disabled={subtask.id === "empty"}
              aria-label={
                subtask.id === "empty"
                  ? "New subtask"
                  : subtask.done
                    ? `Mark ${subtask.title || "subtask"} incomplete`
                    : `Mark ${subtask.title || "subtask"} complete`
              }
              className="text-[var(--text-secondary)] disabled:opacity-35"
              onClick={() =>
                commit({
                  ...task,
                  subtasks: task.subtasks.map((item) =>
                    item.id === subtask.id
                      ? { ...item, done: !item.done }
                      : item,
                  ),
                })
              }
            >
              {subtask.done ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </button>
            <input
              value={subtask.title}
              onChange={(event) =>
                commit({
                  ...task,
                  subtasks:
                    subtask.id === "empty"
                      ? [
                          {
                            id: id("subtask"),
                            title: event.target.value,
                            done: false,
                          },
                        ]
                      : task.subtasks.map((item) =>
                          item.id === subtask.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                })
              }
              className="h-8 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              placeholder="Add the first subtask"
              aria-label="Subtask"
            />
            <button
              type="button"
              disabled={subtask.id === "empty"}
              aria-label={`Remove ${subtask.title || "subtask"}`}
              className="text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-0"
              onClick={() =>
                commit({
                  ...task,
                  subtasks: task.subtasks.filter(
                    (item) => item.id !== subtask.id,
                  ),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttachmentEditor({
  task,
  commit,
}: {
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Attachments
        </h4>
        <label className={`${smallActionClass()} cursor-pointer`}>
          <Plus className="h-3.5 w-3.5" />
          Attach
          <input
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length)
                commit({
                  ...task,
                  attachments: [
                    ...task.attachments,
                    ...files.map((file) => ({
                      id: id("attachment"),
                      name: file.name,
                      meta: `${Math.max(1, Math.round(file.size / 1024))} KB · ${file.type || "file"}`,
                    })),
                  ],
                });
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="space-y-2">
        {task.attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="grid grid-cols-[minmax(0,1fr)_130px_34px] gap-2"
          >
            <input
              value={attachment.name}
              onChange={(event) =>
                commit({
                  ...task,
                  attachments: task.attachments.map((item) =>
                    item.id === attachment.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                })
              }
              className={inputClass()}
              placeholder="Attachment name"
            />
            <input
              value={attachment.meta ?? ""}
              onChange={(event) =>
                commit({
                  ...task,
                  attachments: task.attachments.map((item) =>
                    item.id === attachment.id
                      ? { ...item, meta: event.target.value }
                      : item,
                  ),
                })
              }
              className={inputClass()}
              placeholder="Meta"
            />
            <button
              type="button"
              className={iconButtonClass()}
              onClick={() =>
                commit({
                  ...task,
                  attachments: task.attachments.filter(
                    (item) => item.id !== attachment.id,
                  ),
                })
              }
              aria-label="Remove attachment"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {task.attachments.length === 0 ? (
          <label className="block cursor-pointer rounded-[8px] border border-dashed border-[var(--border-default)] px-4 py-5 text-center text-[12px] text-[var(--text-secondary)] transition hover:border-[color-mix(in_oklab,#d88922_45%,var(--border-default))] hover:bg-[var(--bg-hover)]">
            Drop files here or click to attach
            <input
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length)
                  commit({
                    ...task,
                    attachments: files.map((file) => ({
                      id: id("attachment"),
                      name: file.name,
                      meta: `${Math.max(1, Math.round(file.size / 1024))} KB · ${file.type || "file"}`,
                    })),
                  });
                event.currentTarget.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}

function ReminderEditor({
  task,
  commit,
}: {
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      {task.reminders.map((reminder) => (
        <div
          key={reminder}
          className="flex items-center justify-between gap-2 rounded-[7px] border border-[var(--border-default)] px-2 py-2 text-[12px] text-[var(--text-primary)]"
        >
          <span className="truncate">{reminder}</span>
          <button
            type="button"
            onClick={() =>
              commit({
                ...task,
                reminders: task.reminders.filter((item) => item !== reminder),
              })
            }
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_34px] gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={inputClass()}
          placeholder="e.g. 30 min before"
        />
        <button
          type="button"
          className={iconButtonClass()}
          onClick={() => {
            if (!draft.trim()) return;
            commit({ ...task, reminders: [...task.reminders, draft.trim()] });
            setDraft("");
          }}
          aria-label="Add reminder"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StudioDetails({
  artifact,
  artifacts,
  tagDraft,
  onTagDraftChange,
}: {
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
}) {
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const placements = artifactPlacements(artifact);
  const links = linkedArtifacts(artifact, artifacts);
  const [durableLinks, setDurableLinks] = useState<SpectraArtifactLink[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [detailsTab, setDetailsTab] = useState<"details" | "history">(
    "details",
  );
  const [historyVersions, setHistoryVersions] = useState<SpectraArtifactVersion[]>([]);
  const visibleTags = tagsFromDraft(tagDraft);
  useEffect(() => {
    void getSpectraArtifactLinks(artifact._id)
      .then((result) => setDurableLinks(result.links))
      .catch(() => setDurableLinks([]));
  }, [artifact._id]);
  useEffect(() => {
    if (detailsTab !== "history") return;
    void getSpectraArtifactVersions(artifact._id)
      .then((result) => setHistoryVersions(result.versions))
      .catch(() => setHistoryVersions([]));
  }, [artifact._id, detailsTab]);
  const linkedIds = new Set(
    durableLinks.flatMap((link) =>
      link.artifact?.id ? [link.artifact.id] : [],
    ),
  );
  const suggestions = artifacts
    .filter(
      (candidate) =>
        candidate._id !== artifact._id && !linkedIds.has(candidate._id),
    )
    .map((candidate) => {
      const sharedWorkspace = artifactPlacements(candidate).some((placement) =>
        placements.some(
          (source) => source.workspaceId === placement.workspaceId,
        ),
      );
      const sharedTags = candidate.tags.filter((tag) =>
        artifact.tags.includes(tag),
      ).length;
      const titleWords = artifact.title
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3);
      const titleMatch = titleWords.some((word) =>
        `${candidate.title} ${candidate.summary ?? ""}`
          .toLowerCase()
          .includes(word),
      );
      return {
        candidate,
        score:
          Number(sharedWorkspace) * 5 +
          sharedTags * 3 +
          Number(titleMatch) * 2 +
          Number(candidate.blueprintKey === artifact.blueprintKey),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.candidate.updatedAt - a.candidate.updatedAt,
    )
    .slice(0, 3);

  async function confirmLink(target: SpectraArtifact) {
    setLinkingId(target._id);
    try {
      await postSpectra({
        action: "createArtifactLink",
        sourceArtifactId: artifact._id,
        targetArtifactId: target._id,
        relationType: "related",
        workspaceId: placements[0]?.workspaceId,
        explanation: "Confirmed from a related-artifact suggestion",
      });
      const result = await getSpectraArtifactLinks(artifact._id);
      setDurableLinks(result.links);
    } finally {
      setLinkingId(null);
    }
  }
  async function removeLink(linkId: string) {
    await postSpectra({ action: "removeArtifactLink", linkId });
    const result = await getSpectraArtifactLinks(artifact._id);
    setDurableLinks(result.links);
  }
  return (
    <aside className="spectra-studio-details overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="grid grid-cols-2 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 pt-1">
        <button
          type="button"
          onClick={() => setDetailsTab("details")}
          className={`h-11 border-b-2 text-[12px] font-semibold ${detailsTab === "details" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setDetailsTab("history")}
          className={`h-11 border-b-2 text-[12px] font-semibold ${detailsTab === "history" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          History
        </button>
      </div>
      {detailsTab === "details" ? (
        <div className="space-y-3 p-3">
          <SideCard title="Details">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
              <Icon className="h-4 w-4" style={{ color: meta.color }} />
              {meta.label}
              <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklab,var(--success)_11%,var(--bg-primary))] px-2 py-1 text-[11px] text-[var(--success)]">
                Active
              </span>
            </div>
          </SideCard>
          <SideCard title="Placement">
            <div className="space-y-2">
              {placements.length > 0 ? (
                placements.map((placement) => (
                  <div
                    key={placement.workspaceItemId}
                    className="rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] font-medium text-[var(--text-primary)]"
                  >
                    {placement.workspaceTitle}
                    <div className="text-[11px] font-normal text-[var(--text-secondary)]">
                      Workspace
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  Library inbox
                </div>
              )}
            </div>
          </SideCard>
          <SideCard title="Linked artifacts">
            <div className="space-y-2">
              {durableLinks.slice(0, 8).map((link) =>
                link.artifact ? (
                  <div
                    key={link._id}
                    className="group rounded-[7px] bg-[var(--bg-primary)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]"
                    data-link-direction={link.direction}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {link.artifact.title}
                      </span>
                      <span className="text-[9px] text-[var(--text-tertiary)]">
                        {link.direction === "incoming" ? "←" : "→"}{" "}
                        {link.relationType.replaceAll("_", " ")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeLink(link._id)}
                        className="text-[var(--text-tertiary)] opacity-0 transition hover:text-[var(--danger)] group-hover:opacity-100"
                        aria-label={`Remove link to ${link.artifact.title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {link.explanation ? (
                      <div className="mt-1 line-clamp-2 pl-3.5 text-[9px] leading-4 text-[var(--text-tertiary)]">
                        {link.explanation}
                      </div>
                    ) : null}
                  </div>
                ) : null,
              )}
              {links.slice(0, 4).map(({ artifact: linked }) => {
                const linkedMeta = blueprintMeta[linked.blueprintKey];
                const LinkedIcon = linkedMeta.icon;
                return (
                  <div
                    key={linked._id}
                    className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]"
                  >
                    <LinkedIcon
                      className="h-4 w-4"
                      style={{ color: linkedMeta.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {linked.title}
                    </span>
                  </div>
                );
              })}
              {links.length === 0 && durableLinks.length === 0 ? (
                <div className="text-[12px] text-[var(--text-secondary)]">
                  No confirmed links yet.
                </div>
              ) : null}
            </div>
          </SideCard>
          {suggestions.length > 0 ? (
            <SideCard title="Related suggestions">
              <div className="space-y-1.5">
                {suggestions.map(({ candidate }) => (
                  <div
                    key={candidate._id}
                    className="group flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 hover:bg-[var(--bg-primary)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
                      {candidate.title}
                    </span>
                    <button
                      type="button"
                      disabled={linkingId === candidate._id}
                      onClick={() => void confirmLink(candidate)}
                      className="rounded-[5px] px-1.5 py-1 text-[9px] font-medium text-[var(--accent-cyan)] opacity-70 hover:bg-[var(--bg-hover)] group-hover:opacity-100"
                    >
                      {linkingId === candidate._id
                        ? "Linking…"
                        : "Confirm link"}
                    </button>
                  </div>
                ))}
              </div>
            </SideCard>
          ) : null}
          {artifact.createdFrom ? (
            <SideCard title="Provenance">
              <div className="text-[11px] leading-5 text-[var(--text-secondary)]">
                <div className="font-medium text-[var(--text-primary)]">
                  {artifact.createdFrom.contextSummary ??
                    `Created from ${artifact.createdFrom.source}`}
                </div>
                {artifact.createdFrom.sourceArtifactIds?.length ? (
                  <div className="mt-1">
                    Used {artifact.createdFrom.sourceArtifactIds.length} source
                    artifact
                    {artifact.createdFrom.sourceArtifactIds.length === 1
                      ? ""
                      : "s"}
                  </div>
                ) : null}
                {artifact.createdFrom.threadId ? (
                  <div>Includes conversation context</div>
                ) : null}
                {artifact.createdFrom.sourceAttachmentNames?.length ? (
                  <div>
                    {artifact.createdFrom.sourceAttachmentNames.length}{" "}
                    attachment
                    {artifact.createdFrom.sourceAttachmentNames.length === 1
                      ? ""
                      : "s"}
                  </div>
                ) : null}
              </div>
            </SideCard>
          ) : null}
          <SideCard title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
                  data-artifact-tag={tag}
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onTagDraftChange(
                        visibleTags.filter((item) => item !== tag).join(", "),
                      )
                    }
                    aria-label={`Remove ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <input
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newTag.trim()) {
                    event.preventDefault();
                    onTagDraftChange(
                      Array.from(new Set([...visibleTags, newTag.trim()])).join(
                        ", ",
                      ),
                    );
                    setNewTag("");
                  }
                }}
                className="h-8 min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                placeholder="Add a tag"
              />
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  if (!newTag.trim()) return;
                  onTagDraftChange(
                    Array.from(new Set([...visibleTags, newTag.trim()])).join(
                      ", ",
                    ),
                  );
                  setNewTag("");
                }}
                aria-label="Add tag"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </SideCard>
        </div>
      ) : (
        <div className="p-3">
          <SideCard title="History">
            <div className="space-y-2">
              {historyVersions.map((version, index) => (
                <div key={version._id} className="rounded-[8px] bg-[var(--bg-primary)] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
                    <History className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                    {index === 0 ? "Current saved version" : version.summary || "Saved version"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>{version.source === "ai" ? "Spectra edit" : "Manual save"}</span>
                    <span>{formatRelativeTime(version.createdAt)}</span>
                  </div>
                </div>
              ))}
              {historyVersions.length === 0 ? <p className="text-[11px] leading-5 text-[var(--text-secondary)]">No saved versions yet.</p> : null}
            </div>
          </SideCard>
        </div>
      )}
    </aside>
  );
}

function CardFace({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </div>
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
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <strong className="font-medium text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={toolbarClass(active)}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

function ToolbarTextButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={toolbarClass(active)}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={iconButtonClass()}
        onClick={onClick}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
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
    active
      ? "bg-[var(--text-primary)] text-[var(--bg-primary)]"
      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;
}

function tabButtonClass(active: boolean) {
  return `h-9 rounded-[8px] px-3 text-[13px] font-medium transition ${active ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:text-[var(--text-tertiary)]"}`;
}
