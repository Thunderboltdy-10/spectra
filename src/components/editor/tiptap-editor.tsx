"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Image } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Typography } from "@tiptap/extension-typography";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Underline } from "@tiptap/extension-underline";
import { Highlight } from "@tiptap/extension-highlight";
import { Link } from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  LinkIcon,
  RotateCcw,
  UnderlineIcon,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { ImportDialog } from "@/components/editor/import-dialog";
import { importClipboardData } from "@/lib/editor/clipboard-paste";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { Callout } from "./extensions/callout-node";
import { DragHandle } from "./extensions/drag-handle";
import { SlashCommand } from "./slash-command-extension";
import { createSlashCommandRenderer } from "./slash-command-renderer";
import { AiBar } from "./ai-bar";
import { EditorToolbar } from "./editor-toolbar";
import { RightSidePanel } from "@/components/shared/right-side-panel";

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return formatDateShort(ts);
}

interface TiptapEditorProps {
  content?: JSONContent | null;
  placeholder?: string;
  editable?: boolean;
  onSave?: (json: JSONContent, text: string) => void;
  onChange?: (json: JSONContent, text: string) => void;
  className?: string;
  noteId?: string;
  artifactId?: string;
  compact?: boolean;
  showAiBar?: boolean;
  showDocumentMeta?: boolean;
  documentTitle?: string;
  createdAt?: number;
  updatedAt?: number;
  onVersionHistoryOpen?: () => void;
  onVersionRestore?: (payload: {
    artifact?: {
      _id: string;
      title?: string;
      content?: JSONContent | null;
      contentPlaintext?: string;
      updatedAt?: number;
    };
  }) => void;
}

type EditorSnapshot = {
  json: JSONContent;
  text: string;
};

export function TiptapEditor({
  content,
  placeholder = "Start writing — type / for commands...",
  editable = true,
  onSave,
  onChange,
  className,
  noteId,
  artifactId,
  compact,
  showAiBar = false,
  showDocumentMeta = false,
  documentTitle,
  createdAt,
  updatedAt,
  onVersionHistoryOpen,
  onVersionRestore,
}: TiptapEditorProps) {
  const {
    editorMode,
    setActiveNoteId,
    setActiveArtifactId,
    openVersionHistory,
    closeVersionHistory,
    isVersionHistoryOpen,
  } = useEditorStore();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextAutosaveRef = useRef(false);
  const lastExternalContentRef = useRef<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ _id: string; createdAt: number; authorType?: string; description?: string }>>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  useEffect(() => {
    if (noteId) setActiveNoteId(noteId);
    if (artifactId) setActiveArtifactId(artifactId);
    return () => {
      setActiveNoteId(undefined);
      setActiveArtifactId(undefined);
    };
  }, [noteId, artifactId, setActiveNoteId, setActiveArtifactId]);

  const ensureDocumentTitle = useCallback((value?: JSONContent | null) => {
    if (!value || value.type !== "doc") return value ?? undefined;
    const nodes = Array.isArray(value.content) ? value.content : [];
    const firstNode = nodes[0];
    if (firstNode?.type === "heading" && firstNode.attrs?.level === 1) {
      return value;
    }
    const isEssentiallyEmpty = nodes.length === 0 || nodes.every((node) => {
      if (node.type !== "paragraph") return false;
      const text = Array.isArray(node.content)
        ? node.content.map((child) => ("text" in child && typeof child.text === "string" ? child.text : "")).join("").trim()
        : "";
      return text.length === 0;
    });
    if (!isEssentiallyEmpty) {
      return value;
    }
    return {
      ...value,
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: documentTitle
            ? [{ type: "text", text: documentTitle }]
            : [{ type: "text", text: "Untitled" }],
        },
        ...nodes,
      ],
    } satisfies JSONContent;
  }, [documentTitle]);

  const stripDocumentMarkers = useCallback((value: string) => value
    .replace(/<<\s*(?:DOC|DOCUMENT)[_\s]?START\s*>>/gi, "")
    .replace(/<<\s*(?:DOC|DOCUMENT)[_\s]?END\s*>>/gi, "")
    .trim(), []);

  const sanitizeContent = useCallback(function sanitizeContentNode(value?: JSONContent | null): JSONContent | null | undefined {
    if (!value) return value;

    const nextNode: JSONContent = { ...value };
    if (typeof nextNode.text === "string") {
      nextNode.text = stripDocumentMarkers(nextNode.text);
    }
    if (Array.isArray(nextNode.content)) {
      nextNode.content = nextNode.content
        .map((child) => sanitizeContentNode(child))
        .filter((child): child is JSONContent => Boolean(child))
        .filter((child) => {
          if (!child.content || child.content.length > 0) return true;
          if (child.type === "paragraph" || child.type === "heading") {
            return typeof child.text === "string" && child.text.trim().length > 0;
          }
          return true;
        });
    }
    return nextNode;
  }, [stripDocumentMarkers]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { languageClassPrefix: "language-" },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      // Tables
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      // Task lists
      TaskList,
      TaskItem.configure({ nested: true }),
      // Media
      Image.configure({ allowBase64: true, inline: false }),
      // Text styling
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Typography,
      Underline,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      CharacterCount,
      // Custom blocks
      Callout,
      DragHandle,
      // Slash commands
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          render: createSlashCommandRenderer,
          command: ({
            editor: e,
            range,
            props,
          }: {
            editor: import("@tiptap/core").Editor;
            range: { from: number; to: number };
            props: import("./slash-command-extension").SlashCommandItem;
          }) => {
            e.chain().focus().deleteRange(range).run();
            props.action(e);
          },
        },
      }),
    ],
    [placeholder],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: ensureDocumentTitle(sanitizeContent(content)),
    editable,
    editorProps: {
      attributes: {
        class: "prose-editor focus:outline-none",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON();
      const text = e.getText();
      onChange?.(json, text);

      if (suppressNextAutosaveRef.current) {
        suppressNextAutosaveRef.current = false;
        return;
      }

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        onSave?.(json, text);
      }, 1500);
    },
  });

  // Update content when it changes externally
  useEffect(() => {
    if (!editor || !content || editor.isFocused) return;
    const nextContent = ensureDocumentTitle(sanitizeContent(content));
    if (!nextContent) return;

    const nextSerialized = JSON.stringify(nextContent);
    if (lastExternalContentRef.current === nextSerialized) return;

    const currentSerialized = JSON.stringify(editor.getJSON());
    if (currentSerialized === nextSerialized) {
      lastExternalContentRef.current = nextSerialized;
      return;
    }

    editor.commands.setContent(nextContent, { emitUpdate: false });
    lastExternalContentRef.current = nextSerialized;
  }, [content, editor, ensureDocumentTitle, sanitizeContent]);

  const charOffsetToPos = useCallback(
    (charOffset: number): number => {
      if (!editor) return 1;
      const docSize = editor.state.doc.content.size;
      let charCount = 0;
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (pos > 0) return false;
        if (node.isText && node.text) {
          const textLen = node.text.length;
          if (charCount + textLen >= charOffset) {
            pos = nodePos + (charOffset - charCount);
            return false;
          }
          charCount += textLen;
        } else if (node.isLeaf) {
          charCount += 1;
        }
        return undefined;
      });
      if (pos === 0 && charOffset > 0) pos = Math.min(charOffset + 1, docSize);
      return Math.max(1, Math.min(pos || 1, docSize));
    },
    [editor],
  );

  const applyAiEdits = useCallback(
    (ops: Array<{ type: string; from: number; to: number; content?: string }>): EditorSnapshot | null => {
      if (!editor) return null;
      suppressNextAutosaveRef.current = true;
      editor.chain().focus().run();
      const sorted = [...ops].sort((a, b) => b.from - a.from);
      for (const op of sorted) {
        const from = charOffsetToPos(op.from);
        const to = charOffsetToPos(op.to);
        if (op.type === "replace" || op.type === "insert") {
          editor
            .chain()
            .setTextSelection({ from, to })
            .insertContent(op.content ?? "")
            .run();
        } else if (op.type === "delete") {
          editor
            .chain()
            .setTextSelection({ from, to })
            .deleteSelection()
            .run();
        }
      }
      return {
        json: editor.getJSON(),
        text: editor.getText(),
      };
    },
    [editor, charOffsetToPos],
  );

  const replaceDocument = useCallback(
    (nextContent: JSONContent): EditorSnapshot | null => {
      if (!editor) return null;
      suppressNextAutosaveRef.current = true;
      const ensured = ensureDocumentTitle(sanitizeContent(nextContent)) ?? nextContent;
      lastExternalContentRef.current = JSON.stringify(ensured);
      editor.commands.setContent(ensured, { emitUpdate: false });
      return {
        json: editor.getJSON(),
        text: editor.getText(),
      };
    },
    [editor, ensureDocumentTitle, sanitizeContent],
  );

  const applyImportedDocument = useCallback(
    (document: ImportedDocument, replaceDoc: boolean) => {
      if (!editor) return;
      if (replaceDoc) {
        const ensured = ensureDocumentTitle(sanitizeContent(document.content)) ?? document.content;
        lastExternalContentRef.current = JSON.stringify(ensured);
        editor.commands.setContent(ensured as never, { emitUpdate: false });
      } else {
        const insertable = Array.isArray(document.content.content)
          ? document.content.content
          : document.content;
        editor.commands.insertContent(insertable as never);
      }
      onChange?.(document.content, document.contentPlaintext);
      onSave?.(document.content, document.contentPlaintext);
    },
    [editor, ensureDocumentTitle, onChange, onSave, sanitizeContent],
  );

  useEffect(() => {
    if (!isVersionHistoryOpen || !artifactId) return;
    let cancelled = false;
    setLoadingVersions(true);
    void fetch(`/api/artifacts?action=versions&id=${encodeURIComponent(artifactId)}`)
      .then((response) => (response.ok ? response.json() : Promise.resolve({ versions: [] })))
      .then((data: { versions?: Array<{ _id: string; createdAt: number; authorType?: string; description?: string }> }) => {
        if (!cancelled) {
          setVersions(data.versions ?? []);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingVersions(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, isVersionHistoryOpen]);

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!artifactId) return;
    const response = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restoreVersion",
        artifactId,
        versionId,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to restore version");
    }
    const data = (await response.json()) as {
      artifact?: {
        _id: string;
        title?: string;
        content?: JSONContent | null;
        contentPlaintext?: string;
        updatedAt?: number;
      };
    };
    if (data.artifact?.content) {
      replaceDocument(data.artifact.content);
    }
    onVersionRestore?.(data);
  }, [artifactId, onVersionRestore, replaceDocument]);

  if (!editor) return null;

  const chars = editor.storage.characterCount?.characters() ?? 0;
  const words = editor.storage.characterCount?.words() ?? 0;
  const headingOne = editor.state.doc.firstChild;
  const titleText = stripDocumentMarkers(
    headingOne?.type.name === "heading"
      ? headingOne.textContent || documentTitle || "Untitled"
      : documentTitle || "Untitled",
  ) || "Untitled";

  return (
    <div className={cn("relative flex flex-col h-full", className)}>
      {/* Formatting toolbar */}
      {!compact && (
        <EditorToolbar editor={editor} onOpenImport={() => setImportOpen(true)} />
      )}

      {/* AI bar — only in AI-Enhanced mode */}
      {(editorMode === "ai_enhanced" || showAiBar) && (!compact || showAiBar) && (
        <AiBar
          editor={editor}
          onApplyEdits={applyAiEdits}
          onReplaceDocument={replaceDocument}
          noteId={noteId}
          artifactId={artifactId}
        />
      )}

      {showDocumentMeta && (
        <div className={cn("shrink-0 px-5", compact ? "pt-4" : "pt-6")}>
          <div className={cn("mx-auto w-full", compact ? "max-w-[42rem]" : "max-w-[52rem]")}>
            <p className={cn("text-[11px] text-[var(--text-tertiary)]", compact ? "pb-2" : "pb-3")}>
              {createdAt ? `Created ${formatDateShort(createdAt)}` : "Created recently"}
              {" \u00b7 "}
              {updatedAt ? `Modified ${formatRelativeTime(updatedAt)}` : "Modified recently"}
              {" \u00b7 "}
              <button
                type="button"
                onClick={() => {
                  if (compact && onVersionHistoryOpen) {
                    onVersionHistoryOpen();
                    return;
                  }
                  openVersionHistory();
                }}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Version history
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Selection toolbar — rendered inline, uses Tiptap BubbleMenu extension */}
      <SelectionToolbar editor={editor} />

      {/* Editor content */}
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          compact ? "px-4 py-4" : "px-6 pb-8 pt-0 md:px-10",
        )}
        onClick={() => editor.commands.focus()}
        onPaste={(event) => {
          const imported = importClipboardData(event.clipboardData);
          if (!imported) return;
          event.preventDefault();
          applyImportedDocument(imported, false);
        }}
      >
        <div className={cn("mx-auto w-full", compact ? "max-w-[42rem]" : "max-w-[52rem]")}>
          <EditorContent
            editor={editor}
            className={cn(
              "tiptap-root",
              compact ? "tiptap-compact" : "tiptap-full",
              showDocumentMeta && !compact && "tiptap-with-document-meta",
            )}
          />
        </div>
      </div>

      {/* Character / Word counter */}
      <div className="shrink-0 border-t border-[var(--border-default)]/40 px-4 py-1.5 text-[10px] text-[var(--text-tertiary)] select-none">
        <div className={cn("mx-auto flex items-center justify-end", compact ? "max-w-[42rem]" : "max-w-[52rem]")}>
          {chars.toLocaleString()} characters &middot; {words.toLocaleString()} words
        </div>
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(document) => applyImportedDocument(document, true)}
      />

      {isVersionHistoryOpen && artifactId && (
        <div className="absolute inset-y-0 right-0 z-50">
          <RightSidePanel
            width={320}
            title="Version History"
            icon={<History className="h-4 w-4" />}
            onClose={() => closeVersionHistory()}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-[var(--border-default)] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  {titleText}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
            {loadingVersions ? (
              <div className="text-sm text-[var(--text-secondary)]">Loading versions...</div>
            ) : versions.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)]">No version history yet.</div>
            ) : (
              <div className="space-y-3">
                {versions.map((version) => (
                  <div key={version._id} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-medium text-[var(--text-primary)]">
                        {version.authorType === "agent" ? "Agent" : version.authorType === "system" ? "System" : "You"}
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">
                        {new Date(version.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {version.description && (
                      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                        {version.description}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRestoreVersion(version._id)}
                      className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium text-[var(--accent-cyan)] transition-colors hover:bg-[var(--accent-cyan)]/8"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore this version
                    </button>
                  </div>
                ))}
              </div>
            )}
              </div>
            </div>
          </RightSidePanel>
          </div>
      )}
    </div>
  );
}

/* ── Selection Toolbar — appears above selected text ──────────────── */

function SelectionToolbar({ editor }: { editor: import("@tiptap/core").Editor }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setVisible(false);
        return;
      }
      // Get selection bounding rect
      const view = editor.view;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const editorEl = view.dom.closest(".tiptap-root");
      if (!editorEl) return;
      const editorRect = editorEl.getBoundingClientRect();
      const rawTop = start.top - editorRect.top - 44;
      const top = rawTop < 8
        ? end.bottom - editorRect.top + 12
        : rawTop;
      setPosition({
        top,
        left: (start.left + end.left) / 2 - editorRect.left,
      });
      setVisible(true);
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    editor.on("blur", () => setVisible(false));
    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="bubble-menu absolute z-50"
      style={{ top: position.top, left: position.left, transform: "translateX(-50%)" }}
    >
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Code"
      >
        <Code className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        active={editor.isActive("highlight")}
        title="Highlight"
      >
        <Highlighter className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <div className="w-px h-4 bg-white/20 mx-0.5" />
      <ToolbarBtn
        onClick={() => {
          const url = window.prompt("URL:", editor.getAttributes("link").href || "");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }
        }}
        active={editor.isActive("link")}
        title="Link"
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // Prevent blur
        onClick();
      }}
      title={title}
      className={cn(
        "p-1.5 rounded transition-colors",
        active ? "text-[var(--accent-cyan)]" : "text-white/70 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
