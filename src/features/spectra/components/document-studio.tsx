"use client";

import { describeFailure } from "@/components/ui/truthful-state";
import { uniqueToken } from "@/lib/unique-token";
import type { Editor, JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { isLocalCollaborativeDocumentChange } from "../editor/collaboration-change";
import { applyDocumentStudioProjection } from "../editor/document-studio-projection";
import Highlight from "@tiptap/extension-highlight";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useMutation } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import StarterKit from "@tiptap/starter-kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  ChevronDown,
  Highlighter,
  History,
  ListOrdered,
  Pencil,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type * as Y from "yjs";
import { toast } from "@/components/ui/toast";
import { SpectraTiptapAutocomplete } from "../compute/autocomplete";
import {
  commandContext,
  commandForBinding,
  eventBelongsToFocusedStudio,
  type CommandBinding,
  type CommandParam,
} from "../commands";
import { DOCUMENT_EXPORT_COPIES } from "../capabilities";
import {
  DOCUMENT_STYLE_OPTIONS,
  documentCommandBindings,
  type DocumentCommandHandlers,
} from "../commands/office/document-commands";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
} from "../data/api";
import {
  AiRegionDecoration,
  aiRegionDecorationKey,
  type AiRegionDecorationTarget,
} from "../editor/ai-region-decoration";
import {
  AiSpeculationDecoration,
  aiSpeculationKey,
  type SpeculativeBlockText,
} from "../editor/ai-speculation-decoration";
import { AiTextResolve } from "../editor/ai-text-resolve";
import { Callout } from "../editor/callout-node";
import { DocumentImage, NativeDocxImage } from "../editor/document-image";
import {
  bibliographyFromNavigator,
  bibliographyNode,
  documentFindPattern,
  groupCitationUses,
  outlineEntryAt,
  type BibliographyStyle,
  type DocumentCitationUse,
  type DocumentMatch,
  type DocumentOutlineEntry,
  type FindOptions,
} from "../editor/document-navigation";
import { Endnote, Footnote, SpectraNotes } from "../editor/document-notes";
import { academicSelection, executeAcademicEditorOperations } from "../editor/document-academic-commands";
import type { DocumentAcademicOperation } from "../commands/office/document-academic-operations";
import { documentBlocksFromJson } from "../lenses/document-projection";
import { nextWordNoteId, type WordTextAnchor } from "../lenses/docx-academic-schema";
import type { WordSource } from "../lenses/docx-citation-schema";
import { CitationSourcePickers } from "./document-citation-pickers";
import { DocumentSpreadSheets, spreadStyle, useDocumentCanvas, useDocumentSpread } from "./document-spread";
import { DocumentStatusRail, useDocumentZoom, usePageCount, useSheetFit } from "./document-status-rail";
import { editNoteText } from "../editor/note-text-edit";
import {
  PageBreak,
  ParagraphFrame,
  SectionBreak,
} from "../editor/document-structure";
import { DragHandle } from "../editor/drag-handle";
import { Equation, InlineEquation } from "../editor/equation-node";
import {
  SpectraCitationNode,
  WordCommentBoundary,
  WordRevision,
  SpectraReferenceNode,
} from "../editor/reference-citation-nodes";
import {
  SlashCommand,
  caretPoint,
  documentSlashItems,
  filterSlashCommands,
  type SlashCommandDispatcher,
} from "../editor/slash-command-extension";
import { createSlashCommandRenderer } from "../editor/slash-command-renderer";
import { FORMAT_BAR_KEY, FormatMenu, formatMenuOpen } from "../editor/format-menu";
import { PageFlow } from "../editor/page-flow";
import { StableBlockId } from "../editor/stable-block-id";
import { spectraBus } from "../events";
import type { WorkRegion } from "../anchors/locate";
import { documentBlockFor } from "../anchors/document-region";
import { useOpenAnchor, type AnchorLanding } from "../anchors/use-open-anchor";
import { parseSpectraWorkUrl, type ReferenceNode } from "../references";
import { useSpectraPreferences } from "../settings/preference-store";
import { enforcePdfInput, OFFICE_ARCHIVE_LIMITS, readBoundedArchive } from "../../../../shared/parser-limits";
import type { SourceRecord } from "../sources/records/source-record";
import { createDocumentRelativeSelection } from "../work/models/yjs";
import { availableWorkModes } from "../work/registry";
import {
  documentContentFromJson,
  documentJsonFromContent,
} from "./artifact-studio";
import { exportDocxCopy, importDocxPayload, type DocxAssetResolver } from "../lenses/docx-adapter";
import { record } from "./artifact-content-model";
import {
  artifactBlobSha256,
  downloadDocumentBlob,
  downloadDocumentText,
  escapeDocumentHtml,
  markdownToDocumentHtml,
  sanitizeDocumentHtml,
} from "./artifact-studio-file-utils";
import { ArtifactWorkbar } from "./artifact-workbar";
import { WorkbarCommandControl, isRenderedControl } from "./workbar-controls";
import { useStudioContract } from "./artifact-studio-shell";
import { useStudioViewportReady } from "./studio-viewport-ready";
import { readPdfTextPages } from "../editor/pdf-text-pages";
import {
  imageEmuAttributes,
  materializeJsonImages,
} from "../organization/library-import";
import { requestSpectra } from "../data/request";
import { documentReferenceIds } from "./document-reference-ids";
import { entryOf, withStacked } from "../editor/reference-stack";

const NO_SPECULATION: readonly SpeculativeBlockText[] = [];

function documentMarkdown(json: JSONContent) {
  const renderInline = (node: JSONContent): string => {
    if (node.type === "text") {
      let value = node.text ?? "";
      const marks = node.marks ?? [];
      if (marks.some((mark) => mark.type === "code")) value = `\`${value}\``;
      if (marks.some((mark) => mark.type === "bold")) value = `**${value}**`;
      if (marks.some((mark) => mark.type === "italic")) value = `*${value}*`;
      const link = marks.find((mark) => mark.type === "link");
      if (link?.attrs?.href) value = `[${value}](${String(link.attrs.href)})`;
      return value;
    }
    if (node.type === "inlineEquation")
      return `$${String(node.attrs?.latex ?? "")}$`;
    return (node.content ?? []).map(renderInline).join("");
  };
  const render = (node: JSONContent, depth = 0): string => {
    if (node.type === "heading")
      return `${"#".repeat(Number(node.attrs?.level) || 2)} ${renderInline(node)}`;
    if (node.type === "paragraph") return renderInline(node);
    if (node.type === "blockquote")
      return renderInline(node)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    if (node.type === "bulletList" || node.type === "orderedList")
      return (node.content ?? [])
        .map((item, index) => {
          const prefix = node.type === "orderedList" ? `${index + 1}.` : "-";
          return `${"  ".repeat(depth)}${prefix} ${renderInline(item)}`;
        })
        .join("\n");
    if (node.type === "equation")
      return `$$\n${String(node.attrs?.latex ?? "")}\n$$`;
    if (node.type === "codeBlock")
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${renderInline(node)}\n\`\`\``;
    if (node.type === "callout") return `> ${renderInline(node)}`;
    if (node.type === "table")
      return (node.content ?? [])
        .map(
          (row) => `| ${(row.content ?? []).map(renderInline).join(" | ")} |`,
        )
        .join("\n");
    return (node.content ?? [])
      .map((child) => render(child, depth + 1))
      .join("\n\n");
  };
  return render(json).trim();
}

/** Points, from whatever unit the font-size mark stored. */
function pointsFromCssSize(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(-?[\d.]+)\s*(px|pt|rem|em)?$/.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  const unit = match[2] ?? "px";
  if (unit === "pt") return Math.round(size * 10) / 10;
  if (unit === "rem" || unit === "em")
    return Math.round(size * 16 * 0.75 * 10) / 10;
  return Math.round(size * 0.75 * 10) / 10;
}

/** `RRGGBB`, or null when the colour is not something Word can hold literally. */
function wordHex(value: unknown) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(hex))
    return hex
      .split("")
      .map((digit) => `${digit}${digit}`)
      .join("")
      .toUpperCase();
  return null;
}

/**
 * The formatting every text run in a block agrees on.
 *
 * Word stores formatting per run and Spectra's lens deliberately writes a
 * paragraph's runs uniformly rather than splitting them, so a value is only
 * reported when the whole block carries it. A half-bold paragraph reports no
 * bold at all, which is what keeps a later save from bolding the other half.
 */
function blockRunFormat(node: JSONContent) {
  const texts: JSONContent[] = [];
  const walk = (candidate: JSONContent) => {
    if (candidate.type === "text") texts.push(candidate);
    for (const child of candidate.content ?? []) walk(child);
  };
  for (const child of node.content ?? []) walk(child);
  if (!texts.length) return undefined;
  const read = (text: JSONContent) => {
    const marks = text.marks ?? [];
    const attributesOf = (type: string) =>
      (marks.find((mark) => mark.type === type)?.attrs ?? {}) as Record<
        string,
        unknown
      >;
    const style = attributesOf("textStyle");
    return {
      bold: marks.some((mark) => mark.type === "bold"),
      italic: marks.some((mark) => mark.type === "italic"),
      underline: marks.some((mark) => mark.type === "underline"),
      strike: marks.some((mark) => mark.type === "strike"),
      fontFamily:
        typeof style.fontFamily === "string" ? style.fontFamily : null,
      fontSizePoints: pointsFromCssSize(style.fontSize),
      color: wordHex(style.color),
      shading: wordHex(attributesOf("highlight").color),
    };
  };
  const first = read(texts[0]!);
  const agreed = <K extends keyof typeof first>(key: K) =>
    texts.every((text) => read(text)[key] === first[key])
      ? first[key]
      : undefined;
  const format: Record<string, unknown> = {};
  for (const key of [
    "bold",
    "italic",
    "underline",
    "strike",
    "fontFamily",
    "fontSizePoints",
    "color",
    "shading",
  ] as const) {
    const value = agreed(key);
    if (value !== undefined) format[key] = value;
  }
  return Object.keys(format).length ? format : undefined;
}

/** Paragraph properties, shaped the way the DOCX lens writes `w:pPr`. */
function blockParagraphFormat(node: JSONContent) {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const alignment =
    attrs.textAlign === "center" ||
    attrs.textAlign === "right" ||
    attrs.textAlign === "justify"
      ? attrs.textAlign
      : "left";
  const numeric = (value: unknown) => {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? size : 0;
  };
  // Indent keeps its sign. A Word style may outdent a heading into the left
  // margin — `ProductHead` in the Microsoft test asset sits 2.26in out — and
  // reporting that as level 0 would ask the lens to pull it back on the next
  // save, changing a page nobody touched.
  const level = (value: unknown) => {
    const size = Number(value);
    return Number.isFinite(size) ? Math.round(size) : 0;
  };
  return {
    alignment,
    lineSpacing: numeric(attrs.lineSpacing) || 1,
    spacingAfterPoints: numeric(attrs.spacingAfter),
    indentLevel: level(attrs.indentLevel),
    border:
      typeof attrs.frameBorder === "string" && attrs.frameBorder !== "none"
        ? attrs.frameBorder
        : null,
    shading: wordHex(attrs.frameShading),
  };
}

/**
 * Adds run and paragraph formatting to the projected blocks.
 *
 * `blocksFromJson` is shared by every artifact type and stays limited to
 * structure and text; formatting is a document concern, so it is attached here
 * instead. The attribute names and units match the DOCX lens exactly, which is
 * what makes bold, a font, a colour, alignment, leading, indent, a border and
 * shading reach a mounted Word file as real `w:rPr`/`w:pPr` properties rather
 * than staying a Spectra-only appearance.
 *
 * Exported because it is the whole of what the studio promises a linked file: if
 * a property the document already had does not survive this function, the next
 * save writes a change nobody asked for.
 */

/** Lays a new reference on an existing card as another tab; false when that card is gone. */
function stackReference(editor: Editor, ontoEmbedId: string, reference: Record<string, unknown>) {
  const entry = entryOf(reference);
  if (!entry) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      let placed = false;
      tr.doc.descendants((node, position) => {
        if (placed) return false;
        if (node.type.name !== "spectraReference" || node.attrs.embedId !== ontoEmbedId) return true;
        tr.setNodeMarkup(position, undefined, withStacked(node.attrs, [entry]));
        placed = true;
        return false;
      });
      return placed;
    })
    .run();
}

export function withDocumentFormatting(
  content: Record<string, unknown>,
  json: JSONContent,
) {
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  if (!blocks.length) return content;
  const nodes = Array.isArray(json.content) ? json.content : [];
  // The same id derivation blocksFromJson uses, so a block written without a
  // stable id still lines up with the node it came from.
  const seen = new Set<string>();
  const formatting = new Map<string, Record<string, unknown>>();
  nodes.forEach((node, index) => {
    let id =
      typeof node.attrs?.blockId === "string" && node.attrs.blockId
        ? node.attrs.blockId
        : `block-${index + 1}`;
    if (seen.has(id)) {
      let suffix = 2;
      while (seen.has(`${id}~${suffix}`)) suffix += 1;
      id = `${id}~${suffix}`;
    }
    seen.add(id);
    if (node.type === "table" || node.type === "equation") return;
    const format = blockRunFormat(node);
    formatting.set(id, {
      ...(format ? { format } : {}),
      paragraphFormat: blockParagraphFormat(node),
    });
  });
  return {
    ...content,
    blocks: blocks.map((block) => {
      if (!block || typeof block !== "object") return block;
      const entry = block as Record<string, unknown>;
      const patch =
        typeof entry.id === "string" ? formatting.get(entry.id) : undefined;
      if (!patch) return block;
      return {
        ...entry,
        attrs: { ...record(entry.attrs), ...patch },
      };
    }),
  };
}

type DocumentSelectionEntry = { id: string; binding: CommandBinding };

/**
 * The selection toolbar.
 *
 * It renders *registry bindings*, not its own chains. That is the whole reason
 * it exists in this shape: the floating bar used to hold a second copy of
 * bold/italic/align/highlight and a third copy of the table verbs, so the three
 * surfaces could disagree about what was possible. Now it asks the same
 * availability function the work bar asks, and shows the same sentence when the
 * answer is no.
 */
function DocumentSelectionToolbar({
  entries,
  run,
  availability,
}: {
  entries: readonly DocumentSelectionEntry[];
  run: (id: string, value?: CommandParam) => void;
  availability: (id: string) => { enabled: boolean; reason?: string };
}) {
  return (
    <div
      className="spectra-document-selection-commands"
      role="toolbar"
      aria-label="Selection formatting"
    >
      {entries.map(({ id, binding }) => {
        const state = availability(id);
        if (isRenderedControl(binding))
          return (
            <WorkbarCommandControl
              key={id}
              action={{
                ...binding,
                ...(state.enabled ? {} : { disabled: true }),
                ...(state.reason ? { hint: state.reason } : {}),
              }}
              onEmit={(value) => run(id, value)}
            />
          );
        const Icon = binding.icon;
        return (
          <button
            key={id}
            type="button"
            className="spectra-document-selection-command"
            data-active={binding.active || undefined}
            disabled={!state.enabled}
            title={state.reason ?? binding.hint ?? binding.label}
            aria-label={binding.label}
            aria-pressed={
              binding.active === undefined ? undefined : binding.active
            }
            onClick={() => run(id)}
          >
            {Icon ? <Icon className="h-4 w-4" /> : binding.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One small editor for the one thing a command needs a word for: a link's
 * address, a picture's alternative text, a header line, a style's name.
 *
 * It appears in the document's own column rather than in a modal, because a
 * dialogue that covers the sentence you are describing is the reason nobody
 * writes alt text. Enter commits, Escape cancels, and the explanation sits above
 * the field instead of in a tooltip nobody opens.
 */
function DocumentInlinePanel({
  label,
  detail,
  value,
  placeholder,
  multiline = false,
  confirmLabel,
  onChange,
  onCancel,
  onConfirm,
  children,
}: {
  label: string;
  detail?: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  confirmLabel: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className="spectra-document-inline-panel"
      role="group"
      aria-label={label}
    >
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {multiline ? (
        <textarea
          autoFocus
          rows={2}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
      ) : (
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
            if (event.key === "Escape") onCancel();
          }}
        />
      )}
      {children}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" data-confirm-panel="" onClick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  );
}

type DocumentMode = "write" | "read" | "review" | "focus";

/**
 * Puts a block's stored formatting back onto the editor node.
 *
 * The other direction of `withDocumentFormatting`. Without it a mounted Word
 * file would open flat — every heading the same weight, every paragraph
 * left-aligned and single-spaced — and the first save would then write that
 * flatness back over the file. `documentJsonFromContent` is shared with the
 * other artifact types, so the document-specific half is applied here.
 */
function withEditorFormatting(
  json: JSONContent,
  content: Record<string, unknown>,
) {
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  if (!blocks.length || !Array.isArray(json.content)) return json;
  const attrsById = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id) continue;
    const attrs = record(entry.attrs);
    if (attrs.format || attrs.paragraphFormat) attrsById.set(entry.id, attrs);
  }
  if (!attrsById.size) return json;
  const markFor = (type: string, attrs?: Record<string, unknown>) =>
    attrs ? { type, attrs } : { type };
  return {
    ...json,
    content: json.content.map((node) => {
      const blockId =
        typeof node.attrs?.blockId === "string" ? node.attrs.blockId : "";
      const stored = blockId ? attrsById.get(blockId) : undefined;
      if (!stored) return node;
      const runFormat = record(stored.format);
      const paragraphFormat = record(stored.paragraphFormat);
      const style: Record<string, unknown> = {
        ...(typeof runFormat.fontFamily === "string"
          ? { fontFamily: runFormat.fontFamily }
          : {}),
        ...(Number(runFormat.fontSizePoints) > 0
          ? { fontSize: `${Number(runFormat.fontSizePoints)}pt` }
          : {}),
        ...(typeof runFormat.color === "string"
          ? { color: `#${runFormat.color}` }
          : {}),
      };
      const marks = [
        ...(runFormat.bold === true ? [markFor("bold")] : []),
        ...(runFormat.italic === true ? [markFor("italic")] : []),
        ...(runFormat.underline === true ? [markFor("underline")] : []),
        ...(runFormat.strike === true ? [markFor("strike")] : []),
        ...(Object.keys(style).length ? [markFor("textStyle", style)] : []),
        ...(typeof runFormat.shading === "string"
          ? [markFor("highlight", { color: `#${runFormat.shading}` })]
          : []),
      ];
      const alignment = paragraphFormat.alignment;
      const spacing = Number(paragraphFormat.lineSpacing);
      const after = Number(paragraphFormat.spacingAfterPoints);
      const indent = Number(paragraphFormat.indentLevel);
      const attrs = {
        ...node.attrs,
        ...(alignment === "center" ||
        alignment === "right" ||
        alignment === "justify"
          ? { textAlign: alignment }
          : {}),
        ...(Number.isFinite(spacing) && spacing > 0 && spacing !== 1
          ? { lineSpacing: spacing }
          : {}),
        ...(Number.isFinite(after) && after > 0 ? { spacingAfter: after } : {}),
        ...(Number.isFinite(indent) && indent !== 0
          ? { indentLevel: indent }
          : {}),
        ...(typeof paragraphFormat.border === "string" &&
        paragraphFormat.border !== "none"
          ? { frameBorder: paragraphFormat.border }
          : {}),
        ...(typeof paragraphFormat.shading === "string"
          ? { frameShading: `#${paragraphFormat.shading}` }
          : {}),
      };
      // Marks are applied to the text the block already holds; nothing is
      // inserted, so a block with no text keeps its shape.
      const applyMarks = (child: JSONContent): JSONContent =>
        child.type === "text"
          ? { ...child, marks: [...(child.marks ?? []), ...marks] }
          : {
              ...child,
              ...(child.content
                ? { content: child.content.map(applyMarks) }
                : {}),
            };
      return {
        ...node,
        attrs,
        ...(marks.length && node.content
          ? { content: node.content.map(applyMarks) }
          : {}),
      };
    }),
  };
}

/**
 * Exported as a leaf so surfaces outside the studio shell — the landing story
 * among them — render the one real document view rather than a lookalike.
 * It takes its content as a prop and owns no data acquisition.
 */
export function DocumentStudio({
  artifactId,
  title,
  content,
  onChange,
  onBeforeNativeExport,
  aiChangedPaths = [],
  readOnly = false,
  nativeReadOnlyRegionIds = [],
  collaborationDocument,
  binding = false,
  contentIsProvisional = false,
  speculation = NO_SPECULATION,
  onLocalCollaborativeChange,
  header,
  mode = "tab",
}: {
  artifactId: string;
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  onBeforeNativeExport?: () => Promise<boolean>;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  nativeReadOnlyRegionIds?: string[];
  collaborationDocument?: Y.Doc;
  /** The live room is still arriving: hold typing so it lands in the bound editor. */
  binding?: boolean;
  contentIsProvisional?: boolean;
  /** Blocks a collaborator is writing right now, as they have them. */
  speculation?: readonly SpeculativeBlockText[];
  onLocalCollaborativeChange?: (userInitiated?: boolean) => void;
  header: ReactNode;
  mode?: "split" | "tab";
}) {
  const studioContract = useStudioContract();
  const strictNative = studioContract.compatibilityProfile === "strict-native";
  const createReference = useMutation(api.artifactEmbeds.create);
  const migrateLegacyReference = useMutation(api.artifactEmbeds.migrateLegacy);
  const removeReference = useMutation(api.artifactEmbeds.remove);
  const restoreReference = useMutation(api.artifactEmbeds.restore);
  const migratingLegacyReferencesRef = useRef(new Set<string>());
  const referenceLifecycleRef = useRef(new Map<string, Promise<void>>());
  const enqueueReferenceLifecycle = useCallback(
    (embedId: string, action: () => Promise<unknown>) => {
      const prior =
        referenceLifecycleRef.current.get(embedId) ?? Promise.resolve();
      const next = prior
        .catch(() => undefined)
        .then(async () => {
          await action();
        })
        .finally(() => {
          if (referenceLifecycleRef.current.get(embedId) === next)
            referenceLifecycleRef.current.delete(embedId);
        });
      referenceLifecycleRef.current.set(embedId, next);
      return next;
    },
    [],
  );
  const nativeReadOnlyKey = nativeReadOnlyRegionIds.join("|");
  const onLocalCollaborativeChangeRef = useRef(onLocalCollaborativeChange);
  onLocalCollaborativeChangeRef.current = onLocalCollaborativeChange;
  const contentRef = useRef(content);
  contentRef.current = content;
  const { preferences } = useSpectraPreferences();
  const [initialContent] = useState(() =>
    withEditorFormatting(
      documentJsonFromContent(content, title),
      record(content),
    ),
  );
  const [importing, setImporting] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findDraft, setFindDraft] = useState("");
  const [findOptions, setFindOptions] = useState<FindOptions>({});
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState("");
  const [findCursor, setFindCursor] = useState(0);
  const sharingRole = readOnly ? "read_only" : "edit";
  const documentModes = availableWorkModes("document", sharingRole);
  const canPreviewAsReader = documentModes.some(
    (entry) => entry.id === "preview_as_reader",
  );
  /** Owners always enter the authoring surface. Reader preview and Focus are
   * actions inside the overflow, never peer tabs competing with editing. */
  const [chosenMode, setDocMode] = useState<DocumentMode>("write");
  // Without edit access the page reads; it writes again the moment access
  // arrives (it is often still loading when the studio opens).
  const docMode: DocumentMode = readOnly && chosenMode !== "review" ? "read" : chosenMode;
  const focusMode = docMode === "focus";
  const [canvasChoice, setPageLayout] = useDocumentCanvas(artifactId);
  // Pages side by side need the width of the full screen; the side panel
  // keeps the page view until the work is opened full.
  const pageLayout = canvasChoice === "spread" && mode === "split" ? "page" : canvasChoice;
  const deskRef = useRef<HTMLElement>(null);
  const [importReport, setImportReport] = useState<string>();
  const [importError, setImportError] = useState<string>();
  const createLiveReference = useCallback(
    async ({
      sourceArtifactId,
      containerRegionId = "artifact:structure",
      target,
    }: {
      sourceArtifactId: string;
      containerRegionId?: string;
      target?: {
        workType: string;
        kind: string;
        path: string[];
        stableIds?: Record<string, string>;
        fallbackExcerpt?: string;
        schemaVersion: number;
      };
    }): Promise<ReferenceNode> => {
      const result = await createReference({
        containerType: "artifact",
        containerId: artifactId,
        containerRegionId,
        sourceArtifactId: sourceArtifactId as Id<"spectraArtifacts">,
        mode: "compact",
        interaction: "read",
        versionPolicy: "live",
        contextPolicy: "summary",
        displayPreferences: target
          ? {
              sourceWorkType: target.workType,
              anchorKind: target.kind,
              sourceAnchor: target,
            }
          : undefined,
      });
      return {
        embedId: result.embedId,
        containerType: "artifact",
        containerId: artifactId,
        containerRegionId,
        sourceArtifactId,
        mode: "compact",
        interaction: "read",
        versionPolicy: "live",
        contextPolicy: "summary",
        displayPreferences: target
          ? {
              sourceWorkType: target.workType,
              anchorKind: target.kind,
              sourceAnchor: target,
            }
          : undefined,
        state: "ready",
      };
    },
    [artifactId, createReference],
  );
  const nativeBinding = useMemo(() => record(record(content).nativeBinding), [content]);
  const nativePlaceholders = useMemo(() => {
    return Array.isArray(nativeBinding.nativePlaceholders)
      ? nativeBinding.nativePlaceholders.flatMap((value) => {
          const placeholder = record(value);
          return typeof placeholder.label === "string" &&
            typeof placeholder.detail === "string"
            ? [
                {
                  id:
                    typeof placeholder.id === "string"
                      ? placeholder.id
                      : placeholder.label,
                  label: placeholder.label,
                  detail: placeholder.detail,
                },
              ]
            : [];
        })
      : [];
  }, [nativeBinding]);
  const wordRevisions = useMemo(() => {
    return Array.isArray(nativeBinding.wordRevisions)
      ? nativeBinding.wordRevisions.flatMap((value) => {
          const mark = record(value);
          return typeof mark.id === "string" &&
            typeof mark.kind === "string" &&
            typeof mark.text === "string"
            ? [
                {
                  id: mark.id,
                  kind: mark.kind,
                  author: typeof mark.author === "string" ? mark.author : undefined,
                  date: typeof mark.date === "string" ? mark.date : undefined,
                  text: mark.text,
                },
              ]
            : [];
        })
      : [];
  }, [nativeBinding]);
  const wordComments = useMemo(() => {
    return Array.isArray(nativeBinding.wordComments)
      ? nativeBinding.wordComments.flatMap((value) => {
          const comment = record(value);
          return typeof comment.id === "string" && typeof comment.text === "string"
            ? [
                {
                  id: comment.id,
                  author:
                    typeof comment.author === "string" ? comment.author : undefined,
                  date: typeof comment.date === "string" ? comment.date : undefined,
                  text: comment.text,
                },
              ]
            : [];
        })
      : [];
  }, [nativeBinding]);
  const wordNotes = useMemo(() => {
    return Array.isArray(nativeBinding.wordNotes)
      ? nativeBinding.wordNotes.flatMap((value) => {
          const note = record(value);
          return typeof note.id === "string" &&
            (note.type === "footnote" || note.type === "endnote") &&
            typeof note.text === "string"
            ? [{ id: note.id, type: note.type as "footnote" | "endnote", text: note.text }]
            : [];
        })
      : [];
  }, [nativeBinding]);
  const [pendingTemplate, setPendingTemplate] = useState<
    "notes" | "essay" | "lab" | null
  >(null);
  const importRef = useRef<HTMLInputElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  /*
   * What came over from the Word file but Spectra keeps as it is (a part it
   * cannot edit yet) looks like the rest of the page. A right-click on it says
   * so, and a file kept in sync with a computer can show every such part
   * until asked to stop.
   */
  const [keptMenu, setKeptMenu] = useState<{ x: number; y: number } | null>(null);
  const [showKept, setShowKept] = useState(false);
  const syncedFile = strictNative || nativeReadOnlyRegionIds.length > 0;
  useEffect(() => {
    const root = studioRef.current;
    if (!root) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.shiftKey || !(event.target instanceof Element)) return;
      const kept = event.target.closest('.ProseMirror [data-native-read-only="true"]');
      if (!kept || kept.matches("img")) return;
      event.preventDefault();
      event.stopPropagation();
      setKeptMenu({ x: event.clientX, y: event.clientY });
    };
    root.addEventListener("contextmenu", onContextMenu, true);
    return () => root.removeEventListener("contextmenu", onContextMenu, true);
  }, []);
  const editorReadyForUserChanges = useRef(false);
  const lastDecorationKeyRef = useRef<string>("");
  const editorJsonKeyRef = useRef(JSON.stringify(initialContent));
  /** Filled once the command set exists; the slash menu reads it on each open. */
  const slashDispatchRef = useRef<SlashCommandDispatcher>({
    run: () => undefined,
    availability: () => ({ enabled: false }),
  });
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [spellcheckOn, setSpellcheckOn] = useState(true);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [academicDraft, setAcademicDraft] = useState<{ kind: "comment" | "revision" | "citation"; anchor: WordTextAnchor; text: string; author: string; year: string; pages: string; url: string; citationId?: string; expectedText?: string; source?: WordSource } | null>(null);
  const [academicError, setAcademicError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  /** Small in-canvas editors, each opened by its command and nothing else. */
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState<string | null>(null);
  const [chromeDraft, setChromeDraft] = useState<{
    slot: "header" | "footer";
    text: string;
  } | null>(null);
  const [styleDraft, setStyleDraft] = useState<string | null>(null);
  /**
   * Page setup travels in the document's own content, beside the blocks, so a
   * reopened document keeps its paper and margins. `documentContentFromJson`
   * spreads the previous record, so this key survives every text edit.
   */
  const pageSetup = useMemo(() => {
    const stored = record(record(content).pageSetup);
    const columns = Number(stored.columns);
    return {
      size: typeof stored.size === "string" ? stored.size : "a4",
      orientation:
        stored.orientation === "landscape"
          ? ("landscape" as const)
          : ("portrait" as const),
      margins: typeof stored.margins === "string" ? stored.margins : "normal",
      columns:
        Number.isFinite(columns) && columns > 0 ? Math.min(3, columns) : 1,
      header: typeof stored.header === "string" ? stored.header : "",
      footer: typeof stored.footer === "string" ? stored.footer : "",
    };
  }, [content]);
  /** Named styles this document defines, over and above the built-in six. */
  const namedStyles = useMemo(() => {
    const stored = record(content).namedStyles;
    return Array.isArray(stored)
      ? stored.flatMap((value) => {
          const style = record(value);
          return typeof style.id === "string" && typeof style.label === "string"
            ? [{ id: style.id, label: style.label, attrs: record(style.attrs) }]
            : [];
        })
      : [];
  }, [content]);

  useEffect(() => {
    if (!focusMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const root = studioRef.current;
      // Escape in a work edited in place inside this document is that work's,
      // and this document's Escape is not a host's or another copy's.
      const unfocused =
        event.target === document.body || event.target === document.documentElement;
      const ours =
        eventBelongsToFocusedStudio(event, artifactId, root) ||
        (unfocused && !root?.closest("[data-embed-editor]"));
      if (!ours) return;
      event.preventDefault();
      event.stopPropagation();
      setDocMode("write");
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [artifactId, focusMode]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: false,
          underline: false,
          undoRedo: collaborationDocument ? false : undefined,
        }),
        ...(collaborationDocument
          ? [
              Collaboration.configure({
                fragment: collaborationDocument.getXmlFragment(
                  "spectra:document-v2",
                ),
              }),
            ]
          : []),
        Underline,
        TiptapLink.configure({ openOnClick: false, autolink: true }),
        Table.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              spectraAuthored: {
                default: false,
                parseHTML: (element) =>
                  element.getAttribute("data-spectra-authored") === "true",
                renderHTML: (attributes) =>
                  attributes.spectraAuthored
                    ? { "data-spectra-authored": "true" }
                    : {},
              },
            };
          },
        }).configure({ resizable: true, lastColumnResizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({ nested: true }),
        // DOCX pictures are authored image nodes inside their source
        // paragraph. They must remain inline in ProseMirror or schema parsing
        // drops the entire paragraph when the live Yjs editor reopens it.
        // `setImage` still inserts at the current paragraph selection, while
        // Word export continues to place the drawing in that paragraph.
        DocumentImage.configure({ allowBase64: true, inline: true }),
        NativeDocxImage,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Highlight.configure({ multicolor: true }),
        // Character formatting a writer expects in the first minute: the font,
        // its size, its colour and the line height of the paragraph. These are
        // marks rather than editor-wide settings, so two paragraphs can differ
        // — which is what a document is for, and what Word does.
        TextStyle,
        FontFamily,
        FontSize,
        Color,
        // Structure the page needs and Markdown does not have: an explicit
        // break, a section boundary carrying its own page setup, and the
        // paragraph frame (border / shading / indent / line spacing / space
        // after) — all paragraph properties in Word too.
        PageBreak,
        SectionBreak,
        ParagraphFrame,
        Footnote,
        Endnote,
        SpectraNotes,
        Callout,
        Equation,
        InlineEquation,
        SpectraReferenceNode,
        SpectraCitationNode,
        WordCommentBoundary,
        WordRevision,
        DragHandle,
        FormatMenu,
        PageFlow,
        StableBlockId.configure({
          nativeReadOnlyBlockIds: nativeReadOnlyRegionIds,
        }),
        AiRegionDecoration,
        AiSpeculationDecoration,
        AiTextResolve,
        SpectraTiptapAutocomplete.configure({
          enabled:
            preferences.writing.smartCompletion &&
            preferences.writing.longFormSuggestions &&
            !readOnly,
          delayMs: preferences.writing.delayMs,
        }),
        Placeholder.configure({ placeholder: "Type / for commands" }),
        SlashCommand.configure({
          suggestion: {
            char: "/",
            startOfLine: false,
            render: createSlashCommandRenderer,
            // The menu is a *view of the registry*: every entry names a command
            // id and runs through the same dispatcher the work bar uses, so
            // `/table` and the Insert tab can never disagree (C1). The ref keeps
            // the editor out of the dependency list — a stale closure here would
            // silently freeze the menu on the first render's availability.
            items: ({ query }: { query: string }) =>
              filterSlashCommands(
                documentSlashItems(slashDispatchRef.current),
                query,
              ),
          },
        }),
        // TipTap packages resolve through mixed @tiptap/core versions in this
        // workspace; cast keeps the editor API usable under production typecheck.
      ] as never[],
      content: collaborationDocument ? undefined : initialContent,
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "data-work-id": artifactId,
          class:
            "spectra-prose spectra-composer-clearance min-h-full px-2 pt-2 outline-none",
        },
        handleDOMEvents: {
          // `immediatelyRender: false` can leave `editor.isInitialized` false
          // on the first effect. A once-listener that never attaches would
          // skip onUpdate forever: the table cell would change on screen and
          // in Yjs while native materialize never ran. Mark readiness on the
          // same DOM events ProseMirror uses to create the user transaction.
          pointerdown: () => {
            editorReadyForUserChanges.current = true;
            return false;
          },
          keydown: () => {
            editorReadyForUserChanges.current = true;
            return false;
          },
          beforeinput: () => {
            editorReadyForUserChanges.current = true;
            return false;
          },
        },
        handlePaste: (view, event) => {
          const target = parseSpectraWorkUrl(
            event.clipboardData?.getData("text/plain") ?? "",
          );
          const nodeType = view.state.schema.nodes.spectraReference;
          if (!target || !nodeType) return false;
          if (strictNative) {
            toast.error(
              "This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.",
            );
            return true;
          }
          void createLiveReference({
            sourceArtifactId: target.workId,
            target: target.fragment
              ? {
                  workType: "document",
                  kind: "fragment",
                  path: [target.fragment],
                  schemaVersion: 1,
                }
              : undefined,
          })
            .then((reference) => {
              if (view.isDestroyed) {
                void removeReference({
                  embedId: reference.embedId as Id<"artifactEmbeds">,
                });
                return;
              }
              const node = nodeType.create(reference);
              view.dispatch(
                view.state.tr.replaceSelectionWith(node).scrollIntoView(),
              );
            })
            .catch((error) =>
              toast.error(
                describeFailure(error, { fallback: "The live reference could not be added." }).message,
              ),
            );
          return true;
        },
      },
      onUpdate: ({ editor, transaction }) => {
        const referenceMigration = Boolean(
          transaction.getMeta("spectra-reference-migration"),
        );
        if (
          (!editorReadyForUserChanges.current && !referenceMigration) ||
          readOnly
        )
          return;
        const localChange =
          !collaborationDocument ||
          isLocalCollaborativeDocumentChange(transaction);
        if (localChange) {
          const before = documentReferenceIds(transaction.before);
          const after = documentReferenceIds(transaction.doc);
          for (const embedId of before)
            if (!after.has(embedId))
              void enqueueReferenceLifecycle(embedId, () =>
                removeReference({
                  embedId: embedId as Id<"artifactEmbeds">,
                }),
              ).catch((error) =>
                toast.error(
                  describeFailure(error, { fallback: "The reference could not be removed." }).message,
                ),
              );
          for (const embedId of after)
            if (!before.has(embedId))
              void enqueueReferenceLifecycle(embedId, () =>
                restoreReference({
                  embedId: embedId as Id<"artifactEmbeds">,
                }),
              ).catch((error) =>
                toast.error(
                  describeFailure(error, { fallback: "The reference could not be restored." }).message,
                ),
              );
        }
        if (collaborationDocument) {
          if (localChange) onLocalCollaborativeChangeRef.current?.();
          return;
        }
        const nextJson = editor.getJSON();
        editorJsonKeyRef.current = JSON.stringify(nextJson);
        onChange(
          withDocumentFormatting(
            documentContentFromJson(nextJson, contentRef.current),
            nextJson,
          ),
        );
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to, empty } = editor.state.selection;
        const ranges: Array<{
          blockId: string;
          startOffset: number;
          endOffset: number;
        }> = [];
        let primaryBlockId: string | undefined;
        let caretOffset = 0;
        editor.state.doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
          if (typeof node.attrs?.blockId !== "string" || !node.attrs.blockId)
            return;
          const blockStart = pos + 1;
          const blockEnd = pos + node.nodeSize - 1;
          const startOffset = Math.max(0, Math.min(from, to) - blockStart);
          const endOffset = Math.max(
            startOffset,
            Math.min(blockEnd, Math.max(from, to)) - blockStart,
          );
          if (!primaryBlockId) {
            primaryBlockId = node.attrs.blockId;
            caretOffset = startOffset;
          }
          ranges.push({
            blockId: node.attrs.blockId,
            startOffset,
            endOffset,
          });
        });
        const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
        const firstRange = ranges[0];
        const relative =
          collaborationDocument && firstRange
            ? createDocumentRelativeSelection(
                collaborationDocument,
                firstRange.blockId,
                firstRange.startOffset,
                firstRange.endOffset,
              )
            : null;
        editor.view.dom.dispatchEvent(
          new CustomEvent("spectra-presence-selection", {
            bubbles: true,
            detail: {
              kind: "text",
              collapsed: empty,
              ...(text ? { text: text.slice(0, 280) } : {}),
              ranges,
              ...(relative ? { relative } : {}),
              caretOffset,
              primaryBlockId,
            },
          }),
        );
      },
    },
    [
      collaborationDocument,
      createLiveReference,
      enqueueReferenceLifecycle,
      nativeReadOnlyKey,
      removeReference,
      restoreReference,
      strictNative,
    ],
  );

  useStudioViewportReady(
    Boolean(editor && !editor.isDestroyed && editor.isInitialized && editor.view),
  );
  const spread = useDocumentSpread(editor, deskRef, pageLayout === "spread");
  const [zoom, setZoom] = useDocumentZoom();
  const sheetScale = zoom * useSheetFit(deskRef, pageLayout === "page");
  const pageCount = usePageCount(editor, deskRef, pageLayout === "page", sheetScale, zoom, setZoom);

  useEffect(() => {
    if (!editor || readOnly) return;
    const legacy: Array<{
      legacyReferenceId: string;
      sourceArtifactId: string;
      mode: "compact" | "expanded";
      versionPolicy: "live" | "pinned";
      pinnedVersionId?: string;
      displayPreferences?: Record<string, unknown>;
    }> = [];
    editor.state.doc.descendants((node) => {
      if (
        node.type.name !== "spectraReference" ||
        typeof node.attrs.embedId === "string" ||
        typeof node.attrs.id !== "string" ||
        !node.attrs.id ||
        typeof node.attrs.workId !== "string" ||
        !node.attrs.workId ||
        migratingLegacyReferencesRef.current.has(node.attrs.id)
      )
        return;
      const legacyVersion = node.attrs.versionPolicy;
      const pinnedVersionId =
        legacyVersion &&
        typeof legacyVersion === "object" &&
        typeof (legacyVersion as Record<string, unknown>).pinnedVersionId ===
          "string"
          ? String((legacyVersion as Record<string, unknown>).pinnedVersionId)
          : undefined;
      const sourceAnchor = record(node.attrs.anchor);
      const preferences = {
        ...record(node.attrs.displayPreferences),
        ...(typeof node.attrs.workType === "string"
          ? { sourceWorkType: node.attrs.workType }
          : {}),
        ...(typeof sourceAnchor.kind === "string"
          ? { anchorKind: sourceAnchor.kind, sourceAnchor: node.attrs.anchor }
          : {}),
        ...(typeof node.attrs.view === "string"
          ? { view: node.attrs.view }
          : {}),
        ...(typeof node.attrs.width === "number"
          ? { width: node.attrs.width }
          : {}),
        ...(typeof node.attrs.height === "number"
          ? { height: node.attrs.height }
          : {}),
      };
      migratingLegacyReferencesRef.current.add(node.attrs.id);
      legacy.push({
        legacyReferenceId: node.attrs.id,
        sourceArtifactId: node.attrs.workId,
        mode: node.attrs.state === "expanded" ? "expanded" : "compact",
        versionPolicy: pinnedVersionId ? "pinned" : "live",
        pinnedVersionId,
        displayPreferences: Object.keys(preferences).length
          ? preferences
          : undefined,
      });
    });
    for (const candidate of legacy) {
      void migrateLegacyReference({
        containerId: artifactId,
        legacyReferenceId: candidate.legacyReferenceId,
        sourceArtifactId: candidate.sourceArtifactId as Id<"spectraArtifacts">,
        mode: candidate.mode,
        versionPolicy: candidate.versionPolicy,
        pinnedVersionId: candidate.pinnedVersionId
          ? (candidate.pinnedVersionId as Id<"spectraArtifactVersions">)
          : undefined,
        displayPreferences: candidate.displayPreferences,
      })
        .then((result) => {
          if (editor.isDestroyed) return;
          let transaction = editor.state.tr;
          let changed = false;
          editor.state.doc.descendants((node, position) => {
            if (
              node.type.name !== "spectraReference" ||
              node.attrs.embedId ||
              node.attrs.id !== candidate.legacyReferenceId
            )
              return;
            const canonical: ReferenceNode = {
              embedId: result.embedId,
              containerType: "artifact",
              containerId: artifactId,
              containerRegionId: result.containerRegionId,
              sourceArtifactId: candidate.sourceArtifactId,
              mode: candidate.mode,
              interaction: "read",
              versionPolicy: candidate.versionPolicy,
              ...(candidate.pinnedVersionId
                ? { pinnedVersionId: candidate.pinnedVersionId }
                : {}),
              contextPolicy: "summary",
              displayPreferences: candidate.displayPreferences,
              state: "ready",
            };
            transaction = transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              ...canonical,
              id: null,
              workId: null,
              workType: null,
              anchor: null,
              view: null,
              width: null,
              height: null,
              status: null,
              label: null,
              protocolVersion: null,
            });
            changed = true;
          });
          if (changed)
            editor.view.dispatch(
              transaction.setMeta("spectra-reference-migration", true),
            );
        })
        .catch((error) => {
          migratingLegacyReferencesRef.current.delete(
            candidate.legacyReferenceId,
          );
          toast.error(
            error instanceof Error
              ? error.message
              : "An older live reference could not be restored.",
          );
        });
    }
  }, [artifactId, editor, migrateLegacyReference, readOnly]);

  // Opened at a block or heading (a search hit, a citation): land on it. The
  // editor's nodes are only read; the mark is drawn over them.
  const landOnBlock = useCallback(
    (region: WorkRegion): AnchorLanding | null => {
      if (!editor || editor.isDestroyed) return null;
      return { find: () => documentBlockFor(editor.view.dom, region) };
    },
    [editor],
  );
  useOpenAnchor(artifactId, landOnBlock, { ready: Boolean(editor) });

  useEffect(
    () =>
      spectraBus.handle(
        "reference.insert",
        async ({ hostWorkId, target, reference: suppliedReference, stackOnto }) => {
          if (hostWorkId !== artifactId) return;
          if (!editor || readOnly)
            throw new Error(
              "This document is read-only, so the reference was not added.",
            );
          if (strictNative)
            throw new Error(
              "This file keeps strict native compatibility. Change it to Enhanced before adding a live reference.",
            );
          if (!suppliedReference && !target)
            throw new Error(
              "Choose source work before adding a live reference.",
            );
          const reference =
            suppliedReference ??
            (await createLiveReference({
              sourceArtifactId: target!.workId,
              target: {
                workType: target!.workType,
                kind: target!.kind,
                path: [...target!.path],
                stableIds: target!.stableIds,
                fallbackExcerpt: target!.fallbackExcerpt,
                schemaVersion: target!.schemaVersion,
              },
            }));
          const inserted = stackOnto
            ? stackReference(editor, stackOnto, reference as Record<string, unknown>)
            : editor
                .chain()
                .focus()
                .insertContent({ type: "spectraReference", attrs: reference })
                .run();
          if (!inserted) {
            if (!suppliedReference)
              await removeReference({
                embedId: reference.embedId as Id<"artifactEmbeds">,
              }).catch(() => undefined);
            throw new Error(
              "The live reference could not be placed in this document.",
            );
          }
          return { status: "completed", message: "Reference inserted." };
        },
      ),
    [
      artifactId,
      createLiveReference,
      editor,
      readOnly,
      removeReference,
      strictNative,
    ],
  );

  useEffect(
    () =>
      spectraBus.handle("reference.remove", async ({ hostWorkId, embedId }) => {
        if (hostWorkId !== artifactId) return;
        if (!editor || !editor.isInitialized || editor.isDestroyed)
          throw new Error("The document is not ready to remove this reference.");
        if (readOnly || strictNative || docMode === "read")
          throw new Error("This document cannot remove the reference in its current mode.");
        let range: { from: number; to: number } | undefined;
        editor.state.doc.descendants((node, position) => {
          if (
            node.type.name === "spectraReference" &&
            node.attrs.embedId === embedId
          ) {
            range = { from: position, to: position + node.nodeSize };
            return false;
          }
          return range === undefined;
        });
        if (!range)
          throw new Error("The reference is no longer present in this document.");
        if (!editor.chain().focus().deleteRange(range).run())
          throw new Error("The reference could not be removed from this document.");
        return { status: "completed", message: "Reference removed." };
      }),
    [artifactId, docMode, editor, readOnly, strictNative],
  );

  useEffect(() => {
    // Read is a mode, not a permission: it puts the document down without
    // pretending the reader lost access to it.
    editor?.setEditable(!readOnly && !binding && docMode !== "read");
  }, [binding, docMode, editor, readOnly]);

  // Binding the room builds a new editor. A writer who clicked in while it
  // arrived keeps their place: the caret moves into the bound editor.
  const wantedFocusRef = useRef(false);
  useEffect(() => {
    if (!binding) return;
    const root = studioRef.current;
    const want = (event: Event) => {
      if ((event.target as Element | null)?.closest?.(".ProseMirror")) wantedFocusRef.current = true;
    };
    root?.addEventListener("pointerdown", want, true);
    return () => root?.removeEventListener("pointerdown", want, true);
  }, [binding]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || binding || readOnly || !collaborationDocument || !wantedFocusRef.current) return;
    const focus = () => {
      wantedFocusRef.current = false;
      if (!editor.isDestroyed) editor.commands.focus("end");
    };
    if (editor.isInitialized) focus();
    else editor.once("create", focus);
    return () => { editor.off("create", focus); };
  }, [binding, collaborationDocument, editor, readOnly]);

  useEffect(() => {
    if (!editor || !editor.isInitialized) return;
    const markUserInput = () => {
      editorReadyForUserChanges.current = true;
    };
    const element = editor.view.dom;
    element.addEventListener("pointerdown", markUserInput);
    element.addEventListener("keydown", markUserInput);
    element.addEventListener("beforeinput", markUserInput);
    element.addEventListener("paste", markUserInput);
    return () => {
      element.removeEventListener("pointerdown", markUserInput);
      element.removeEventListener("keydown", markUserInput);
      element.removeEventListener("beforeinput", markUserInput);
      element.removeEventListener("paste", markUserInput);
    };
  }, [editor, editor?.isInitialized]);

  const incomingEditorJson = useMemo(
    () =>
      withEditorFormatting(
        documentJsonFromContent(content, title),
        record(content),
      ),
    [content, title],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.isInitialized || !editor.view)
      return;
    const incomingKey = JSON.stringify(incomingEditorJson);
    const contentChanged = incomingKey !== editorJsonKeyRef.current;
    if (contentChanged) editorJsonKeyRef.current = incomingKey;
    const lineTargets = aiChangedPaths.flatMap<
      NonNullable<AiRegionDecorationTarget["lines"]>[number]
    >((path) => {
      const lineMatch = path.match(
        /^\/(?:content\/)?blocks\/(?:id:|byId\/)?([^/]+)\/lines\/(\d+)/i,
      );
      if (!lineMatch) return [];
      const raw = decodeURIComponent(
        lineMatch[1]!.replaceAll("~1", "/").replaceAll("~0", "~"),
      );
      const line = Number(lineMatch[2]);
      if (!Number.isFinite(line)) return [];
      if (/^\d+$/.test(raw)) return [{ index: Number(raw), line }];
      return [{ blockId: raw, line }];
    });
    // Line-scoped paths must never also paint the whole block / whole doc —
    // that is the mid-stream cyan wash that fails G-01/G-02 Excellent.
    const hasLineScope = lineTargets.length > 0;
    const target: AiRegionDecorationTarget | null = aiChangedPaths.length
      ? {
          all: !hasLineScope && aiChangedPaths.includes("/"),
          indices: hasLineScope
            ? []
            : aiChangedPaths.flatMap((path) => {
                const match = path.match(
                  /^\/(?:content\/)?blocks\/(\d+)(?:\/|$)/,
                );
                return match ? [Number(match[1])] : [];
              }),
          blockIds: hasLineScope
            ? []
            : aiChangedPaths.flatMap((path) => {
                const byId = path.match(
                  /^\/(?:content\/)?blocks\/(?:id:|byId\/)([^/]+)/i,
                );
                if (byId)
                  return [byId[1]!.replaceAll("~1", "/").replaceAll("~0", "~")];
                // TipTap StableBlockId may be referenced without the id: prefix.
                const bare = path.match(
                  /^\/(?:content\/)?blocks\/([^/]+)(?:\/|$)/i,
                );
                if (bare && !/^\d+$/.test(bare[1]!))
                  return [
                    decodeURIComponent(
                      bare[1]!.replaceAll("~1", "/").replaceAll("~0", "~"),
                    ),
                  ];
                return [];
              }),
          lines: lineTargets,
        }
      : null;
    // Effects already run after React's commit. Apply the projection now:
    // requestAnimationFrame is throttled in an unfocused collaborator window,
    // and cancelling the preceding callback for every 112 ms presence beat can
    // starve TipTap indefinitely, leaving a peer on a provisional prefix.
    // Native Y.XmlFragment collaboration is already bound directly to the
    // editor. Reapplying a projected JSON snapshot here would reset selection,
    // corrupt IME composition, and turn a remote delta into a full replace.
    // Keep Word saves arrive the same way, through the room.
    if (contentChanged)
      applyDocumentStudioProjection(editor, incomingEditorJson, {
        collaborative: Boolean(collaborationDocument),
      });
    const decorationKey = JSON.stringify(target);
    if (lastDecorationKeyRef.current === decorationKey) return;
    lastDecorationKeyRef.current = decorationKey;
    editor.view.dispatch(
      editor.state.tr
        .setMeta(aiRegionDecorationKey, target)
        .setMeta("addToHistory", false),
    );
  }, [aiChangedPaths, collaborationDocument, contentIsProvisional, editor, incomingEditorJson, nativeBinding.format]);

  // A shared document is bound to the room; a collaborator's in-flight words
  // are drawn over it instead (ai-speculation-decoration).
  const speculationKey = JSON.stringify(speculation);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.isInitialized || !editor.view) return;
    editor.view.dispatch(
      editor.state.tr
        // A page not bound to the room is drawn from the writer's own value;
        // only a work being set down into it still needs telling.
        .setMeta(aiSpeculationKey, collaborationDocument ? speculation : speculation.filter((target) => target.arrival === "placed"))
        .setMeta("addToHistory", false),
    );
    // speculationKey stands for speculation's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborationDocument, editor, speculationKey]);

  const editorText = editor?.getText({ blockSeparator: "\n" }) ?? "";
  const wordCount = editorText.trim()
    ? editorText.trim().split(/\s+/).length
    : 0;
  const characterCount = editorText.replace(/\n/g, "").length;
  const outlineEntries = (() => {
    if (!outlineOpen && !sourcesOpen) return [] as DocumentOutlineEntry[];
    const entries: DocumentOutlineEntry[] = [];
    const wordsAfter: number[] = [];
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") {
        entries.push({
          title: node.textContent.trim() || "Untitled section",
          level: Number(node.attrs.level) || 2,
          position,
          ...(typeof node.attrs.blockId === "string"
            ? { blockId: node.attrs.blockId }
            : {}),
          wordCount: 0,
        });
        wordsAfter.push(0);
        return false;
      }
      if (node.isText && node.text?.trim() && wordsAfter.length)
        wordsAfter[wordsAfter.length - 1]! += node.text
          .trim()
          .split(/\s+/).length;
      return true;
    });
    return entries.map((entry, index) => ({
      ...entry,
      wordCount: wordsAfter[index] ?? 0,
    }));
  })();
  const activeOutlineEntry = editor
    ? outlineEntryAt(outlineEntries, editor.state.selection.from)
    : undefined;
  const findMatches = (() => {
    const matches: DocumentMatch[] = [];
    const query = findDraft.trim();
    if (!findOpen || !editor || !query) return matches;
    const pattern = documentFindPattern(query, findOptions);
    if (!pattern) return matches;
    editor.state.doc.descendants((node, position) => {
      if (!node.isText || !node.text) return;
      const text = node.text;
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match) {
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        } else {
          matches.push({
            from: position + match.index,
            to: position + match.index + match[0].length,
            preview: text
              .slice(
                Math.max(0, match.index - 24),
                Math.min(text.length, match.index + match[0].length + 24),
              )
              .trim(),
          });
        }
        match = pattern.exec(text);
      }
    });
    return matches;
  })();
  const documentCitationUses = (() => {
    const uses: DocumentCitationUse[] = [];
    if (!sourcesOpen) return uses;
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name !== "spectraCitation") return;
      const sourceId = node.attrs.sourceId;
      if (typeof sourceId !== "string" || !sourceId) return;
      const section = outlineEntryAt(outlineEntries, position)?.title;
      uses.push({
        citationId:
          typeof node.attrs.id === "string" && node.attrs.id
            ? node.attrs.id
            : `citation:${position}`,
        sourceId,
        ...(typeof node.attrs.evidenceSpanId === "string" &&
        node.attrs.evidenceSpanId
          ? { evidenceSpanId: node.attrs.evidenceSpanId }
          : {}),
        label:
          typeof node.attrs.label === "string" && node.attrs.label
            ? node.attrs.label
            : "Citation",
        position,
        ...(section ? { section } : {}),
      });
    });
    return uses;
  })();
  const sourceNavigator = groupCitationUses(
    documentCitationUses,
    // Sources travel with the document, so the navigator reflects what this
    // copy actually carries rather than what a side table happens to hold.
    ((record(content).sources ?? []) as SourceRecord[]).filter(
      (source) => source && typeof source.id === "string",
    ),
  );
  const bibliographyStyle: BibliographyStyle =
    record(content).bibliographyStyle === "author_date"
      ? "author_date"
      : "numeric";
  const bibliography = bibliographyFromNavigator(
    sourceNavigator,
    bibliographyStyle,
  );

  function selectFindMatch(direction = 1) {
    if (!editor || !findMatches.length) return;
    const next =
      (findCursor + direction + findMatches.length) % findMatches.length;
    const match = findMatches[next]!;
    setFindCursor(next);
    editor.chain().focus().setTextSelection(match).scrollIntoView().run();
  }

  /**
   * Replaces every match as ranged edits in one transaction, working backwards
   * so earlier positions stay valid. A full `setContent` would rewrite the whole
   * document and clobber a collaborator mid-sentence (§11A).
   */
  function replaceAllMatches(): boolean {
    if (!editor || !findDraft || readOnly || !findMatches.length) return false;
    editorReadyForUserChanges.current = true;
    const transaction = editor.state.tr;
    for (const match of [...findMatches].reverse()) {
      if (replaceDraft)
        transaction.replaceWith(
          match.from,
          match.to,
          editor.state.schema.text(replaceDraft),
        );
      else transaction.delete(match.from, match.to);
    }
    editor.view.dispatch(transaction);
    setFindCursor(0);
    return true;
  }

  /**
   * Replaces the References section with one built from the citations in the
   * text right now. It is regenerated rather than hand-edited, so it can never
   * claim a source the document does not actually cite (§11A).
   */
  function insertBibliography() {
    if (!editor || readOnly) return;
    if (nativeBinding.format || editor.getJSON().content?.some((node) => JSON.stringify(node).includes('"native"'))) {
      const blocks = documentBlocksFromJson(editor.getJSON());
      const existing = blocks.find((block) => block.inlineContent?.some((item) => item.kind === "bibliography"));
      runAcademic([{ kind: "regenerate-word-bibliography", ...(existing ? { regionId: existing.id, expectedText: existing.text } : {}) }]);
      return;
    }
    const block = bibliographyNode(bibliography);
    const existing: { from: number; to: number }[] = [];
    let inReferences = false;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") {
        inReferences = node.textContent.trim().toLowerCase() === "references";
        if (inReferences)
          existing.push({ from: offset, to: offset + node.nodeSize });
        return;
      }
      if (inReferences)
        existing.push({ from: offset, to: offset + node.nodeSize });
    });
    editorReadyForUserChanges.current = true;
    const chain = editor.chain().focus();
    if (existing.length)
      chain.deleteRange({
        from: existing[0]!.from,
        to: existing[existing.length - 1]!.to,
      });
    chain
      .insertContentAt(
        existing.length ? existing[0]!.from : editor.state.doc.content.size,
        block.content ?? [],
      )
      .scrollIntoView()
      .run();
  }

  function applyDocumentTemplate(kind: "notes" | "essay" | "lab") {
    if (!editor || readOnly) return;
    const template =
      kind === "notes"
        ? `<h1>Study notes</h1><aside data-spectra-callout="true" data-callout-type="info"><p>Key idea</p></aside><h2>Core concepts</h2><ul><li>Add the first important concept</li><li>Connect it to prior knowledge</li></ul><h2>Questions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>What still needs clarification?</p></li></ul>`
        : kind === "essay"
          ? `<h1>Essay title</h1><p><em>State the central argument in one precise sentence.</em></p><h2>Introduction</h2><p>Establish context and your thesis.</p><h2>Argument</h2><p>Develop evidence and analysis.</p><h2>Counterargument</h2><p>Address the strongest alternative interpretation.</p><h2>Conclusion</h2><p>Synthesize the argument without repeating it.</p>`
          : `<h1>Lab report</h1><h2>Research question</h2><p>What are you investigating?</p><h2>Hypothesis</h2><p>State a testable prediction.</p><h2>Method</h2><ol><li>Describe the procedure.</li></ol><h2>Results</h2><table><tbody><tr><th><p>Variable</p></th><th><p>Observation</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Conclusion</h2><p>Interpret the evidence and limitations.</p>`;
    editorReadyForUserChanges.current = true;
    editor.commands.setContent(template);
  }

  async function exportDocument(
    format: "docx" | "pdf" | "html" | "md" | "txt",
  ) {
    if (!editor) return;
    const safeTitle = (title.trim() || "Spectra document").replace(
      /[<>:"/\\|?*]/g,
      "-",
    );
    if (format === "html") {
      downloadDocumentText(
        `${safeTitle}.html`,
        "text/html;charset=utf-8",
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeDocumentHtml(title)}</title></head><body>${editor.getHTML()}</body></html>`,
      );
    } else if (format === "md") {
      downloadDocumentText(
        `${safeTitle}.md`,
        "text/markdown;charset=utf-8",
        documentMarkdown(editor.getJSON()),
      );
    } else if (format === "txt") {
      downloadDocumentText(
        `${safeTitle}.txt`,
        "text/plain;charset=utf-8",
        editorText,
      );
    } else if (format === "pdf") {
      const { jsPDF } = await import("jspdf");
      const document = new jsPDF({ unit: "pt", format: "a4" });
      document.setFont("times", "normal");
      document.setFontSize(12);
      const lines = document.splitTextToSize(editorText, 470) as string[];
      let page = 1;
      lines.forEach((line, index) => {
        const y = 62 + (index - (page - 1) * 46) * 15;
        if (y > 780) {
          document.addPage();
          page += 1;
        }
        const pageIndex = index - (page - 1) * 46;
        document.text(line, 62, 62 + pageIndex * 15);
      });
      document.save(`${safeTitle}.pdf`);
    } else {
      if (nativeBinding.format === "docx") {
        if (onBeforeNativeExport && !(await onBeforeNativeExport()))
          throw new Error(
            "The latest Word changes could not be saved. The download was cancelled.",
          );
        const response = await requestSpectra("/api/spectra/lenses/docx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "download-copy", artifactId }),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(failure?.message ?? "The saved Word copy could not be prepared.");
        }
        downloadDocumentBlob(`${safeTitle}.docx`, await response.blob());
        return;
      }
      const editorJson = editor.getJSON();
      const resolveAsset: DocxAssetResolver = async ({ assetId }) => {
        if (!assetId) return undefined;
        const response = await requestSpectra(
          `/api/spectra/assets/content?assetId=${encodeURIComponent(assetId)}`,
          { cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("The image asset is unavailable or revoked. Restore or upload it before exporting.");
        return new Uint8Array(await response.arrayBuffer());
      };
      const copy = await exportDocxCopy(editorJson, { pageSetup, resolveAsset });
      const blob = new Blob([new Uint8Array(copy.bytes).buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      downloadDocumentBlob(`${safeTitle}.docx`, blob);
    }
  }

  async function importDocument(file: File) {
    if (!editor || readOnly) return;
    if (file.size > 80 * 1024 * 1024) {
      setImportError(
        "This document exceeds the 80 MB technical safety ceiling.",
      );
      return;
    }
    editorReadyForUserChanges.current = true;
    setImporting(true);
    setImportError(undefined);
    setImportReport(undefined);
    let importJobId: string | undefined;
    try {
      const name = file.name.toLowerCase();
      const extension = name.split(".").pop() || "unknown";
      const fidelityReport: Array<{
        scope: string;
        level: "exact" | "adapted" | "unsupported";
        message: string;
      }> = [];
      const unsupportedFeatures: string[] = [];
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "document",
        format: extension,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(importJobId, file);
      if (name.endsWith(".docx")) {
        const checked = await readBoundedArchive(
          new Uint8Array(await file.arrayBuffer()),
          OFFICE_ARCHIVE_LIMITS,
        );
        const result = await importDocxPayload(checked.bytes);
        const durableJson = await materializeJsonImages(result.json as JSONContent, artifactId);
        editor.commands.setContent(durableJson);
        const conversionNotes = result.conversion.notes;
        setImportReport(
          conversionNotes.some((note) => note.level !== "exact")
            ? `Imported a separate editable copy with ${conversionNotes.length} shared native conversion note${conversionNotes.length === 1 ? "" : "s"}. It is not linked to the source file; the retained original remains available in import history.`
            : "Imported a separate editable copy through the shared native DOCX adapter. It is not linked to the source file; the retained original remains available in import history.",
        );
        fidelityReport.push(...conversionNotes);
        unsupportedFeatures.push(
          ...conversionNotes
            .filter((note) => note.level === "unsupported")
            .map((note) => note.scope),
        );
      } else if (name.endsWith(".odt")) {
        const { strFromU8 } = await import("fflate");
        const archive = (await readBoundedArchive(
          new Uint8Array(await file.arrayBuffer()),
          OFFICE_ARCHIVE_LIMITS,
        )).entries;
        const contentXml = archive["content.xml"];
        if (!contentXml) throw new Error("ODT content.xml is missing.");
        const xml = strFromU8(contentXml);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml))
          throw new Error(
            "Unsafe XML declarations caused this ODT to be quarantined.",
          );
        const parsed = new DOMParser().parseFromString(xml, "application/xml");
        if (parsed.querySelector("parsererror"))
          throw new Error("ODT XML is invalid.");
        const html = Array.from(
          parsed.querySelectorAll("text\\:h, text\\:p, text\\:list-item"),
        )
          .map((node) => {
            const value = escapeDocumentHtml(node.textContent ?? "");
            if (node.nodeName.endsWith(":h")) {
              const level = Math.max(
                1,
                Math.min(
                  3,
                  Number(node.getAttribute("text:outline-level") ?? 2),
                ),
              );
              return `<h${level}>${value}</h${level}>`;
            }
            if (node.nodeName.endsWith(":list-item"))
              return `<ul><li>${value}</li></ul>`;
            return `<p>${value}</p>`;
          })
          .join("");
        editor.commands.setContent(html || "<p></p>");
        setImportReport(
          "Imported editable ODT text and headings. Complex page styles, comments, and unsupported layout are reported as adapted.",
        );
        fidelityReport.push({
          scope: "ODT text and outline",
          level: "adapted",
          message:
            "Text, headings, and list items were converted; the retained original preserves page styles and unsupported layout.",
        });
        unsupportedFeatures.push(
          "complex ODT page styles",
          "ODT comments",
          "floating objects",
        );
      } else if (name.endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const bytes = new Uint8Array(await file.arrayBuffer());
        enforcePdfInput(bytes);
        const pdfOptions = {
          data: bytes,
          enableScripting: false,
        };
        const pages = await readPdfTextPages(pdfjs.getDocument(pdfOptions));
        editor.commands.setContent(
          pages
            .map(
              (page, index) =>
                `<h2>Page ${index + 1}</h2><p>${escapeDocumentHtml(page)}</p>`,
            )
            .join(""),
        );
        setImportReport(
          "Extracted editable PDF text by page. Original layout, annotations, and media are preserved only in the retained source and reported as adapted.",
        );
        fidelityReport.push({
          scope: "PDF text extraction",
          level: "adapted",
          message: `${pages.length} page${pages.length === 1 ? "" : "s"} extracted as editable text with explicit page headings.`,
        });
        unsupportedFeatures.push(
          "original PDF page geometry",
          "PDF annotations",
          "non-text media",
          "scanned text without an embedded text layer",
        );
      } else {
        const text = await file.text();
        editor.commands.setContent(
          name.endsWith(".html") || name.endsWith(".htm")
            ? sanitizeDocumentHtml(text)
            : name.endsWith(".md") || name.endsWith(".markdown")
              ? markdownToDocumentHtml(text)
              : `<p>${escapeDocumentHtml(text)
                  .replace(/\n{2,}/g, "</p><p>")
                  .replace(/\n/g, "<br>")}</p>`,
        );
        setImportReport(
          name.endsWith(".html") || name.endsWith(".htm")
            ? "Sanitized and imported editable HTML. Active elements and unsafe URL handlers were removed."
            : "Imported as editable native document content.",
        );
        const htmlInput = name.endsWith(".html") || name.endsWith(".htm");
        const markdownInput =
          name.endsWith(".md") || name.endsWith(".markdown");
        fidelityReport.push({
          scope: htmlInput
            ? "sanitized HTML"
            : markdownInput
              ? "Markdown structure"
              : "plain text",
          level: htmlInput ? "adapted" : "exact",
          message: htmlInput
            ? "Safe supported HTML was converted; active and unsafe elements were removed."
            : "The source was converted to editable native document content.",
        });
        if (htmlInput)
          unsupportedFeatures.push(
            "scripts",
            "event handlers",
            "unsafe URLs",
            "unsupported CSS layout",
          );
      }
      const importedContent = documentContentFromJson(
        editor.getJSON(),
        content,
      );
      onChange(importedContent);
      await completeArtifactImport({
        jobId: importJobId!,
        typeKey: "document",
        status: "imported",
        fidelityReport,
        unsupportedFeatures,
        importedContent,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The document could not be validated.";
      if (importJobId) {
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "document",
          status: "quarantined",
          fidelityReport: [
            { scope: "document import", level: "unsupported", message },
          ],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(importJobId!, message).catch(
            () => undefined,
          );
        });
      }
      setImportError(`Import quarantined: ${message}`);
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  const sourcesHaveWork = Boolean(
    sourceNavigator.entries.length ||
    sourceNavigator.unresolved.length ||
    sourceNavigator.uncited.length,
  );

  /* ------------------------------------------------------------------ *
   * One implementation per verb.
   *
   * Everything below is the *only* place a document verb is performed. The
   * work bar renders these bindings, the selection toolbar renders a subset of
   * the same bindings, the slash menu dispatches their ids, and the AI reaches
   * them through the manifest ops they declare. There is no second chain
   * anywhere in this file, which is the whole point: `/table` and the Insert
   * tab cannot disagree, because they are the same function.
   * ------------------------------------------------------------------ */

  const canEdit = !readOnly && docMode === "write";
  const imageRef = useRef<HTMLInputElement>(null);

  /** Runs an editor change, and marks the frame as genuine user input. */
  const withEdit = useCallback(
    (run: () => void) => {
      if (!editor || !canEdit) return;
      editorReadyForUserChanges.current = true;
      run();
    },
    [canEdit, editor],
  );

  function runAcademic(operations: DocumentAcademicOperation[]) {
    if (!editor || !canEdit) return false;
    try {
      editorReadyForUserChanges.current = true;
      executeAcademicEditorOperations(editor, content, operations);
      setAcademicError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The academic edit could not be applied.";
      setAcademicError(message);
      toast.error(message);
      return false;
    }
  }

  function openAcademic(kind: "comment" | "revision" | "citation") {
    if (!editor || !canEdit) return;
    try { setAcademicDraft({ kind, anchor: academicSelection(editor), text: "", author: "", year: "", pages: "", url: "" }); setAcademicError(null); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Select a paragraph first."); }
  }

  function addAcademicNote(noteType: "footnote" | "endnote") {
    if (!editor) return;
    try {
      const usedIds = [
        ...academicNotes.filter((note) => note.noteType === noteType).map((note) => note.noteId),
        ...wordNotes.filter((note) => note.type === noteType).map((note) => note.id),
      ];
      const noteId = nextWordNoteId(usedIds, crypto.getRandomValues(new Uint32Array(1))[0]!);
      if (runAcademic([{ kind: "insert-note", anchor: academicSelection(editor), noteType, noteId, content: [[{ text: "" }]] }])) editor.state.doc.descendants((node, pos) => { if (node.attrs.nativeNoteId === noteId) editor.commands.setNodeSelection(pos); });
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Select a paragraph first."); }
  }

  const academicBlocks = editor ? documentBlocksFromJson(editor.getJSON()) : [];
  const academicItems = academicBlocks.flatMap((block) => (block.inlineContent ?? []).map((item) => ({ block, item })));
  const editableRevisions = academicItems.flatMap(({ block, item }) => item.kind === "revision" ? [{ block, item }] : []);
  const editableComments = academicItems.flatMap(({ block, item }) => item.kind === "commentBoundary" && item.boundary === "start" && item.comment ? [{ block, item }] : []);
  const academicNotes = academicItems.flatMap(({ item }) => item.kind === "noteRef" ? [item] : []);
  const academicCitations = academicItems.flatMap(({ block, item }) => item.kind === "citation" ? [{ block, item }] : []);
  const availableWordSources = [...new Map([
    ...((record(content).nativeBinding as { wordSources?: WordSource[] } | undefined)?.wordSources ?? []).map((source) => [source.tag, source] as const),
    ...academicCitations.map(({ item }) => [item.source.tag, item.source] as const),
  ]).values()];
  const sourceAuthor = (source: WordSource) => source.corporate || source.authors?.map((person) => [person.first, person.middle, person.last].filter(Boolean).join(" ")).join("; ") || "";
  function chooseWordSource(source: WordSource) {
    if (academicDraft) setAcademicDraft({ ...academicDraft, source, text: source.title, author: sourceAuthor(source), year: source.year ?? "", url: source.url ?? "" });
  }
  function editAcademicCitation(id?: string) {
    const found = academicCitations.find(({ item }) => item.citationId === id);
    if (!found) { setRevisionsOpen(true); return; }
    const { block, item } = found;
    setAcademicDraft({ kind: "citation", citationId: item.citationId, expectedText: item.text, source: item.source, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 }, text: item.source.title, author: sourceAuthor(item.source), year: item.source.year ?? "", pages: item.pages ?? "", url: item.source.url ?? "" });
  }
  function removeAcademicCitation(id?: string) {
    const found = academicCitations.find(({ item }) => item.citationId === id);
    if (found) runAcademic([{ kind: "remove-word-citation", citationId: found.item.citationId, expectedText: found.item.text }]);
    else setRevisionsOpen(true);
  }
  function changeAcademicNote(action: "move" | "delete", key?: string) {
    const note = academicNotes.find((item) => `${item.noteType}:${item.noteId}` === key);
    if (!note || !editor) { setRevisionsOpen(true); return; }
    try {
      runAcademic([action === "delete" ? { kind: "delete-note", noteType: note.noteType, noteId: note.noteId, expectedText: note.text } : { kind: "move-note", noteType: note.noteType, noteId: note.noteId, anchor: academicSelection(editor) }]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Select a destination paragraph first."); }
  }
  function reviewAcademicRevision(key: string | undefined, decision: "accept" | "reject") {
    const found = editableRevisions.find(({ block, item }) => `${block.id}:${item.revisionId}:${item.revisionKind}` === key);
    if (found) runAcademic([{ kind: "review-revision", regionId: found.block.id, revisionId: found.item.revisionId, revisionKind: found.item.revisionKind, expectedText: found.item.text, decision }]);
    else setRevisionsOpen(true);
  }

  function submitAcademicDraft() {
    if (!academicDraft) return;
    const id = String((crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_646) + 1);
    const draft = academicDraft;
    let operation: DocumentAcademicOperation;
    if (draft.kind === "comment") operation = { kind: "add-word-comment", anchor: draft.anchor, commentId: id, comment: { author: draft.author.trim(), text: draft.text, date: new Date().toISOString() } };
    else if (draft.kind === "revision") operation = { kind: "track-text", anchor: draft.anchor, revisionId: id, replacement: draft.text, provenance: { author: draft.author.trim(), date: new Date().toISOString() } };
    else {
      const { authors: _authors, corporate: _corporate, year: _year, url: _url, ...retained } = draft.source ?? { tag: `Source${id}`, sourceType: "Misc" as const };
      const author = draft.source && sourceAuthor(draft.source) === draft.author ? { ...(draft.source.authors ? { authors: draft.source.authors } : {}), ...(draft.source.corporate ? { corporate: draft.source.corporate } : {}) } : draft.author.trim() ? { authors: [{ last: draft.author.trim() }] } : {};
      const source: WordSource = { ...retained, title: draft.text.trim(), ...author, ...(draft.year.trim() ? { year: draft.year.trim() } : {}), ...(draft.url.trim() ? { url: draft.url.trim() } : {}) };
      operation = draft.citationId ? { kind: "edit-word-citation", citationId: draft.citationId, expectedText: draft.expectedText!, source, ...(draft.pages.trim() ? { pages: draft.pages.trim() } : {}) } : { kind: "insert-word-citation", citationId: `citation-${id}`, anchor: draft.anchor, source, ...(draft.pages.trim() ? { pages: draft.pages.trim() } : {}) };
    }
    if (runAcademic([operation])) { setAcademicDraft(null); setRevisionsOpen(draft.kind !== "citation"); }
  }

  /** Writes one key of the document's own content record beside the blocks. */
  const patchContent = useCallback(
    (patch: Record<string, unknown>) => {
      onChange({ ...record(content), ...patch });
      // Layout chrome is still a user edit. Notify the collaborative parent
      // just like the ProseMirror update path; a direct onChange here made
      // headers/footers look saved in the panel while never scheduling a
      // durable synchronization.
      onLocalCollaborativeChangeRef.current?.(true);
    },
    [content, onChange],
  );

  const BLOCK_TYPES = ["paragraph", "heading", "blockquote"] as const;
  /** The nearest block that carries paragraph properties. */
  const blockAttrs = (() => {
    if (!editor) return {} as Record<string, unknown>;
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (BLOCK_TYPES.includes(node.type.name as (typeof BLOCK_TYPES)[number]))
        return node.attrs as Record<string, unknown>;
    }
    return {} as Record<string, unknown>;
  })();

  /** The node a contextual tab is about: an image, an equation, a table. */
  const activeNode = (names: readonly string[]) => {
    if (!editor) return null;
    const { selection } = editor.state;
    const selected = (selection as { node?: { type: { name: string } } }).node;
      if (selected && names.includes(selected.type.name))
      return {
        type: selected.type.name,
        pos: selection.from,
        attrs: (selected as unknown as { attrs: Record<string, unknown> })
          .attrs,
      };
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (names.includes(node.type.name))
        return {
          type: node.type.name,
          pos: $from.before(depth),
          attrs: node.attrs as Record<string, unknown>,
        };
    }
    const after = $from.nodeAfter;
    if (after && names.includes(after.type.name))
      return { type: after.type.name, pos: $from.pos, attrs: after.attrs as Record<string, unknown> };
    return null;
  };

  const textStyleAttrs = editor?.getAttributes("textStyle") ?? {};
  const activeImage = activeNode(["image", "nativeDocxImage"]);
  const activeEquation = activeNode(["equation", "inlineEquation"]);
  const inTable = Boolean(editor?.isActive("table"));
  const inList = Boolean(
    editor?.isActive("bulletList") ||
    editor?.isActive("orderedList") ||
    editor?.isActive("taskList"),
  );
  const activeStyle = !editor
    ? "paragraph"
    : editor.isActive("heading", { level: 1 })
      ? "h1"
      : editor.isActive("heading", { level: 2 })
        ? "h2"
        : editor.isActive("heading", { level: 3 })
          ? "h3"
          : editor.isActive("blockquote")
            ? "quote"
            : editor.isActive("codeBlock")
              ? "code"
              : "paragraph";
  const trackedPlaceholders = wordRevisions.length
    ? wordRevisions.map((mark) => {
        const kindLabel =
          mark.kind === "ins"
            ? "Insertion"
            : mark.kind === "del"
              ? "Deletion"
              : mark.kind === "moveFrom"
                ? "Moved from"
                : mark.kind === "moveTo"
                  ? "Moved to"
                  : "Revision";
        return {
          id: mark.id,
          label: `Tracked change · ${kindLabel}`,
          detail: `${mark.author?.trim() || "Word"}: ${(mark.text.trim() || "(empty mark)").slice(0, 180)}`,
        };
      })
    : nativePlaceholders.filter((placeholder) =>
        /revision|tracked change/i.test(
          `${placeholder.label} ${placeholder.detail}`,
        ),
      );

  function applyStyle(style: string) {
    withEdit(() => {
      const chain = editor!.chain().focus();
      if (style === "h1" || style === "h2" || style === "h3")
        chain.setNode("heading", { level: Number(style.slice(1)) }).run();
      else if (style === "quote") chain.setParagraph().toggleBlockquote().run();
      else if (style === "code") chain.toggleCodeBlock().run();
      else chain.clearNodes().setParagraph().run();
    });
  }

  /** Increase / decrease indent: list nesting inside a list, `w:ind` outside. */
  function shiftIndent(steps: number) {
    withEdit(() => {
      if (inList) {
        const chain = editor!.chain().focus();
        if (steps > 0) chain.sinkListItem("listItem").run();
        else chain.liftListItem("listItem").run();
        return;
      }
      editor!.chain().focus().shiftParagraphIndent(steps).run();
    });
  }

  function insertTableOfContents() {
    withEdit(() => {
      const items = outlineEntries.map((entry) => ({
        type: "paragraph",
        attrs: { indentLevel: entry.level > 1 ? entry.level - 1 : null },
        content: [{ type: "text", text: entry.title }],
      }));
      editor!
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Contents" }],
          },
          ...(items.length
            ? items
            : [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Add headings and insert this again.",
                    },
                  ],
                },
              ]),
        ])
        .run();
    });
  }

  function insertCrossReference() {
    withEdit(() => {
      const target = outlineEntries[0];
      if (!target) return;
      editor!
        .chain()
        .focus()
        .insertContent([
          {
            type: "text",
            text: target.title,
            marks: [
              {
                type: "link",
                attrs: { href: `#${target.blockId ?? target.position}` },
              },
            ],
          },
        ])
        .run();
    });
  }

  function insertCitation() {
    const source =
      sourceNavigator.uncited[0] ?? sourceNavigator.entries[0]?.source;
    if (!source) {
      setSourcesOpen(true);
      return;
    }
    withEdit(() => {
      editor!
        .chain()
        .focus()
        .insertContent({
          type: "spectraCitation",
          attrs: {
            id: uniqueToken(),
            sourceId: source.id,
            label: source.title.slice(0, 60) || "Citation",
          },
        })
        .run();
    });
  }

  function saveNamedStyle(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = `style:${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    patchContent({
      namedStyles: [
        ...namedStyles.filter((style) => style.id !== id),
        {
          id,
          label: trimmed,
          // A named style is a snapshot of what this paragraph already looks
          // like, so "make everything else look like this" is one click rather
          // than five remembered settings.
          attrs: {
            ...(blockAttrs.lineSpacing
              ? { lineSpacing: blockAttrs.lineSpacing }
              : {}),
            ...(blockAttrs.spacingAfter
              ? { spacingAfter: blockAttrs.spacingAfter }
              : {}),
            ...(blockAttrs.indentLevel
              ? { indentLevel: blockAttrs.indentLevel }
              : {}),
            ...(blockAttrs.frameBorder
              ? { frameBorder: blockAttrs.frameBorder }
              : {}),
            ...(blockAttrs.frameShading
              ? { frameShading: blockAttrs.frameShading }
              : {}),
          },
        },
      ],
    });
    withEdit(() => editor!.chain().focus().setParagraphStyle(id).run());
  }

  function applyNamedStyle(styleId: string) {
    const style = namedStyles.find((entry) => entry.id === styleId);
    withEdit(() => {
      const chain = editor!
        .chain()
        .focus()
        .setParagraphStyle(styleId || null);
      const attrs = style?.attrs ?? {};
      if (typeof attrs.lineSpacing === "number")
        chain.setParagraphLineSpacing(attrs.lineSpacing);
      if (typeof attrs.spacingAfter === "number")
        chain.setParagraphSpacing(attrs.spacingAfter);
      if (typeof attrs.frameBorder === "string")
        chain.setParagraphBorder(attrs.frameBorder);
      if (typeof attrs.frameShading === "string")
        chain.setParagraphShading(attrs.frameShading);
      chain.run();
    });
  }

  const documentHandlers: DocumentCommandHandlers = {
    editable: canEdit,
    history: {
      undo: () => withEdit(() => editor!.chain().focus().undo().run()),
      redo: () => withEdit(() => editor!.chain().focus().redo().run()),
      canUndo: Boolean(editor?.can().undo()),
      canRedo: Boolean(editor?.can().redo()),
    },
    find: {
      toggle: () => setFindOpen((open) => !open),
      open: findOpen,
      toggleReplace: () => {
        setFindOpen(true);
        setReplaceOpen((open) => !open);
      },
      replaceOpen,
      replaceAll: replaceAllMatches,
      matchCount: findMatches.length,
    },
    comments: {
      toggle: () =>
        studioContract.inspector.open === "comments"
          ? studioContract.inspector.hide()
          : studioContract.inspector.show("comments"),
      open: studioContract.inspector.open === "comments",
      ...(strictNative
        ? {
            preservedNote:
              "Spectra threads live beside the document. Word's own comment parts stay exactly as the file has them.",
          }
        : {}),
    },
    format: {
      style: {
        value: activeStyle,
        set: applyStyle,
        options: DOCUMENT_STYLE_OPTIONS,
      },
      fontFamily: {
        ...(typeof textStyleAttrs.fontFamily === "string"
          ? { value: textStyleAttrs.fontFamily }
          : {}),
        set: (family) =>
          withEdit(() =>
            family
              ? editor!.chain().focus().setFontFamily(family).run()
              : editor!.chain().focus().unsetFontFamily().run(),
          ),
      },
      fontSize: {
        value:
          typeof textStyleAttrs.fontSize === "string" &&
          Number.parseFloat(textStyleAttrs.fontSize)
            ? Number.parseFloat(textStyleAttrs.fontSize)
            : 11,
        set: (size) =>
          withEdit(() =>
            editor!.chain().focus().setFontSize(`${size}px`).run(),
          ),
      },
      bold: {
        active: editor?.isActive("bold"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleBold().run()),
      },
      italic: {
        active: editor?.isActive("italic"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleItalic().run()),
      },
      underline: {
        active: editor?.isActive("underline"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleUnderline().run()),
      },
      strike: {
        active: editor?.isActive("strike"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleStrike().run()),
      },
      color: {
        ...(typeof textStyleAttrs.color === "string"
          ? { value: textStyleAttrs.color }
          : {}),
        set: (value) =>
          withEdit(() =>
            value
              ? editor!.chain().focus().setColor(value).run()
              : editor!.chain().focus().unsetColor().run(),
          ),
      },
      highlight: {
        ...(typeof editor?.getAttributes("highlight").color === "string"
          ? { value: editor.getAttributes("highlight").color as string }
          : {}),
        set: (value) =>
          withEdit(() =>
            value
              ? editor!.chain().focus().toggleHighlight({ color: value }).run()
              : editor!.chain().focus().unsetHighlight().run(),
          ),
      },
      alignment: {
        value: editor?.isActive({ textAlign: "center" })
          ? "center"
          : editor?.isActive({ textAlign: "right" })
            ? "right"
            : editor?.isActive({ textAlign: "justify" })
              ? "justify"
              : "left",
        set: (value) =>
          withEdit(() => editor!.chain().focus().setTextAlign(value).run()),
      },
      lineHeight: {
        ...(typeof blockAttrs.lineSpacing === "number"
          ? { value: blockAttrs.lineSpacing }
          : { value: 1 }),
        set: (value) =>
          withEdit(() =>
            editor!.chain().focus().setParagraphLineSpacing(value).run(),
          ),
      },
      bulletList: {
        active: editor?.isActive("bulletList"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleBulletList().run()),
      },
      numberedList: {
        active: editor?.isActive("orderedList"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleOrderedList().run()),
      },
      indent: {
        increase: () => shiftIndent(1),
        decrease: () => shiftIndent(-1),
        canDecrease: inList
          ? Boolean(editor?.can().liftListItem("listItem"))
          : Number(blockAttrs.indentLevel) > -8,
      },
      clear: () =>
        withEdit(() =>
          editor!.chain().focus().unsetAllMarks().clearNodes().run(),
        ),
      disabled: !canEdit,
      generalPins: ["fontFamily", "fontSize", "bold", "italic"],
    },
    paragraph: {
      ...(typeof blockAttrs.spacingAfter === "number"
        ? { spacingAfter: blockAttrs.spacingAfter }
        : {}),
      setSpacingAfter: (points) =>
        withEdit(() =>
          editor!.chain().focus().setParagraphSpacing(points).run(),
        ),
      border:
        typeof blockAttrs.frameBorder === "string"
          ? blockAttrs.frameBorder
          : "none",
      setBorder: (kind) =>
        withEdit(() => editor!.chain().focus().setParagraphBorder(kind).run()),
      shading:
        typeof blockAttrs.frameShading === "string"
          ? blockAttrs.frameShading
          : null,
      setShading: (color) =>
        withEdit(() =>
          editor!.chain().focus().setParagraphShading(color).run(),
        ),
      quote: {
        active: editor?.isActive("blockquote"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleBlockquote().run()),
      },
      codeBlock: {
        active: editor?.isActive("codeBlock"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleCodeBlock().run()),
      },
      inlineCode: {
        active: editor?.isActive("code"),
        toggle: () =>
          withEdit(() => editor!.chain().focus().toggleCode().run()),
      },
      inList,
      ...(Number(blockAttrs.indentLevel)
        ? { listLevel: Number(blockAttrs.indentLevel) }
        : {}),
      demote: () => shiftIndent(1),
      promote: () => shiftIndent(-1),
      canPromote: inList
        ? Boolean(editor?.can().liftListItem("listItem"))
        : Number(blockAttrs.indentLevel) > 0,
      moveUp: () => withEdit(() => editor!.chain().focus().moveBlock(-1).run()),
      moveDown: () =>
        withEdit(() => editor!.chain().focus().moveBlock(1).run()),
    },
    namedStyles: {
      options: namedStyles.map((style) => ({
        value: style.id,
        label: style.label,
      })),
      apply: applyNamedStyle,
      create: () => setStyleDraft(""),
      ...(namedStyles.length
        ? {}
        : {
            createHint:
              "Captures this paragraph's spacing, indent and frame as a style you can reuse",
          }),
    },
    outline: {
      toggle: () => setOutlineOpen((open) => !open),
      open: outlineOpen,
      headings: outlineEntries.length,
    },
    spellcheck: {
      active: spellcheckOn,
      toggle: () => setSpellcheckOn((on) => !on),
    },
    insert: {
      table: () =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .updateAttributes("table", { spectraAuthored: true })
            .run(),
        ),
      image: () => imageRef.current?.click(),
      link: () =>
        setLinkDraft(
          typeof editor?.getAttributes("link").href === "string"
            ? (editor.getAttributes("link").href as string)
            : "",
        ),
      linkActive: editor?.isActive("link"),
      unlink: () => withEdit(() => editor!.chain().focus().unsetLink().run()),
      equationBlock: () =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .insertContent({
              type: "equation",
              attrs: { latex: "", display: "block", alignment: "center" },
            })
            .run(),
        ),
      equationInline: () =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .insertContent({ type: "inlineEquation", attrs: { latex: "" } })
            .run(),
        ),
      callout: (kind) =>
        withEdit(() =>
          editor!.chain().focus().setCallout({ type: kind }).run(),
        ),
      divider: () =>
        withEdit(() => editor!.chain().focus().setHorizontalRule().run()),
      taskList: () =>
        withEdit(() => editor!.chain().focus().toggleTaskList().run()),
      taskListActive: editor?.isActive("taskList"),
      reference: () =>
        spectraBus.command("reference.add", {
          hostWorkId: artifactId,
          at: editor ? caretPoint(editor.view) : undefined,
        }),
      citation: () => nativeBinding.format || !sourcesHaveWork ? openAcademic("citation") : insertCitation(),
      ...(sourcesHaveWork || nativeBinding.format
        ? {}
        : {
            citationHint:
              "Cite a source once this document carries one; the Sources rail opens instead",
          }),
      footnote: () => addAcademicNote("footnote"),
      endnote: () => addAcademicNote("endnote"),
      pageBreak: () =>
        withEdit(() => editor!.chain().focus().insertPageBreak().run()),
      sectionBreak: () =>
        withEdit(() => editor!.chain().focus().insertSectionBreak().run()),
      caption: () =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .insertContent({
              type: "paragraph",
              attrs: { blockStyle: "caption" },
              content: [
                { type: "text", text: "Figure — describe what this shows" },
              ],
            })
            .run(),
        ),
      tableOfContents: insertTableOfContents,
    },
    table: {
      active: inTable,
      addRowBefore: () =>
        withEdit(() => editor!.chain().focus().addRowBefore().run()),
      addRowAfter: () =>
        withEdit(() => editor!.chain().focus().addRowAfter().run()),
      deleteRow: () =>
        withEdit(() => editor!.chain().focus().deleteRow().run()),
      addColumnBefore: () =>
        withEdit(() => editor!.chain().focus().addColumnBefore().run()),
      addColumnAfter: () =>
        withEdit(() => editor!.chain().focus().addColumnAfter().run()),
      deleteColumn: () =>
        withEdit(() => editor!.chain().focus().deleteColumn().run()),
      mergeCells: () =>
        withEdit(() => editor!.chain().focus().mergeCells().run()),
      splitCell: () =>
        withEdit(() => editor!.chain().focus().splitCell().run()),
      canMerge: Boolean(editor?.can().mergeCells()),
      canSplit: Boolean(editor?.can().splitCell()),
      toggleHeaderRow: () =>
        withEdit(() => editor!.chain().focus().toggleHeaderRow().run()),
      headerRowActive: Boolean(editor?.isActive("tableHeader")),
      deleteTable: () =>
        withEdit(() => editor!.chain().focus().deleteTable().run()),
      ...(() => {
        const currentTable = activeNode(["table"]);
        const authoredHere = currentTable?.attrs.spectraAuthored === true;
        return strictNative && inTable && !authoredHere
          ? {
              nativeStructureReason:
                "This table came from the Word file. Spectra can edit the text in its cells; changing rows or columns would rewrite the table definition, so that stays in Word.",
            }
          : {};
      })(),
    },
    image: {
      active: Boolean(activeImage),
      ...(typeof activeImage?.attrs.wrap === "string"
        ? { wrap: activeImage.attrs.wrap }
        : {}),
      setWrap: (wrap) =>
        withEdit(() =>
          editor!.chain().focus().updateAttributes(activeImage?.type ?? "image", { wrap }).run(),
        ),
      ...(Number(activeImage?.attrs.widthPercent)
        ? { width: Number(activeImage!.attrs.widthPercent) }
        : activeImage?.type === "nativeDocxImage" && Number(activeImage.attrs.widthEmu)
          ? { width: Math.max(1, Math.min(100, Number(activeImage.attrs.widthEmu) / (8.27 * 914400) * 100)) }
        : {}),
      setWidth: (percent) =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .updateAttributes(
              activeImage?.type ?? "image",
              activeImage?.type === "nativeDocxImage"
                ? { widthPercent: percent, widthEmu: Math.round((percent / 100) * 8.27 * 914400) }
                : { widthPercent: percent },
            )
            .run(),
        ),
      ...(typeof activeImage?.attrs.alt === "string"
        ? { alt: activeImage.attrs.alt }
        : {}),
      editAlt: () =>
        setAltDraft(
          typeof activeImage?.attrs.alt === "string"
            ? activeImage.attrs.alt
            : "",
        ),
      replace: () => imageRef.current?.click(),
      remove: () =>
        withEdit(() => editor!.chain().focus().deleteSelection().run()),
    },
    equation: {
      active: Boolean(activeEquation),
      ...(activeEquation
        ? {
            display:
              activeEquation.attrs.display === "inline"
                ? ("inline" as const)
                : ("block" as const),
          }
        : {}),
      setDisplay: (display) =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .updateAttributes("equation", {
              display: display === "inline" ? "inline" : "block",
            })
            .run(),
        ),
      ...(typeof activeEquation?.attrs.alignment === "string"
        ? { alignment: activeEquation.attrs.alignment }
        : {}),
      setAlignment: (alignment) =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .updateAttributes("equation", { alignment })
            .run(),
        ),
      // Selecting the node is what opens its LaTeX field: the equation is edited
      // where it sits, not in a dialogue at the edge of the screen.
      edit: () => {
        if (!editor || !activeEquation) return;
        editor.chain().focus().setNodeSelection(activeEquation.pos).run();
      },
      remove: () =>
        withEdit(() => editor!.chain().focus().deleteSelection().run()),
    },
    page: {
      size: pageSetup.size,
      setSize: (size) => patchContent({ pageSetup: { ...pageSetup, size } }),
      orientation: pageSetup.orientation,
      setOrientation: (orientation) =>
        patchContent({
          pageSetup: {
            ...pageSetup,
            orientation: orientation === "landscape" ? "landscape" : "portrait",
          },
        }),
      margins: pageSetup.margins,
      setMargins: (margins) =>
        patchContent({ pageSetup: { ...pageSetup, margins } }),
      columns: pageSetup.columns,
      setColumns: (columns) =>
        patchContent({
          pageSetup: {
            ...pageSetup,
            columns: Math.max(1, Math.min(3, columns)),
          },
        }),
      editHeader: () =>
        setChromeDraft({ slot: "header", text: pageSetup.header }),
      headerText: pageSetup.header,
      editFooter: () =>
        setChromeDraft({ slot: "footer", text: pageSetup.footer }),
      footerText: pageSetup.footer,
      canvas: pageLayout,
      setCanvas: setPageLayout,
      spreadReason: mode === "split" ? "Open the document full to lay its pages side by side" : undefined,
      focus: focusMode,
      toggleFocus: () => {
        if (focusMode) {
          setDocMode("write");
          return;
        }
        setDocMode("focus");
        setOutlineOpen(false);
        setSourcesOpen(false);
        setFindOpen(false);
      },
      ...(canPreviewAsReader
        ? { previewAsReader: () => setDocMode("read") }
        : {}),
      templates: [
        { id: "notes", label: "Study notes" },
        { id: "essay", label: "Essay" },
        { id: "lab", label: "Lab report" },
      ],
      applyTemplate: (id) =>
        setPendingTemplate(
          id === "essay" ? "essay" : id === "lab" ? "lab" : "notes",
        ),
    },
    references: {
      sources: {
        toggle: () => setSourcesOpen((open) => !open),
        open: sourcesOpen,
        unresolved: sourceNavigator.unresolved.length,
        count: sourceNavigator.entries.length + sourceNavigator.uncited.length,
      },
      insertBibliography,
      citationStyle: bibliographyStyle,
      setCitationStyle: (style) =>
        patchContent({
          bibliographyStyle:
            style === "author_date" ? "author_date" : "numeric",
        }),
      addSource: () => openAcademic("citation"),
      crossReference: insertCrossReference,
    },
    review: {
      editNote: () => setRevisionsOpen(true),
      moveNote: (key) => changeAcademicNote("move", key),
      deleteNote: (key) => changeAcademicNote("delete", key),
      editWordComment: () => setRevisionsOpen(true),
      editCitation: editAcademicCitation,
      removeCitation: removeAcademicCitation,
      addWordComment: () => openAcademic("comment"),
      proposeText: () => openAcademic("revision"),
      acceptRevision: (key) => reviewAcademicRevision(key, "accept"),
      rejectRevision: (key) => reviewAcademicRevision(key, "reject"),
      deleteWordComment: (id) => {
        const found = editableComments.find(({ item }) => item.commentId === id);
        if (found?.item.comment) runAcademic([{ kind: "delete-word-comment", commentId: id, expectedText: found.item.comment.text }]);
      },
      showTrackedChanges: () => setRevisionsOpen((open) => !open),
      trackedChangesOpen: revisionsOpen,
      trackedChangeCount: trackedPlaceholders.length,
      revisionsPreservedReason:
        "Review individual supported revisions in the rail. Whole-document review is unavailable when native structural or formatting revisions may be present.",
      acceptRevisions: () => undefined,
      rejectRevisions: () => undefined,
      updateFields: () => undefined,
      fieldsPreservedReason:
        "Field results stay as Word calculated them. Spectra never recalculates a field, so a stale page number is Word's to refresh.",
    },
    exportCopies: {
      formats: [...DOCUMENT_EXPORT_COPIES],
      run: async (format) => {
        setExportBusy(format);
        try {
          await exportDocument(
            format as "docx" | "pdf" | "html" | "md" | "txt",
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "The document copy could not be exported.");
        } finally {
          setExportBusy(null);
        }
      },
      busyFormat: exportBusy,
      noun: "document",
    },
    importCopy: {
      open: () => importRef.current?.click(),
      busy: importing,
      noun: "document",
    },
    print: () => window.print(),
  };

  const selectionKind = activeImage
    ? "Image"
    : activeEquation
      ? "Equation"
      : inTable
        ? "Table"
        : undefined;

  const documentCommands = documentCommandBindings(documentHandlers);
  /**
   * The registry view of those bindings, keyed by id. Everything that is not
   * the work bar — the selection toolbar, the slash menu, a keyboard path —
   * dispatches through this map, so availability is decided once (C2).
   */
  const documentCommandMap = useMemo(() => {
    const entries = documentCommands.map((binding, index) => {
      const command = commandForBinding("document", binding, index);
      return [command.id, { binding, command }] as const;
    });
    return new Map(entries);
    // documentCommands is rebuilt every render by design: it reads live editor
    // state. The map is derived from it in the same frame.
  }, [documentCommands]);
  const documentCommandCtx = useMemo(
    () =>
      commandContext(
        "document",
        studioContract.can,
        studioContract.role,
        selectionKind,
        {
          compatibilityProfile: studioContract.compatibilityProfile,
          fidelity: studioContract.fidelity,
          artifactId,
        },
        studioContract.executeApplicationCommand,
      ),
    [
      artifactId,
      selectionKind,
      studioContract.can,
      studioContract.compatibilityProfile,
      studioContract.executeApplicationCommand,
      studioContract.fidelity,
      studioContract.role,
    ],
  );
  const runDocumentCommand = async (id: string, value?: CommandParam) => {
    const entry = documentCommandMap.get(id);
    if (!entry) return false;
    const availability = entry.command.availability(documentCommandCtx);
    if (availability.state !== "enabled") return false;
    try {
      const outcome = await entry.command.execute(documentCommandCtx, value);
      if (outcome === false) return false;
      if (outcome === true) return true;
      if (
        !outcome ||
        typeof outcome !== "object" ||
        outcome.status !== "completed" ||
        (outcome.data &&
          typeof outcome.data === "object" &&
          "changed" in outcome.data &&
          outcome.data.changed === false)
      ) {
        if (outcome?.status === "failed" || outcome?.status === "unavailable")
          toast.error(outcome.message);
        return false;
      }
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The document command could not be completed.",
      );
      return false;
    }
  };
  useEffect(() => spectraBus.handle("document.executeCommand", async ({ artifactId: targetId, commandId, params }) => {
    if (targetId !== artifactId) return undefined;
    const entry = documentCommandMap.get(commandId);
    if (!entry) {
      return {
        commandId,
        status: "unavailable",
        effect: "mutate",
        message: "This command is not registered for the active document.",
      } satisfies import("../commands/types").CommandExecutionResult;
    }
    const availability = entry.command.availability(documentCommandCtx);
    if (availability.state !== "enabled") {
      return {
        commandId,
        status: "unavailable",
        effect: "mutate",
        message: availability.state === "disabled"
          ? availability.reason
          : "This command is not available for the active document.",
      } satisfies import("../commands/types").CommandExecutionResult;
    }
    const outcome = await entry.command.execute(documentCommandCtx, params as CommandParam);
    return outcome && typeof outcome === "object" ? outcome : {
      commandId,
      status: "failed",
      effect: "mutate",
      message: "This document command did not confirm a completed change.",
    } satisfies import("../commands/types").CommandExecutionResult;
  }), [artifactId, documentCommandCtx, documentCommandMap]);
  const documentCommandAvailability = (id: string) => {
    const entry = documentCommandMap.get(id);
    if (!entry) return { enabled: false };
    const state = entry.command.availability(documentCommandCtx);
    if (state.state === "enabled") return { enabled: true };
    // "hidden" carries no sentence: the viewer lacks the capability, so the verb
    // is absent rather than explained. "disabled" always carries one.
    return state.state === "disabled"
      ? { enabled: false, reason: state.reason }
      : { enabled: false };
  };
  const slashDispatch = slashDispatchRef;
  /**
   * What the floating bar offers, in the order a hand reaches for it. The list
   * is ids only: the bindings, their live state and their availability all come
   * from the one command set, so nothing here can drift from the work bar.
   */
  const selectionToolbarEntries = (
    [
      "document.format.style",
      "document.format.bold",
      "document.format.italic",
      "document.format.underline",
      "document.format.highlight",
      "document.format.align",
      "document.insert.link",
      ...(editor?.isActive("link") ? ["document.insert.link.remove"] : []),
      ...(inTable
        ? [
            "document.table.row.after",
            "document.table.column.after",
            "document.table.merge",
            "document.table.split",
            "document.table.row.delete",
            "document.table.column.delete",
          ]
        : []),
      ...(activeImage
        ? [
            "document.image.wrap",
            "document.image.width",
            "document.image.alt",
            "document.image.replace",
          ]
        : []),
      ...(activeEquation
        ? [
            "document.equation.display",
            "document.equation.align",
            "document.equation.edit",
          ]
        : []),
    ] as const
  ).flatMap<DocumentSelectionEntry>((id) => {
    const entry = documentCommandMap.get(id);
    return entry ? [{ id, binding: entry.binding }] : [];
  });
  useEffect(() => {
    // Keeps the menu's dispatcher current without rebuilding the editor. The
    // items themselves are built when the menu opens, from this pair.
    slashDispatch.current = {
      run: runDocumentCommand,
      availability: documentCommandAvailability,
    };
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute("spellcheck", spellcheckOn ? "true" : "false");
  }, [editor, spellcheckOn]);

  return (
    <div
      ref={studioRef}
      className="spectra-document-studio flex h-full min-h-0 flex-col bg-[var(--bg-primary)]"
      data-focus={focusMode || undefined}
      data-doc-mode={docMode}
      data-compact={mode === "split" || undefined}
      data-layout={pageLayout}
      data-page-size={pageSetup.size}
      data-orientation={pageSetup.orientation}
      data-margins={pageSetup.margins}
      data-columns={pageSetup.columns > 1 ? pageSetup.columns : undefined}
      data-show-kept={(showKept && syncedFile) || undefined}
    >
      {keptMenu ? createPortal(
        <DropdownMenu open onOpenChange={(open) => !open && setKeptMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden style={{ position: "fixed", left: keptMenu.x, top: keptMenu.y, width: 0, height: 0 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-[260px]" layer="composer-dock">
            <DropdownMenuLabel className="whitespace-normal font-normal leading-snug text-[var(--text-secondary)]">
              Kept as it is in the original file. Spectra cannot edit this part yet, and saves it back unchanged.
            </DropdownMenuLabel>
            {syncedFile ? (
              <DropdownMenuItem onSelect={() => setShowKept((shown) => !shown)}>
                <Highlighter className="size-3.5 text-[var(--text-tertiary)]" />
                {showKept ? "Stop highlighting kept parts" : "Highlight every kept part"}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>,
        // The panel moves on a transform, which would carry a fixed anchor with it.
        document.body,
      ) : null}
      {!focusMode ? header : null}
      {/* One bar. Off-default activities (Page canvas, Focus) stay in the bar
          with the active treatment so the writer can see they left continuous. */}
      <ArtifactWorkbar
        label="Document tools"
        selectionContext={selectionKind}
        modes={[]}
        context={docMode === "read" ? (readOnly ? "Read only" : "Reader preview") : undefined}
        {...(docMode === "read" || docMode === "review"
          ? {
              primary: {
                label: "Back to editing",
                icon: Pencil,
                requires: "edit" as const,
                onSelect: () => setDocMode("write"),
              },
            }
          : {})}
        actions={documentCommands}
      />
      {canEdit && editor ? (
        <BubbleMenu
          editor={editor}
          pluginKey={FORMAT_BAR_KEY}
          appendTo={() => document.body}
          options={{ placement: "top", offset: 10, flip: true, shift: true }}
          shouldShow={({ editor: current, state }) => {
            if (!current.isEditable || readOnly || !formatMenuOpen(state)) return false;
            if (document.querySelector(".slash-command-portal")) return false;
            const selectedNode = (
              state.selection as { node?: { type: { name: string } } }
            ).node;
            // A selected atom gets its own contextual tab in the bar; only the
            // ones that have something to offer here open the floating bar.
            return (
              !selectedNode ||
              ["table", "tableRow", "image", "nativeDocxImage", "equation", "inlineEquation"].includes(
                selectedNode.type.name,
              )
            );
          }}
          className="spectra-document-selection-toolbar"
        >
          <DocumentSelectionToolbar
            entries={selectionToolbarEntries}
            run={runDocumentCommand}
            availability={documentCommandAvailability}
          />
        </BubbleMenu>
      ) : null}
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file || !editor) return;
          void (async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const mediaType =
              bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
                ? "image/png"
                : bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
                  ? "image/jpeg"
                  : "";
            if (!mediaType) {
              toast.error("Word pictures must be PNG or JPEG files.");
              return;
            }
            const blob = new Blob([bytes], { type: mediaType });
            const sha256 = await artifactBlobSha256(blob);
            const extension = mediaType === "image/jpeg" ? "jpg" : "png";
            const uploaded = await uploadArtifactAsset({
              artifactId,
              path: `document/images/${sha256}.${extension}`,
              name: file.name || `image-${sha256.slice(0, 12)}.${extension}`,
              mediaType,
              sha256,
              blob,
            });
            const attrs = {
              src: `/api/spectra/assets/content?assetId=${encodeURIComponent(uploaded.assetId)}`,
              assetId: uploaded.assetId,
              mediaType,
              ...imageEmuAttributes(bytes, mediaType),
            };
            withEdit(() => {
              const chain = editor.chain().focus();
              if (activeImage) chain.updateAttributes(activeImage.type, attrs);
              else chain.setImage(attrs);
              chain.run();
            });
          })().catch((error) => {
            toast.error(error instanceof Error ? error.message : "The image could not be uploaded.");
          });
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".docx,.odt,.pdf,.html,.htm,.txt,.md,.markdown"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importDocument(file);
        }}
      />
      <div className="spectra-editor-body">
        {findOpen ? (
          <div className="spectra-document-findbar">
            <Search className="h-4 w-4" />
            <label>
              <span className="sr-only">Find text</span>
              <input
                autoFocus
                value={findDraft}
                onChange={(event) => {
                  setFindDraft(event.target.value);
                  setFindCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setFindOpen(false);
                  if (event.key === "Enter")
                    selectFindMatch(event.shiftKey ? -1 : 1);
                }}
                placeholder="Find in document"
              />
              <small>
                {findMatches.length
                  ? `${Math.min(findCursor + 1, findMatches.length)} of ${findMatches.length}`
                  : findDraft
                    ? findOptions.regex &&
                      !documentFindPattern(findDraft, findOptions)
                      ? "Not a valid pattern"
                      : "No matches"
                    : ""}
              </small>
            </label>
            <div
              className="spectra-document-find-options"
              role="group"
              aria-label="Match options"
            >
              {(
                [
                  ["caseSensitive", "Aa", "Match case"],
                  ["wholeWord", "W", "Whole word"],
                  ["regex", ".*", "Regular expression"],
                ] as const
              ).map(([option, glyph, label]) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={findOptions[option] === true}
                  data-active={findOptions[option] === true || undefined}
                  title={label}
                  aria-label={label}
                  onClick={() => {
                    setFindOptions((current) => ({
                      ...current,
                      [option]: !current[option],
                    }));
                    setFindCursor(0);
                  }}
                >
                  {glyph}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!findMatches.length}
              onClick={() => selectFindMatch(-1)}
              aria-label="Previous match"
            >
              <ChevronDown className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              disabled={!findMatches.length}
              onClick={() => selectFindMatch(1)}
              aria-label="Next match"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            {replaceOpen ? (
              <>
                <input
                  data-find-replace=""
                  value={replaceDraft}
                  disabled={readOnly}
                  onChange={(event) => setReplaceDraft(event.target.value)}
                  placeholder="Replace with"
                  aria-label="Replacement text"
                />
                <button
                  type="button"
                  data-find-replace=""
                  disabled={!findMatches.length || readOnly}
                  onClick={() =>
                    runDocumentCommand("document.navigate.replace", true)
                  }
                >
                  Replace all
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label="Close find and replace"
              onClick={() => setFindOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {linkDraft !== null ? (
          <DocumentInlinePanel
            label={editor?.isActive("link") ? "Edit link" : "Add link"}
            detail="The selected text becomes the link. Clear the address to remove it."
            value={linkDraft}
            placeholder="https://example.com"
            confirmLabel="Apply"
            onChange={setLinkDraft}
            onCancel={() => setLinkDraft(null)}
            onConfirm={() => {
              const href = linkDraft.trim();
              withEdit(() =>
                href
                  ? editor!
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .setLink({ href })
                      .run()
                  : editor!
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run(),
              );
              setLinkDraft(null);
            }}
          />
        ) : null}
        {academicDraft ? (
          <DocumentInlinePanel
            label={academicDraft.kind === "citation" ? "Word citation" : academicDraft.kind === "comment" ? "Word comment" : "Proposed text"}
            detail={academicDraft.kind === "citation" ? "Enter only metadata you know. These details are user supplied; adding a URL does not verify the source." : academicDraft.kind === "comment" ? "This annotation is stored in the Word file. Its author label does not invite anyone or change Spectra conversations." : "The selected original text remains available for review and undo. An empty replacement proposes a deletion."}
            value={academicDraft.text}
            placeholder={academicDraft.kind === "citation" ? "Source title" : academicDraft.kind === "comment" ? "Comment on this range" : "Replacement text"}
            multiline={academicDraft.kind !== "citation"}
            confirmLabel={academicDraft.citationId ? "Save citation" : academicDraft.kind === "revision" ? "Propose change" : "Insert"}
            onChange={(text) => setAcademicDraft({ ...academicDraft, text })}
            onCancel={() => setAcademicDraft(null)}
            onConfirm={submitAcademicDraft}
          >
            <label>Author{academicDraft.kind === "citation" ? " (optional)" : ""}<input aria-label="Native author" value={academicDraft.author} onChange={(event) => setAcademicDraft({ ...academicDraft, author: event.target.value })} /></label>
            {academicDraft.kind === "citation" ? <>
              <CitationSourcePickers
                sources={availableWordSources}
                source={academicDraft.source}
                showSources={!academicDraft.citationId}
                onChooseSource={chooseWordSource}
                onNewSource={() => setAcademicDraft({ ...academicDraft, source: undefined, text: "", author: "", year: "", url: "" })}
                onSourceType={(sourceType) => setAcademicDraft({ ...academicDraft, source: { ...(academicDraft.source ?? { tag: `Source${crypto.randomUUID().replaceAll("-", "")}`, title: academicDraft.text }), sourceType } })}
              />
              <label>Year (optional)<input aria-label="Source year" value={academicDraft.year} onChange={(event) => setAcademicDraft({ ...academicDraft, year: event.target.value })} /></label>
              <label>Pages (optional)<input aria-label="Citation pages" value={academicDraft.pages} onChange={(event) => setAcademicDraft({ ...academicDraft, pages: event.target.value })} /></label>
              <label>URL (optional)<input aria-label="Source URL" value={academicDraft.url} onChange={(event) => setAcademicDraft({ ...academicDraft, url: event.target.value })} /></label>
            </> : null}
            {academicError ? <p role="alert">{academicError}</p> : null}
          </DocumentInlinePanel>
        ) : null}
        {altDraft !== null ? (
          <DocumentInlinePanel
            label="Alternative text"
            detail="What the picture shows, for a reader who cannot see it. It travels with the image into a Word or PDF copy."
            value={altDraft}
            placeholder="A labelled diagram of the water cycle"
            multiline
            confirmLabel="Save"
            onChange={setAltDraft}
            onCancel={() => setAltDraft(null)}
            onConfirm={() => {
              withEdit(() =>
                editor!
                  .chain()
                  .focus()
                  .updateAttributes(activeImage?.type ?? "image", { alt: altDraft })
                  .run(),
              );
              setAltDraft(null);
            }}
          />
        ) : null}
        {chromeDraft ? (
          <DocumentInlinePanel
            label={
              chromeDraft.slot === "header" ? "Page header" : "Page footer"
            }
            detail="Shown on every page of the page canvas and in a printed copy."
            value={chromeDraft.text}
            placeholder={
              chromeDraft.slot === "header"
                ? "Title, author, or unit"
                : "Class, date, or page note"
            }
            confirmLabel="Save"
            onChange={(text) =>
              setChromeDraft({ slot: chromeDraft.slot, text })
            }
            onCancel={() => setChromeDraft(null)}
            onConfirm={() => {
              patchContent({
                pageSetup: {
                  ...pageSetup,
                  [chromeDraft.slot]: chromeDraft.text,
                },
              });
              setChromeDraft(null);
            }}
          />
        ) : null}
        {styleDraft !== null ? (
          <DocumentInlinePanel
            label="Name this style"
            detail="Captures this paragraph's spacing, indent and frame so the rest of the document can match it."
            value={styleDraft}
            placeholder="Question stem"
            confirmLabel="Save style"
            onChange={setStyleDraft}
            onCancel={() => setStyleDraft(null)}
            onConfirm={() => {
              saveNamedStyle(styleDraft);
              setStyleDraft(null);
            }}
          />
        ) : null}
        {importReport || importError ? (
          <div
            className="spectra-document-import-report"
            data-error={Boolean(importError) || undefined}
            role="status"
          >
            <span>
              <strong>
                {importError ? "Couldn't import" : "Import complete"}
              </strong>
              <small>{importError || importReport}</small>
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setImportError(undefined);
                setImportReport(undefined);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {pendingTemplate ? (
          <div className="spectra-document-confirm" role="status">
            <span>
              <strong>Replace this document?</strong>
              <small>
                {(pendingTemplate === "notes"
                  ? "Study notes"
                  : pendingTemplate === "essay"
                    ? "Essay"
                    : "Lab report") + " will replace the current pages."}
              </small>
            </span>
            <button type="button" onClick={() => setPendingTemplate(null)}>
              Keep writing
            </button>
            <button
              type="button"
              data-confirm-replace=""
              onClick={() => {
                applyDocumentTemplate(pendingTemplate);
                setPendingTemplate(null);
              }}
            >
              Replace
            </button>
          </div>
        ) : null}
        <div className="spectra-document-canvas-shell">
          {outlineOpen ? (
            <aside className="spectra-document-outline">
              <header>
                <strong>Outline</strong>
                <button type="button" aria-label="Close outline" onClick={() => setOutlineOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </header>
              {outlineEntries.map((entry, index) => (
                <button
                  key={`${entry.position}:${index}`}
                  type="button"
                  data-current={
                    activeOutlineEntry?.position === entry.position || undefined
                  }
                  style={{ paddingLeft: 11 + (entry.level - 1) * 12 }}
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      // A heading's content starts one past the node itself.
                      .setTextSelection(entry.position + 1)
                      .scrollIntoView()
                      .run()
                  }
                >
                  <span>{index + 1}</span>
                  <strong>{entry.title}</strong>
                  {entry.wordCount ? <em>{entry.wordCount}</em> : null}
                </button>
              ))}
              {!outlineEntries.length ? (
                <p>Add headings to navigate long documents.</p>
              ) : null}
            </aside>
          ) : null}
          {sourcesOpen ? (
            <aside className="spectra-document-sources spectra-panel-enter">
              <header>
                <strong>Sources</strong>
                <button type="button" aria-label="Close sources" onClick={() => setSourcesOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </header>
              {sourceNavigator.unresolved.length ? (
                <div className="spectra-document-sources-problem" role="alert">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <p>
                    {sourceNavigator.unresolved.length} citation
                    {sourceNavigator.unresolved.length === 1 ? "" : "s"} point
                    at a source this document does not carry. Attach the source
                    or remove the citation.
                  </p>
                </div>
              ) : null}
              {sourceNavigator.entries.map((entry, index) => (
                <button
                  key={entry.source.id}
                  type="button"
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      .setTextSelection(entry.uses[0]!.position)
                      .scrollIntoView()
                      .run()
                  }
                >
                  <span>{bibliography[index]?.marker ?? `[${index + 1}]`}</span>
                  <strong>{entry.source.title || "Untitled source"}</strong>
                  <em>
                    {entry.uses.length} citation
                    {entry.uses.length === 1 ? "" : "s"}
                    {entry.sections.length
                      ? ` · ${entry.sections.slice(0, 2).join(", ")}`
                      : ""}
                  </em>
                </button>
              ))}
              {sourceNavigator.uncited.length ? (
                <p className="spectra-document-sources-uncited">
                  {sourceNavigator.uncited.length} attached source
                  {sourceNavigator.uncited.length === 1 ? "" : "s"} nothing
                  cites yet.
                </p>
              ) : null}
              {!sourceNavigator.entries.length &&
              !sourceNavigator.unresolved.length ? (
                <p>
                  Cite a source in the text and it appears here, with every
                  place it is used.
                </p>
              ) : null}
              {readOnly ? null : (
                <button
                  type="button"
                  className="spectra-document-sources-action"
                  onClick={insertBibliography}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                  Insert references
                </button>
              )}
            </aside>
          ) : null}
          {revisionsOpen ? (
            <aside className="spectra-document-revisions spectra-panel-enter" aria-label="Word review">
              <header>
                <History className="h-3.5 w-3.5" />
                <strong>Tracked changes</strong>
                <button type="button" aria-label="Close Word review" onClick={() => setRevisionsOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </header>
              {editableRevisions.map(({ block, item }) => (
                <div key={`${block.id}:${item.revisionId}:${item.revisionKind}`}>
                  <strong>{item.revisionKind === "ins" ? "Insertion" : "Deletion"} · {item.author || "Word"}</strong>
                  <small>{item.text || "Empty revision"}</small>
                  <button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.review.trackChanges.acceptOne", `${block.id}:${item.revisionId}:${item.revisionKind}`)}>Accept</button>
                  <button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.review.trackChanges.rejectOne", `${block.id}:${item.revisionId}:${item.revisionKind}`)}>Reject</button>
                </div>
              ))}
              {trackedPlaceholders.length ? (
                <>
                  {trackedPlaceholders.filter((placeholder) => !editableRevisions.some(({ item }) => placeholder.id === `docx:revision:${item.revisionKind}:${item.revisionId}`)).map((placeholder) => (
                    <div key={placeholder.id}>
                      <strong>{placeholder.label}</strong>
                      <small>{placeholder.detail}</small>
                    </div>
                  ))}
                  <p>
                    Structural, formatting, moved and nested revision marks stay in Word. The supported text revisions above can be reviewed individually.
                  </p>
                </>
              ) : (
                <p>
                  {editableRevisions.length ? "Review each change above, or undo the operation." : "This document carries no tracked text changes. Select text and choose Propose text edit to create one."}
                </p>
              )}
              {editableComments.length ? <div className="spectra-document-word-comments">
                <strong>Word comments</strong>
                {editableComments.map(({ item }) => <div key={item.commentId}>
                  <strong>{item.comment!.author || "Word"}</strong>
                  <textarea key={item.comment!.text} aria-label={`Word comment ${item.commentId}`} defaultValue={item.comment!.text} disabled={!canEdit || Boolean(item.comment!.readOnlyReason)} onBlur={(event) => { if (event.target.value !== item.comment!.text) runAcademic([{ kind: "edit-word-comment", commentId: item.commentId, expectedText: item.comment!.text, text: event.target.value }]); }} />
                  {item.comment!.readOnlyReason ? <small>{item.comment!.readOnlyReason}</small> : null}
                  <button type="button" disabled={!canEdit || Boolean(item.comment!.readOnlyReason)} onClick={() => runDocumentCommand("document.review.comment.delete", item.commentId)}>Delete comment</button>
                </div>)}
                <p>Native author labels describe the Word file. Spectra conversations and access remain separate.</p>
              </div> : null}
              {wordComments.length ? (
                <div className="spectra-document-word-comments">
                  <strong>Word comments</strong>
                  {wordComments.filter((comment) => !editableComments.some(({ item }) => item.commentId === comment.id)).map((comment) => (
                    <div key={`word-comment-${comment.id}`}>
                      <strong>{comment.author?.trim() || "Word"}</strong>
                      <small>{comment.text}</small>
                    </div>
                  ))}
                  <p>
                    These are native Word comments from the file. Spectra
                    threads stay separate and are never written into the
                    package by this panel.
                  </p>
                </div>
              ) : null}
              {academicCitations.length ? <div className="spectra-document-word-comments">
                <strong>Word citations</strong>
                {academicCitations.map(({ item }) => <div key={item.citationId}><small>{item.text}</small><button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.references.citation.edit", item.citationId)}>Edit citation</button><button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.references.citation.remove", item.citationId)}>Remove citation</button></div>)}
                <button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.references.bibliography")}>Update bibliography</button>
              </div> : null}
              {academicNotes.length ? <div className="spectra-document-word-notes">
                <strong>Word notes</strong>
                <p>To move a reference, select its destination in the text, then choose Move here.</p>
                {academicNotes.map((note) => <div key={`${note.noteType}:${note.noteId}`}>
                  <strong>{note.noteType === "footnote" ? "Footnote" : "Endnote"} {note.noteId}</strong>
                  <textarea key={note.text} aria-label={`${note.noteType} ${note.noteId} text`} defaultValue={note.text} disabled={!canEdit || Boolean(note.readOnlyReason)} onBlur={(event) => { if (event.target.value !== note.text) runAcademic([{ kind: "edit-note", noteType: note.noteType, noteId: note.noteId, expectedText: note.text, content: editNoteText(note.text, event.target.value, note.content) }]); }} />
                  {note.readOnlyReason ? <small>{note.readOnlyReason}</small> : null}
                  <button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.notes.move", `${note.noteType}:${note.noteId}`)}>Move here</button>
                  <button type="button" disabled={!canEdit} onClick={() => runDocumentCommand("document.notes.delete", `${note.noteType}:${note.noteId}`)}>Delete note</button>
                </div>)}
              </div> : null}
              {wordNotes.some((note) => !academicNotes.some((item) => item.noteType === note.type && item.noteId === note.id)) ? (
                <div className="spectra-document-word-notes">
                  <strong>Word notes</strong>
                  {wordNotes.filter((note) => !academicNotes.some((item) => item.noteType === note.type && item.noteId === note.id)).map((note) => (
                    <div key={`word-note-${note.type}-${note.id}`}>
                      <strong>
                        {note.type === "endnote" ? "Endnote" : "Footnote"}{" "}
                        {note.id}
                      </strong>
                      <small>{note.text || "(empty note)"}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </aside>
          ) : null}
          {/* The document is a page on the desk (EDITORS.md, "Document"):
              the running head and foot are printed on the paper, and the one
              number a writer checks constantly sits under it. */}
          <main ref={deskRef} className="document-desk">
            <div
              className="document-page"
              style={
                pageLayout === "spread"
                  ? spreadStyle(spread)
                  : pageLayout === "page"
                    ? ({ zoom: sheetScale, "--doc-pages": pageCount?.total ?? 1 } as CSSProperties)
                    : undefined
              }
            >
              {pageLayout === "spread" ? (
                <DocumentSpreadSheets
                  pages={spread.pages}
                  header={pageSetup.header}
                  footer={pageSetup.footer}
                />
              ) : null}
              {pageLayout === "page" && pageSetup.header ? (
                <p className="spectra-document-page-chrome" data-slot="header">
                  {pageSetup.header}
                </p>
              ) : null}
              <EditorContent
                editor={editor}
                className="tiptap-root spectra-document-canvas [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none"
              />
              {pageLayout === "page" && pageSetup.footer ? (
                <p className="spectra-document-page-chrome" data-slot="footer">
                  {pageSetup.footer}
                </p>
              ) : null}
            </div>
          </main>
        </div>
      </div>
      {!focusMode ? (
        <DocumentStatusRail
          canvas={pageLayout}
          setCanvas={setPageLayout}
          spreadReason={mode === "split" ? "Open the document full to lay its pages side by side" : undefined}
          pages={pageLayout === "page" ? pageCount : pageLayout === "spread" ? { total: spread.pages } : null}
          words={wordCount}
          characters={characterCount}
          zoom={zoom}
          shownZoom={sheetScale}
          setZoom={setZoom}
        />
      ) : null}
    </div>
  );
}
