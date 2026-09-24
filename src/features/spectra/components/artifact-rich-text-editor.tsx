"use client";

import { useEffect, useRef, useState } from "react";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Equation, InlineEquation } from "../editor/equation-node";
import { targetAttrs } from "../collaboration/target-attributes";
import { plannerDescriptionHtml, RichTextFormatBar } from "./artifact-studio";
import { shouldEmitRichTextChange } from "./artifact-studio-value-utils";

export function ArtifactRichTextEditor({
  value,
  disabled,
  onChange,
  onFocus,
  path,
  placeholder = "Write something…",
  variant = "compact",
  collapsible = false,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  path?: string;
  placeholder?: string;
  variant?: "planner" | "compact" | "card";
  collapsible?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const contentKeyRef = useRef(plannerDescriptionHtml(value));
  const focusedRef = useRef(false);
  const typedWhileFocusedRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const [initialContent] = useState(() => plannerDescriptionHtml(value));
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const emitRichTextChange = (html: string) => {
    const next = html === "<p></p>" ? "" : html;
    if (
      !shouldEmitRichTextChange({
        committedValue: valueRef.current,
        nextHtml: next,
        typedWhileFocused: typedWhileFocusedRef.current,
      })
    ) {
      return;
    }
    onChangeRef.current(next);
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Equation,
      InlineEquation,
      Placeholder.configure({ placeholder }),
    ] as never[],
    content: initialContent,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          variant === "card"
            ? // 180px left a single-line answer floating in an almost empty
              // box; two of them pushed the note, tags and settings off screen.
              "min-h-[112px] px-6 py-6 text-center font-serif text-metric leading-snug text-[var(--text-primary)] outline-none"
            : variant === "planner"
              ? "min-h-[136px] px-4 py-3 text-ui leading-6 text-[var(--text-primary)] outline-none"
              : "min-h-[62px] px-3 py-2 text-ui leading-5 text-[var(--text-primary)] outline-none",
      },
    },
    onFocus: () => {
      focusedRef.current = true;
      onFocus?.();
    },
    onBlur: ({ editor: current }) => {
      focusedRef.current = false;
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const html = current.getHTML();
      contentKeyRef.current = html;
      emitRichTextChange(html);
      typedWhileFocusedRef.current = false;
    },
    onUpdate: ({ editor: current }) => {
      // TipTap can emit hydrate updates before focus. Only human typing while
      // focused may dirty the parent studio.
      if (!focusedRef.current) return;
      typedWhileFocusedRef.current = true;
      const html = current.getHTML();
      contentKeyRef.current = html;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        emitRichTextChange(html);
      }, 280);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    if (focusedRef.current) return;
    const incoming = plannerDescriptionHtml(value);
    if (incoming === contentKeyRef.current) return;
    contentKeyRef.current = incoming;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, value]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div
      className="spectra-planner-description spectra-rich-text-editor"
      data-disabled={disabled || undefined}
      data-rich-text-variant={variant}
      data-rich-text-collapsible={collapsible || undefined}
      data-spectra-hidden-target={collapsible ? "true" : undefined}
      {...(path ? targetAttrs(path) : {})}
    >
      <RichTextFormatBar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  );
}

