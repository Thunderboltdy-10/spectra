"use client";

import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileQuestion,
  LockKeyhole,
  Maximize2,
  Minimize2,
  RotateCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { blueprintMeta } from "./artifact-card";
import type { SpectraArtifactEmbed } from "../data/api";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textFrom(value: unknown, limit = 360): string {
  if (typeof value === "string") return value.slice(0, limit);
  if (Array.isArray(value)) return value.map((entry) => textFrom(entry, limit)).filter(Boolean).join(" · ").slice(0, limit);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map((entry) => textFrom(entry, limit)).filter(Boolean).join(" ").slice(0, limit);
  return value === undefined || value === null ? "" : String(value).slice(0, limit);
}

function ContentAdapter({ embed }: { embed: SpectraArtifactEmbed }) {
  const type = embed.source?.blueprintKey;
  const content = record(embed.source?.snapshot?.content);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  if (!type) return null;

  if (type === "document") {
    const blocks = Array.isArray(content.blocks) ? content.blocks.slice(0, embed.mode === "compact" ? 2 : 8) : [];
    return <div className="space-y-2">{blocks.map((block, index) => { const item = record(block); return <p key={String(item.id ?? index)} className={`${item.type === "heading" ? "font-display text-[16px] font-semibold text-[var(--text-primary)]" : "text-[12px] leading-5 text-[var(--text-secondary)]"}`}>{textFrom(item.text ?? item.content) || "Empty block"}</p>; })}{blocks.length === 0 ? <p className="text-[12px] text-[var(--text-tertiary)]">Empty document</p> : null}</div>;
  }
  if (type === "flashcard_deck") {
    const cards = Array.isArray(content.cards) ? content.cards.map(record) : [];
    const card = cards[Math.min(activeIndex, Math.max(0, cards.length - 1))];
    return <div><button type="button" onClick={() => setRevealed((value) => !value)} className="flex min-h-[116px] w-full items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-5 text-center"><span><span className="block text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--text-tertiary)]">{revealed ? "Answer" : "Prompt"}</span><span className="mt-2 block text-[15px] font-medium leading-6 text-[var(--text-primary)]">{textFrom(revealed ? card?.back : card?.front) || "Empty card"}</span></span></button>{embed.mode === "expanded" && cards.length > 1 ? <div className="mt-2 flex items-center justify-between"><button type="button" onClick={() => { setActiveIndex((value) => Math.max(0, value - 1)); setRevealed(false); }} disabled={activeIndex === 0} className="rounded-[6px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span className="text-[9px] text-[var(--text-tertiary)]">{activeIndex + 1} / {cards.length}</span><button type="button" onClick={() => { setActiveIndex((value) => Math.min(cards.length - 1, value + 1)); setRevealed(false); }} disabled={activeIndex >= cards.length - 1} className="rounded-[6px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div> : null}</div>;
  }
  if (type === "quiz") {
    const questions = Array.isArray(content.questions) ? content.questions.map(record) : [];
    const question = questions[Math.min(activeIndex, Math.max(0, questions.length - 1))];
    const options = Array.isArray(question?.options) ? question.options.map(record) : [];
    return <div><p className="text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{textFrom(question?.prompt) || "Empty question"}</p><div className="mt-3 space-y-1.5">{options.map((option, index) => { const id = String(option.id ?? index); return <button type="button" key={id} onClick={() => setSelected(id)} className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[11px] ${selected === id ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]"}`}><span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[8px]">{String.fromCharCode(65 + index)}</span>{textFrom(option.text ?? option.label)}</button>; })}</div><p className="mt-2 text-[8px] text-[var(--text-tertiary)]">Practice only · responses are separate from artifact content</p></div>;
  }
  if (type === "planner_task") {
    return <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-[8px] bg-[var(--bg-primary)] p-3"><div className="text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]">Status</div><div className="mt-1 text-[12px] font-semibold capitalize text-[var(--text-primary)]">{String(content.status ?? "todo").replaceAll("_", " ")}</div></div><div className="rounded-[8px] bg-[var(--bg-primary)] p-3"><div className="text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]">Priority</div><div className="mt-1 text-[12px] font-semibold capitalize text-[var(--text-primary)]">{String(content.priority ?? "medium")}</div></div><div className="rounded-[8px] bg-[var(--bg-primary)] p-3"><div className="text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]">Due</div><div className="mt-1 text-[12px] font-semibold text-[var(--text-primary)]">{typeof content.dueAt === "number" ? new Date(content.dueAt).toLocaleDateString() : "No date"}</div></div></div>;
  }
  if (type === "presentation") {
    const slides = Array.isArray(content.slides) ? content.slides.map(record) : [];
    const slide = slides[Math.min(activeIndex, Math.max(0, slides.length - 1))];
    return <div><div className="aspect-video rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-[8%]"><h4 className="font-display text-[clamp(15px,2vw,26px)] font-semibold text-[var(--text-primary)]">{textFrom(slide?.title) || "Untitled slide"}</h4><p className="mt-3 max-w-[76%] text-[10px] leading-4 text-[var(--text-secondary)]">{textFrom(slide?.objects, 220)}</p></div>{embed.mode === "expanded" && slides.length > 1 ? <div className="mt-2 flex items-center justify-center gap-3"><button type="button" onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}><ChevronLeft className="h-4 w-4" /></button><span className="text-[9px] text-[var(--text-tertiary)]">Slide {activeIndex + 1} of {slides.length}</span><button type="button" onClick={() => setActiveIndex((value) => Math.min(slides.length - 1, value + 1))}><ChevronRight className="h-4 w-4" /></button></div> : null}</div>;
  }
  if (type === "sheets") {
    const sheets = Array.isArray(content.sheets) ? content.sheets.map(record) : [];
    const sheet = sheets[0];
    const cells = record(sheet?.cells);
    const entries = Object.entries(cells).slice(0, embed.mode === "compact" ? 12 : 40);
    return <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]"><div className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[9px] font-semibold text-[var(--text-secondary)]">{String(sheet?.name ?? "Sheet 1")}</div><div className="grid grid-cols-4 bg-[var(--border-subtle)] gap-px">{entries.map(([address, value]) => <div key={address} className="min-h-9 bg-[var(--bg-primary)] px-2 py-1"><span className="block text-[7px] text-[var(--text-tertiary)]">{address}</span><span className="block truncate text-[10px] text-[var(--text-primary)]">{textFrom(record(value).value ?? value, 40)}</span></div>)}{entries.length === 0 ? <div className="col-span-4 p-6 text-center text-[10px] text-[var(--text-tertiary)]">Empty range</div> : null}</div></div>;
  }
  if (type === "code") {
    const files = Array.isArray(content.files) ? content.files.map(record) : [];
    const file = files[0];
    return <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[#151713] text-[#e8eadf]"><div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[9px] text-white/55"><Code2 className="h-3 w-3" />{String(file?.path ?? "source")}</div><pre className={`overflow-auto p-3 font-mono text-[9px] leading-4 ${embed.mode === "compact" ? "max-h-32" : "max-h-72"}`}>{String(file?.source ?? "")}</pre></div>;
  }
  if (type === "whiteboard") {
    const nodes = Array.isArray(content.nodes) ? content.nodes.map(record).slice(0, embed.mode === "compact" ? 8 : 24) : [];
    return <div className="relative min-h-[190px] overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[radial-gradient(circle_at_1px_1px,var(--border-subtle)_1px,transparent_0)] bg-[size:18px_18px]">{nodes.map((node, index) => <div key={String(node.id ?? index)} className="absolute max-w-[120px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[8px] text-[var(--text-primary)] shadow-sm" style={{ left: `${8 + (index * 23) % 70}%`, top: `${10 + (index * 31) % 68}%` }}>{textFrom(node.content, 70) || String(node.type ?? "Node")}</div>)}</div>;
  }
  if (type === "timetable") {
    const events = Array.isArray(content.events) ? content.events.map(record).slice(0, embed.mode === "compact" ? 3 : 8) : [];
    return <div className="space-y-1.5">{events.map((event, index) => <div key={String(event.id ?? index)} className="flex items-center gap-3 rounded-[7px] border border-[var(--border-subtle)] px-3 py-2"><CalendarDays className="h-3.5 w-3.5 text-[var(--accent-cyan)]" /><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{textFrom(event.title) || "Event"}</div><div className="text-[8px] text-[var(--text-tertiary)]">{typeof event.startAt === "number" ? new Date(event.startAt).toLocaleString() : "Time not set"}</div></div></div>)}</div>;
  }
  return <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 text-[11px] leading-5 text-[var(--text-secondary)]">{textFrom(content, embed.mode === "compact" ? 260 : 900) || "No preview content"}</div>;
}

export function ArtifactEmbed({ embed, onOpenSource, onRetry, onModeChange }: { embed: SpectraArtifactEmbed; onOpenSource?: (artifactId: string) => void; onRetry?: () => void; onModeChange?: (mode: "compact" | "expanded") => void }) {
  const meta = embed.source ? blueprintMeta[embed.source.blueprintKey] : null;
  const Icon = meta?.icon ?? FileQuestion;
  const status = useMemo(() => {
    if (embed.state === "no_access") return { icon: LockKeyhole, title: "Source access required", detail: "This embed does not grant access to its source artifact." };
    if (embed.state === "deleted") return { icon: AlertCircle, title: "Source was deleted", detail: "The container remains intact, but this projection is no longer available." };
    if (embed.state === "version_unavailable") return { icon: AlertCircle, title: "Pinned version unavailable", detail: "The retained source version could not be loaded." };
    return null;
  }, [embed.state]);
  if (status) {
    const StatusIcon = status.icon;
    return <section className="rounded-[11px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"><StatusIcon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-[var(--text-primary)]">{status.title}</div><p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">{status.detail}</p></div>{onRetry ? <button type="button" onClick={onRetry} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Retry embed"><RotateCw className="h-3.5 w-3.5" /></button> : null}</div></section>;
  }
  if (!embed.source || !meta) return null;
  return <section className="overflow-hidden rounded-[11px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_8px_28px_rgba(28,24,18,0.06)]"><header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--embed-accent)_9%,var(--bg-secondary))]" style={{ "--embed-accent": meta.color, color: meta.color } as CSSProperties}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{embed.source.title}</div><div className="mt-0.5 flex items-center gap-1.5 text-[8px] uppercase tracking-[.1em] text-[var(--text-tertiary)]"><span>{meta.label}</span><span>·</span><span>{embed.versionPolicy === "pinned" ? "Pinned" : "Live"}</span>{embed.state === "archived" ? <><span>·</span><span>Archived</span></> : null}</div></div>{onModeChange ? <button type="button" onClick={() => onModeChange(embed.mode === "compact" ? "expanded" : "compact")} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label={embed.mode === "compact" ? "Expand embed" : "Collapse embed"}>{embed.mode === "compact" ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}</button> : null}{onOpenSource ? <button type="button" onClick={() => onOpenSource(embed.source!.artifactId)} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[9px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Open source<ArrowUpRight className="h-3 w-3" /></button> : null}</header><div className={embed.mode === "compact" ? "p-3.5" : "p-4 sm:p-5"}><ContentAdapter embed={embed} /></div>{embed.source.summary ? <footer className="border-t border-[var(--border-subtle)] px-4 py-2 text-[9px] leading-4 text-[var(--text-tertiary)]">{embed.source.summary}</footer> : null}</section>;
}
