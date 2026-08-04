"use client";

import { useMemo, useRef } from "react";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { spectraBus } from "../events";
import { IncrementalRichContentParser, type RichInline } from "../rich-content";

function InlineContent({ content, verifiedSourceIds }: { content: RichInline[]; verifiedSourceIds: ReadonlySet<string> }) {
  return <>{content.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "inline_code") return <code key={index} className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[.9em]">{node.code}</code>;
    if (node.type === "inline_math") return <span key={index} aria-label={`Math: ${node.math}`}>${node.math}$</span>;
    if (node.type === "citation") return verifiedSourceIds.has(node.sourceId)
      ? <button key={index} type="button" className="mx-0.5 rounded border border-[var(--border-default)] px-1 text-[.82em] font-semibold text-[var(--accent-cyan)]" title={`Verified source ${node.sourceId}`} aria-label={`Open citation ${node.label ?? node.sourceId}`}>[{node.label ?? node.sourceId.replace(/^source:/, "")}]</button>
      : <span key={index} className="text-[var(--text-secondary)]" title="Source verification unavailable">[{node.label ?? "source"}]</span>;
    if (node.type === "reference") return <button key={index} type="button" onClick={() => void spectraBus.command("work.open", { workId: node.workId, surface: "panel" })} className="mx-0.5 rounded border border-[var(--border-default)] px-1 text-[.85em] font-semibold text-[var(--text-primary)]">{node.label ?? "Referenced work"}</button>;
    return <sup key={index}>[{node.id}]</sup>;
  })}</>;
}

function hasNativeIdentity(content: RichInline[]) {
  return content.some((node) => node.type === "citation" || node.type === "reference");
}

export function SpectraRichContent({ content, className, verifiedSourceIds = [] }: { content: string; className?: string; verifiedSourceIds?: readonly string[] }) {
  const parser = useRef(new IncrementalRichContentParser());
  const ast = useMemo(() => parser.current.replace(content), [content]);
  const verified = useMemo(() => new Set(verifiedSourceIds), [verifiedSourceIds]);
  return <div className={cn("spectra-rich-content", className)} data-rich-complete={ast.complete}>
    {ast.blocks.map((block) => {
      if (block.type === "code_block" || block.type === "math_block" || block.type === "table" || block.type === "list") return <RichText key={block.id} content={block.raw} />;
      if (block.type === "media") return <figure key={block.id}><img src={block.url} alt={block.alt} className="max-w-full rounded-[8px]" /></figure>;
      if (block.type === "heading") { if (!hasNativeIdentity(block.content)) return <RichText key={block.id} content={block.raw} />; const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; return <Tag key={block.id} className="mb-2 mt-5 font-display font-semibold"><InlineContent content={block.content} verifiedSourceIds={verified} /></Tag>; }
      if (block.type === "callout") return <aside key={block.id} data-tone={block.tone} className="my-3 border-l-2 border-[var(--accent-cyan)] bg-[var(--bg-secondary)] px-3 py-2">{hasNativeIdentity(block.content) ? <InlineContent content={block.content} verifiedSourceIds={verified} /> : <RichText content={block.raw} />}</aside>;
      if (block.type === "source_note") return <aside key={block.id} className="my-2 text-[.88em] text-[var(--text-secondary)]"><strong>Source: </strong><InlineContent content={block.content} verifiedSourceIds={verified} /></aside>;
      if (block.type === "footnote") return <p key={block.id} className="text-[.84em] text-[var(--text-secondary)]"><sup>{block.footnoteId}</sup> <InlineContent content={block.content} verifiedSourceIds={verified} /></p>;
      return hasNativeIdentity(block.content) ? <p key={block.id} className="my-3 leading-[1.78] first:mt-0 last:mb-0"><InlineContent content={block.content} verifiedSourceIds={verified} /></p> : <RichText key={block.id} content={block.raw} />;
    })}
  </div>;
}
