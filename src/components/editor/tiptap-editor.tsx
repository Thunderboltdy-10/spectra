"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { AiBar } from "./ai-bar";
import { EditorToolbar } from "./editor-toolbar";

type EditorMode = "simple" | "notion" | "agentic";

interface TiptapEditorProps {
  content?: object | null;
  placeholder?: string;
  editable?: boolean;
  onSave?: (json: object, text: string) => void;
  onChange?: (json: object, text: string) => void;
  className?: string;
  noteId?: string;
  artifactId?: string;
}

export function TiptapEditor({
  content,
  placeholder = "Start writing...",
  editable = true,
  onSave,
  onChange,
  className,
  noteId,
  artifactId,
}: TiptapEditorProps) {
  const { editorMode, setActiveNoteId, setActiveArtifactId } = useEditorStore();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (noteId) setActiveNoteId(noteId);
    if (artifactId) setActiveArtifactId(artifactId);
    return () => {
      setActiveNoteId(undefined);
      setActiveArtifactId(undefined);
    };
  }, [noteId, artifactId, setActiveNoteId, setActiveArtifactId]);

  const extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { languageClassPrefix: "language-" },
    }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: "is-editor-empty",
    }),
  ];

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

      // Debounced auto-save
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        onSave?.(json, text);
      }, 1500);
    },
  });

  // Update content when it changes externally
  useEffect(() => {
    if (editor && content && !editor.isFocused) {
      // Update content without emitting update event to avoid save loop
      editor.commands.setContent(content as any);
    }
  }, [editor, content]);

  const charOffsetToPos = useCallback(
    (charOffset: number): number => {
      if (!editor) return 1;
      const docSize = editor.state.doc.content.size;
      // Walk through the document text to map character offset to ProseMirror position
      let charCount = 0;
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (pos > 0) return false; // already found
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
      // If we never found it, clamp to document bounds
      if (pos === 0 && charOffset > 0) pos = Math.min(charOffset + 1, docSize);
      return Math.max(1, Math.min(pos || 1, docSize));
    },
    [editor],
  );

  const applyAiEdits = useCallback(
    (ops: Array<{ type: string; from: number; to: number; content?: string }>) => {
      if (!editor) return;
      editor.chain().focus().run();
      // Apply ops in reverse order to preserve positions
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
    },
    [editor, charOffsetToPos],
  );

  if (!editor) return null;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Mode toolbar (notion + agentic) */}
      {editorMode !== "simple" && (
        <EditorToolbar editor={editor} />
      )}

      {/* AI bar (agentic mode only) */}
      {editorMode === "agentic" && (
        <AiBar
          editor={editor}
          onApplyEdits={applyAiEdits}
          noteId={noteId}
          artifactId={artifactId}
        />
      )}

      {/* Editor content */}
      <div
        className="flex-1 overflow-y-auto px-8 py-6"
        onClick={() => editor.commands.focus()}
      >
        <EditorContent
          editor={editor}
          className={cn(
            "tiptap-root",
            editorMode === "simple" && "tiptap-simple",
          )}
        />
      </div>
    </div>
  );
}
