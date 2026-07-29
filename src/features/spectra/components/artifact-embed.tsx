"use client";

import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  LockKeyhole,
  Maximize2,
  Minimize2,
  RotateCw,
  Send,
  X,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { SpectraArtifactEmbed } from "../data/api";
import { blueprintMeta } from "./artifact-card";
import { LiveCodeRuntime } from "./live-code-runtime";
import { PublishedCodeRuntime } from "./published-code-runtime";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function textFrom(value: unknown, limit = 360): string {
  if (typeof value === "string") return value.slice(0, limit);
  if (Array.isArray(value))
    return value
      .map((entry) => textFrom(entry, limit))
      .filter(Boolean)
      .join(" · ")
      .slice(0, limit);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>)
      .map((entry) => textFrom(entry, limit))
      .filter(Boolean)
      .join(" ")
      .slice(0, limit);
  return value === undefined || value === null
    ? ""
    : String(value).slice(0, limit);
}

function ContentAdapter({ embed }: { embed: SpectraArtifactEmbed }) {
  const source = embed.source;
  const type = source?.blueprintKey;
  const content = record(embed.source?.snapshot?.content);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const canInteract =
    embed.effectiveInteraction === "interact" ||
    embed.effectiveInteraction === "edit";
  if (!type || !source) return null;

  if (type === "document") {
    const blocks = records(content.blocks).slice(
      0,
      embed.mode === "compact" ? 2 : 8,
    );
    return (
      <div className="space-y-2.5">
        {blocks.map((block, index) => (
          <p
            key={String(block.id ?? index)}
            className={
              block.type === "heading"
                ? "font-display text-[16px] font-semibold text-[var(--text-primary)]"
                : "text-[12px] leading-5 text-[var(--text-secondary)]"
            }
          >
            {textFrom(block.text ?? block.content) || "Empty block"}
          </p>
        ))}
        {blocks.length === 0 ? (
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Empty document
          </p>
        ) : null}
      </div>
    );
  }

  if (type === "flashcard_deck") {
    const cards = records(content.cards);
    const card = cards[Math.min(activeIndex, Math.max(0, cards.length - 1))];
    if (embed.mode === "expanded" && !canInteract) {
      return (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.slice(0, 4).map((entry, index) => (
            <div
              key={String(entry.id ?? index)}
              className="min-h-[112px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3.5"
            >
              <span className="text-[8px] font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
                {index % 2 === 0 ? "Front" : "Back"}
              </span>
              <p className="mt-2 font-display text-[13px] leading-5 text-[var(--text-primary)]">
                {textFrom(index % 2 === 0 ? entry.front : entry.back) ||
                  "Empty card"}
              </p>
            </div>
          ))}
          {cards.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Empty deck
            </p>
          ) : null}
        </div>
      );
    }
    return (
      <div>
        <button
          type="button"
          disabled={!canInteract}
          onClick={() => setRevealed((value) => !value)}
          className="flex min-h-[116px] w-full items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 text-center disabled:cursor-default"
        >
          <span>
            <span className="block text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--text-tertiary)]">
              {revealed ? "Answer" : "Prompt"}
            </span>
            <span className="mt-2 block text-[15px] font-medium leading-6 text-[var(--text-primary)]">
              {textFrom(revealed ? card?.back : card?.front) || "Empty card"}
            </span>
            {!canInteract ? (
              <span className="mt-2 block text-[8px] text-[var(--text-tertiary)]">
                Read-only preview
              </span>
            ) : null}
          </span>
        </button>
        {embed.mode === "expanded" && cards.length > 1 ? (
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setActiveIndex((value) => Math.max(0, value - 1));
                setRevealed(false);
              }}
              disabled={activeIndex === 0}
              className="rounded-[6px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[9px] text-[var(--text-tertiary)]">
              {activeIndex + 1} / {cards.length}
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveIndex((value) =>
                  Math.min(cards.length - 1, value + 1),
                );
                setRevealed(false);
              }}
              disabled={activeIndex >= cards.length - 1}
              className="rounded-[6px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === "quiz") {
    const questions = records(content.questions);
    const question =
      questions[Math.min(activeIndex, Math.max(0, questions.length - 1))];
    const optionIds = Array.isArray(question?.optionIds)
      ? question.optionIds
      : [];
    const options = Array.isArray(question?.options)
      ? question.options.map((option, index) => ({
          id:
            typeof optionIds[index] === "string"
              ? optionIds[index]
              : `${String(question?.id ?? activeIndex)}:option:${index + 1}`,
          text: textFrom(option),
        }))
      : [];
    if (embed.mode === "compact" && !canInteract)
      return (
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">
              {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"}
            </div>
            <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
              Formative practice · responses stay separate
            </p>
          </div>
          <span className="rounded-[6px] border border-[var(--border-default)] px-2 py-1 text-[9px] font-medium text-[var(--text-secondary)]">
            Preview
          </span>
        </div>
      );
    return (
      <div>
        <p className="text-[13px] font-semibold leading-5 text-[var(--text-primary)]">
          {textFrom(question?.prompt) || "Empty question"}
        </p>
        <div className="mt-3 space-y-1.5">
          {options.map((option, index) => {
            const id = option.id;
            return (
              <button
                type="button"
                disabled={!canInteract}
                key={id}
                onClick={() => setSelected(id)}
                className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[11px] disabled:cursor-default ${selected === id ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)] enabled:hover:border-[var(--border-default)]"}`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[8px]">
                  {String.fromCharCode(65 + index)}
                </span>
                {option.text}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[8px] text-[var(--text-tertiary)]">
          Practice only · responses are separate from artifact content
        </p>
      </div>
    );
  }

  if (type === "planner_task") {
    if (embed.mode === "compact")
      return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[11px] font-semibold capitalize text-[var(--text-primary)]">
            {String(content.status ?? "todo").replaceAll("_", " ")}
          </span>
          <span className="text-[9px] capitalize text-[var(--text-tertiary)]">
            {String(content.priority ?? "medium")} priority
          </span>
          <span className="ml-auto text-[9px] text-[var(--text-secondary)]">
            {typeof content.dueAt === "number"
              ? new Date(content.dueAt).toLocaleString()
              : "No due date"}
          </span>
        </div>
      );
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric
          label="Status"
          value={String(content.status ?? "todo").replaceAll("_", " ")}
        />
        <Metric label="Priority" value={String(content.priority ?? "medium")} />
        <Metric
          label="Due"
          value={
            typeof content.dueAt === "number"
              ? new Date(content.dueAt).toLocaleString()
              : "No date"
          }
        />
      </div>
    );
  }

  if (type === "presentation") {
    const slides = records(content.slides);
    const slide = slides[Math.min(activeIndex, Math.max(0, slides.length - 1))];
    return (
      <div>
        <div className="aspect-video rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-[8%]">
          <h4 className="font-display text-[clamp(15px,2vw,26px)] font-semibold text-[var(--text-primary)]">
            {textFrom(slide?.title) || "Untitled slide"}
          </h4>
          <p className="mt-3 max-w-[76%] text-[10px] leading-4 text-[var(--text-secondary)]">
            {textFrom(slide?.objects, 220)}
          </p>
        </div>
        {embed.mode === "expanded" && slides.length > 1 ? (
          <div className="mt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}
              disabled={activeIndex === 0}
              className="disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[9px] text-[var(--text-tertiary)]">
              Slide {activeIndex + 1} of {slides.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveIndex((value) =>
                  Math.min(slides.length - 1, value + 1),
                )
              }
              disabled={activeIndex >= slides.length - 1}
              className="disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === "sheets") {
    const sheet = records(content.sheets)[0];
    const cells = record(sheet?.cells);
    const entries = Object.entries(cells).slice(
      0,
      embed.mode === "compact" ? 12 : 40,
    );
    return (
      <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
        <div className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[9px] font-semibold text-[var(--text-secondary)]">
          {String(sheet?.name ?? "Sheet 1")}
        </div>
        <div className="grid grid-cols-4 gap-px bg-[var(--border-subtle)]">
          {entries.map(([address, value]) => (
            <div
              key={address}
              className="min-h-9 bg-[var(--bg-primary)] px-2 py-1"
            >
              <span className="block text-[7px] text-[var(--text-tertiary)]">
                {address}
              </span>
              <span className="block truncate text-[10px] text-[var(--text-primary)]">
                {textFrom(record(value).value ?? value, 40)}
              </span>
            </div>
          ))}
          {entries.length === 0 ? (
            <div className="col-span-4 p-6 text-center text-[10px] text-[var(--text-tertiary)]">
              Empty range
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (type === "code") {
    if (embed.runtimeBuild) {
      return (
        <PublishedCodeRuntime
          title={embed.source?.title ?? "Interactive visualisation"}
          build={embed.runtimeBuild}
          compact={embed.mode === "compact"}
          resources={embed.runtimeResources}
          allowInteraction={canInteract}
        />
      );
    }
    return (
      <LiveCodeRuntime
        artifactId={source.artifactId}
        title={source.title ?? "Interactive visualisation"}
        content={content}
        compact={embed.mode === "compact"}
        allowInteraction={canInteract}
        resources={embed.runtimeResources}
      />
    );
  }

  if (type === "whiteboard") {
    const nodes = records(content.nodes).slice(
      0,
      embed.mode === "compact" ? 8 : 24,
    );
    return (
      <div className="relative min-h-[190px] overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[radial-gradient(circle_at_1px_1px,var(--border-subtle)_1px,transparent_0)] bg-[size:18px_18px]">
        {nodes.map((node, index) => (
          <div
            key={String(node.id ?? index)}
            className="absolute max-w-[120px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[8px] text-[var(--text-primary)] shadow-sm"
            style={{
              left: `${8 + ((index * 23) % 70)}%`,
              top: `${10 + ((index * 31) % 68)}%`,
            }}
          >
            {textFrom(node.content, 70) || String(node.type ?? "Node")}
          </div>
        ))}
      </div>
    );
  }

  if (type === "timetable") {
    const events = records(content.events).slice(
      0,
      embed.mode === "compact" ? 3 : 8,
    );
    return (
      <div className="space-y-1.5">
        {events.map((event, index) => (
          <div
            key={String(event.id ?? index)}
            className="flex items-center gap-3 rounded-[7px] border border-[var(--border-subtle)] px-3 py-2"
          >
            <CalendarDays className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                {textFrom(event.title) || "Event"}
              </div>
              <div className="text-[8px] text-[var(--text-tertiary)]">
                {typeof event.start === "string"
                  ? new Date(event.start).toLocaleString()
                  : typeof event.startAt === "number"
                    ? new Date(event.startAt).toLocaleString()
                    : "Time not set"}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 ? (
          <p className="text-[10px] text-[var(--text-tertiary)]">
            No events in this view.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 text-[11px] leading-5 text-[var(--text-secondary)]">
      {textFrom(content, embed.mode === "compact" ? 260 : 900) ||
        "No preview content"}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--bg-primary)] p-3">
      <div className="text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 text-[12px] font-semibold capitalize text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

export function ArtifactEmbed({
  embed,
  busy = false,
  onOpenSource,
  onRetry,
  onModeChange,
  onRequestAccess,
  onCancelAccessRequest,
  onUseLiveVersion,
}: {
  embed: SpectraArtifactEmbed;
  busy?: boolean;
  onOpenSource?: (artifactId: string) => void;
  onRetry?: () => void;
  onModeChange?: (mode: "compact" | "expanded") => void;
  onRequestAccess?: () => void;
  onCancelAccessRequest?: (requestId: string) => void;
  onUseLiveVersion?: () => void;
}) {
  const meta = embed.source ? blueprintMeta[embed.source.blueprintKey] : null;
  const Icon = meta?.icon ?? FileQuestion;
  const status =
    embed.state === "no_access" && embed.accessRequest
      ? {
          icon: Send,
          title: "Access requested",
          detail:
            "The source owner will decide whether to grant access. This embed unlocks automatically after approval.",
        }
      : embed.state === "no_access"
        ? {
            icon: LockKeyhole,
            title: "Source access required",
            detail:
              "The container does not grant source access. No title, preview, comments, or presence has been exposed.",
          }
        : embed.state === "deleted"
          ? {
              icon: AlertCircle,
              title: "Source was deleted",
              detail:
                "The surrounding artifact is unchanged, but this projection is no longer available.",
            }
          : embed.state === "version_unavailable"
            ? {
                icon: AlertCircle,
                title: "Pinned version unavailable",
                detail:
                  "The retained source version is missing or failed its integrity check.",
              }
            : null;

  if (status) {
    const StatusIcon = status.icon;
    return (
      <section className="rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-secondary)_82%,var(--bg-elevated))] px-4 py-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
            <StatusIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">
              {status.title}
            </div>
            <p className="mt-0.5 max-w-[620px] text-[10px] leading-4 text-[var(--text-secondary)]">
              {status.detail}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
            {embed.state === "no_access" &&
            embed.canRequestAccess &&
            onRequestAccess ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRequestAccess}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-[9px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                <Send className="h-3 w-3" />
                Request access
              </button>
            ) : null}
            {embed.state === "no_access" &&
            embed.accessRequest &&
            onCancelAccessRequest ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onCancelAccessRequest(embed.accessRequest!.requestId)
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] px-2.5 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
              >
                <X className="h-3 w-3" />
                Cancel request
              </button>
            ) : null}
            {embed.state === "version_unavailable" &&
            embed.canConfigure &&
            onUseLiveVersion ? (
              <button
                type="button"
                disabled={busy}
                onClick={onUseLiveVersion}
                className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-[9px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                Use live source
              </button>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRetry}
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
                aria-label="Retry embed"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }
  if (!embed.source || !meta) return null;
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_1px_2px_rgba(28,24,18,0.025)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5 sm:px-4">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--embed-accent)_9%,var(--bg-secondary))]"
          style={
            { "--embed-accent": meta.color, color: meta.color } as CSSProperties
          }
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-[140px] flex-1">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
            {embed.source.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            <span>{meta.label}</span>
            <span>·</span>
            <span>{embed.mode === "compact" ? "Compact" : "Expanded"}</span>
            <span>·</span>
            <span>{embed.versionPolicy === "pinned" ? "Pinned" : "Live"}</span>
            {embed.state === "archived" ? (
              <>
                <span>·</span>
                <span className="text-[var(--warning)]">Archived</span>
              </>
            ) : null}
            {embed.effectiveInteraction === "read" ? (
              <>
                <span>·</span>
                <span>Read-only</span>
              </>
            ) : null}
          </div>
        </div>
        {onModeChange ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onModeChange(embed.mode === "compact" ? "expanded" : "compact")
            }
            className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
            aria-label={
              embed.mode === "compact" ? "Expand embed" : "Collapse embed"
            }
          >
            {embed.mode === "compact" ? (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                Expand
              </>
            ) : (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                Collapse
              </>
            )}
          </button>
        ) : null}
        {onOpenSource ? (
          <button
            type="button"
            onClick={() => onOpenSource(embed.source!.artifactId)}
            className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[9px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Open source
            <ArrowUpRight className="h-3 w-3" />
          </button>
        ) : null}
      </header>
      <div className={embed.mode === "compact" ? "p-3.5" : "p-4 sm:p-5"}>
        <ContentAdapter embed={embed} />
      </div>
      {embed.source.summary && embed.mode === "expanded" ? (
        <footer className="border-t border-[var(--border-subtle)] px-4 py-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
          {embed.source.summary}
        </footer>
      ) : null}
    </section>
  );
}
