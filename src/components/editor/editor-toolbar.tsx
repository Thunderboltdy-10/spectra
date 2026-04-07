"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Download,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImageIcon,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Strikethrough,
  Table,
  UnderlineIcon,
  Undo,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function EditorToolbar({ editor, onOpenImport }: { editor: Editor; onOpenImport?: () => void }) {
  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 shadow-[0_1px_0_var(--border-default)] bg-[var(--bg-elevated)] shrink-0 flex-wrap">
      {/* Text formatting */}
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
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        active={editor.isActive("highlight")}
        title="Highlight"
      >
        <Highlighter className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <Code className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      {/* Headings */}
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
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      {/* Lists and blocks */}
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
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive("taskList")}
        title="Task list"
      >
        <ListChecks className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <Code className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        active={false}
        title="Divider"
      >
        <Minus className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      {/* Table & Image */}
      <FormatBtn
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        active={editor.isActive("table")}
        title="Insert table"
      >
        <Table className="w-3.5 h-3.5" />
      </FormatBtn>
      <FormatBtn
        onClick={() => {
          // Use file input for local upload — converts to base64 data URI
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string | null;
              if (src) editor.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
          };
          input.click();
        }}
        active={false}
        title="Insert image"
      >
        <ImageIcon className="w-3.5 h-3.5" />
      </FormatBtn>

      <div className="w-px h-4 bg-[var(--border-default)] mx-1" />

      {/* Undo/Redo */}
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

      {onOpenImport && (
        <>
          <div className="w-px h-4 bg-[var(--border-default)] mx-1" />
          <FormatBtn onClick={onOpenImport} active={false} title="Import document">
            <Download className="w-3.5 h-3.5" />
          </FormatBtn>
        </>
      )}
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
