"use client";

import { useEffect, useRef, useState } from "react";
import {
  createAutocompleteSession,
  requestLocalAutocomplete,
  type AutocompleteSuggestion,
  type AutocompleteSurface,
} from "./autocomplete";

const EMPTY_AUTOCOMPLETE_CONTEXT: readonly string[] = [];

export function useLocalAutocomplete({
  value,
  cursor = value.length,
  surface,
  enabled = true,
  delayMs = 420,
  remoteApplying = false,
  recentPhrases = EMPTY_AUTOCOMPLETE_CONTEXT,
  workspaceTerms = EMPTY_AUTOCOMPLETE_CONTEXT,
}: {
  value: string;
  cursor?: number;
  surface: AutocompleteSurface;
  enabled?: boolean;
  delayMs?: number;
  remoteApplying?: boolean;
  recentPhrases?: readonly string[];
  workspaceTerms?: readonly string[];
}) {
  const session = useRef(createAutocompleteSession());
  const [suggestion, setSuggestion] = useState<AutocompleteSuggestion | null>(null);
  useEffect(() => {
    session.current.setRemoteApplying(remoteApplying);
  }, [remoteApplying]);
  useEffect(() => {
    if (!enabled || remoteApplying || cursor !== value.length || value.trim().length < 8) {
      setSuggestion(null);
      return;
    }
    let handle: ReturnType<typeof requestLocalAutocomplete> | null = null;
    const timer = window.setTimeout(() => {
      handle = requestLocalAutocomplete({ value, cursor, surface, recentPhrases, workspaceTerms });
      void handle.result.then((next) => setSuggestion(session.current.offer(next))).catch(() => setSuggestion(null));
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      handle?.cancel();
    };
  }, [cursor, delayMs, enabled, recentPhrases, remoteApplying, surface, value, workspaceTerms]);
  return {
    suggestion,
    compositionStart: () => {
      session.current.setComposition(true);
      setSuggestion(null);
    },
    compositionEnd: () => session.current.setComposition(false),
    dismiss: () => {
      session.current.dismiss();
      setSuggestion(null);
    },
    accept: (mode: "word" | "all") => {
      const next = session.current.accept(value, mode);
      setSuggestion(session.current.state.suggestion);
      return next;
    },
  };
}
