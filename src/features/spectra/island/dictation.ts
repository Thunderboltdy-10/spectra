"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Speaking a message instead of typing it (ISLAND.md, "The composer"). The
 * browser's own speech recognition listens; what it hears is written into the
 * field as it comes, after whatever was already there, and nothing is sent
 * until the student sends it. Where the browser cannot listen, there is no
 * microphone to press.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Joins what was typed and what was heard with one space between them. */
export function joinSpoken(typed: string, heard: string) {
  const spoken = heard.trim();
  if (!spoken) return typed;
  if (!typed.trim()) return spoken;
  return `${typed.replace(/\s+$/, "")} ${spoken}`;
}

export function useDictation({ text, onText, onFailure }: { text: string; onText: (text: string) => void; onFailure?: (message: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  // What the field held when listening began; what is heard is written after it.
  const before = useRef("");
  const latest = useRef({ onText, onFailure });
  latest.current = { onText, onFailure };

  useEffect(() => setAvailable(recognitionConstructor() !== null), []);
  useEffect(() => () => recognition.current?.stop(), []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    const listener = new Constructor();
    listener.lang = document.documentElement.lang || navigator.language || "en";
    listener.continuous = true;
    listener.interimResults = true;
    before.current = text;
    listener.onresult = (event) => {
      let heard = "";
      for (let index = 0; index < event.results.length; index += 1) heard += event.results[index]![0]!.transcript;
      latest.current.onText(joinSpoken(before.current, heard));
    };
    listener.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") latest.current.onFailure?.("Spectra can't hear you: the browser has not been allowed to use the microphone.");
      else if (event.error !== "aborted" && event.error !== "no-speech") latest.current.onFailure?.("Listening stopped. Try again.");
    };
    listener.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = listener;
    setListening(true);
    listener.start();
  }, [text]);

  return { available, listening, toggle: listening ? stop : start, stop };
}
