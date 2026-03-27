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

  const applyAiEdits = useCallback(
    (ops: Array<{ type: string; from: number; to: number; content?: string }>) => {
      if (!editor) return;
      editor.chain().focus().run();
      for (const op of ops) {
        if (op.type === "replace" || op.type === "insert") {
          editor
            .chain()
            .setTextSelection({ from: op.from, to: op.to })
            .insertContent(op.content ?? "")
            .run();
        } else if (op.type === "delete") {
          editor
            .chain()
            .setTextSelection({ from: op.from, to: op.to })
            .deleteSelection()
            .run();
        }
      }
    },
    [editor],
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
