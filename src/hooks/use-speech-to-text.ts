"use client";

import { useMemo, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechCtor = new () => SpeechRecognitionLike;

export function useSpeechToText() {
  const ctor = useMemo<SpeechCtor | null>(() => {
    if (typeof window === "undefined") return null;
    const value = (window as Window & {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    }).SpeechRecognition
      ?? (window as Window & { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;
    return value ?? null;
  }, []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  function start() {
    if (!ctor || isListening) return;
    const recognition = new ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const rows = Array.from(event.results);
      const text = rows
        .map((row) => row?.[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setTranscript(text);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function reset() {
    setTranscript("");
  }

  return {
    isSupported: Boolean(ctor),
    isListening,
    transcript,
    start,
    stop,
    reset,
  };
}
