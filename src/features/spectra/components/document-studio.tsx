"use client";

import { uniqueToken } from "@/lib/unique-token";
import type { JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { isLocalCollaborativeDocumentChange } from "../editor/collaboration-change";
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
import StarterKit from "@tiptap/starter-kit";
import {
  AlertCircle,
  ChevronDown,
  FileText,
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
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { SpectraTiptapAutocomplete } from "../compute/autocomplete";
import {
  commandContext,
  commandForBinding,
  executeCommand,
  type CommandBinding,
  type CommandParam,
} from "../commands";
import {
  DOCUMENT_STYLE_OPTIONS,
  documentCommandBindings,
  type DocumentCommandHandlers,
} from "../commands/office/document-commands";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  uploadArtifactImportOriginal,
} from "../data/api";
import {
  AiRegionDecoration,
  aiRegionDecorationKey,
  type AiRegionDecorationTarget,
} from "../editor/ai-region-decoration";
import { Callout } from "../editor/callout-node";
import { DocumentImage } from "../editor/document-image";
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
import {
  PageBreak,
  ParagraphFrame,
  SectionBreak,
} from "../editor/document-structure";
import { DragHandle } from "../editor/drag-handle";
import { Equation, InlineEquation } from "../editor/equation-node";
import {
  SpectraCitationNode,
  SpectraReferenceNode,
} from "../editor/reference-citation-nodes";
import {
  SlashCommand,
  documentSlashItems,
  filterSlashCommands,
  type SlashCommandDispatcher,
} from "../editor/slash-command-extension";
import { createSlashCommandRenderer } from "../editor/slash-command-renderer";
import { StableBlockId } from "../editor/stable-block-id";
import { spectraBus } from "../events";
import { parseSpectraWorkUrl } from "../references";
import { useSpectraPreferences } from "../settings/preference-store";
import type { SourceRecord } from "../sources/records/source-record";
import { createDocumentRelativeSelection } from "../work/models/yjs";
import { availableWorkModes } from "../work/registry";
import {
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  blocksFromJson,
  documentContentFromJson,
  documentJsonFromContent,
  record,
} from "./artifact-studio";
import {
  artifactBlobSha256,
  downloadDocumentText,
  escapeDocumentHtml,
  markdownToDocumentHtml,
  sanitizeDocumentHtml,
} from "./artifact-studio-file-utils";
import {
  ArtifactWorkbar,
  workbarMenuItemClass,
} from "./artifact-workbar";
import { WorkbarCommandControl, isRenderedControl } from "./workbar-controls";
import { useStudioContract } from "./artifact-studio-shell";

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
  if (unit === "rem" || unit === "em") return Math.round(size * 16 * 0.75 * 10) / 10;
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
      (marks.find((mark) => mark.type === type)?.attrs ?? {}) as Record<string, unknown>;
    const style = attributesOf("textStyle");
    return {
      bold: marks.some((mark) => mark.type === "bold"),
      italic: marks.some((mark) => mark.type === "italic"),
      underline: marks.some((mark) => mark.type === "underline"),
      strike: marks.some((mark) => mark.type === "strike"),
      fontFamily: typeof style.fontFamily === "string" ? style.fontFamily : null,
      fontSizePoints: pointsFromCssSize(style.fontSize),
      color: wordHex(style.color),
      shading: wordHex(attributesOf("highlight").color),
    };
  };
  const first = read(texts[0]!);
  const agreed = <K extends keyof typeof first>(key: K) =>
    texts.every((text) => read(text)[key] === first[key]) ? first[key] : undefined;
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
    attrs.textAlign === "center" || attrs.textAlign === "right" || attrs.textAlign === "justify"
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
export function withDocumentFormatting(content: Record<string, unknown>, json: JSONContent) {
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
      const patch = typeof entry.id === "string" ? formatting.get(entry.id) : undefined;
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
            aria-pressed={binding.active === undefined ? undefined : binding.active}
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
}) {
  return (
    <div className="spectra-document-inline-panel" role="group" aria-label={label}>
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
function withEditorFormatting(json: JSONContent, content: Record<string, unknown>) {
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
      const blockId = typeof node.attrs?.blockId === "string" ? node.attrs.blockId : "";
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
        ...(typeof runFormat.color === "string" ? { color: `#${runFormat.color}` } : {}),
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
        ...(alignment === "center" || alignment === "right" || alignment === "justify"
          ? { textAlign: alignment }
          : {}),
        ...(Number.isFinite(spacing) && spacing > 0 && spacing !== 1
          ? { lineSpacing: spacing }
          : {}),
        ...(Number.isFinite(after) && after > 0 ? { spacingAfter: after } : {}),
        ...(Number.isFinite(indent) && indent !== 0 ? { indentLevel: indent } : {}),
        ...(typeof paragraphFormat.border === "string" && paragraphFormat.border !== "none"
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
          : { ...child, ...(child.content ? { content: child.content.map(applyMarks) } : {}) };
      return {
        ...node,
        attrs,
        ...(marks.length && node.content ? { content: node.content.map(applyMarks) } : {}),
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
  aiChangedPaths = [],
  readOnly = false,
  nativeReadOnlyRegionIds = [],
  collaborationDocument,
  onLocalCollaborativeChange,
  header,
  mode = "tab",
}: {
  artifactId: string;
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  nativeReadOnlyRegionIds?: string[];
  collaborationDocument?: Y.Doc;
  onLocalCollaborativeChange?: () => void;
  header: ReactNode;
  mode?: "split" | "tab";
}) {
  const studioContract = useStudioContract();
  const strictNative = studioContract.compatibilityProfile === "strict-native";
  const nativeReadOnlyKey = nativeReadOnlyRegionIds.join("|");
  const { preferences } = useSpectraPreferences();
  const [initialContent] = useState(() =>
    withEditorFormatting(documentJsonFromContent(content, title), record(content)),
  );
  const [, refreshToolbar] = useState(0);
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
  const [docMode, setDocMode] = useState<DocumentMode>(
    readOnly ? "read" : "write",
  );
  const focusMode = docMode === "focus";
  const [pageLayout, setPageLayout] = useState<"page" | "continuous">(
    "continuous",
  );
  const [importReport, setImportReport] = useState<string>();
  const [importError, setImportError] = useState<string>();
  const nativeNoticeKey = `spectra:native-features-notice:${artifactId}`;
  const [nativeNoticeDismissed, setNativeNoticeDismissed] = useState(() =>
    typeof window !== "undefined" &&
    window.localStorage.getItem(nativeNoticeKey) === "dismissed",
  );
  const nativePlaceholders = useMemo(() => {
    const binding = record(record(content).nativeBinding);
    return Array.isArray(binding.nativePlaceholders)
      ? binding.nativePlaceholders.flatMap((value) => {
          const placeholder = record(value);
          return typeof placeholder.label === "string" &&
            typeof placeholder.detail === "string"
            ? [{
                id:
                  typeof placeholder.id === "string"
                    ? placeholder.id
                    : placeholder.label,
                label: placeholder.label,
                detail: placeholder.detail,
              }]
            : [];
        })
      : [];
  }, [content]);
  const [pendingTemplate, setPendingTemplate] = useState<
    "notes" | "essay" | "lab" | null
  >(null);
  const importRef = useRef<HTMLInputElement>(null);
  const editorReadyForUserChanges = useRef(false);
  const editorJsonKeyRef = useRef(JSON.stringify(initialContent));
  /** Filled once the command set exists; the slash menu reads it on each open. */
  const slashDispatchRef = useRef<SlashCommandDispatcher>({
    run: () => undefined,
    availability: () => ({ enabled: false }),
  });
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [spellcheckOn, setSpellcheckOn] = useState(true);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
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
      orientation: stored.orientation === "landscape" ? "landscape" as const : "portrait" as const,
      margins: typeof stored.margins === "string" ? stored.margins : "normal",
      columns: Number.isFinite(columns) && columns > 0 ? Math.min(3, columns) : 1,
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
      event.preventDefault();
      event.stopPropagation();
      setDocMode("write");
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusMode]);

  useEffect(() => {
    // Losing edit access mid-session drops the surface to Read rather than
    // leaving a writing UI that no longer writes.
    if (readOnly)
      setDocMode((current) => (current === "review" ? current : "read"));
  }, [readOnly]);
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
        Table.configure({ resizable: true, lastColumnResizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({ nested: true }),
        DocumentImage.configure({ allowBase64: true, inline: false }),
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
        DragHandle,
        StableBlockId.configure({
          nativeReadOnlyBlockIds: nativeReadOnlyRegionIds,
        }),
        AiRegionDecoration,
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
              filterSlashCommands(documentSlashItems(slashDispatchRef.current), query),
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
            "min-h-[620px] px-2 pb-24 pt-2 outline-none text-[var(--text-primary)]",
        },
        handlePaste: (view, event) => {
          if (strictNative) return false;
          const target = parseSpectraWorkUrl(
            event.clipboardData?.getData("text/plain") ?? "",
          );
          const nodeType = view.state.schema.nodes.spectraReference;
          if (!target || !nodeType) return false;
          const node = nodeType.create({
            id: uniqueToken(),
            workId: target.workId,
            anchor: target.fragment
              ? { kind: "fragment", path: [target.fragment], schemaVersion: 1 }
              : null,
            state: "collapsed",
            versionPolicy: "live",
            label: "Referenced work",
          });
          view.dispatch(
            view.state.tr.replaceSelectionWith(node).scrollIntoView(),
          );
          return true;
        },
      },
      onUpdate: ({ editor, transaction }) => {
        const nextJson = editor.getJSON();
        editorJsonKeyRef.current = JSON.stringify(nextJson);
        refreshToolbar((value) => value + 1);
        // Extension normalization can emit an update during the editor's mount
        // frame even when the user changed nothing. Treat that frame as editor
        // hydration; genuine input begins immediately afterward.
        if (!editorReadyForUserChanges.current || readOnly)
          return;
        // Native collaboration already committed this transaction directly to
        // the bound XmlFragment. Mirroring it through React/onChange would turn
        // each keystroke back into a full projected document replacement.
        if (collaborationDocument) {
          if (isLocalCollaborativeDocumentChange(transaction))
            onLocalCollaborativeChange?.();
          return;
        }
        onChange(withDocumentFormatting(documentContentFromJson(nextJson, content), nextJson));
      },
      onSelectionUpdate: ({ editor }) => {
        refreshToolbar((value) => value + 1);
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
      nativeReadOnlyKey,
      onLocalCollaborativeChange,
    ],
  );

  useEffect(
    () =>
      spectraBus.handle("reference.insert", ({ hostWorkId, target }) => {
        if (hostWorkId !== artifactId || !editor || readOnly || strictNative)
          return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: "spectraReference",
            attrs: {
              id: uniqueToken(),
              workId: target.workId,
              anchor: {
                workId: target.workId,
                workType: target.workType,
                kind: target.kind,
                path: [...target.path],
                stableIds: target.stableIds,
                fallbackExcerpt: target.fallbackExcerpt,
                schemaVersion: target.schemaVersion,
              },
              state: "collapsed",
              versionPolicy: "live",
              label: target.fallbackExcerpt ?? "Referenced work",
            },
          })
          .run();
      }),
    [artifactId, editor, readOnly, strictNative],
  );

  useEffect(() => {
    // Read is a mode, not a permission: it puts the document down without
    // pretending the reader lost access to it.
    editor?.setEditable(!readOnly && docMode !== "read");
  }, [docMode, editor, readOnly]);

  useEffect(() => {
    if (!editor || !editor.isInitialized) return;
    const markUserInput = () => {
      editorReadyForUserChanges.current = true;
    };
    const element = editor.view.dom;
    element.addEventListener("pointerdown", markUserInput, { once: true });
    element.addEventListener("keydown", markUserInput, { once: true });
    element.addEventListener("beforeinput", markUserInput, { once: true });
    element.addEventListener("paste", markUserInput, { once: true });
    return () => {
      element.removeEventListener("pointerdown", markUserInput);
      element.removeEventListener("keydown", markUserInput);
      element.removeEventListener("beforeinput", markUserInput);
      element.removeEventListener("paste", markUserInput);
    };
  }, [editor]);

  const incomingEditorJson = useMemo(
    () => withEditorFormatting(documentJsonFromContent(content, title), record(content)),
    [content, title],
  );
  useEffect(() => {
    if (!editor) return;
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
    if (editor.isDestroyed || !editor.isInitialized) return;
    // Native Y.XmlFragment collaboration is already bound directly to the
    // editor. Reapplying a projected JSON snapshot here would reset selection,
    // corrupt IME composition, and turn a remote delta into a full replace.
    if (contentChanged && !collaborationDocument)
      editor.commands.setContent(incomingEditorJson, { emitUpdate: false });
    editor.view.dispatch(
      editor.state.tr.setMeta(aiRegionDecorationKey, target),
    );
  }, [aiChangedPaths, collaborationDocument, editor, incomingEditorJson]);

  const editorText = editor?.getText({ blockSeparator: "\n" }) ?? "";
  const wordCount = editorText.trim()
    ? editorText.trim().split(/\s+/).length
    : 0;
  // Outline, find and the source navigator all read the live ProseMirror
  // document rather than a JSON copy, so their positions are the editor's own
  // and stay correct through collaborative edits (§11A).
  const outlineEntries = (() => {
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
    if (!editor || !query) return matches;
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
  function replaceAllMatches() {
    if (!editor || !findDraft || readOnly || !findMatches.length) return;
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
  }

  /**
   * Replaces the References section with one built from the citations in the
   * text right now. It is regenerated rather than hand-edited, so it can never
   * claim a source the document does not actually cite (§11A).
   */
  function insertBibliography() {
    if (!editor || readOnly) return;
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
      const { Document, HeadingLevel, Packer, Paragraph, TextRun } =
        await import("docx");
      const blocks = blocksFromJson(editor.getJSON());
      const document = new Document({
        sections: [
          {
            children: blocks.map((block) =>
              block.type === "heading"
                ? new Paragraph({
                    text: block.text,
                    heading:
                      Number(record(block.attrs).level) === 1
                        ? HeadingLevel.HEADING_1
                        : Number(record(block.attrs).level) === 3
                          ? HeadingLevel.HEADING_3
                          : HeadingLevel.HEADING_2,
                  })
                : new Paragraph({
                    children: [new TextRun(block.text)],
                    ...(block.type === "quote"
                      ? { style: "IntenseQuote" }
                      : {}),
                  }),
            ),
          },
        ],
      });
      const blob = await Packer.toBlob(document);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeTitle}.docx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
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
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({
          arrayBuffer: await file.arrayBuffer(),
        });
        editor.commands.setContent(
          sanitizeDocumentHtml(result.value || "<p></p>"),
        );
        setImportReport(
          result.messages.length
            ? `Imported a separate editable copy with ${result.messages.length} fidelity note${result.messages.length === 1 ? "" : "s"}. It is not linked to the source file; the retained original remains available in import history.`
            : "Imported a separate editable copy. It is not linked to the source file; the retained original remains available in import history.",
        );
        fidelityReport.push({
          scope: "editable document structure",
          level: result.messages.length ? "adapted" : "exact",
          message: result.messages.length
            ? `${result.messages.length} converter note${result.messages.length === 1 ? "" : "s"} recorded; text, headings, lists, tables, and supported media were converted where available.`
            : "Supported Word structure converted to editable native content.",
        });
        unsupportedFeatures.push(
          "Word macros",
          "tracked-change authorship not represented by the converter",
          "unsupported floating layout",
        );
      } else if (name.endsWith(".odt")) {
        const { strFromU8, unzipSync } = await import("fflate");
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
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
        const document = await pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        }).promise;
        const pages: string[] = [];
        for (
          let pageNumber = 1;
          pageNumber <= document.numPages;
          pageNumber += 1
        ) {
          const page = await document.getPage(pageNumber);
          const textContent = await page.getTextContent();
          pages.push(
            textContent.items
              .flatMap((item) => ("str" in item ? [item.str] : []))
              .join(" "),
          );
        }
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

  /** Writes one key of the document's own content record beside the blocks. */
  const patchContent = useCallback(
    (patch: Record<string, unknown>) => {
      onChange({ ...record(content), ...patch });
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
      return { pos: selection.from, attrs: (selected as unknown as { attrs: Record<string, unknown> }).attrs };
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (names.includes(node.type.name))
        return { pos: $from.before(depth), attrs: node.attrs as Record<string, unknown> };
    }
    const after = $from.nodeAfter;
    if (after && names.includes(after.type.name))
      return { pos: $from.pos, attrs: after.attrs as Record<string, unknown> };
    return null;
  };

  const textStyleAttrs = editor?.getAttributes("textStyle") ?? {};
  const activeImage = activeNode(["image"]);
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
  const trackedPlaceholders = nativePlaceholders.filter((placeholder) =>
    /revision|tracked change/i.test(`${placeholder.label} ${placeholder.detail}`),
  );

  function applyStyle(style: string) {
    withEdit(() => {
      const chain = editor!.chain().focus();
      if (style === "h1" || style === "h2" || style === "h3")
        chain.setNode("heading", { level: Number(style.slice(1)) }).run();
      else if (style === "quote")
        chain.setParagraph().toggleBlockquote().run();
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
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Contents" }] },
          ...(items.length
            ? items
            : [{ type: "paragraph", content: [{ type: "text", text: "Add headings and insert this again." }] }]),
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
            marks: [{ type: "link", attrs: { href: `#${target.blockId ?? target.position}` } }],
          },
        ])
        .run();
    });
  }

  function insertCitation() {
    const source = sourceNavigator.uncited[0] ?? sourceNavigator.entries[0]?.source;
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
            ...(blockAttrs.lineSpacing ? { lineSpacing: blockAttrs.lineSpacing } : {}),
            ...(blockAttrs.spacingAfter ? { spacingAfter: blockAttrs.spacingAfter } : {}),
            ...(blockAttrs.indentLevel ? { indentLevel: blockAttrs.indentLevel } : {}),
            ...(blockAttrs.frameBorder ? { frameBorder: blockAttrs.frameBorder } : {}),
            ...(blockAttrs.frameShading ? { frameShading: blockAttrs.frameShading } : {}),
          },
        },
      ],
    });
    withEdit(() => editor!.chain().focus().setParagraphStyle(id).run());
  }

  function applyNamedStyle(styleId: string) {
    const style = namedStyles.find((entry) => entry.id === styleId);
    withEdit(() => {
      const chain = editor!.chain().focus().setParagraphStyle(styleId || null);
      const attrs = style?.attrs ?? {};
      if (typeof attrs.lineSpacing === "number") chain.setParagraphLineSpacing(attrs.lineSpacing);
      if (typeof attrs.spacingAfter === "number") chain.setParagraphSpacing(attrs.spacingAfter);
      if (typeof attrs.frameBorder === "string") chain.setParagraphBorder(attrs.frameBorder);
      if (typeof attrs.frameShading === "string") chain.setParagraphShading(attrs.frameShading);
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
      style: { value: activeStyle, set: applyStyle, options: DOCUMENT_STYLE_OPTIONS },
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
        ...(typeof textStyleAttrs.fontSize === "string" &&
        Number.parseFloat(textStyleAttrs.fontSize)
          ? { value: Number.parseFloat(textStyleAttrs.fontSize) }
          : {}),
        set: (size) =>
          withEdit(() => editor!.chain().focus().setFontSize(`${size}px`).run()),
      },
      bold: {
        active: editor?.isActive("bold"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleBold().run()),
      },
      italic: {
        active: editor?.isActive("italic"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleItalic().run()),
      },
      underline: {
        active: editor?.isActive("underline"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleUnderline().run()),
      },
      strike: {
        active: editor?.isActive("strike"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleStrike().run()),
      },
      color: {
        ...(typeof textStyleAttrs.color === "string" ? { value: textStyleAttrs.color } : {}),
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
        set: (value) => withEdit(() => editor!.chain().focus().setTextAlign(value).run()),
      },
      lineHeight: {
        ...(typeof blockAttrs.lineSpacing === "number"
          ? { value: blockAttrs.lineSpacing }
          : { value: 1 }),
        set: (value) =>
          withEdit(() => editor!.chain().focus().setParagraphLineSpacing(value).run()),
      },
      bulletList: {
        active: editor?.isActive("bulletList"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleBulletList().run()),
      },
      numberedList: {
        active: editor?.isActive("orderedList"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleOrderedList().run()),
      },
      indent: {
        increase: () => shiftIndent(1),
        decrease: () => shiftIndent(-1),
        canDecrease: inList
          ? Boolean(editor?.can().liftListItem("listItem"))
          : Number(blockAttrs.indentLevel) > -8,
      },
      clear: () =>
        withEdit(() => editor!.chain().focus().unsetAllMarks().clearNodes().run()),
      disabled: !canEdit,
      generalPins: ["fontFamily", "fontSize", "bold", "italic"],
    },
    paragraph: {
      ...(typeof blockAttrs.spacingAfter === "number"
        ? { spacingAfter: blockAttrs.spacingAfter }
        : {}),
      setSpacingAfter: (points) =>
        withEdit(() => editor!.chain().focus().setParagraphSpacing(points).run()),
      border: typeof blockAttrs.frameBorder === "string" ? blockAttrs.frameBorder : "none",
      setBorder: (kind) =>
        withEdit(() => editor!.chain().focus().setParagraphBorder(kind).run()),
      shading: typeof blockAttrs.frameShading === "string" ? blockAttrs.frameShading : null,
      setShading: (color) =>
        withEdit(() => editor!.chain().focus().setParagraphShading(color).run()),
      quote: {
        active: editor?.isActive("blockquote"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleBlockquote().run()),
      },
      codeBlock: {
        active: editor?.isActive("codeBlock"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleCodeBlock().run()),
      },
      inlineCode: {
        active: editor?.isActive("code"),
        toggle: () => withEdit(() => editor!.chain().focus().toggleCode().run()),
      },
      inList,
      ...(Number(blockAttrs.indentLevel) ? { listLevel: Number(blockAttrs.indentLevel) } : {}),
      demote: () => shiftIndent(1),
      promote: () => shiftIndent(-1),
      canPromote: inList
        ? Boolean(editor?.can().liftListItem("listItem"))
        : Number(blockAttrs.indentLevel) > 0,
      moveUp: () => withEdit(() => editor!.chain().focus().moveBlock(-1).run()),
      moveDown: () => withEdit(() => editor!.chain().focus().moveBlock(1).run()),
    },
    namedStyles: {
      options: namedStyles.map((style) => ({ value: style.id, label: style.label })),
      apply: applyNamedStyle,
      create: () => setStyleDraft(""),
      ...(namedStyles.length
        ? {}
        : { createHint: "Captures this paragraph's spacing, indent and frame as a style you can reuse" }),
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
          editor!.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
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
      callout: (kind) => withEdit(() => editor!.chain().focus().setCallout({ type: kind }).run()),
      divider: () => withEdit(() => editor!.chain().focus().setHorizontalRule().run()),
      taskList: () => withEdit(() => editor!.chain().focus().toggleTaskList().run()),
      taskListActive: editor?.isActive("taskList"),
      reference: () => spectraBus.command("reference.beginPicking", { hostWorkId: artifactId }),
      citation: insertCitation,
      ...(sourcesHaveWork
        ? {}
        : { citationHint: "Cite a source once this document carries one; the Sources rail opens instead" }),
      footnote: () => withEdit(() => editor!.chain().focus().insertFootnote().run()),
      endnote: () => withEdit(() => editor!.chain().focus().insertEndnote().run()),
      pageBreak: () => withEdit(() => editor!.chain().focus().insertPageBreak().run()),
      sectionBreak: () => withEdit(() => editor!.chain().focus().insertSectionBreak().run()),
      caption: () =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .insertContent({
              type: "paragraph",
              attrs: { blockStyle: "caption" },
              content: [{ type: "text", text: "Figure — describe what this shows" }],
            })
            .run(),
        ),
      tableOfContents: insertTableOfContents,
    },
    table: {
      active: inTable,
      addRowBefore: () => withEdit(() => editor!.chain().focus().addRowBefore().run()),
      addRowAfter: () => withEdit(() => editor!.chain().focus().addRowAfter().run()),
      deleteRow: () => withEdit(() => editor!.chain().focus().deleteRow().run()),
      addColumnBefore: () => withEdit(() => editor!.chain().focus().addColumnBefore().run()),
      addColumnAfter: () => withEdit(() => editor!.chain().focus().addColumnAfter().run()),
      deleteColumn: () => withEdit(() => editor!.chain().focus().deleteColumn().run()),
      mergeCells: () => withEdit(() => editor!.chain().focus().mergeCells().run()),
      splitCell: () => withEdit(() => editor!.chain().focus().splitCell().run()),
      canMerge: Boolean(editor?.can().mergeCells()),
      canSplit: Boolean(editor?.can().splitCell()),
      toggleHeaderRow: () => withEdit(() => editor!.chain().focus().toggleHeaderRow().run()),
      headerRowActive: Boolean(editor?.isActive("tableHeader")),
      deleteTable: () => withEdit(() => editor!.chain().focus().deleteTable().run()),
      ...(strictNative
        ? {
            nativeStructureReason:
              "Spectra edits the text inside a linked Word table, not its shape. Adding or removing rows would rewrite the table definition, so it is unavailable here.",
          }
        : {}),
    },
    image: {
      active: Boolean(activeImage),
      ...(typeof activeImage?.attrs.wrap === "string" ? { wrap: activeImage.attrs.wrap } : {}),
      setWrap: (wrap) =>
        withEdit(() => editor!.chain().focus().updateAttributes("image", { wrap }).run()),
      ...(Number(activeImage?.attrs.widthPercent)
        ? { width: Number(activeImage!.attrs.widthPercent) }
        : {}),
      setWidth: (percent) =>
        withEdit(() =>
          editor!.chain().focus().updateAttributes("image", { widthPercent: percent }).run(),
        ),
      ...(typeof activeImage?.attrs.alt === "string" ? { alt: activeImage.attrs.alt } : {}),
      editAlt: () =>
        setAltDraft(typeof activeImage?.attrs.alt === "string" ? activeImage.attrs.alt : ""),
      remove: () => withEdit(() => editor!.chain().focus().deleteSelection().run()),
    },
    equation: {
      active: Boolean(activeEquation),
      ...(activeEquation
        ? { display: activeEquation.attrs.display === "inline" ? ("inline" as const) : ("block" as const) }
        : {}),
      setDisplay: (display) =>
        withEdit(() =>
          editor!
            .chain()
            .focus()
            .updateAttributes("equation", { display: display === "inline" ? "inline" : "block" })
            .run(),
        ),
      ...(typeof activeEquation?.attrs.alignment === "string"
        ? { alignment: activeEquation.attrs.alignment }
        : {}),
      setAlignment: (alignment) =>
        withEdit(() => editor!.chain().focus().updateAttributes("equation", { alignment }).run()),
      // Selecting the node is what opens its LaTeX field: the equation is edited
      // where it sits, not in a dialogue at the edge of the screen.
      edit: () => {
        if (!editor || !activeEquation) return;
        editor.chain().focus().setNodeSelection(activeEquation.pos).run();
      },
      remove: () => withEdit(() => editor!.chain().focus().deleteSelection().run()),
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
      setMargins: (margins) => patchContent({ pageSetup: { ...pageSetup, margins } }),
      columns: pageSetup.columns,
      setColumns: (columns) =>
        patchContent({ pageSetup: { ...pageSetup, columns: Math.max(1, Math.min(3, columns)) } }),
      editHeader: () => setChromeDraft({ slot: "header", text: pageSetup.header }),
      headerText: pageSetup.header,
      editFooter: () => setChromeDraft({ slot: "footer", text: pageSetup.footer }),
      footerText: pageSetup.footer,
      canvas: pageLayout,
      setCanvas: (canvas) => setPageLayout(canvas === "page" ? "page" : "continuous"),
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
      ...(canPreviewAsReader ? { previewAsReader: () => setDocMode("read") } : {}),
      templates: [
        { id: "notes", label: "Study notes" },
        { id: "essay", label: "Essay" },
        { id: "lab", label: "Lab report" },
      ],
      applyTemplate: (id) =>
        setPendingTemplate(id === "essay" ? "essay" : id === "lab" ? "lab" : "notes"),
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
          bibliographyStyle: style === "author_date" ? "author_date" : "numeric",
        }),
      addSource: () => setSourcesOpen(true),
      addSourceReason:
        "A source has to be verified before this document can cite it, so sources arrive with research rather than being typed in here. The rail shows what this copy carries.",
      crossReference: insertCrossReference,
    },
    review: {
      showTrackedChanges: () => setRevisionsOpen((open) => !open),
      trackedChangesOpen: revisionsOpen,
      trackedChangeCount: trackedPlaceholders.length,
      revisionsPreservedReason:
        "Word revision marks are preserved exactly as the file has them. Accepting or rejecting them would rewrite parts Spectra does not model, so it belongs in Word.",
      acceptRevisions: () => undefined,
      rejectRevisions: () => undefined,
      updateFields: () => undefined,
      fieldsPreservedReason:
        "Field results stay as Word calculated them. Spectra never recalculates a field, so a stale page number is Word's to refresh.",
    },
    exportCopies: {
      formats: [
        { format: "docx", label: "Word" },
        { format: "pdf", label: "PDF", lossy: true },
        { format: "md", label: "Markdown", lossy: true },
        { format: "html", label: "HTML", lossy: true },
        { format: "txt", label: "text", lossy: true },
      ],
      run: async (format) => {
        setExportBusy(format);
        try {
          await exportDocument(format as "docx" | "pdf" | "html" | "md" | "txt");
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
  const runDocumentCommand = (id: string, value?: CommandParam) => {
    const entry = documentCommandMap.get(id);
    if (!entry) return;
    executeCommand(entry.command, documentCommandCtx, value);
  };
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
        ? ["document.image.wrap", "document.image.width", "document.image.alt"]
        : []),
      ...(activeEquation
        ? ["document.equation.display", "document.equation.align", "document.equation.edit"]
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
      className="spectra-document-studio bg-[var(--bg-primary)]"
      data-focus={focusMode || undefined}
      data-doc-mode={docMode}
      data-compact={mode === "split" || undefined}
      data-layout={pageLayout}
      data-page-size={pageSetup.size}
      data-orientation={pageSetup.orientation}
      data-margins={pageSetup.margins}
      data-columns={pageSetup.columns > 1 ? pageSetup.columns : undefined}
    >
      {!focusMode ? header : null}
      {/* One bar. Off-default activities (Page canvas, Focus) stay in the bar
          with the active treatment so the writer can see they left continuous. */}
      <ArtifactWorkbar
        label="Document tools"
        selectionContext={selectionKind}
        modes={[]}
        context={docMode === "read" ? "Reading" : undefined}
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
        overflow={
          <>
            <DropdownMenuLabel>Document</DropdownMenuLabel>
            <div className={workbarMenuItemClass()} role="note">
              <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
                <FileText className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">
                {wordCount.toLocaleString()}{" "}
                {wordCount === 1 ? "word" : "words"}
              </span>
            </div>
          </>
        }
      />
      {canEdit && editor ? (
        <BubbleMenu
          editor={editor}
          appendTo={() => document.body}
          options={{ placement: "top", offset: 10, flip: true, shift: true }}
          shouldShow={({ editor: current, state }) => {
            if (!current.isEditable || readOnly) return false;
            if (document.querySelector(".slash-command-portal")) return false;
            const selectedNode = (
              state.selection as { node?: { type: { name: string } } }
            ).node;
            // A selected atom gets its own contextual tab in the bar; only the
            // three that have something to offer here open the floating bar.
            if (
              selectedNode &&
              !["table", "tableRow", "image", "equation", "inlineEquation"].includes(
                selectedNode.type.name,
              )
            ) {
              return false;
            }
            if (current.isActive("table") || current.isActive("image")) return true;
            return !state.selection.empty;
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
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== "string") return;
            withEdit(() =>
              editor.chain().focus().setImage({ src: reader.result as string }).run(),
            );
          };
          reader.readAsDataURL(file);
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
                  onClick={replaceAllMatches}
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
                  ? editor!.chain().focus().extendMarkRange("link").setLink({ href }).run()
                  : editor!.chain().focus().extendMarkRange("link").unsetLink().run(),
              );
              setLinkDraft(null);
            }}
          />
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
                editor!.chain().focus().updateAttributes("image", { alt: altDraft }).run(),
              );
              setAltDraft(null);
            }}
          />
        ) : null}
        {chromeDraft ? (
          <DocumentInlinePanel
            label={chromeDraft.slot === "header" ? "Page header" : "Page footer"}
            detail="Shown on every page of the page canvas and in a printed copy."
            value={chromeDraft.text}
            placeholder={
              chromeDraft.slot === "header"
                ? "Title, author, or unit"
                : "Class, date, or page note"
            }
            confirmLabel="Save"
            onChange={(text) => setChromeDraft({ slot: chromeDraft.slot, text })}
            onCancel={() => setChromeDraft(null)}
            onConfirm={() => {
              patchContent({
                pageSetup: { ...pageSetup, [chromeDraft.slot]: chromeDraft.text },
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
                {importError ? "Import quarantined" : "Import complete"}
              </strong>
              <small>{importError || importReport}</small>
            </span>
            <button
              type="button"
              onClick={() => {
                setImportError(undefined);
                setImportReport(undefined);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {nativePlaceholders.length && !nativeNoticeDismissed ? (
          <div className="spectra-document-native-features" role="note">
            <FileText className="h-4 w-4 shrink-0" />
            <span>
              <strong>
                {nativePlaceholders.length === 1
                  ? nativePlaceholders[0]!.label
                  : `${nativePlaceholders.length} Word features preserved`}
              </strong>
              <small>
                {nativePlaceholders.length === 1
                  ? nativePlaceholders[0]!.detail
                  : "They remain intact in the Word file and are read-only here."}
              </small>
            </span>
            <em>Preserved</em>
            <button
              type="button"
              aria-label="Dismiss preserved features notice"
              title="Dismiss"
              onClick={() => {
                window.localStorage.setItem(nativeNoticeKey, "dismissed");
                setNativeNoticeDismissed(true);
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
                <button type="button" onClick={() => setOutlineOpen(false)}>
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
                <button type="button" onClick={() => setSourcesOpen(false)}>
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
            <aside className="spectra-document-revisions spectra-panel-enter">
              <header>
                <History className="h-3.5 w-3.5" />
                <strong>Tracked changes</strong>
                <button type="button" onClick={() => setRevisionsOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </header>
              {trackedPlaceholders.length ? (
                <>
                  {trackedPlaceholders.map((placeholder) => (
                    <div key={placeholder.id}>
                      <strong>{placeholder.label}</strong>
                      <small>{placeholder.detail}</small>
                    </div>
                  ))}
                  <p>
                    These marks stay exactly as Word wrote them. Accepting or
                    rejecting them would rewrite parts Spectra does not model, so
                    that belongs in Word.
                  </p>
                </>
              ) : (
                <p>
                  This document carries no Word revision marks. When a linked
                  file has them, they are listed here read-only.
                </p>
              )}
            </aside>
          ) : null}
          <main>
            {/* The hint row that used to sit here carried the word count and
                the slash-command tip, and CSS hid it outright — so the one
                number a writer checks constantly was in the DOM and invisible.
                The count now lives in the work bar's context slot, where every
                other studio puts its standing fact. */}
            {pageLayout === "page" && pageSetup.header ? (
              <p className="spectra-document-page-chrome" data-slot="header">
                {pageSetup.header}
              </p>
            ) : null}
            <EditorContent
              editor={editor}
              className="tiptap-root spectra-document-canvas mx-auto max-w-[920px] [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-default)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:font-display [&_.ProseMirror_h1]:text-[30px] [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:font-display [&_.ProseMirror_h2]:text-[23px] [&_.ProseMirror_h2]:leading-tight [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p]:my-4"
            />
            {pageLayout === "page" && pageSetup.footer ? (
              <p className="spectra-document-page-chrome" data-slot="footer">
                {pageSetup.footer}
              </p>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
