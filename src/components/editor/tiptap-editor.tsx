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
  UnderlineIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { ImportDialog } from "@/components/editor/import-dialog";
import { importClipboardData } from "@/lib/editor/clipboard-paste";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
import { Callout } from "./extensions/callout-node";
import { SlashCommand } from "./slash-command-extension";
import { createSlashCommandRenderer } from "./slash-command-renderer";
import { AiBar } from "./ai-bar";
import { EditorToolbar } from "./editor-toolbar";

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
}: TiptapEditorProps) {
  const { editorMode, setActiveNoteId, setActiveArtifactId } = useEditorStore();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextAutosaveRef = useRef(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (noteId) setActiveNoteId(noteId);
    if (artifactId) setActiveArtifactId(artifactId);
    return () => {
      setActiveNoteId(undefined);
      setActiveArtifactId(undefined);
    };
  }, [noteId, artifactId, setActiveNoteId, setActiveArtifactId]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { languageClassPrefix: "language-" },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
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
    content: content ?? undefined,
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
    if (editor && content && !editor.isFocused) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

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
      editor.commands.setContent(nextContent);
      return {
        json: editor.getJSON(),
        text: editor.getText(),
      };
    },
    [editor],
  );

  const applyImportedDocument = useCallback(
    (document: ImportedDocument, replaceDoc: boolean) => {
      if (!editor) return;
      if (replaceDoc) {
        editor.commands.setContent(document.content as never);
      } else {
        const insertable = Array.isArray(document.content.content)
          ? document.content.content
          : document.content;
        editor.commands.insertContent(insertable as never);
      }
      onChange?.(document.content, document.contentPlaintext);
      onSave?.(document.content, document.contentPlaintext);
    },
    [editor, onChange, onSave],
  );

  if (!editor) return null;

  const chars = editor.storage.characterCount?.characters() ?? 0;
  const words = editor.storage.characterCount?.words() ?? 0;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Formatting toolbar */}
      {!compact && (
        <EditorToolbar editor={editor} onOpenImport={() => setImportOpen(true)} />
      )}

      {/* AI bar — only in AI-Enhanced mode */}
      {editorMode === "ai_enhanced" && !compact && (
        <AiBar
          editor={editor}
          onApplyEdits={applyAiEdits}
          onReplaceDocument={replaceDocument}
          noteId={noteId}
          artifactId={artifactId}
        />
      )}

      {/* Selection toolbar — rendered inline, uses Tiptap BubbleMenu extension */}
      <SelectionToolbar editor={editor} />

      {/* Editor content */}
      <div
        className="flex-1 overflow-y-auto px-8 py-6"
        onClick={() => editor.commands.focus()}
        onPaste={(event) => {
          const imported = importClipboardData(event.clipboardData);
          if (!imported) return;
          event.preventDefault();
          applyImportedDocument(imported, false);
        }}
      >
        <EditorContent editor={editor} className="tiptap-root" />
      </div>

      {/* Character / Word counter */}
      <div className="shrink-0 flex items-center justify-end px-4 py-1.5 text-[10px] text-[var(--text-tertiary)] select-none border-t border-[var(--border-default)]/40">
        {chars.toLocaleString()} characters &middot; {words.toLocaleString()} words
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(document) => applyImportedDocument(document, true)}
      />
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
      setPosition({
        top: start.top - editorRect.top - 44,
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
