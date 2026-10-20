"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { fileKind, type TaskStatus, type WorkPreview } from "../artifacts/work-preview";
import { PageThumbnail } from "../whiteboard/page-thumbnail";
import { sideClick } from "./side-open";
import { GhostLines, WorkingMark } from "@/components/ui/skeleton";

/*
 * A work as an index card (LANGUAGE.md, "Cards"): a tab in its type's colour
 * names what it is, and the face shows what is in it — the opening lines of a
 * document, a fanned deck, the first question of a quiz. Nothing on a desk
 * of these needs a generic icon to be told apart.
 *
 * `WorkCard` is the card as a link (Home, search). Surfaces with their own
 * gestures — the Library board selects, drags and opens menus — wrap
 * `WorkCardBody` in their own element instead.
 */

export type WorkCardContent = {
  type: PresentedWorkType;
  title: string;
  /** `undefined` while it is being read; `null` when the work has nothing to show. */
  preview: WorkPreview | null | undefined;
  summary?: string;
  /** Where it lives, e.g. its workspace. */
  place?: string;
  when?: string;
  /** Spectra is working on it right now. */
  live?: boolean;
};

/**
 * The colour variables a card's tab, face and preview read: its kind's, or,
 * on a view across every place (Home, the Library's shelf), the ink of the
 * place it lives in.
 */
export function workCardStyle(type: PresentedWorkType, ink?: string | null) {
  if (ink) return { "--work-hue": ink, "--work-tint": `color-mix(in oklab, ${ink} 16%, var(--card-paper))` } as CSSProperties;
  const meta = workTypeMeta[type];
  return { "--work-hue": meta.color, "--work-tint": meta.soft } as CSSProperties;
}

export function WorkCard({
  href,
  onOpen,
  className,
  ink,
  ...content
}: WorkCardContent & {
  href: string;
  /** Opens it beside the page; the address stays for a new tab. */
  onOpen?: () => void;
  className?: string;
  ink?: string | null;
}) {
  return (
    <Link href={href} prefetch={false} onClick={onOpen ? sideClick(onOpen) : undefined} data-work-card={content.type} style={workCardStyle(content.type, ink)} className={cn("work-card group", className)}>
      <WorkCardBody {...content} />
    </Link>
  );
}

export function WorkCardBody({
  type,
  title,
  preview,
  summary,
  place,
  when,
  live,
  marks,
  status,
  actions,
  bare = false,
}: WorkCardContent & {
  /** Small signs beside the type on the tab, e.g. that it is shared. */
  marks?: ReactNode;
  /** A live line under the preview: what Spectra is doing to it now. */
  status?: ReactNode;
  /** Controls at the end of the foot. */
  actions?: ReactNode;
  /** The face alone, where the tabs above it are someone else's (a stack). */
  bare?: boolean;
}) {
  const meta = workTypeMeta[type];
  return (
    <>
      {bare ? null : (
        <span className="work-card-tab">
          <Icon name={meta.glyph} size={13} />
          {meta.label}
          {marks}
          {live ? <WorkingMark label="Spectra is working on this" className="ml-0.5" /> : null}
        </span>
      )}
      <span className="work-card-face">
        <span data-row-title className="work-card-title">
          {title}
        </span>
        <span className="work-card-preview" aria-hidden>
          <PreviewFace type={type} title={title} preview={preview} summary={summary} live={live} />
        </span>
        {status}
        <span className="work-card-foot">
          {place ? <span className="min-w-0 truncate">{place}</span> : null}
          <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
            {preview ? <span>{previewSize(preview)}</span> : null}
            {when ? <span>{when}</span> : null}
          </span>
          {actions}
        </span>
      </span>
    </>
  );
}

/** A new document's own prompt, which is not yet anything written. */
const BLANK_TEXT = /^(start writing here\.?)?$/i;

/** Nothing written yet: no preview, or only the title and the new document's prompt. */
function isBlank(preview: WorkPreview | null, title: string) {
  if (!preview) return true;
  if (preview.kind !== "text") return false;
  const heading = preview.heading?.trim();
  return (!heading || heading === title.trim()) && BLANK_TEXT.test(preview.lines.join(" ").trim());
}

function PreviewFace({ type, title, preview, summary, live }: { type: PresentedWorkType; title: string; preview: WorkPreview | null | undefined; summary?: string; live?: boolean }) {
  if (preview === undefined) return <PreviewGhost />;
  // Spectra is writing a work that has nothing in it yet: the lines it will take, as a skeleton.
  if (live && isBlank(preview, title)) return <GhostLines count={4} className="pt-1" />;
  if (!preview) {
    const kind = type === "resource" ? fileKind(title) : null;
    if (kind) return <span className="work-preview-file">{kind}</span>;
    return summary ? <span className="work-preview-text line-clamp-4">{summary}</span> : <span className="work-preview-empty">Nothing in it yet</span>;
  }
  switch (preview.kind) {
    case "text":
      return (
        <span className="work-preview-text">
          {/* The card already wears the title; a body that opens with it again starts at what follows. */}
          {preview.heading && preview.heading.trim() !== title.trim() ? <span className="work-preview-heading">{preview.heading}</span> : null}
          {preview.lines.map((line, index) => (
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </span>
      );
    case "cards":
      return (
        <span className="work-preview-deck">
          <span className="work-preview-deck-card" data-depth="2" />
          <span className="work-preview-deck-card" data-depth="1" />
          <span className="work-preview-deck-card" data-depth="0">
            <span className="line-clamp-3">{preview.fronts[0] || "A blank card"}</span>
          </span>
        </span>
      );
    case "questions":
      return (
        <span className="work-preview-quiz">
          <span className="line-clamp-2 font-medium text-[var(--text-primary)]">{preview.first || "An unwritten question"}</span>
          {preview.options.map((option, index) => (
            <span key={index} className="work-preview-option">
              {option}
            </span>
          ))}
        </span>
      );
    case "tasks":
      return (
        <span className="work-preview-tasks">
          {preview.items.map((item, index) => (
            <span key={index} data-done={item.done || undefined} className="work-preview-task">
              {item.title}
            </span>
          ))}
        </span>
      );
    case "code":
      return (
        <span className="work-preview-code">
          {preview.lines.map((line, index) => (
            <span key={index} className="block whitespace-pre">
              {line || " "}
            </span>
          ))}
        </span>
      );
    case "slides":
      return (
        <span className="work-preview-slides">
          <span className="work-preview-slide">{preview.titles[0] ?? ""}</span>
        </span>
      );
    case "grid":
      return (
        <span className="work-preview-grid">
          {preview.rows.map((row, rowIndex) => (
            <span key={rowIndex} className="work-preview-grid-row" data-head={rowIndex === 0 || undefined}>
              {row.map((cell, cellIndex) => (
                <span key={cellIndex} data-number={/^-?[\d.,]+%?$/.test(cell) || undefined}>
                  {cell}
                </span>
              ))}
            </span>
          ))}
        </span>
      );
    case "board":
      return <PageThumbnail nodes={preview.nodes} edges={preview.edges} className="work-preview-board" />;
    case "task":
      return <TaskFace task={preview} />;
    case "exchange":
      return (
        <span className="work-preview-exchange">
          <span className="work-preview-ask line-clamp-2">{preview.ask}</span>
          {preview.answer ? <span className="work-preview-answer line-clamp-3">{preview.answer}</span> : null}
        </span>
      );
  }
}

const TASK_STATUS: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", done: "Done" };

/** A task: the day it is due as a torn-off calendar leaf, where it stands, and how many of its steps are done. */
function TaskFace({ task }: { task: Extract<WorkPreview, { kind: "task" }> }) {
  const due = task.dueAt ? new Date(task.dueAt) : null;
  return (
    <span className="work-preview-task-face" data-status={task.status}>
      {due ? (
        <span className="work-preview-leaf">
          <span className="work-preview-leaf-month">{due.toLocaleDateString(undefined, { month: "short" })}</span>
          <span className="work-preview-leaf-day">{due.getDate()}</span>
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="work-preview-task-status">
          {TASK_STATUS[task.status]}
          {task.priority === "high" ? <span className="work-preview-task-priority">High priority</span> : null}
        </span>
        {task.note ? <span className="work-preview-text mt-1 line-clamp-2">{task.note}</span> : null}
        {task.steps.total ? (
          <span className="work-preview-steps">
            <span className="work-preview-steps-track">
              <span style={{ width: `${(task.steps.done / task.steps.total) * 100}%` }} />
            </span>
            {task.steps.done} of {task.steps.total}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** How much is in it, where the preview can only show the start. */
function previewSize(preview: WorkPreview) {
  if (preview.kind === "cards") return plural(preview.count, "card");
  if (preview.kind === "questions") return plural(preview.count, "question");
  if (preview.kind === "slides") return plural(preview.count, "slide");
  if (preview.kind === "board" && preview.pages > 1) return plural(preview.pages, "page");
  return null;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The shape of a preview, held while the work is read (LIFE.md: never a blank, never a jump). */
function PreviewGhost() {
  return (
    <span data-life-ghost className="block space-y-2 pt-1">
      {[92, 78, 86, 54].map((width, index) => (
        <span key={index} data-life-ghost-bar className="block h-2 animate-pulse rounded-full bg-[var(--bg-tertiary)]" style={{ width: `${width}%` }} />
      ))}
    </span>
  );
}
