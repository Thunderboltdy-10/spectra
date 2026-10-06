"use client";

import { useEffect, useRef, useState } from "react";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { AiTextResolve } from "../editor/ai-text-resolve";
import { Callout } from "../editor/callout-node";
import { Equation, InlineEquation } from "../editor/equation-node";
import { fieldContent, fieldDocument, fieldValue, type FieldFormat } from "../editor/field-format";
import { targetAttrs } from "../collaboration/target-attributes";
import { RichTextFormatBar } from "./artifact-studio";
import { shouldEmitRichTextChange } from "./artifact-studio-value-utils";

/** A change that came in through `value`: someone else's text (a peer's, or Spectra's). */
const INCOMING_META = "spectraIncomingValue";

export function ArtifactRichTextEditor({
  value,
  disabled,
  onChange,
  onFocus,
  path,
  placeholder = "Write something…",
  label,
  variant = "compact",
  format = "html",
  autoFocus = false,
  collapsible = false,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  path?: string;
  placeholder?: string;
  /** The field's accessible name. */
  label?: string;
  /** `bare` writes inside an object that is its own frame: a board note. */
  variant?: "planner" | "compact" | "card" | "bare";
  /** What the field stores: its editor's HTML, or Markdown. */
  format?: FieldFormat;
  /** Puts the caret at the end once the field opens. */
  autoFocus?: boolean;
  collapsible?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  // The stored value the editor last showed or wrote.
  const contentKeyRef = useRef(value);
  const focusedRef = useRef(false);
  const typedWhileFocusedRef = useRef(false);
  const [initialContent] = useState(() => fieldContent(value));
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const emitRichTextChange = (next: string) => {
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
    typedWhileFocusedRef.current = false;
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      // The same text primitives as a document, so nothing a field is given
      // (a checklist, a callout, a styled run) is dropped when it opens.
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Equation,
      InlineEquation,
      Placeholder.configure({ placeholder }),
      // Spectra's words resolve from a slight blur while it writes this field (MOTION.md).
      AiTextResolve.configure({
        writing: () => Boolean(hostRef.current?.closest('[data-ai-region="true"]')),
        remote: (transaction) => transaction.getMeta(INCOMING_META) === true,
      }),
    ] as never[],
    content: initialContent,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        ...(label ? { "aria-label": label } : {}),
        class:
          variant === "card"
            ? // 180px left a single-line answer floating in an almost empty
              // box; two of them pushed the note, tags and settings off screen.
              "spectra-prose min-h-[112px] px-6 py-6 text-center text-metric leading-snug outline-none"
            : variant === "planner"
              ? "spectra-prose min-h-[136px] px-4 py-3 text-ui leading-6 outline-none"
              : variant === "bare"
                ? "spectra-prose min-h-full outline-none"
                : "spectra-prose min-h-[62px] px-3 py-2 text-ui leading-5 outline-none",
      },
    },
    onFocus: () => {
      focusedRef.current = true;
      onFocus?.();
    },
    onBlur: ({ editor: current }) => {
      focusedRef.current = false;
      const next = fieldValue(current, format);
      contentKeyRef.current = next;
      emitRichTextChange(next);
      typedWhileFocusedRef.current = false;
    },
    onUpdate: ({ editor: current }) => {
      // TipTap can emit hydrate updates before focus. Only human typing while
      // focused may dirty the parent studio.
      if (!focusedRef.current) return;
      typedWhileFocusedRef.current = true;
      const next = fieldValue(current, format);
      contentKeyRef.current = next;
      // Publish intent before remote props arrive; the parent coalesces durable saves.
      emitRichTextChange(next);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    if (value === contentKeyRef.current) return;
    contentKeyRef.current = value;
    // Apply the incoming delta, rather than replacing the whole document, so
    // a focused caret follows the peer's insertions/deletions.
    const next = fieldDocument(editor.schema, value);
    const current = editor.state.doc;
    const start = current.content.findDiffStart(next.content);
    if (start === null) return;
    const end = current.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(end.a, end.b);
    const endA = end.a + Math.max(0, overlap);
    const endB = end.b + Math.max(0, overlap);
    editor.view.dispatch(editor.state.tr
      .replace(start, endA, next.slice(start, endB))
      .setMeta("preventUpdate", true)
      .setMeta(INCOMING_META, true)
      .setMeta("addToHistory", false));
    typedWhileFocusedRef.current = false;
  }, [editor, value]);

  return (
    <div
      ref={hostRef}
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

