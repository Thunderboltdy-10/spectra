"use client";

import { useMemo, useRef } from "react";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { spectraBus } from "../events";
import { IncrementalRichContentParser, type RichInline } from "../rich-content";

/**
 * Where a verified source lives: a work in the user's library opens in the
 * Side, a web page in a new tab.
 */
export type CitationSource = { id: string; title?: string } & ({ workId: string } | { url: string });

type Verified = { ids: ReadonlySet<string>; sources: ReadonlyMap<string, CitationSource> };

const CITATION_CLASS = "mx-0.5 rounded border border-[var(--border-default)] px-1 text-micro font-semibold text-[var(--accent-cyan)]";

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Opens a verified source where it lives. */
export function openCitationSource(source: CitationSource) {
  if ("workId" in source) {
    void spectraBus.command("work.open", { workId: source.workId, surface: "panel" });
    return;
  }
  const url = webUrl(source.url);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function Citation({ node, verified }: { node: Extract<RichInline, { type: "citation" }>; verified: Verified }) {
  const text = `[${node.label ?? node.sourceId.replace(/^source:/, "")}]`;
  const source = verified.sources.get(node.sourceId);
  const opens = source && ("workId" in source || webUrl(source.url));
  if (source && opens) {
    const where = "workId" in source ? "in the Side" : "in a new tab";
    // A work opens in the Side out of the citation (MOTION.md, "Shared elements").
    return <button type="button" {...("workId" in source ? { "data-life-launch": "" } : {})} onClick={() => openCitationSource(source)} className={CITATION_CLASS} title={source.title ? `Verified source: ${source.title}` : "Verified source"} aria-label={`Open the source ${source.title ?? node.label ?? ""} ${where}`.replace(/\s+/g, " ")}>{text}</button>;
  }
  // Verified, but with nowhere to open: no button that does nothing.
  if (source || verified.ids.has(node.sourceId)) return <span className={CITATION_CLASS} title="Verified source">{text}</span>;
  return <span className="text-[var(--text-secondary)]" title="Source verification unavailable">[{node.label ?? "source"}]</span>;
}

function InlineContent({ content, verified }: { content: RichInline[]; verified: Verified }) {
  return <>{content.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "inline_code") return <code key={index} className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-caption">{node.code}</code>;
    if (node.type === "inline_math") return <span key={index} aria-label={`Math: ${node.math}`}>${node.math}$</span>;
    if (node.type === "citation") return <Citation key={index} node={node} verified={verified} />;
    if (node.type === "reference") return <button key={index} type="button" data-life-launch="" onClick={() => void spectraBus.command("work.open", { workId: node.workId, surface: "panel" })} className="mx-0.5 rounded border border-[var(--border-default)] px-1 text-micro font-semibold text-[var(--text-primary)]">{node.label ?? "Referenced work"}</button>;
    return <sup key={index}>[{node.id}]</sup>;
  })}</>;
}

const EMPTY_IDS: readonly string[] = [];
const EMPTY_SOURCES: readonly CitationSource[] = [];

function hasNativeIdentity(content: RichInline[]) {
  return content.some((node) => node.type === "citation" || node.type === "reference");
}

export function SpectraRichContent({ content, className, verifiedSourceIds = EMPTY_IDS, sources = EMPTY_SOURCES }: {
  content: string;
  className?: string;
  /** Sources verified without a place to open them. */
  verifiedSourceIds?: readonly string[];
  /** Verified sources and where each opens. */
  sources?: readonly CitationSource[];
}) {
  const parser = useRef(new IncrementalRichContentParser());
  const ast = useMemo(() => parser.current.replace(content), [content]);
  const verified = useMemo<Verified>(
    () => ({ ids: new Set(verifiedSourceIds), sources: new Map(sources.map((source) => [source.id, source])) }),
    [verifiedSourceIds, sources],
  );
  return <div className={cn("spectra-rich-content", className)} data-rich-complete={ast.complete}>
    {ast.blocks.map((block) => {
      if (block.type === "code_block" || block.type === "math_block" || block.type === "table" || block.type === "list") return <RichText key={block.id} content={block.raw} />;
      if (block.type === "media") return (
        <figure key={block.id}>
          {/* User-authored media URLs are not known at build time. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className="max-w-full rounded-control" />
        </figure>
      );
      if (block.type === "heading") { if (!hasNativeIdentity(block.content)) return <RichText key={block.id} content={block.raw} />; const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; return <Tag key={block.id} className="mb-2 mt-5 font-display font-semibold"><InlineContent content={block.content} verified={verified} /></Tag>; }
      if (block.type === "callout") return <aside key={block.id} data-tone={block.tone} className="my-3 border-l-2 border-[var(--accent-cyan)] bg-[var(--bg-secondary)] px-3 py-2">{hasNativeIdentity(block.content) ? <InlineContent content={block.content} verified={verified} /> : <RichText content={block.raw} />}</aside>;
      if (block.type === "source_note") return <aside key={block.id} className="my-2 text-caption text-[var(--text-secondary)]"><strong>Source: </strong><InlineContent content={block.content} verified={verified} /></aside>;
      if (block.type === "footnote") return <p key={block.id} className="text-micro text-[var(--text-secondary)]"><sup>{block.footnoteId}</sup> <InlineContent content={block.content} verified={verified} /></p>;
      return hasNativeIdentity(block.content) ? <p key={block.id} className="my-3 leading-[1.78] first:mt-0 last:mb-0"><InlineContent content={block.content} verified={verified} /></p> : <RichText key={block.id} content={block.raw} />;
    })}
  </div>;
}
