"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { ImportDialog } from "@/components/editor/import-dialog";
import { importClipboardData } from "@/lib/editor/clipboard-paste";
import type { ImportedDocument } from "@/lib/editor/tiptap-import";
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
}

type EditorSnapshot = {
  json: JSONContent;
  text: string;
};

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

      if (suppressNextAutosaveRef.current) {
        suppressNextAutosaveRef.current = false;
        return;
      }

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

  const replaceDocument = useCallback((nextContent: JSONContent): EditorSnapshot | null => {
    if (!editor) return null;
    suppressNextAutosaveRef.current = true;
    editor.commands.setContent(nextContent);
    return {
      json: editor.getJSON(),
      text: editor.getText(),
    };
  }, [editor]);

  const applyImportedDocument = useCallback((document: ImportedDocument, replaceDocument: boolean) => {
    if (!editor) return;
    if (replaceDocument) {
      editor.commands.setContent(document.content as never);
    } else {
      const insertable = Array.isArray(document.content.content)
        ? document.content.content
        : document.content;
      editor.commands.insertContent(insertable as never);
    }
    onChange?.(document.content, document.contentPlaintext);
    onSave?.(document.content, document.contentPlaintext);
  }, [editor, onChange, onSave]);

  if (!editor) return null;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Formatting toolbar — ALWAYS visible in both modes */}
      <EditorToolbar editor={editor} onOpenImport={() => setImportOpen(true)} />

      {/* AI bar — only in AI-Enhanced mode */}
      {editorMode === "ai_enhanced" && (
        <AiBar
          editor={editor}
          onApplyEdits={applyAiEdits}
          onReplaceDocument={replaceDocument}
          noteId={noteId}
          artifactId={artifactId}
        />
      )}

      {/* Editor content — no border, no max-height constraint */}
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
        <EditorContent
          editor={editor}
          className="tiptap-root"
        />
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(document) => applyImportedDocument(document, true)}
      />
    </div>
  );
}
