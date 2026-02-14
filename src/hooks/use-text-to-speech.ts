"use client";

import { useMemo, useRef, useState } from "react";

function stripMarkdown(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[>#*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useTextToSpeech() {
  const synth = useMemo(() => (typeof window !== "undefined" ? window.speechSynthesis : null), []);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  function speak(input: string) {
    if (!synth) return;
    const text = stripMarkdown(input);
    if (!text) return;

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const preferred = voices.find((voice) => /en[-_](US|GB)/i.test(voice.lang)) ?? voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    utteranceRef.current = utterance;
    synth.speak(utterance);
  }

  function stop() {
    synth?.cancel();
    setIsSpeaking(false);
  }

  return {
    isSupported: Boolean(synth),
    isSpeaking,
    speak,
    stop,
  };
}
