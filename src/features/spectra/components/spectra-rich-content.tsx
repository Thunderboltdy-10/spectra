"use client";

import dynamic from "next/dynamic";
import { createElement, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EquationPreview } from "../editor/equation-preview";
import { spectraBus } from "../events";
import { workRegionFrom } from "../anchors/locate";
import {
  IncrementalRichContentParser,
  richContentFromStored,
  richContentToPlainText,
  type RichBlock,
  type RichInline,
  type RichMark,
  type SpectraRichContentAst,
} from "../rich-content";

/*
 * Spectra's one rich-content renderer.
 *
 * It draws the shared model with exactly the DOM the TipTap editors write
 * (a checklist is `ul[data-type=taskList]`, a callout `aside[data-spectra-
 * callout]`, an equation `div[data-equation]`) and gives no element a style
 * of its own. `.spectra-prose` styles both, so a reply, a comment, a
 * flashcard face and a document read as the same text.
 */

/**
 * Where a verified source lives: a work in the user's library opens in the
 * Side, a web page in a new tab.
 */
export type CitationSource = { id: string; title?: string } & ({ workId: string } | { url: string });

type Verified = { ids: ReadonlySet<string>; sources: ReadonlyMap<string, CitationSource> };

const ArtifactEmbedById = dynamic(() => import("./artifact-embed-host").then((module) => module.ArtifactEmbedById), { ssr: false });

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A link a learner can follow: same-site paths and web pages only. */
function safeHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return webUrl(value) ?? (value.startsWith("mailto:") ? value : null);
}

/**
 * Where a picture may come from: a link's places, plus the page's own object
 * URLs, which is how a file read in the viewer shows its embedded pictures.
 */
function safeMediaSrc(value: string) {
  return value.startsWith("blob:") ? value : safeHref(value);
}

/**
 * Opens a verified source where it lives. A work source opens at the place
 * the citation names (its WHERE: a region a search gave, "slide-3", a range,
 * a heading), when the work can find it.
 */
export function openCitationSource(source: CitationSource, where?: string) {
  if ("workId" in source) {
    const region = citationRegion(where);
    void spectraBus.command("work.open", { workId: source.workId, surface: "panel", ...(region ? { region } : {}) });
    return;
  }
  const url = webUrl(source.url);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

/** The place a citation's WHERE names; "source" is the writer's placeholder for "the whole source". */
export function citationRegion(where: string | undefined) {
  const id = where?.trim();
  return id && id.toLowerCase() !== "source" ? workRegionFrom(id) : undefined;
}

function Citation({ node, verified }: { node: Extract<RichInline, { type: "citation" }>; verified: Verified }) {
  const text = `[${node.label ?? node.sourceId.replace(/^source:/, "")}]`;
  const source = verified.sources.get(node.sourceId);
  const opens = source && ("workId" in source || webUrl(source.url));
  if (source && opens) {
    const where = "workId" in source ? "in the Side" : "in a new tab";
    // A work opens in the Side out of the citation (MOTION.md, "Shared elements").
    return <button type="button" data-spectra-citation="" {...("workId" in source ? { "data-life-launch": "" } : {})} onClick={() => openCitationSource(source, node.evidenceIds[0])} title={source.title ? `Verified source: ${source.title}` : "Verified source"} aria-label={`Open the source ${source.title ?? node.label ?? ""} ${where}`.replace(/\s+/g, " ")}>{text}</button>;
  }
  // Verified, but with nowhere to open: no button that does nothing.
  if (source || verified.ids.has(node.sourceId)) return <span data-spectra-citation="" title="Verified source">{text}</span>;
  return <span data-spectra-citation="" data-unverified="" title="Source verification unavailable">[{node.label ?? "source"}]</span>;
}

const MARK_TAGS: Record<RichMark, string> = { bold: "strong", italic: "em", underline: "u", strike: "s" };

function runStyle(style: Extract<RichInline, { type: "text" }>["style"]): CSSProperties | undefined {
  if (!style) return undefined;
  return {
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    // A run's size is in points of the surface it is on: a slide scaled into a thumbnail sets `--rich-pt` smaller.
    ...(style.fontSizePt ? { fontSize: `calc(var(--rich-pt, 1pt) * ${style.fontSizePt})` } : {}),
    ...(style.color ? { color: style.color } : {}),
    // A highlighter is a wash, so the text stays readable on either theme.
    ...(style.highlight ? { backgroundColor: `color-mix(in srgb, ${style.highlight} 45%, transparent)` } : {}),
  };
}

/** Who made a tracked change and when, as its tooltip says it. */
function revisionLabel(node: Extract<RichInline, { type: "revision" }>) {
  const day = node.date && /^\d{4}-\d{2}-\d{2}/.test(node.date) ? node.date.slice(0, 10) : undefined;
  return `${node.kind === "insert" ? "Inserted" : "Deleted"} by ${node.author || "Word"}${day ? ` on ${day}` : ""}`;
}

function Inlines({ content, verified }: { content: readonly RichInline[]; verified: Verified }) {
  return <>{content.map((node, index) => {
    switch (node.type) {
      case "text": {
        let element: ReactNode = node.text;
        if (node.style) element = <span style={runStyle(node.style)}>{element}</span>;
        for (const mark of [...(node.marks ?? [])].reverse()) element = createElement(MARK_TAGS[mark], null, element);
        return <Fragment key={index}>{element}</Fragment>;
      }
      case "inline_code":
        return <code key={index}>{node.code}</code>;
      case "inline_math":
        return <span key={index} className="spectra-equation spectra-equation-inline" data-inline-equation="true">
          {node.complete ? <EquationPreview latex={node.math} displayMode={false} forceRender={false} /> : `$${node.math}`}
        </span>;
      case "link": {
        const href = safeHref(node.href);
        const inner = <Inlines content={node.content} verified={verified} />;
        if (!href) return <span key={index}>{inner}</span>;
        const external = !href.startsWith("/");
        return <a key={index} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>;
      }
      case "citation":
        return <Citation key={index} node={node} verified={verified} />;
      case "reference":
        return <button key={index} type="button" data-spectra-work-ref="" data-life-launch="" onClick={() => void spectraBus.command("work.open", { workId: node.workId, surface: "panel" })}>{node.label ?? "Referenced work"}</button>;
      case "footnote_ref":
        return <sup key={index} data-footnote-ref="">[{node.id}]</sup>;
      case "image":
        // User-authored media URLs are not known at build time.
        // eslint-disable-next-line @next/next/no-img-element
        return safeMediaSrc(node.url) ? <img key={index} src={node.url} alt={node.alt} /> : <Fragment key={index}>{node.alt}</Fragment>;
      case "break":
        return <br key={index} />;
      case "revision":
        return createElement(
          node.kind === "insert" ? "ins" : "del",
          { key: index, "data-revision": node.kind, title: revisionLabel(node) },
          <Inlines content={node.content} verified={verified} />,
        );
      case "comment":
        return <mark key={index} data-comment={node.ids.join(" ")}><Inlines content={node.content} verified={verified} /></mark>;
      case "comment_ref":
        return <sup key={index} data-comment-ref={node.id} aria-label={`Comment ${node.label}`}>{node.label}</sup>;
    }
  })}</>;
}

// Code highlighting arrives after the code: the text is there at once and the
// colours land when the highlighter has loaded.
type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] };
let highlighter: Promise<(code: string, language: string) => HastNode[]> | null = null;

function loadHighlighter() {
  highlighter ??= import("rehype-highlight").then(({ default: rehypeHighlight }) => {
    // An unknown language is left plain.
    const transform = rehypeHighlight();
    return (code: string, language: string) => {
      const codeNode: HastNode = { type: "element", tagName: "code", properties: { className: [`language-${language}`] }, children: [{ type: "text", value: code }] };
      const tree = { type: "root", children: [{ type: "element", tagName: "pre", properties: {}, children: [codeNode] }] };
      try {
        (transform as (tree: unknown, file: unknown) => void)(tree, { message: () => undefined });
      } catch {
        return [{ type: "text", value: code }];
      }
      return codeNode.children ?? [];
    };
  });
  return highlighter;
}

function hastToReact(nodes: readonly HastNode[]): ReactNode {
  return nodes.map((node, index) => node.type === "text"
    ? node.value
    : <span key={index} className={node.properties?.className?.join(" ")}>{hastToReact(node.children ?? [])}</span>);
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [highlighted, setHighlighted] = useState<{ code: string; nodes: HastNode[] } | null>(null);
  useEffect(() => {
    if (!language) return;
    let live = true;
    void loadHighlighter().then((highlight) => {
      if (live) setHighlighted({ code, nodes: highlight(code, language) });
    });
    return () => { live = false; };
  }, [code, language]);
  return <pre><code className={language ? `language-${language}` : undefined}>{highlighted?.code === code ? hastToReact(highlighted.nodes) : code}</code></pre>;
}

function align(value?: string): CSSProperties | undefined {
  return value ? { textAlign: value as CSSProperties["textAlign"] } : undefined;
}

function Block({ block, verified }: { block: RichBlock; verified: Verified }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p style={align(block.align)}><Inlines content={block.content} verified={verified} /></p>;
    case "heading":
      return createElement(`h${block.level}`, { style: align(block.align) }, <Inlines content={block.content} verified={verified} />);
    case "list": {
      const items = block.items.map((item, index) => {
        const body = <Blocks blocks={item.blocks} verified={verified} />;
        if (block.kind !== "task") return <li key={index}>{body}</li>;
        return <li key={index} data-type="taskItem" data-checked={item.checked ? "true" : "false"}>
          <label><input type="checkbox" checked={Boolean(item.checked)} disabled readOnly aria-label={item.checked ? "Done" : "Not done"} /><span /></label>
          <div>{body}</div>
        </li>;
      });
      if (block.kind === "ordered") return <ol start={block.start}>{items}</ol>;
      return <ul {...(block.kind === "task" ? { "data-type": "taskList" } : {})}>{items}</ul>;
    }
    case "quote":
      return <blockquote><Blocks blocks={block.blocks} verified={verified} /></blockquote>;
    case "callout":
      return <aside data-spectra-callout="true" data-callout-type={block.tone} className={`callout callout-${block.tone}`}><Blocks blocks={block.blocks} verified={verified} /></aside>;
    case "code_block":
      return <CodeBlock code={block.code} language={block.language} />;
    case "math_block":
      return block.complete
        ? <div className="spectra-equation spectra-equation-block is-center" data-equation="true"><EquationPreview latex={block.math} displayMode forceRender={false} /></div>
        : <pre data-equation-pending=""><code>{block.math}</code></pre>;
    case "table": {
      const [head, ...rows] = block.header ? block.rows : [undefined, ...block.rows];
      const cells = (row: readonly RichInline[][], tag: "th" | "td") => row.map((cell, index) => createElement(tag, { key: index }, <Inlines content={cell} verified={verified} />));
      return <div className="tableWrapper"><table>
        {head ? <thead><tr>{cells(head, "th")}</tr></thead> : null}
        <tbody>{rows.map((row, index) => row ? <tr key={index}>{cells(row, "td")}</tr> : null)}</tbody>
      </table></div>;
    }
    case "media":
      return safeMediaSrc(block.url)
        // User-authored media URLs are not known at build time.
        // eslint-disable-next-line @next/next/no-img-element
        ? <figure><img src={block.url} alt={block.alt} /></figure>
        : null;
    case "embed":
      return <div data-spectra-reference="" data-reference-id={block.embedId}>
        {block.embedId ? <ArtifactEmbedById embedId={block.embedId} /> : block.workId ? <button type="button" data-spectra-work-ref="" data-life-launch="" onClick={() => void spectraBus.command("work.open", { workId: block.workId!, surface: "panel" })}>{block.label ?? "Referenced work"}</button> : null}
      </div>;
    case "rule":
      return <hr />;
    case "source_note":
      return <p data-source-note=""><strong>Source: </strong><Inlines content={block.content} verified={verified} /></p>;
    case "footnote":
      return <p data-footnote=""><sup>{block.footnoteId}</sup> <Inlines content={block.content} verified={verified} /></p>;
  }
}

function Blocks({ blocks, verified }: { blocks: readonly RichBlock[]; verified: Verified }) {
  return <>{blocks.map((block) => <Fragment key={block.id}><Block block={block} verified={verified} /></Fragment>)}</>;
}

const EMPTY_IDS: readonly string[] = [];
const EMPTY_SOURCES: readonly CitationSource[] = [];

/**
 * Draws rich content: Markdown as it streams (`content`), or a model an
 * adapter has already read from a stored format (`ast`).
 */
export function SpectraRichContent({ content, ast, className, verifiedSourceIds = EMPTY_IDS, sources = EMPTY_SOURCES }: {
  className?: string;
  /** Sources verified without a place to open them. */
  verifiedSourceIds?: readonly string[];
  /** Verified sources and where each opens. */
  sources?: readonly CitationSource[];
} & ({ content: string; ast?: undefined } | { ast: SpectraRichContentAst; content?: undefined })) {
  const parser = useRef<IncrementalRichContentParser | null>(null);
  const model = useMemo(() => {
    if (ast) return ast;
    parser.current ??= new IncrementalRichContentParser();
    return parser.current.replace(content ?? "");
  }, [ast, content]);
  const verified = useMemo<Verified>(
    () => ({ ids: new Set(verifiedSourceIds), sources: new Map(sources.map((source) => [source.id, source])) }),
    [verifiedSourceIds, sources],
  );
  return <div className={cn("spectra-prose", className)} data-rich-complete={model.complete}>
    <Blocks blocks={model.blocks} verified={verified} />
  </div>;
}

const NO_SOURCES: Verified = { ids: new Set(), sources: new Map() };

/**
 * A stored text field drawn read-only: a quiz question, a flashcard face, an
 * option, a note. The value is whatever its field wrote (editor HTML or
 * Markdown). `inline` keeps a one-paragraph value inside a line, for an
 * option in a button or a label in a row.
 */
export function SpectraStoredText({ value, fallback = "", inline = false, className }: {
  value: string;
  fallback?: string;
  inline?: boolean;
  className?: string;
}) {
  const ast = useMemo(() => {
    const stored = richContentFromStored(value);
    // A cleared editor still writes `<p></p>`: an empty field reads as its fallback.
    const empty = stored.blocks.every((block) => block.type !== "media" && block.type !== "embed") && !richContentToPlainText(stored).trim();
    return empty ? richContentFromStored(fallback) : stored;
  }, [fallback, value]);
  const only = ast.blocks.length === 1 ? ast.blocks[0] : undefined;
  if (inline && (!only || only.type === "paragraph")) {
    return <span className={cn("spectra-prose spectra-prose-inline", className)}>{only?.type === "paragraph" ? <Inlines content={only.content} verified={NO_SOURCES} /> : null}</span>;
  }
  return <SpectraRichContent ast={ast} className={className} />;
}
