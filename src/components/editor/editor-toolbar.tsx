"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Download,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

const MODES = [
  { id: "simple", label: "Simple" },
  { id: "notion", label: "Document" },
  { id: "agentic", label: "AI" },
] as const;

export function EditorToolbar({ editor, onOpenImport }: { editor: Editor; onOpenImport?: () => void }) {
  const { editorMode, setEditorMode } = useEditorStore();

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] shrink-0 flex-wrap">
      {/* Mode toggle */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-secondary)] mr-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setEditorMode(m.id)}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
              editorMode === m.id
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      {/* Formatting */}
      <FormatBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <Code className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      <FormatBtn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Ordered list"
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      <FormatBtn
        onClick={() => editor.chain().focus().undo().run()}
        active={false}
        title="Undo"
        disabled={!editor.can().undo()}
      >
        <Undo className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().redo().run()}
        active={false}
        title="Redo"
        disabled={!editor.can().redo()}
      >
        <Redo className="w-3.5 h-3.5" />
      </FormatBtn>

      {onOpenImport ? (
        <>
          <div className="w-px h-4 bg-[var(--border-default)] mx-1" />
          <FormatBtn
            onClick={onOpenImport}
            active={false}
            title="Import document"
          >
            <Download className="w-3.5 h-3.5" />
          </FormatBtn>
        </>
      ) : null}
    </div>
  );
}

function FormatBtn({
  onClick,
  active,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        active
          ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        disabled && "opacity-30 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
