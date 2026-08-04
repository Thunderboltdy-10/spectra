"use client";

import { forwardRef, useId, useImperativeHandle, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useSpectraPreferences } from "@/features/spectra/settings/preference-store";
import type { AutocompleteSurface } from "./autocomplete";
import { useLocalAutocomplete } from "./use-local-autocomplete";

const EMPTY_AUTOCOMPLETE_CONTEXT: readonly string[] = [];

export const AUTOCOMPLETE_SURFACE_SUPPORT = {
  quick_chat: true,
  document: true,
  comment: true,
  description: true,
  plan_note: true,
  quiz_card_text: true,
  slide_text: true,
  agent_foundry: true,
  prose: true,
} as const satisfies Record<AutocompleteSurface, true>;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  surface: AutocompleteSurface;
  remoteApplying?: boolean;
  recentPhrases?: readonly string[];
  workspaceTerms?: readonly string[];
  textareaClassName?: string;
};

export const LocalAutocompleteTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function LocalAutocompleteTextarea(
    {
      value,
      onValueChange,
      surface,
      remoteApplying = false,
      recentPhrases = EMPTY_AUTOCOMPLETE_CONTEXT,
      workspaceTerms = EMPTY_AUTOCOMPLETE_CONTEXT,
      className,
      textareaClassName,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      ...props
    },
    forwardedRef,
  ) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const instructionsId = useId();
    useImperativeHandle(forwardedRef, () => ref.current!);
    const { preferences } = useSpectraPreferences();
    const autocomplete = useLocalAutocomplete({
      value,
      surface,
      enabled:
        preferences.writing.smartCompletion &&
        !props.readOnly &&
        !props.disabled,
      delayMs: preferences.writing.delayMs,
      remoteApplying,
      recentPhrases,
      workspaceTerms,
    });
    const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (autocomplete.suggestion && event.key === "Escape") {
        event.preventDefault();
        autocomplete.dismiss();
        return;
      }
      if (autocomplete.suggestion && event.key === "Tab") {
        event.preventDefault();
        onValueChange(autocomplete.accept("all"));
        return;
      }
      if (
        autocomplete.suggestion &&
        event.key === "ArrowRight" &&
        event.currentTarget.selectionStart === value.length &&
        event.currentTarget.selectionEnd === value.length
      ) {
        event.preventDefault();
        onValueChange(autocomplete.accept("word"));
        return;
      }
      onKeyDown?.(event);
    };
    return (
      <div className={cn("relative", className)} data-autocomplete-surface={surface}>
        {autocomplete.suggestion ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-[12px] leading-5">
            <span className="invisible">{value}</span>
            <span className="text-[var(--text-tertiary)] opacity-70">{autocomplete.suggestion.text}</span>
          </div>
        ) : null}
        <textarea
          {...props}
          ref={ref}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={keyDown}
          onCompositionStart={(event) => {
            autocomplete.compositionStart();
            onCompositionStart?.(event);
          }}
          onCompositionEnd={(event) => {
            autocomplete.compositionEnd();
            onCompositionEnd?.(event);
          }}
          aria-describedby={autocomplete.suggestion ? instructionsId : props["aria-describedby"]}
          className={cn("relative z-[1] bg-transparent", textareaClassName)}
        />
        {autocomplete.suggestion ? (
          <span id={instructionsId} className="sr-only">
            Local suggestion available. Press Tab to accept all, Right Arrow to accept one word, or Escape to dismiss.
          </span>
        ) : null}
      </div>
    );
  },
);
