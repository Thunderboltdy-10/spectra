import { createHash } from "node:crypto";
import { verifyCitation, type SourceRecord, type EvidenceSpan } from "../sources/records";
import type { ResearchEvidenceBundle } from "../sources/research";
import { wordCitationLabel, type WordCitationInline, type WordSource } from "../lenses/docx-citation-schema";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

/** Only handles in structural reference fields can select server-owned evidence. */
export function contentEvidenceRefs(value: unknown, refs = new Set<string>(), depth = 0): Set<string> {
  if (depth > 16 || !value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    value.forEach((child) => contentEvidenceRefs(child, refs, depth + 1));
    return refs;
  }
  const record = row(value);
  if (Array.isArray(record.sourceRefs)) for (const ref of record.sourceRefs) {
    if (typeof ref === "string" && /^(?:source|evidence):/.test(ref)) refs.add(ref);
  }
  const native = row(record.sourceRef);
  if (typeof native.sourceId === "string") refs.add(native.sourceId);
  if (Array.isArray(native.evidenceIds)) for (const ref of native.evidenceIds) if (typeof ref === "string") refs.add(ref);
  Object.values(record).forEach((child) => contentEvidenceRefs(child, refs, depth + 1));
  return refs;
}

function shortId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 28); }

function citationLabel(source: SourceRecord, spans: EvidenceSpan[]) {
  const pages = [...new Set(spans.flatMap((span) => span.page ? [span.page] : []))].sort((a, b) => a - b);
  return `${source.title}${pages.length ? `, ${pages.length === 1 ? "p." : "pp."} ${pages.join(", ")}` : ""}`;
}

function nativeCitation(source: SourceRecord, spans: EvidenceSpan[], blockId: string): WordCitationInline {
  const metadata: WordSource = {
    tag: `Spectra${shortId(source.id)}`,
    title: source.title,
    sourceType: source.sourceType === "book" ? "Book" : source.sourceType === "paper" ? "JournalArticle" : source.canonicalUrl ? "DocumentFromInternetSite" : "Report",
    ...(source.authors?.length ? { authors: source.authors.map((last) => ({ last })) } : {}),
    ...(source.publishedAt && /^\d{4}/.test(source.publishedAt) ? { year: source.publishedAt.slice(0, 4) } : {}),
    ...(source.canonicalUrl ? { url: source.canonicalUrl } : {}),
  };
  const pages = [...new Set(spans.flatMap((span) => span.page ? [span.page] : []))].sort((a, b) => a - b).join(", ");
  return {
    kind: "citation", citationId: `citation:${shortId(`${blockId}:${source.id}:${spans.map((span) => span.id).join(":")}`)}`,
    source: metadata, ...(pages ? { pages } : {}), text: wordCitationLabel(metadata, pages || undefined),
    sourceRef: { sourceId: source.id, evidenceIds: spans.map((span) => span.id), passages: spans.map(({ sourceId: _sourceId, ...span }) => span) },
  };
}

/** Materialize trusted metadata and portable citations before quality/save.
 * A bare source handle never silently selects an unrelated first passage.
 */
export function prepareContentEvidence(blueprintKey: string, value: unknown, bundle?: ResearchEvidenceBundle): unknown {
  const content = row(value);
  const refs = contentEvidenceRefs(content);
  if (!refs.size && !Array.isArray(content.sources)) return value;
  const sources = new Map((bundle?.sources ?? []).map((source) => [source.id, source]));
  const evidence = new Map((bundle?.evidence ?? []).map((span) => [span.id, span]));
  const selected = new Set<string>();
  const spansFor = (region: unknown) => {
    const groups = new Map<string, EvidenceSpan[]>();
    for (const ref of contentEvidenceRefs(region)) {
      if (ref.startsWith("source:")) {
        if (!sources.has(ref)) throw new Error("RESEARCH_SOURCE_REF_NOT_ISSUED");
        selected.add(ref);
      } else {
        const span = evidence.get(ref);
        if (!span || !sources.has(span.sourceId)) throw new Error("RESEARCH_EVIDENCE_REF_NOT_ISSUED");
        selected.add(span.sourceId);
        if (!sources.get(span.sourceId)!.verified) continue;
        verifyCitation({ sourceId: span.sourceId, evidenceIds: [ref] }, [...sources.values()], [span]);
        groups.set(span.sourceId, [...(groups.get(span.sourceId) ?? []), span]);
      }
    }
    return groups;
  };
  spansFor(content); // Reject an invented handle before saving any region.
  // Authored metadata is never proof of verification, even if its id is real.
  for (const authored of Array.isArray(content.sources) ? content.sources : []) {
    const id = row(authored).id;
    if (typeof id !== "string" || !sources.has(id)) throw new Error("RESEARCH_SOURCE_REF_NOT_ISSUED");
    selected.add(id);
  }
  if (blueprintKey === "document") {
    const priorBlocks = Array.isArray(content.blocks) ? content.blocks : [];
    const citedRegions = new Set(priorBlocks.flatMap((entry) => typeof row(row(entry).attrs).sourceCitationFor === "string" ? [row(row(entry).attrs).sourceCitationFor] : []));
    const blocks = priorBlocks.flatMap((entry) => {
      const block = row(entry);
      const citationFor = row(block.attrs).sourceCitationFor;
      const region = typeof citationFor === "string" ? row(priorBlocks.find((entry) => row(entry).id === citationFor)) : block;
      const explicitRefs = Array.isArray(region.sourceRefs);
      // A new structural selection replaces old generated citation refs. The
      // old native field is a rendering of that selection, not another source.
      const groups = spansFor(explicitRefs ? { sourceRefs: region.sourceRefs } : block);
      const existing = Array.isArray(block.inlineContent) ? block.inlineContent : [];
      const generated = existing.filter((entry) => {
        const inline = row(entry), ref = row(inline.sourceRef);
        return inline.kind === "citation" && typeof ref.sourceId === "string" && Array.isArray(ref.evidenceIds) &&
          inline.citationId === `citation:${shortId(`${String(region.id)}:${ref.sourceId}:${ref.evidenceIds.join(":")}`)}`;
      });
      if (explicitRefs && generated.length && !content.tiptap) {
        const retained = existing.filter((entry) => !generated.includes(entry));
        const manualSources = new Set(retained.filter((entry) => row(entry).kind === "citation").map((entry) => row(row(entry).sourceRef).sourceId));
        const citations = [...groups].filter(([sourceId]) => !manualSources.has(sourceId))
          .map(([sourceId, spans]) => nativeCitation(sources.get(sourceId)!, spans, String(region.id)));
        if (JSON.stringify(generated) === JSON.stringify(citations)) return [block];
        let text = String(block.text ?? "");
        for (const old of [...generated].reverse()) {
          const label = String(row(old).text ?? "");
          if (label && text.trimEnd().endsWith(label)) text = text.trimEnd().slice(0, -label.length).trimEnd();
        }
        const simpleText = retained.every((entry) => row(entry).kind === "text" && Object.keys(row(entry)).every((key) => key === "kind" || key === "text"));
        // Keep rich authored inlines. A changed plain block.text is authoritative
        // for the simple body initially generated by this helper.
        const base = typeof citationFor === "string" ? [] : simpleText ? [{ kind: "text", text }] : retained;
        const inlineContent = [...base, ...citations.flatMap((citation, index) => [
          ...(base.length || index ? [{ kind: "text", text: " " }] : []), citation,
        ])];
        return [{ ...block, text: `${text}${citations.map((citation) => ` ${citation.text}`).join("")}`.trim(), inlineContent }];
      }
      if (!groups.size || content.tiptap) return [block];
      const used = new Set(existing.flatMap((entry) => row(entry).kind === "citation" ? [row(row(entry).sourceRef).sourceId] : []));
      const citations = [...groups].flatMap(([sourceId, spans]) => used.has(sourceId) ? [] : [nativeCitation(sources.get(sourceId)!, spans, String(block.id))]);
      if (!citations.length) return [block];
      const inlines = citations.flatMap((citation) => [{ kind: "text", text: " " }, citation]);
      if (["paragraph", "heading", "quote"].includes(String(block.type))) {
        const base = existing.length ? existing : [{ kind: "text", text: String(block.text ?? "") }];
        return [{ ...block, text: `${String(block.text ?? "")}${citations.map((citation) => ` ${citation.text}`).join("")}`, inlineContent: [...base, ...inlines] }];
      }
      // Keep tables, lists and callouts intact; the citation is a native field
      // in an adjacent paragraph instead of flattening the original structure.
      if (citedRegions.has(block.id)) return [block];
      let citationBlockId = `evidence-${shortId(String(block.id))}`;
      while (priorBlocks.some((entry) => row(entry).id === citationBlockId)) citationBlockId += "-citation";
      return [block, { id: citationBlockId, type: "paragraph", attrs: { sourceCitationFor: block.id }, text: citations.map((citation) => citation.text).join(" "), inlineContent: inlines.slice(1) }];
    });
    return { ...content, blocks, sources: [...selected].flatMap((id) => sources.get(id)?.verified ? [sources.get(id)!] : []) };
  }
  if (blueprintKey === "presentation") {
    return { ...content, slides: (Array.isArray(content.slides) ? content.slides : []).map((entry) => {
      const slide = row(entry);
      const generated = [...spansFor(slide)].map(([sourceId, spans]) => ({
        id: `citation:${shortId(`${String(slide.id)}:${sourceId}`)}`,
        label: citationLabel(sources.get(sourceId)!, spans),
        ...(sources.get(sourceId)!.canonicalUrl ? { url: sources.get(sourceId)!.canonicalUrl } : {}),
        sourceRefs: spans.map((span) => span.id),
      }));
      return generated.length ? { ...slide, citations: generated } : slide;
    }) };
  }
  return value;
}

/**
 * Materialize server-verified citation metadata when an AI update writes a
 * presentation through JSON-pointer patches instead of replacing its full
 * content. Root slide-array and whole-slide writes carry enough context to
 * derive native citations. A sourceRefs-only write adds a matching citations
 * patch so the previous citation list cannot silently go stale.
 */
export function prepareContentPatchEvidence(
  blueprintKey: string,
  value: unknown,
  bundle?: ResearchEvidenceBundle,
) {
  if (blueprintKey !== "presentation") return value;
  const patch = row(value);
  if (!Array.isArray(patch.changes)) return value;

  const changes = patch.changes as unknown[];
  const citationChanges = new Map<string, unknown>();
  let preparedAnyChange = false;
  const preparedChanges = changes.flatMap((entry) => {
    const change = row(entry);
    if (typeof change.path !== "string") return [entry];
    const segments = change.path
      .replace(/^\//, "")
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (segments[0] !== "slides") return [entry];

    if (segments.length === 1 && Array.isArray(change.value)) {
      const prepared = row(
        prepareContentEvidence("presentation", { slides: change.value }, bundle),
      );
      preparedAnyChange = true;
      return [{ ...change, value: prepared.slides ?? change.value }];
    }

    if (
      segments.length === 2 &&
      change.value &&
      typeof change.value === "object" &&
      !Array.isArray(change.value)
    ) {
      const prepared = row(
        prepareContentEvidence("presentation", { slides: [change.value] }, bundle),
      );
      preparedAnyChange = true;
      return [{ ...change, value: (prepared.slides as unknown[] | undefined)?.[0] ?? change.value }];
    }

    if (
      segments.length === 3 &&
      segments[2] === "sourceRefs" &&
      Array.isArray(change.value)
    ) {
      const slideIndex = segments[1]!;
      const prepared = row(
        prepareContentEvidence(
          "presentation",
          { slides: [{ id: `patched-slide-${slideIndex}`, sourceRefs: change.value }] },
          bundle,
        ),
      );
      const slide = row((prepared.slides as unknown[] | undefined)?.[0]);
      citationChanges.set(`/slides/${slideIndex}/citations`, slide.citations ?? []);
      preparedAnyChange = true;
    }

    if (
      segments.length === 3 &&
      segments[2] === "citations" &&
      Array.isArray(change.value)
    ) {
      const evidenceRefs = [
        ...new Set(
          change.value.flatMap((citation) =>
            (Array.isArray(row(citation).sourceRefs)
              ? (row(citation).sourceRefs as unknown[])
              : []
            ).filter(
              (ref): ref is string =>
                typeof ref === "string" && ref.startsWith("evidence:"),
            ),
          ),
        ),
      ];
      if (evidenceRefs.length) {
        const prepared = row(
          prepareContentEvidence(
            "presentation",
            {
              slides: [
                { id: `patched-slide-${segments[1]!}`, sourceRefs: evidenceRefs },
              ],
            },
            bundle,
          ),
        );
        const slide = row((prepared.slides as unknown[] | undefined)?.[0]);
        preparedAnyChange = true;
        return [{ ...change, value: slide.citations ?? [] }];
      }
    }

    return [entry];
  });

  if (!preparedAnyChange) return value;
  const withoutStaleCitations = preparedChanges.filter((entry) => {
    const path = row(entry).path;
    return typeof path !== "string" || !citationChanges.has(path);
  });
  for (const [path, citationValue] of citationChanges) {
    withoutStaleCitations.push({ path, value: citationValue });
  }
  return { ...patch, changes: withoutStaleCitations };
}
