"use client";

import { uniqueToken } from "@/lib/unique-token";
import type { JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  Eye,
  FileDown,
  FileText,
  Focus,
  Highlighter,
  Import,
  LayoutTemplate,
  ListOrdered,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import { SpectraTiptapAutocomplete } from "../compute/autocomplete";
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
import { DragHandle } from "../editor/drag-handle";
import { Equation, InlineEquation } from "../editor/equation-node";
import {
  SpectraCitationNode,
  SpectraReferenceNode,
} from "../editor/reference-citation-nodes";
import { SlashCommand } from "../editor/slash-command-extension";
import { createSlashCommandRenderer } from "../editor/slash-command-renderer";
import { StableBlockId } from "../editor/stable-block-id";
import { spectraBus } from "../events";
import { parseSpectraWorkUrl } from "../references";
import { useSpectraPreferences } from "../settings/preference-store";
import type { SourceRecord } from "../sources/records/source-record";
import { createDocumentRelativeSelection } from "../work/models/yjs";
import { availableWorkModes } from "../work/registry";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  RichTextFormatBar,
  ToolbarButton,
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
  WorkbarSelect,
  workbarMenuItemClass,
} from "./artifact-workbar";

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

function DocumentOverflowItem({
  icon: Icon,
  label,
  onSelect,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      className={workbarMenuItemClass()}
      onSelect={onSelect}
    >
      <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </DropdownMenuItem>
  );
}

type DocumentMode = "write" | "read" | "review" | "focus";

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
  collaborationDocument,
  header,
  mode = "tab",
}: {
  artifactId: string;
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  collaborationDocument?: Y.Doc;
  header: ReactNode;
  mode?: "split" | "tab";
}) {
  const { preferences } = useSpectraPreferences();
  const [initialContent] = useState(() =>
    documentJsonFromContent(content, title),
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
  const [pendingTemplate, setPendingTemplate] = useState<
    "notes" | "essay" | "lab" | null
  >(null);
  const importRef = useRef<HTMLInputElement>(null);
  const editorReadyForUserChanges = useRef(false);
  const editorJsonKeyRef = useRef(JSON.stringify(initialContent));

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
        Image.configure({ allowBase64: true, inline: false }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Highlight.configure({ multicolor: true }),
        Callout,
        Equation,
        InlineEquation,
        SpectraReferenceNode,
        SpectraCitationNode,
        DragHandle,
        StableBlockId,
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
      onUpdate: ({ editor }) => {
        const nextJson = editor.getJSON();
        editorJsonKeyRef.current = JSON.stringify(nextJson);
        refreshToolbar((value) => value + 1);
        // Extension normalization can emit an update during the editor's mount
        // frame even when the user changed nothing. Treat that frame as editor
        // hydration; genuine input begins immediately afterward.
        if (
          !editorReadyForUserChanges.current ||
          readOnly ||
          collaborationDocument
        )
          return;
        // Native collaboration already committed this transaction directly to
        // the bound XmlFragment. Mirroring it through React/onChange would turn
        // each keystroke back into a full projected document replacement.
        onChange(documentContentFromJson(nextJson, content));
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
    [collaborationDocument],
  );

  useEffect(
    () =>
      spectraBus.handle("reference.insert", ({ hostWorkId, target }) => {
        if (hostWorkId !== artifactId || !editor || readOnly) return;
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
    [artifactId, editor, readOnly],
  );

  useEffect(() => {
    // Read is a mode, not a permission: it puts the document down without
    // pretending the reader lost access to it.
    editor?.setEditable(!readOnly && docMode !== "read");
  }, [docMode, editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
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
    () => documentJsonFromContent(content, title),
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
    if (editor.isDestroyed) return;
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
                      Number(block.attrs?.level) === 1
                        ? HeadingLevel.HEADING_1
                        : Number(block.attrs?.level) === 3
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
            ? `Imported as editable content with ${result.messages.length} fidelity note${result.messages.length === 1 ? "" : "s"}. The original should remain available in import history.`
            : "Imported as editable native content with no reported conversion warnings.",
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

  return (
    <div
      className="spectra-document-studio bg-[var(--bg-primary)]"
      data-focus={focusMode || undefined}
      data-doc-mode={docMode}
      data-compact={mode === "split" || undefined}
      data-layout={pageLayout}
    >
      {!focusMode ? header : null}
      {/* One bar. Off-default activities (Page canvas, Focus) stay in the bar
          with the active treatment so the writer can see they left continuous. */}
      <ArtifactWorkbar
        label="Document tools"
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
        actions={[
          {
            id: "find",
            label: "Find",
            icon: Search,
            priority: "essential",
            active: findOpen,
            onSelect: () => setFindOpen((open) => !open),
          },
          {
            id: "outline",
            label: "Outline",
            icon: FileText,
            priority: "essential",
            active: outlineOpen,
            onSelect: () => setOutlineOpen((open) => !open),
          },
          ...(pageLayout === "page"
            ? [
                {
                  id: "page-canvas",
                  label: "Page canvas",
                  icon: FileText,
                  priority: "essential" as const,
                  active: true,
                  onSelect: () => setPageLayout("continuous"),
                },
              ]
            : []),
          ...(focusMode
            ? [
                {
                  id: "focus",
                  label: "Focus",
                  icon: Focus,
                  priority: "essential" as const,
                  active: true,
                  onSelect: () => setDocMode("write"),
                },
              ]
            : []),
          ...(sourcesHaveWork
            ? [
                {
                  id: "sources",
                  label: "Sources",
                  icon: BookOpen,
                  priority: "secondary" as const,
                  active: sourcesOpen,
                  onSelect: () => setSourcesOpen((open) => !open),
                  ...(sourceNavigator.unresolved.length
                    ? {
                        hint: `${sourceNavigator.unresolved.length} to resolve`,
                      }
                    : {}),
                },
              ]
            : []),
        ]}
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
            <DropdownMenuSeparator />
            {!sourcesHaveWork ? (
              <>
                <DropdownMenuLabel>Cite</DropdownMenuLabel>
                <DocumentOverflowItem
                  icon={BookOpen}
                  label="Sources"
                  onSelect={() => setSourcesOpen((open) => !open)}
                />
                <DropdownMenuSeparator />
              </>
            ) : null}
            {!readOnly ? (
              <>
                <DropdownMenuLabel>View</DropdownMenuLabel>
                {canPreviewAsReader ? (
                  <DocumentOverflowItem
                    icon={Eye}
                    label="Preview as reader"
                    onSelect={() => setDocMode("read")}
                  />
                ) : null}
                <DocumentOverflowItem
                  icon={Focus}
                  label="Focus"
                  onSelect={() => {
                    setDocMode("focus");
                    setOutlineOpen(false);
                    setSourcesOpen(false);
                    setFindOpen(false);
                  }}
                />
                <DocumentOverflowItem
                  icon={FileText}
                  label={
                    pageLayout === "page"
                      ? "Continuous canvas"
                      : "Page canvas"
                  }
                  onSelect={() =>
                    setPageLayout(
                      pageLayout === "page" ? "continuous" : "page",
                    )
                  }
                />
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuLabel>File</DropdownMenuLabel>
            <DocumentOverflowItem
              icon={importing ? Loader2 : Import}
              label={importing ? "Importing…" : "Import"}
              disabled={importing || readOnly}
              onSelect={() => importRef.current?.click()}
            />
            {(
              [
                ["docx", "Export Word"],
                ["pdf", "Export PDF"],
                ["md", "Export Markdown"],
                ["html", "Export HTML"],
                ["txt", "Export text"],
              ] as const
            ).map(([format, label]) => (
              <DocumentOverflowItem
                key={format}
                icon={FileDown}
                label={label}
                onSelect={() => void exportDocument(format)}
              />
            ))}
            <DocumentOverflowItem
              icon={Printer}
              label="Print"
              onSelect={() => window.print()}
            />
            {!readOnly ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Replace with a template</DropdownMenuLabel>
                <DocumentOverflowItem
                  icon={LayoutTemplate}
                  label="Study notes"
                  onSelect={() => setPendingTemplate("notes")}
                />
                <DocumentOverflowItem
                  icon={LayoutTemplate}
                  label="Essay"
                  onSelect={() => setPendingTemplate("essay")}
                />
                <DocumentOverflowItem
                  icon={LayoutTemplate}
                  label="Lab report"
                  onSelect={() => setPendingTemplate("lab")}
                />
              </>
            ) : null}
          </>
        }
      >
        {docMode === "write" && editor ? (
          <RichTextFormatBar
            editor={editor}
            disabled={readOnly}
            label="Document formatting"
            withTextStyle
            inserts={false}
            trailing={
              <>
                <WorkbarSelect
                  ariaLabel="Alignment"
                  className="w-[5.75rem] shrink-0"
                  value={
                    editor.isActive({ textAlign: "center" })
                      ? "center"
                      : editor.isActive({ textAlign: "right" })
                        ? "right"
                        : "left"
                  }
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(alignment) =>
                    editor.chain().focus().setTextAlign(alignment).run()
                  }
                />
                <ToolbarButton
                  label={
                    editor.isActive("highlight")
                      ? "Remove highlight"
                      : "Highlight"
                  }
                  icon={Highlighter}
                  active={editor.isActive("highlight")}
                  onClick={() =>
                    editor.isActive("highlight")
                      ? editor.chain().focus().unsetHighlight().run()
                      : editor
                          .chain()
                          .focus()
                          .toggleHighlight({ color: "#dff3ed" })
                          .run()
                  }
                />
              </>
            }
          />
        ) : null}
      </ArtifactWorkbar>
      {docMode === "write" && editor ? (
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
            if (
              selectedNode &&
              selectedNode.type.name !== "table" &&
              selectedNode.type.name !== "tableRow"
            ) {
              return false;
            }
            if (current.isActive("table")) return true;
            return !state.selection.empty;
          }}
          className="spectra-document-selection-toolbar"
        >
          <RichTextFormatBar
            editor={editor}
            disabled={readOnly}
            label="Document formatting"
            withTextStyle
            inserts={false}
            trailing={
              <>
                <WorkbarSelect
                  ariaLabel="Alignment"
                  className="w-[5.75rem] shrink-0"
                  value={
                    editor.isActive({ textAlign: "center" })
                      ? "center"
                      : editor.isActive({ textAlign: "right" })
                        ? "right"
                        : "left"
                  }
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(alignment) =>
                    editor.chain().focus().setTextAlign(alignment).run()
                  }
                />
                <ToolbarButton
                  label={
                    editor.isActive("highlight")
                      ? "Remove highlight"
                      : "Highlight"
                  }
                  icon={Highlighter}
                  active={editor.isActive("highlight")}
                  onClick={() =>
                    editor.isActive("highlight")
                      ? editor.chain().focus().unsetHighlight().run()
                      : editor
                          .chain()
                          .focus()
                          .toggleHighlight({ color: "#dff3ed" })
                          .run()
                  }
                />
                {editor.isActive("table") ? (
                  <>
                    <ToolbarButton
                      label="Add table row"
                      icon={Plus}
                      onClick={() =>
                        editor.chain().focus().addRowAfter().run()
                      }
                    />
                    <ToolbarButton
                      label="Add table column"
                      icon={Plus}
                      onClick={() =>
                        editor.chain().focus().addColumnAfter().run()
                      }
                    />
                    <ToolbarButton
                      label="Delete table row"
                      icon={Minus}
                      onClick={() =>
                        editor.chain().focus().deleteRow().run()
                      }
                    />
                    <ToolbarButton
                      label="Delete table column"
                      icon={X}
                      onClick={() =>
                        editor.chain().focus().deleteColumn().run()
                      }
                    />
                    <ToolbarButton
                      label="Delete table"
                      icon={Trash2}
                      onClick={() =>
                        editor.chain().focus().deleteTable().run()
                      }
                    />
                  </>
                ) : null}
              </>
            }
          />
        </BubbleMenu>
      ) : null}
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
            <button
              type="button"
              aria-label="Close find and replace"
              onClick={() => setFindOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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
          <main>
            {/* The hint row that used to sit here carried the word count and
                the slash-command tip, and CSS hid it outright — so the one
                number a writer checks constantly was in the DOM and invisible.
                The count now lives in the work bar's context slot, where every
                other studio puts its standing fact. */}
            <EditorContent
              editor={editor}
              className="tiptap-root mx-auto max-w-[920px] [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-default)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:font-display [&_.ProseMirror_h1]:text-[30px] [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:font-display [&_.ProseMirror_h2]:text-[23px] [&_.ProseMirror_h2]:leading-tight [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p]:my-4"
            />
          </main>
        </div>
      </div>
    </div>
  );
}
