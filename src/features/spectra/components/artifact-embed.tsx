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
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import type { SpectraArtifactEmbed } from "../data/api";
import { workTypeMeta } from "./artifact-card";
import { LiveCodeRuntime } from "./live-code-runtime";
import { PublishedCodeRuntime } from "./published-code-runtime";
import { isArtifactTypeKey } from "../artifacts/registry";
import { getWorkReferenceContract, validateReferenceView } from "../references";
import { embedCapabilityEnabled } from "../capabilities";
import { useSpectraMotion } from "../motion/motion-level";
import { transitionFor } from "../motion/grammar";
import { ArtifactEmbedQuiz } from "./artifact-embed-quiz";
import { shouldMountArtifactEmbedRuntime } from "./artifact-embed-runtime";
import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { normalizePlanContent } from "../plan/model";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

/* Rich fields (quiz prompts, option text, card faces) are stored as HTML by
   their studios. An embed preview is a *summary*, so it renders text — never
   injected markup and never the raw tags the reader would otherwise see. */
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function plainTextFromRichValue(source: string) {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#")) {
        const code =
          entity[1]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0
          ? String.fromCodePoint(code)
          : match;
      }
      return HTML_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function textFrom(value: unknown, limit = 360): string {
  if (typeof value === "string")
    return (
      /<[a-z!/][^>]*>/i.test(value) ? plainTextFromRichValue(value) : value
    ).slice(0, limit);
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
  const effectiveInteraction = embed.effectiveInteraction ?? embed.interaction;
  if (!type || !source || !isArtifactTypeKey(type)) return null;
  const contract = getWorkReferenceContract(type);
  const requestedView =
    typeof embed.displayPreferences?.view === "string"
      ? embed.displayPreferences.view
      : undefined;
  const targetKind =
    contract.targets.find(
      (target) =>
        !requestedView ||
        (target.views as readonly string[]).includes(requestedView),
    )?.kind ?? contract.targets[0]!.kind;
  const activeView = validateReferenceView(type, targetKind, requestedView)
    ? requestedView
    : contract.targets[0]!.views[0];

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
    const canReveal = embedCapabilityEnabled(
      "flashcard_deck",
      effectiveInteraction,
      "study.reveal",
    );
    const canNavigate = embedCapabilityEnabled(
      "flashcard_deck",
      effectiveInteraction,
      "study.navigate",
    );
    const cards = records(content.cards);
    const card = cards[Math.min(activeIndex, Math.max(0, cards.length - 1))];
    if (embed.mode === "expanded" && !canReveal) {
      return (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.slice(0, 4).map((entry, index) => (
            <div
              key={String(entry.id ?? index)}
              className="min-h-[112px] rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3.5"
            >
              <span className="text-micro font-semibold uppercase tracking-[.11em] text-[var(--text-tertiary)]">
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
          disabled={!canReveal}
          onClick={() => setRevealed((value) => !value)}
          className="flex min-h-[116px] w-full items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 text-center disabled:cursor-default"
        >
          <span>
            <span className="block text-micro font-semibold uppercase tracking-[.12em] text-[var(--text-tertiary)]">
              {revealed ? "Answer" : "Prompt"}
            </span>
            <span className="mt-2 block text-[15px] font-medium leading-6 text-[var(--text-primary)]">
              {textFrom(revealed ? card?.back : card?.front) || "Empty card"}
            </span>
            {!canReveal ? (
              <span className="mt-2 block text-micro text-[var(--text-tertiary)]">
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
              disabled={!canNavigate || activeIndex === 0}
              className="rounded-[6px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-micro text-[var(--text-tertiary)]">
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
              disabled={!canNavigate || activeIndex >= cards.length - 1}
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
    return <ArtifactEmbedQuiz embed={embed} />;
  }

  if (type === "planner_task") {
    const plan = normalizePlanContent(content);
    const nextDue = plan.tasks
      .filter((task) => task.dueAt !== undefined && task.status !== "done")
      .sort((left, right) => left.dueAt! - right.dueAt!)[0];
    if (embed.mode === "compact")
      return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[11px] font-semibold capitalize text-[var(--text-primary)]">
            {plan.tasks.length} task{plan.tasks.length === 1 ? "" : "s"}
          </span>
          <span className="text-micro capitalize text-[var(--text-tertiary)]">
            {plan.tasks.filter((task) => task.status === "done").length} complete
          </span>
          <span className="ml-auto text-micro text-[var(--text-secondary)]">
            {nextDue?.dueAt !== undefined
              ? new Date(nextDue.dueAt).toLocaleString()
              : "No due date"}
          </span>
        </div>
      );
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric
          label="Tasks"
          value={String(plan.tasks.length)}
        />
        <Metric
          label="Complete"
          value={String(plan.tasks.filter((task) => task.status === "done").length)}
        />
        <Metric
          label="Next due"
          value={
            nextDue?.dueAt !== undefined
              ? new Date(nextDue.dueAt).toLocaleString()
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
          <p className="mt-3 max-w-[76%] text-micro leading-4 text-[var(--text-secondary)]">
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
            <span className="text-micro text-[var(--text-tertiary)]">
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
    const entries = sheetCellEntries(
      sheet?.cells,
      embed.mode === "compact" ? 12 : 40,
    );
    return (
      <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
        <div className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-micro font-semibold text-[var(--text-secondary)]">
          {String(sheet?.name ?? "Sheet 1")}
        </div>
        <div className="grid grid-cols-4 gap-px bg-[var(--border-subtle)]">
          {entries.map(([address, value]) => (
            <div
              key={address}
              className="min-h-9 bg-[var(--bg-primary)] px-2 py-1"
            >
              <span className="block text-micro text-[var(--text-tertiary)]">
                {address}
              </span>
              <span className="block truncate text-micro text-[var(--text-primary)]">
                {textFrom(record(value).value ?? value, 40)}
              </span>
            </div>
          ))}
          {entries.length === 0 ? (
            <div className="col-span-4 p-6 text-center text-micro text-[var(--text-tertiary)]">
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
          embedId={embed.embedId}
          compact={embed.mode === "compact"}
          resources={embed.runtimeResources}
          allowInteraction={embedCapabilityEnabled(
            "code",
            effectiveInteraction,
            "runtime.interact",
          )}
        />
      );
    }
    return (
      <LiveCodeRuntime
        artifactId={source.artifactId}
        title={source.title ?? "Interactive visualisation"}
        content={content}
        compact={embed.mode === "compact"}
        allowInteraction={embedCapabilityEnabled(
          "code",
          effectiveInteraction,
          "runtime.interact",
        )}
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
            className="absolute max-w-[120px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-micro text-[var(--text-primary)] shadow-sm"
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
              <div className="text-micro text-[var(--text-tertiary)]">
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
          <p className="text-micro text-[var(--text-tertiary)]">
            No events in this view.
          </p>
        ) : null}
      </div>
    );
  }

  if (type === "agent") {
    const mission = record(content.mission);
    const skills = records(content.skills);
    const evidence = records(content.evidenceBindings ?? content.evidence);
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
          <div className="text-micro uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            Mission
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-primary)]">
            {textFrom(mission.objective ?? content.objective, 420) ||
              "Mission is still being shaped."}
          </p>
        </div>
        <Metric label="Skills" value={String(skills.length)} />
        <Metric label="Evidence" value={String(evidence.length)} />
        <Metric
          label="Release"
          value={String(content.releaseStatus ?? content.status ?? "draft")}
        />
      </div>
    );
  }

  void activeView;
  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--bg-primary)] p-3">
      <div className="text-micro uppercase tracking-[.1em] text-[var(--text-tertiary)]">
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
  onResize,
  onRequestAccess,
  onCancelAccessRequest,
  onUseLiveVersion,
  onRemove,
}: {
  embed: SpectraArtifactEmbed;
  busy?: boolean;
  onOpenSource?: (artifactId: string) => void;
  onRetry?: () => void;
  onModeChange?: (mode: "compact" | "expanded") => void;
  onResize?: (size: { width: number; height: number }) => void;
  onRequestAccess?: () => void;
  onCancelAccessRequest?: (requestId: string) => void;
  onUseLiveVersion?: () => void;
  onRemove?: () => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [nearViewport, setNearViewport] = useState(
    () => typeof window !== "undefined" && !("IntersectionObserver" in window),
  );
  const [pageVisible, setPageVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  /* A drag on the native resize grip is the only thing that may persist a size.
     Reading the box on any pointer-up would save a size the reader never chose
     — a plain click, a text selection, or a pane resize would silently pin the
     card. So we remember the box when the pointer goes down and write only if
     that same interaction actually changed it. */
  const dragOriginRef = useRef<{ width: number; height: number } | null>(null);
  const motionLevel = useSpectraMotion();
  const meta = embed.source ? workTypeMeta[embed.source.blueprintKey] : null;
  const Icon = meta?.icon ?? FileQuestion;
  const interaction = embed.effectiveInteraction ?? embed.interaction;
  const status =
    embed.state === "no_access" && embed.accessRequest
      ? {
          icon: Send,
          title: "Access requested",
          detail:
            "The source owner will decide whether to grant access. This reference unlocks automatically after approval.",
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
                "The surrounding work is unchanged, but this reference is no longer available.",
            }
          : embed.state === "version_unavailable"
            ? {
                icon: AlertCircle,
                title: "Pinned version unavailable",
                detail:
                  "The retained source version is missing or failed its integrity check.",
              }
            : embed.state === "removed"
              ? {
                  icon: X,
                  title: "Reference removed",
                  detail:
                    "This placement is no longer connected to its source. You can delete it from the surrounding work.",
                }
              : null;

  useEffect(() => {
    if (embed.source?.blueprintKey !== "code") return;
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "640px 0px", threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [embed.embedId, embed.source?.blueprintKey]);

  useEffect(() => {
    if (embed.source?.blueprintKey !== "code") return;
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [embed.source?.blueprintKey]);

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
            <p className="mt-0.5 max-w-[620px] text-micro leading-4 text-[var(--text-secondary)]">
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
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
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
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] px-2.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
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
                className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
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
    <motion.section
      layout={!motionLevel.disabled}
      transition={
        motionLevel.disabled
          ? undefined
          : transitionFor("morph", motionLevel.level)
      }
      ref={rootRef}
      data-reference-id={embed.embedId}
      className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_1px_2px_rgba(28,24,18,0.025)]"
      style={
        embed.mode === "expanded"
          ? {
              width:
                typeof embed.displayPreferences?.width === "number"
                  ? embed.displayPreferences.width
                  : undefined,
              height:
                typeof embed.displayPreferences?.height === "number"
                  ? embed.displayPreferences.height
                  : undefined,
              maxWidth: "100%",
              maxHeight: "min(720px, 80vh)",
              minWidth: 240,
              minHeight: 160,
              resize: onResize ? "both" : undefined,
              overflow: "auto",
            }
          : undefined
      }
      onPointerDown={() => {
        if (!onResize || embed.mode !== "expanded" || !rootRef.current) {
          dragOriginRef.current = null;
          return;
        }
        const bounds = rootRef.current.getBoundingClientRect();
        dragOriginRef.current = {
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      }}
      onPointerCancel={() => {
        dragOriginRef.current = null;
      }}
      onPointerUp={() => {
        const origin = dragOriginRef.current;
        dragOriginRef.current = null;
        if (
          !onResize ||
          embed.mode !== "expanded" ||
          !rootRef.current ||
          !origin
        )
          return;
        const bounds = rootRef.current.getBoundingClientRect();
        const width = Math.round(bounds.width);
        const height = Math.round(bounds.height);
        if (
          Math.abs(width - origin.width) > 3 ||
          Math.abs(height - origin.height) > 3
        )
          onResize({ width, height });
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5 sm:px-4">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--embed-accent)_9%,var(--bg-secondary))]"
          style={
            { "--embed-accent": meta.color, color: meta.color } as CSSProperties
          }
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-[140px] flex-1 basis-[min(100%,220px)]">
          <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
            {embed.source.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            <span>{meta.label}</span>
            <span>·</span>
            <span>{embed.mode === "compact" ? "Compact" : "Expanded"}</span>
            <span>·</span>
            <span>{embed.versionPolicy === "pinned" ? "Pinned" : "Live"}</span>
            {typeof embed.displayPreferences?.view === "string" ? (
              <>
                <span>·</span>
                <span>
                  {embed.displayPreferences.view.replaceAll("_", " ")}
                </span>
              </>
            ) : null}
            {embed.state === "archived" ? (
              <>
                <span>·</span>
                <span className="text-[var(--warning)]">Archived</span>
              </>
            ) : null}
            {interaction ? (
              <>
                <span>·</span>
                <span>
                  {interaction === "read"
                    ? "Read-only"
                    : interaction === "interact"
                      ? "Interactive"
                      : "Editable"}
                </span>
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
            className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
            aria-label={
              embed.mode === "compact"
                ? "Expand reference"
                : "Collapse reference"
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
            className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-micro font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Open source
            <ArrowUpRight className="h-3 w-3" />
          </button>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
            aria-label="Remove reference"
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header>
      <motion.div
        key={embed.mode}
        initial={motionLevel.disabled ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={
          motionLevel.disabled
            ? undefined
            : {
                ...transitionFor("reveal", motionLevel.level),
                // Let the shell start settling before the arriving content
                // declares itself — geometry first, then content.
                delay: motionLevel.reduced ? 0 : 0.09,
              }
        }
        className={embed.mode === "compact" ? "p-3.5" : "p-4 sm:p-5"}
      >
        {shouldMountArtifactEmbedRuntime({
          sourceType: embed.source.blueprintKey,
          nearViewport,
          pageVisible,
        }) ? (
          <ContentAdapter embed={embed} />
        ) : (
          <div
            className={`${embed.mode === "compact" ? "min-h-32" : "min-h-56"} flex items-center justify-center rounded-[8px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] px-4 text-center`}
            aria-label="Published runtime paused"
          >
            <p className="max-w-sm text-micro leading-4 text-[var(--text-tertiary)]">
              Preview paused until it is back on screen.
            </p>
          </div>
        )}
      </motion.div>
      {embed.source.summary && embed.mode === "expanded" ? (
        <motion.footer
          initial={motionLevel.disabled ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            motionLevel.disabled
              ? undefined
              : {
                  ...transitionFor("reveal", motionLevel.level),
                  delay: motionLevel.reduced ? 0 : 0.14,
                }
          }
          className="border-t border-[var(--border-subtle)] px-4 py-2 text-micro leading-4 text-[var(--text-tertiary)]"
        >
          {embed.source.summary}
        </motion.footer>
      ) : null}
    </motion.section>
  );
}
