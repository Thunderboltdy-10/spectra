"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Clock,
  History,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Archive,
  Tag,
  X,
  RotateCcw,
  Check,
  Plus,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { getArtifactMeta } from "@/lib/artifact-types";
import type { ArtifactItem } from "./artifact-card";
import { cn } from "@/lib/utils";

type Version = {
  _id: string;
  diff: unknown;
  snapshot?: unknown;
  authorType: string;
  description?: string;
  createdAt: number;
};

function formatDateTime(ts: number) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Per-type Content Editors
// ---------------------------------------------------------------------------

function NoteEditor({
  content,
  onChange,
}: {
  content: { text?: string };
  onChange: (c: unknown) => void;
}) {
  return (
    <textarea
      className="min-h-[300px] w-full resize-y rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 font-[family-name:var(--font-manrope)] text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none"
      value={content.text ?? ""}
      onChange={(e) => onChange({ ...content, text: e.target.value })}
      placeholder="Write your note..."
    />
  );
}

function StudyPlanEditor({
  content,
  onChange,
}: {
  content: { description?: string; milestones?: { id: string; title: string; done: boolean }[] };
  onChange: (c: unknown) => void;
}) {
  const milestones = content.milestones ?? [];

  function addMilestone() {
    onChange({
      ...content,
      milestones: [
        ...milestones,
        { id: `m-${Date.now()}`, title: "", done: false },
      ],
    });
  }

  function updateMilestone(index: number, updates: Partial<{ title: string; done: boolean }>) {
    const updated = milestones.map((m, i) => (i === index ? { ...m, ...updates } : m));
    onChange({ ...content, milestones: updated });
  }

  function removeMilestone(index: number) {
    onChange({ ...content, milestones: milestones.filter((_, i) => i !== index) });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
          Description
        </label>
        <textarea
          className="min-h-[80px] w-full resize-y rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:outline-none"
          value={content.description ?? ""}
          onChange={(e) => onChange({ ...content, description: e.target.value })}
          placeholder="Describe your study plan..."
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Milestones</label>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--brand-primary)] hover:bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-primary))]"
            onClick={addMilestone}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>

        <div className="space-y-2">
          {milestones.map((m, i) => (
            <div key={m.id} className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  m.done
                    ? "border-[var(--success)] bg-[var(--success)] text-white"
                    : "border-[var(--border-default)] hover:border-[var(--text-tertiary)]",
                )}
                onClick={() => updateMilestone(i, { done: !m.done })}
              >
                {m.done ? <Check className="h-3 w-3" /> : null}
              </button>
              <input
                type="text"
                value={m.title}
                onChange={(e) => updateMilestone(i, { title: e.target.value })}
                placeholder={`Milestone ${i + 1}`}
                className={cn(
                  "flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none",
                  m.done && "line-through opacity-60",
                )}
              />
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                onClick={() => removeMilestone(i)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FlashcardDeckEditor({
  content,
  onChange,
}: {
  content: { cards?: { front: string; back: string }[] };
  onChange: (c: unknown) => void;
}) {
  const cards = content.cards ?? [];
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());
  const [previewIndex, setPreviewIndex] = useState(0);

  function addCard() {
    const newCards = [...cards, { front: "", back: "" }];
    onChange({ ...content, cards: newCards });
    setEditingIndex(newCards.length - 1);
  }

  function updateCard(index: number, field: "front" | "back", value: string) {
    const updated = cards.map((c, i) => (i === index ? { ...c, [field]: value } : c));
    onChange({ ...content, cards: updated });
  }

  function removeCard(index: number) {
    onChange({ ...content, cards: cards.filter((_, i) => i !== index) });
    if (editingIndex === index) setEditingIndex(null);
    if (previewIndex >= cards.length - 1) setPreviewIndex(Math.max(0, cards.length - 2));
  }

  function toggleFlip(index: number) {
    setFlippedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // Keyboard navigation for preview
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (editingIndex !== null) return;
      if (e.key === "ArrowLeft" && previewIndex > 0) {
        setPreviewIndex((i) => i - 1);
        setFlippedCards(new Set());
      }
      if (e.key === "ArrowRight" && previewIndex < cards.length - 1) {
        setPreviewIndex((i) => i + 1);
        setFlippedCards(new Set());
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleFlip(previewIndex);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [previewIndex, cards.length, editingIndex]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--text-secondary)]">
          {cards.length} card{cards.length !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-[var(--radius-input)] bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          onClick={addCard}
        >
          <Plus className="h-3.5 w-3.5" /> Add Card
        </button>
      </div>

      {/* Card preview — large flip card */}
      {cards.length > 0 ? (
        <div className="space-y-4">
          <div
            className="group mx-auto w-full cursor-pointer"
            onClick={() => toggleFlip(previewIndex)}
            style={{ perspective: "1200px" }}
          >
            <div
              className="relative h-72 w-full transition-transform duration-500 sm:h-80"
              style={{
                transformStyle: "preserve-3d",
                transform: flippedCards.has(previewIndex) ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* Front */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[color-mix(in_oklab,var(--brand-primary)_25%,var(--border-default))] bg-[var(--bg-elevated)] px-10 py-10 shadow-[var(--shadow-card)]"
                style={{ backfaceVisibility: "hidden" }}
              >
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Front</div>
                <p className="max-w-lg text-center text-lg leading-relaxed text-[var(--text-primary)] sm:text-xl">
                  {cards[previewIndex]?.front || <span className="italic text-[var(--text-tertiary)]">Empty</span>}
                </p>
              </div>
              {/* Back */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-[color-mix(in_oklab,var(--brand-accent)_30%,var(--border-default))] bg-[var(--bg-elevated)] px-10 py-10 shadow-[var(--shadow-card)]"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Back</div>
                <p className="max-w-lg text-center text-lg leading-relaxed text-[var(--text-primary)] sm:text-xl">
                  {cards[previewIndex]?.back || <span className="italic text-[var(--text-tertiary)]">Empty</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              disabled={previewIndex === 0}
              className="rounded-xl p-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
              onClick={() => { setPreviewIndex((i) => i - 1); setFlippedCards(new Set()); }}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="min-w-[80px] text-center text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
              {previewIndex + 1} / {cards.length}
            </span>
            <button
              type="button"
              disabled={previewIndex >= cards.length - 1}
              className="rounded-xl p-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-30"
              onClick={() => { setPreviewIndex((i) => i + 1); setFlippedCards(new Set()); }}
            >
              <ArrowLeft className="h-5 w-5 rotate-180" />
            </button>
          </div>

          <p className="text-center text-[10px] text-[var(--text-tertiary)]">
            Click to flip &middot; &larr; &rarr; to navigate &middot; Space to flip
          </p>
        </div>
      ) : null}

      {/* Card list editor */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          All Cards
        </h4>
        {cards.map((card, i) => (
          <div
            key={i}
            className={cn(
              "rounded-[14px] border bg-[var(--bg-primary)] transition-colors",
              editingIndex === i
                ? "border-[var(--brand-primary)]"
                : "border-[var(--border-default)] hover:border-[color-mix(in_oklab,var(--brand-primary)_25%,var(--border-default))]",
            )}
          >
            {editingIndex === i ? (
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Card {i + 1}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded-md p-1 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                      onClick={() => removeCard(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-0.5 text-xs text-[var(--brand-primary)] hover:bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-primary))]"
                      onClick={() => setEditingIndex(null)}
                    >
                      Done
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-[var(--text-tertiary)]">Front</label>
                    <textarea
                      className="min-h-[80px] w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm leading-relaxed text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
                      value={card.front}
                      onChange={(e) => updateCard(i, "front", e.target.value)}
                      placeholder="Question or term..."
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-[var(--text-tertiary)]">Back</label>
                    <textarea
                      className="min-h-[80px] w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm leading-relaxed text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
                      value={card.back}
                      onChange={(e) => updateCard(i, "back", e.target.value)}
                      placeholder="Answer or definition..."
                    />
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-3 p-3 text-left"
                onClick={() => { setEditingIndex(i); setPreviewIndex(i); }}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-secondary)] text-xs font-bold text-[var(--text-tertiary)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--text-primary)]">{card.front || "Untitled card"}</p>
                  <p className="truncate text-xs text-[var(--text-tertiary)]">{card.back || "No answer"}</p>
                </div>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>
        ))}
      </div>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-container)] border-2 border-dashed border-[var(--border-default)] py-12">
          <p className="mb-3 text-sm text-[var(--text-tertiary)]">No cards yet</p>
          <button
            type="button"
            className="rounded-[var(--radius-input)] bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={addCard}
          >
            Add First Card
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TimetableEditor({
  content,
  onChange,
}: {
  content: { slots?: { day: string; time: string; subject: string }[] };
  onChange: (c: unknown) => void;
}) {
  const slots = content.slots ?? [];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function addSlot() {
    onChange({
      ...content,
      slots: [...slots, { day: "Monday", time: "09:00", subject: "" }],
    });
  }

  function updateSlot(index: number, field: string, value: string) {
    const updated = slots.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    onChange({ ...content, slots: updated });
  }

  function removeSlot(index: number) {
    onChange({ ...content, slots: slots.filter((_, i) => i !== index) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {slots.length} slot{slots.length !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--brand-primary)] hover:bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-primary))]"
          onClick={addSlot}
        >
          <Plus className="h-3 w-3" /> Add Slot
        </button>
      </div>

      <div className="space-y-2">
        {slots.map((slot, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={slot.day}
              onChange={(e) => updateSlot(i, "day", e.target.value)}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
            >
              {days.map((d) => (
                <option key={d} value={d}>{d.slice(0, 3)}</option>
              ))}
            </select>
            <input
              type="time"
              value={slot.time}
              onChange={(e) => updateSlot(i, "time", e.target.value)}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
            <input
              type="text"
              value={slot.subject}
              onChange={(e) => updateSlot(i, "subject", e.target.value)}
              placeholder="Subject / Activity"
              className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
            <button
              type="button"
              className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
              onClick={() => removeSlot(i)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookmarkEditor({
  content,
  onChange,
}: {
  content: { url?: string; note?: string; messagePreview?: string };
  onChange: (c: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      {content.messagePreview ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Saved Message
          </div>
          <p className="text-sm leading-relaxed text-[var(--text-primary)]">
            {content.messagePreview}
          </p>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
            URL
          </label>
          <input
            type="url"
            value={content.url ?? ""}
            onChange={(e) => onChange({ ...content, url: e.target.value })}
            placeholder="https://..."
            className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
          />
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
          Note
        </label>
        <textarea
          className="min-h-[80px] w-full resize-y rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
          value={content.note ?? ""}
          onChange={(e) => onChange({ ...content, note: e.target.value })}
          placeholder="Add a note..."
        />
      </div>
    </div>
  );
}

function CodeProjectEditor({
  content,
  onChange,
}: {
  content: { language?: string; code?: string };
  onChange: (c: unknown) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
          Language
        </label>
        <select
          value={content.language ?? "javascript"}
          onChange={(e) => onChange({ ...content, language: e.target.value })}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--brand-primary)] focus:outline-none"
        >
          {["javascript", "typescript", "python", "html", "css", "java", "go", "rust"].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
          Code
        </label>
        <textarea
          className="min-h-[250px] w-full resize-y rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-code)] p-4 font-[family-name:var(--font-plex-mono)] text-sm leading-relaxed text-[#e2e8f0] focus:border-[var(--brand-primary)] focus:outline-none"
          value={content.code ?? ""}
          onChange={(e) => onChange({ ...content, code: e.target.value })}
          placeholder="// Write your code here..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function ImageViewer({ content }: { content: { url?: string; prompt?: string } }) {
  return (
    <div className="space-y-3">
      {content.url ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
          <img
            src={content.url}
            alt={content.prompt ?? "Generated image"}
            className="max-h-[400px] w-full object-contain"
          />
        </div>
      ) : null}
      {content.prompt ? (
        <div className="rounded-xl bg-[var(--bg-secondary)] p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Prompt
          </div>
          <p className="text-sm text-[var(--text-primary)]">{content.prompt}</p>
        </div>
      ) : null}
    </div>
  );
}

function DocumentViewer({ content }: { content: { title?: string; body?: string; downloadUrl?: string } }) {
  return (
    <div className="space-y-3">
      {content.body ? (
        <div className="prose prose-sm max-w-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-6 text-[var(--text-primary)]">
          <div dangerouslySetInnerHTML={{ __html: content.body }} />
        </div>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">No content preview available.</p>
      )}
      {content.downloadUrl ? (
        <a
          href={content.downloadUrl}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          download
        >
          Download
        </a>
      ) : null}
    </div>
  );
}

function GenericEditor({
  content,
  onChange,
}: {
  content: Record<string, unknown>;
  onChange: (c: unknown) => void;
}) {
  const [jsonText, setJsonText] = useState(JSON.stringify(content, null, 2));
  const [parseError, setParseError] = useState(false);

  return (
    <div>
      <textarea
        className={cn(
          "min-h-[200px] w-full resize-y rounded-[var(--radius-input)] border bg-[var(--bg-primary)] p-4 font-[family-name:var(--font-plex-mono)] text-xs leading-relaxed text-[var(--text-primary)] focus:outline-none",
          parseError ? "border-[var(--danger)]" : "border-[var(--border-default)] focus:border-[var(--brand-primary)]",
        )}
        value={jsonText}
        onChange={(e) => {
          setJsonText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            setParseError(false);
            onChange(parsed);
          } catch {
            setParseError(true);
          }
        }}
        spellCheck={false}
      />
      {parseError ? (
        <p className="mt-1 text-xs text-[var(--danger)]">Invalid JSON</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content editor dispatcher
// ---------------------------------------------------------------------------

function ContentEditor({
  type,
  content,
  onChange,
}: {
  type: string;
  content: unknown;
  onChange: (c: unknown) => void;
}) {
  const c = (content ?? {}) as Record<string, unknown>;

  switch (type) {
    case "note":
      return <NoteEditor content={c as { text?: string }} onChange={onChange} />;
    case "study_plan":
      return <StudyPlanEditor content={c as any} onChange={onChange} />;
    case "flashcard_deck":
      return <FlashcardDeckEditor content={c as any} onChange={onChange} />;
    case "timetable":
      return <TimetableEditor content={c as any} onChange={onChange} />;
    case "bookmark":
      return <BookmarkEditor content={c as any} onChange={onChange} />;
    case "code_project":
      return <CodeProjectEditor content={c as any} onChange={onChange} />;
    case "image":
      return <ImageViewer content={c as any} />;
    case "document":
      return <DocumentViewer content={c as any} />;
    default:
      return <GenericEditor content={c} onChange={onChange} />;
  }
}

// ---------------------------------------------------------------------------
// Main Editor Component
// ---------------------------------------------------------------------------

export function ArtifactEditor({
  artifact,
  onBack,
  onSave,
  onPin,
  onArchive,
  onDelete,
  onRestoreVersion,
}: {
  artifact: ArtifactItem;
  onBack: () => void;
  onSave: (updates: { title?: string; content?: unknown; tags?: string[] }) => Promise<void>;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestoreVersion: (versionId: string) => Promise<void>;
}) {
  const meta = getArtifactMeta(artifact.type);
  const Icon = meta.icon;

  const [title, setTitle] = useState(artifact.title);
  const [content, setContent] = useState<unknown>(artifact.content);
  const [tagsInput, setTagsInput] = useState((artifact.tags ?? []).join(", "));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDirtyRef = useRef(false);

  useEffect(() => {
    setTitle(artifact.title);
    setContent(artifact.content);
    setTagsInput((artifact.tags ?? []).join(", "));
    setDirty(false);
    latestDirtyRef.current = false;
  }, [artifact._id, artifact.title, artifact.content, artifact.tags]);

  const handleContentChange = useCallback((c: unknown) => {
    setContent(c);
    setDirty(true);
    latestDirtyRef.current = true;
  }, []);

  // Auto-save: debounce 1.5s after any change
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (latestDirtyRef.current) void handleAutoSave();
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [dirty, title, content, tagsInput]);

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (latestDirtyRef.current) void handleAutoSave();
    };
  }, []);

  async function handleAutoSave() {
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await onSave({
        title: title !== artifact.title ? title : undefined,
        content: latestDirtyRef.current ? content : undefined,
        tags,
      });
      setDirty(false);
      latestDirtyRef.current = false;
    } catch {
      // Silent fail for auto-save — user can manually retry
    } finally {
      setSaving(false);
    }
  }

  async function loadVersions() {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/artifacts?action=versions&id=${artifact._id}`);
      if (res.ok) {
        const data = (await res.json()) as { versions: Version[] };
        setVersions(data.versions ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoadingVersions(false);
    }
  }

  function toggleHistory() {
    if (!showHistory) {
      void loadVersions();
    }
    setShowHistory(!showHistory);
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-3">
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="mx-2 h-4 w-px bg-[var(--border-default)]" />

        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in oklab, ${meta.color} 12%, var(--bg-primary))`,
            color: meta.color,
          }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>

        <span className="text-xs text-[var(--text-tertiary)]">{meta.label}</span>

        <div className="flex-1" />

        <button
          type="button"
          className={cn(
            "rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
            showHistory && "bg-[var(--bg-hover)] text-[var(--brand-primary)]",
          )}
          onClick={toggleHistory}
          title="Version history"
        >
          <History className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          onClick={onPin}
          title={artifact.pinnedAt ? "Unpin" : "Pin"}
        >
          {artifact.pinnedAt ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>

        <button
          type="button"
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
          onClick={onArchive}
          title="Archive"
        >
          <Archive className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>

        <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
          {saving ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-[var(--text-tertiary)] border-t-transparent" />
              Saving…
            </>
          ) : dirty ? (
            <>
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
              Unsaved
            </>
          ) : (
            <>
              <Check className="h-3 w-3 text-[var(--success)]" />
              Saved
            </>
          )}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8 lg:px-12">
          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            className="mb-2 w-full border-none bg-transparent font-display text-3xl font-semibold text-[var(--text-primary)] focus:outline-none"
            placeholder="Untitled"
          />

          {/* Tags */}
          <div className="mb-6 flex items-center gap-2 border-b border-[var(--border-default)] pb-5">
            <Tag className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                setDirty(true);
              }}
              placeholder="Add tags (comma-separated)..."
              className="flex-1 border-none bg-transparent text-sm text-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            />
          </div>

          {/* Type-specific editor */}
          <ContentEditor type={artifact.type} content={content} onChange={handleContentChange} />

          {/* Meta info */}
          <div className="mt-8 flex items-center gap-4 border-t border-[var(--border-default)] pt-4 text-[10px] text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {formatDateTime(artifact.createdAt)}
            </span>
            <span>Updated {formatDateTime(artifact.updatedAt)}</span>
          </div>
          </div>{/* end max-w wrapper */}
        </div>

        {/* Version history panel */}
        {showHistory ? (
          <div className="w-[280px] shrink-0 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-primary)]">
            <div className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Version History
              </h3>
            </div>

            {loadingVersions ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-primary)]" />
              </div>
            ) : versions.length === 0 ? (
              <p className="p-4 text-xs text-[var(--text-tertiary)]">No version history yet.</p>
            ) : (
              <div className="divide-y divide-[var(--border-default)]">
                {versions.map((v) => (
                  <div key={v._id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                        {v.authorType === "agent" ? "Agent" : v.authorType === "system" ? "System" : "You"}
                      </span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {formatDateTime(v.createdAt)}
                      </span>
                    </div>
                    {v.description ? (
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">{v.description}</p>
                    ) : null}
                    {v.snapshot ? (
                      <button
                        type="button"
                        className="mt-2 flex items-center gap-1 text-[10px] text-[var(--brand-primary)] hover:underline"
                        onClick={() => onRestoreVersion(v._id)}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore this version
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
