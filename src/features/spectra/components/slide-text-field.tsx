"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { SpectraTiptapAutocomplete } from "../compute/autocomplete";
import { fieldExtensions, INCOMING_META } from "../editor/field-extensions";
import { mergeRefs } from "../life/use-life";
import {
  nativePresentationParagraphs,
  presentationObjectParagraphs,
  presentationParagraphsAreNative,
  type PresentationObject,
  type PresentationParagraph,
} from "../presentation/model";
import {
  richContentFromProseMirror,
  richContentFromSlideParagraphs,
  richContentToProseMirror,
  richContentToSlideParagraphs,
  slideParagraphsAfterEdit,
} from "../rich-content";
import { useSpectraPreferences } from "../settings/preference-store";
import { RichTextFormatBar } from "./artifact-studio";

/*
 * A slide's text box, written in place with the field every other editor
 * uses: the same marks, lists, checklists, quotes, code, links and equations,
 * the same command bar, local autocomplete, and Spectra's writing light.
 *
 * It stores what a deck stores: DrawingML paragraphs and runs. The editor
 * speaks the shared model, so a paragraph or run property the model does not
 * carry is kept by `slideParagraphsAfterEdit`, and a deck linked to a
 * PowerPoint file only ever receives text DrawingML can hold.
 */

/** The commands a linked PowerPoint text box has no place for. */
export const NATIVE_UNAVAILABLE_COMMANDS = ["Checklist", "Quote", "Inline code", "Inline equation", "Block equation"] as const;
const NATIVE_REASON = "PowerPoint text cannot hold this, so it stays out of linked decks.";

/** Paragraphs as the deck will hold them, so an echo of our own write is recognised. */
function paragraphsKey(paragraphs: readonly PresentationParagraph[]) {
  return JSON.stringify(presentationObjectParagraphs({ content: { text: "", paragraphs } } as unknown as PresentationObject));
}

function documentOf(paragraphs: readonly PresentationParagraph[]): JSONContent {
  return richContentToProseMirror(richContentFromSlideParagraphs(paragraphs));
}

/** Where the command bar sits: above the text box, or below it when the box is at the top of the window. */
function useBarPlace(host: { current: HTMLElement | null }, open: boolean) {
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      const below = rect.top < 64;
      setPlace({ left: Math.max(8, rect.left), top: below ? rect.bottom + 8 : rect.top - 8, below });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (host.current) observer?.observe(host.current);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [host, open]);
  return place;
}

export type SlideTextFieldProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "onFocus" | "onBlur"> & {
  paragraphs: PresentationParagraph[];
  /** Locked objects and readers see the text without a caret. */
  editable: boolean;
  /** The deck is linked to a PowerPoint file: only what DrawingML holds is written. */
  native: boolean;
  style?: CSSProperties;
  hostRef?: Ref<HTMLDivElement>;
  onChange: (paragraphs: PresentationParagraph[]) => void;
  onFocus: () => void;
  onBlur: () => void;
};

export function SlideTextField({
  paragraphs,
  editable,
  native,
  style,
  hostRef,
  onChange,
  onFocus,
  onBlur,
  className,
  ...host
}: SlideTextFieldProps) {
  const { preferences } = useSpectraPreferences();
  const ownRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const paragraphsRef = useRef(paragraphs);
  const onChangeRef = useRef(onChange);
  const nativeRef = useRef(native);
  // What the field last showed or wrote, as the deck holds it.
  const keyRef = useRef(paragraphsKey(paragraphs));
  const focusedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [initialContent] = useState(() => documentOf(paragraphs));
  useEffect(() => {
    paragraphsRef.current = paragraphs;
    onChangeRef.current = onChange;
    nativeRef.current = native;
  });

  const emit = (editor: Editor) => {
    const edited = richContentToSlideParagraphs(richContentFromProseMirror(editor.getJSON()));
    let next = slideParagraphsAfterEdit(paragraphsRef.current, edited);
    if (nativeRef.current && !presentationParagraphsAreNative(next)) next = nativePresentationParagraphs(next);
    const key = paragraphsKey(next);
    if (key === keyRef.current) return;
    keyRef.current = key;
    onChangeRef.current(next);
  };

  const editor = useEditor({
    extensions: [
      ...fieldExtensions({ placeholder: "", host: () => ownRef.current, box: true }),
      SpectraTiptapAutocomplete.configure({
        enabled: preferences.writing.smartCompletion && editable,
        delayMs: preferences.writing.delayMs,
        surface: "slide_text",
      }),
    ],
    content: initialContent,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Slide text",
        class: "spectra-prose spectra-prose-inherit presentation-object-copy outline-none",
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      // Only the person's own writing is a change; what came in is already stored.
      if (!focusedRef.current || transaction.getMeta(INCOMING_META)) return;
      emit(current);
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  // Someone else's text (a peer, Spectra, find and replace, undo in the
  // studio): apply only what differs, so a focused caret follows it.
  useEffect(() => {
    if (!editor) return;
    const key = paragraphsKey(paragraphs);
    if (key === keyRef.current) return;
    keyRef.current = key;
    const next = editor.schema.nodeFromJSON(documentOf(paragraphs));
    const current = editor.state.doc;
    const start = current.content.findDiffStart(next.content);
    if (start === null) return;
    const end = current.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(end.a, end.b);
    const endA = end.a + Math.max(0, overlap);
    const endB = end.b + Math.max(0, overlap);
    editor.view.dispatch(
      editor.state.tr
        .replace(start, endA, next.slice(start, endB))
        .setMeta(INCOMING_META, true)
        .setMeta("addToHistory", false),
    );
  }, [editor, paragraphs]);

  const within = (target: EventTarget | null) =>
    target instanceof Node && Boolean(ownRef.current?.contains(target) || barRef.current?.contains(target));

  const place = useBarPlace(ownRef, active && editable);

  return (
    <div
      {...host}
      ref={mergeRefs(ownRef, hostRef)}
      className={`${className ?? ""} presentation-text-field`.trim()}
      style={style}
      data-editing={active || undefined}
      onFocus={() => {
        if (focusedRef.current) return;
        focusedRef.current = true;
        setActive(true);
        onFocus();
      }}
      onBlur={(event) => {
        if (within(event.relatedTarget)) return;
        focusedRef.current = false;
        setActive(false);
        onBlur();
      }}
      // The caret goes where the pointer is; the object is moved by its frame.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <EditorContent editor={editor} className="presentation-text-field-content" />
      {place && editor
        ? createPortal(
            <div
              ref={barRef}
              className="presentation-text-bar"
              data-below={place.below || undefined}
              style={{ left: place.left, top: place.top }}
              // The bar is the field's own chrome: pressing it keeps the caret,
              // and nothing reaches the canvas behind it (React portals bubble).
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              // Its focus and blur bubble to the field through the portal, so
              // moving into the link form is still writing in this text box.
              onClick={(event) => event.stopPropagation()}
            >
              <RichTextFormatBar
                editor={editor}
                label="Slide text formatting"
                unavailable={native ? { labels: NATIVE_UNAVAILABLE_COMMANDS, reason: NATIVE_REASON } : undefined}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
