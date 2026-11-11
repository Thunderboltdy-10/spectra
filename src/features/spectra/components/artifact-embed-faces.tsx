"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "@/components/icons/glyph-icons";
import type { SpectraArtifactEmbed } from "../data/api";
import { LiveCodeRuntime } from "./live-code-runtime";
import { PublishedCodeRuntime } from "./published-code-runtime";
import { ViewOnlyCover } from "./view-only-cover";
import { isArtifactTypeKey } from "../artifacts/registry";
import { embedCapabilityEnabled } from "../capabilities";
import { ArtifactEmbedQuiz } from "./artifact-embed-quiz";
import { sheetCellEntries } from "../../../../shared/sheet-cells";
import { plainTextFromStored } from "../rich-content";
import { SpectraStoredText } from "./spectra-rich-content";
import { normalizePresentationContent } from "../presentation/model";
import { useWorkPreview, type PreviewSource } from "../artifacts/use-work-previews";

/*
 * The face of an embedded work: the part of the card that is the work itself,
 * usable where it sits. A deck steps through its slides, flashcards turn and
 * step, a quiz takes answers, a visualisation runs, and the rest show enough
 * of themselves to read without opening them. Every face sits on the card's
 * paper in the work's own tint (spectra-embeds.css); none draws a box of its
 * own inside the card.
 */

/* The slide canvas brings the deck's editing parts with it, so a conversation
   loads it only when a deck's face is first shown. */
const SlideCanvas = dynamic(
  () => import("./presentation-slide-canvas").then((module) => module.SlideCanvas),
  { ssr: false },
);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

/* Rich fields (quiz prompts, option text, card faces) are stored as HTML or
   Markdown by their studios. A summary reads them as words through the shared
   model — never injected markup and never the raw tags. */
function textFrom(value: unknown, limit = 360): string {
  if (typeof value === "string")
    return (
      /<[a-z!/][^>]*>/i.test(value)
        ? plainTextFromStored(value).replace(/\s+/g, " ")
        : value
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

function firstDocumentImage(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 12 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const image = firstDocumentImage(child, depth + 1);
      if (image) return image;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const attrs = record(candidate.attrs);
  if (candidate.kind === "image" && typeof candidate.assetId === "string") return candidate;
  if (candidate.type === "image" && typeof attrs.assetId === "string")
    return { ...attrs, altText: attrs.alt ?? "" };
  for (const child of Object.values(candidate)) {
    const image = firstDocumentImage(child, depth + 1);
    if (image) return image;
  }
  return undefined;
}

export type WhiteboardPreviewNode = {
  id: string;
  label: string;
  /** Percent of the frame, from the node's place on the board. */
  left: number;
  top: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A board preview keeps the board's own arrangement: each node sits where it
 * sits on the board's current page, scaled into the frame, so a flow chart
 * still reads as one and two nodes side by side stay side by side.
 */
export function whiteboardPreviewNodes(
  content: Record<string, unknown>,
  limit: number,
): WhiteboardPreviewNode[] {
  const all = records(content.nodes).filter((node) => node.hidden !== true);
  const viewportPage = record(content.viewport).pageId;
  const page =
    typeof viewportPage === "string"
      ? viewportPage
      : records(content.pages)[0]?.id;
  const onPage =
    typeof page === "string" && all.some((node) => node.pageId === page)
      ? all.filter((node) => node.pageId === page)
      : all;
  const nodes = onPage.slice(0, limit);
  const placed = nodes.filter((node) => finite(node.x) && finite(node.y));
  const minX = Math.min(...placed.map((node) => node.x as number));
  const minY = Math.min(...placed.map((node) => node.y as number));
  const maxX = Math.max(...placed.map((node) => node.x as number));
  const maxY = Math.max(...placed.map((node) => node.y as number));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return nodes.map((node, index) => {
    const label = textFrom(node.content, 70) || String(node.type ?? "Node");
    const id = String(node.id ?? index);
    if (!finite(node.x) || !finite(node.y))
      return {
        id,
        label,
        left: 8 + ((index * 23) % 70),
        top: 10 + ((index * 31) % 68),
      };
    // 6–76% across and 8–72% down leaves room for the node's own box.
    const left = spanX > 0 ? 6 + ((node.x - minX) / spanX) * 70 : 40;
    const top = spanY > 0 ? 8 + ((node.y - minY) / spanY) * 64 : 40;
    return {
      id,
      label,
      left: Math.round(left * 10) / 10,
      top: Math.round(top * 10) / 10,
    };
  });
}

/** Previous and next for a face that holds several things, with where the reader is. */
function Stepper({
  index,
  count,
  noun,
  onStep,
  disabled = false,
}: {
  index: number;
  count: number;
  noun: "slide" | "card";
  onStep: (next: number) => void;
  disabled?: boolean;
}) {
  if (count < 2) return null;
  return (
    <div className="work-embed-stepper">
      <button
        type="button"
        onClick={() => onStep(Math.max(0, index - 1))}
        disabled={disabled || index === 0}
        aria-label={`Previous ${noun}`}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span aria-live="polite">{noun === "slide" ? `Slide ${index + 1} of ${count}` : `${index + 1} / ${count}`}</span>
      <button
        type="button"
        onClick={() => onStep(Math.min(count - 1, index + 1))}
        disabled={disabled || index >= count - 1}
        aria-label={`Next ${noun}`}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="work-embed-fact">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function when(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString(undefined, WHEN);
}

/**
 * A document whose words are kept outside its record (a long or imported
 * one) has no blocks in the embed's snapshot; it shows the opening the shelf
 * reads for its card instead.
 */
function DocumentReadFace({ work }: { work: PreviewSource }) {
  const ref = useRef<HTMLDivElement>(null);
  const preview = useWorkPreview(work, ref);
  // A table's corner belongs on a card; the embed reads on as words.
  const lines = preview?.kind === "text" ? preview.lines.filter((line): line is string => typeof line === "string") : [];
  const heading = preview?.kind === "text" ? preview.heading : undefined;
  return (
    <div ref={ref} className="work-embed-document">
      {preview === undefined ? <p className="work-embed-empty">Reading…</p> : null}
      {preview !== undefined && !heading && !lines.length ? <p className="work-embed-empty">Nothing written yet</p> : null}
      {heading ? <h4>{heading}</h4> : null}
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}

function DocumentFace({ content, compact, work }: { content: Record<string, unknown>; compact: boolean; work: PreviewSource }) {
  const blocks = records(content.blocks).slice(0, compact ? 3 : 10);
  const image = compact ? undefined : firstDocumentImage(content);
  if (!blocks.length && !image) return <DocumentReadFace work={work} />;
  return (
    <div className="work-embed-document">
      {blocks.map((block, index) =>
        block.type === "heading" ? (
          <h4 key={String(block.id ?? index)}>{textFrom(block.text ?? block.content)}</h4>
        ) : (
          <p key={String(block.id ?? index)}>{textFrom(block.text ?? block.content) || " "}</p>
        ),
      )}
      {image ? (
        <figure>
          {/* The authenticated asset endpoint has no stable intrinsic dimensions; keep the bounded preview. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/spectra/assets/content?assetId=${encodeURIComponent(String(image.assetId))}`}
            alt={textFrom(image.altText) || "Document image"}
            loading="lazy"
          />
        </figure>
      ) : null}
    </div>
  );
}

/* Turning a card and stepping through the deck read the work; they never
   change it, so an embedded deck can always be studied where it sits. */
function FlashcardFace({ content }: { content: Record<string, unknown> }) {
  const cards = records(content.cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  if (!cards.length) return <p className="work-embed-empty">No cards yet</p>;
  const card = cards[Math.min(index, cards.length - 1)];
  return (
    <div className="work-embed-stage">
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        className="work-embed-flashcard"
        data-side={revealed ? "back" : "front"}
        aria-label={revealed ? "Show the question" : "Show the answer"}
      >
        <span key={`${index}-${revealed}`} className="work-embed-turn">
          <SpectraStoredText
            value={textFrom(revealed ? card?.back : card?.front, 600)}
            fallback="Empty card"
            className="work-embed-card-words"
          />
          {revealed && card.explanation ? (
            <small>
              <SpectraStoredText value={textFrom(card.explanation, 600)} inline />
            </small>
          ) : null}
        </span>
      </button>
      <Stepper
        index={index}
        count={cards.length}
        noun="card"
        onStep={(next) => {
          setIndex(next);
          setRevealed(false);
        }}
      />
    </div>
  );
}

/** The deck's own slides, drawn by the same canvas the studio draws them with. */
function SlidesFace({ content }: { content: Record<string, unknown> }) {
  const deck = useMemo(() => normalizePresentationContent(content), [content]);
  const [index, setIndex] = useState(0);
  if (!deck.slides.length) return <p className="work-embed-empty">No slides yet</p>;
  const slide = deck.slides[Math.min(index, deck.slides.length - 1)]!;
  return (
    <div className="work-embed-stage">
      <div key={slide.id} className="work-embed-slide work-embed-turn">
        <SlideCanvas slide={slide} deck={deck} assets={[]} readOnly compact />
      </div>
      <Stepper index={index} count={deck.slides.length} noun="slide" onStep={setIndex} />
    </div>
  );
}

function SheetFace({ content, compact }: { content: Record<string, unknown>; compact: boolean }) {
  const sheet = records(content.sheets)[0];
  const entries = sheetCellEntries(sheet?.cells, compact ? 12 : 40);
  return (
    <div className="work-embed-sheet">
      <div className="work-embed-sheet-name">{String(sheet?.name ?? "Sheet 1")}</div>
      {entries.length ? (
        <div className="work-embed-sheet-grid">
          {entries.map(([address, value]) => (
            <div key={address}>
              <span>{address}</span>
              <strong>{textFrom(record(value).value ?? value, 40)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="work-embed-empty">No cells filled yet</p>
      )}
    </div>
  );
}

function BoardFace({ content, compact }: { content: Record<string, unknown>; compact: boolean }) {
  const nodes = whiteboardPreviewNodes(content, compact ? 8 : 24);
  return (
    <div className="work-embed-board">
      {nodes.map((node) => (
        <span key={node.id} style={{ left: `${node.left}%`, top: `${node.top}%` }}>
          {node.label}
        </span>
      ))}
      {nodes.length === 0 ? <p className="work-embed-empty">The board is empty</p> : null}
    </div>
  );
}

function TimetableFace({ content, compact }: { content: Record<string, unknown>; compact: boolean }) {
  const events = records(content.events).slice(0, compact ? 3 : 8);
  if (!events.length) return <p className="work-embed-empty">No events in this view</p>;
  return (
    <ul className="work-embed-events">
      {events.map((event, index) => (
        <li key={String(event.id ?? index)}>
          <CalendarDays className="size-3.5" aria-hidden />
          <span>{textFrom(event.title) || "Event"}</span>
          <time>{when(event.start ?? event.startAt) ?? "Time not set"}</time>
        </li>
      ))}
    </ul>
  );
}

function TaskFace({ content }: { content: Record<string, unknown> }) {
  const status = String(content.status ?? "todo");
  return (
    <div className="work-embed-facts">
      <Fact label="Status">{status === "done" ? "Done" : status === "doing" ? "Under way" : "To do"}</Fact>
      <Fact label="Due">{when(content.dueAt) ?? "No due date"}</Fact>
    </div>
  );
}

function AgentFace({ content }: { content: Record<string, unknown> }) {
  const mission = record(content.mission);
  const purpose = textFrom(mission.objective ?? content.objective ?? content.purpose, 420);
  return (
    <div className="work-embed-document">
      <p>{purpose || "Its purpose is still being written."}</p>
      <div className="work-embed-facts">
        <Fact label="Skills">{records(content.skills).length}</Fact>
        <Fact label="Released">{String(content.releaseStatus ?? content.status ?? "draft") === "draft" ? "Not yet" : "Yes"}</Fact>
      </div>
    </div>
  );
}

/** The usable face of one embedded work. */
export function EmbedFace({ embed }: { embed: SpectraArtifactEmbed }) {
  const source = embed.source;
  const type = source?.blueprintKey;
  if (!type || !source || !isArtifactTypeKey(type)) return null;
  const content = record(source.snapshot?.content);
  const compact = embed.mode === "compact";
  switch (type) {
    case "document":
      return (
        <DocumentFace
          content={content}
          compact={compact}
          work={{ _id: source.artifactId, blueprintKey: "document", updatedAt: source.updatedAt ?? 0 }}
        />
      );
    case "flashcard_deck":
      return <FlashcardFace content={content} />;
    case "quiz":
      return <ArtifactEmbedQuiz embed={embed} />;
    case "planner_task":
      return <TaskFace content={content} />;
    case "presentation":
      return <SlidesFace content={content} />;
    case "sheets":
      return <SheetFace content={content} compact={compact} />;
    case "whiteboard":
      return <BoardFace content={content} compact={compact} />;
    case "timetable":
      return <TimetableFace content={content} compact={compact} />;
    case "agent":
      return <AgentFace content={content} />;
    case "code": {
      const allowInteraction = embedCapabilityEnabled("code", embed.effectiveInteraction ?? embed.interaction, "runtime.interact");
      const runtime = embed.runtimeBuild ? (
        <PublishedCodeRuntime
          title={source.title ?? "Interactive visualisation"}
          build={embed.runtimeBuild}
          embedId={embed.embedId}
          compact={compact}
          resources={embed.runtimeResources}
          allowInteraction={allowInteraction}
        />
      ) : (
        <LiveCodeRuntime
          artifactId={source.artifactId}
          title={source.title ?? "Interactive visualisation"}
          content={content}
          compact={compact}
          allowInteraction={allowInteraction}
          resources={embed.runtimeResources}
        />
      );
      // Controls that look live but do nothing here say so, and point to where they work.
      return allowInteraction ? runtime : <ViewOnlyCover workId={source.artifactId}>{runtime}</ViewOnlyCover>;
    }
    default:
      return null;
  }
}
