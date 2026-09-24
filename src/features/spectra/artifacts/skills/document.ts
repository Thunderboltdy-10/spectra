import { defineArtifactSkill } from "../types";

export const documentSkill = defineArtifactSkill({
  typeKey: "document",
  purpose:
    "Author structured long-form material whose stable blocks remain editable, citeable, printable, collaborative, and reusable across Spectra.",
  createWhen: [
    "The result is best read, revised, printed, cited, or embedded as structured prose.",
    "Notes, reports, essays, lab work, explanations, or source material need headings, tables, media, equations, callouts, or references.",
  ],
  inspect: [
    "Read the outline and document properties first, then request only the stable blocks, table cells, citations, embeds, or assets needed for the operation.",
    "Inspect the exact current selection, surrounding heading context, marks, comments, sources, and linked consumers before rewriting.",
    "For broad work, inspect heading order, length, accessibility, citation coverage, broken links, and layout risk before proposing changes.",
  ],
  regions: [
    "document properties",
    "stable block",
    "text selection",
    "heading and outline entry",
    "list or task item",
    "table",
    "table cell",
    "equation",
    "code block",
    "callout",
    "citation or footnote",
    "media and caption",
    "artifact embed",
  ],
  operations: [
    "For claims based on supplied evidence, put the exact supporting evidence handles in the block's sourceRefs. Spectra creates readable native citation fields and source metadata; do not invent verified sources or duplicate those citations in prose.",
    "For study material, teach the idea before testing it: explain mechanisms, connect concepts, include a worked example and likely misconception, then add a few retrieval questions with answers. Match depth to the learner and supplied evidence; do not pad with generic introductions.",
    "Choose a clear reading hierarchy with a specific title, useful headings, short focused paragraphs, and a table or diagram only where it explains a relationship. Keep prose substantive and the result easy to revise or print.",
    "For a narrow text edit, use the actual stable block path /blocks/id:<blockId>/text or its supplied index. Rewrite the section body without overwriting its heading or unrelated blocks.",
    "Inspect outline, selected blocks, sources, comments, embeds, and constraints.",
    "Insert, rewrite, move, split, merge, format, summarize, expand, translate, or partially restore the smallest stable blocks that satisfy the request.",
    "Create headings, lists, tasks, tables, callouts, code, equations, media captions, citations, footnotes, and live or pinned artifact embeds.",
    "Build or apply a document template, find and replace within scope, repair structure, verify requested length and style, and prepare print or export output.",
  ],
  preservationRules: [
    "Preserve unaffected blocks, marks, citations, comment anchors, stable IDs, embeds, assets, and accessible structure.",
    "Do not flatten tables, equations, tasks, callouts, media, or embeds into plain text unless the user explicitly requests a lossy conversion.",
    "A linked embed never grants access to its source; preserve live versus pinned behavior and surface inaccessible sources honestly.",
    "Use a proposal and comparison for a broad rewrite instead of silently replacing the live document.",
  ],
  validation: [
    "Check schema, stable IDs, heading order, broken references, citation targets, table structure, equation syntax, asset and embed access, and layout overflow.",
    "Verify keyboard order, alt text or captions, contrast, print representation, requested constraints, and that untargeted blocks remain byte-equivalent where required.",
  ],
  approvals: [
    "Preview broad rewrites, destructive removal, publishing, citation detachment, source-detaching changes, or conversion that loses unsupported layout.",
    "Focused insertions and rewrites inside an explicitly targeted block may proceed without interrupting the user.",
  ],
  connections: [
    "Documents can source quizzes and decks, embed permissioned Sheets charts and code visualisations, link tasks, and provide reviewed agent knowledge.",
    "ManageBac resources may be imported with provenance, while inaccessible linked sources remain unavailable even when the document itself is shared.",
  ],
  workingEffects: [
    "Text forms or morphs in the targeted block, table cells populate in place, and embedded objects resolve from their real source; independent blocks may animate concurrently.",
    "Every effect is tied to durable operation state and fully clears after success, failure, cancellation, rejection, permission loss, or navigation; reduced motion uses a quiet block outline and status label.",
  ],
  specialistGuides: [
    {
      id: "academic-sources",
      trigger:
        "The request adds, checks, reformats, or relies on citations, footnotes, quotations, or source-linked claims.",
      instructions: [
        "Inspect source permissions and citation metadata before writing.",
        "Use each supplied sourceId/evidenceId with its actual supporting passage or page. Cite the claim it supports, not just the whole artifact. Distinguish a source's observation from your inference; qualify gaps and contradictions instead of inventing attribution.",
        "Keep claim-to-source relationships explicit and never invent missing bibliographic details.",
        "Verify every changed citation target and preserve the user's citation style unless asked to change it.",
      ],
    },
    {
      id: "document-migration",
      trigger:
        "The operation imports DOCX, ODT, PDF, Markdown, HTML, or plain text.",
      instructions: [
        "Retain the immutable original, quarantine unsafe content, and produce an itemized fidelity report.",
        "Convert supported structure into native editable blocks; do not disguise flattened or omitted layout as exact.",
        "Verify headings, lists, tables, media, comments, citations, equations, and page boundaries after conversion.",
      ],
    },
  ],
});
