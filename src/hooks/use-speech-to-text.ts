"use client";

import { useCallback, useMemo, useRef, useState } from "react";

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

function hasSpeechRecognition(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as Window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor })
      .SpeechRecognition ??
    (window as Window & { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition ??
    null
  );
}

function hasMediaRecorder(): boolean {
  if (typeof window === "undefined") return false;
  return typeof MediaRecorder !== "undefined" && typeof navigator?.mediaDevices?.getUserMedia === "function";
}

function detectPreferredSpeechLanguage() {
  if (typeof window === "undefined") return "en-US";
  const documentLang = document.documentElement.lang?.trim();
  if (documentLang) return documentLang;
  const navLang = navigator.language?.trim();
  if (navLang) return navLang;
  return "en-US";
}

async function transcribeAudioBlob(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!response.ok) throw new Error("Transcription failed");
  const json = (await response.json()) as { transcript?: string };
  return json.transcript ?? "";
}

export function useSpeechToText() {
  const ctor = useMemo<SpeechCtor | null>(() => hasSpeechRecognition(), []);
  const useMediaRecorderFallback = useMemo(
    () => !hasSpeechRecognition() && hasMediaRecorder(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");

  const startNativeSpeech = useCallback(() => {
    if (!ctor || isListening) return;
    const recognition = new ctor();
    recognition.lang = detectPreferredSpeechLanguage();
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
  }, [ctor, isListening]);

  const stopNativeSpeech = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const startMediaRecorder = useCallback(async () => {
    if (isListening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a MIME type supported by the browser (Firefox prefers ogg/opus)
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType || "audio/webm" });
        audioChunksRef.current = [];
        setIsTranscribing(true);
        try {
          const text = await transcribeAudioBlob(blob);
          if (text) setTranscript(text);
        } catch {
          // transcription failed — leave transcript unchanged
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect chunks every 250ms
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [isListening]);

  const stopMediaRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  function start() {
    if (ctor) {
      startNativeSpeech();
    } else if (useMediaRecorderFallback) {
      void startMediaRecorder();
    }
  }

  function stop() {
    if (ctor) {
      stopNativeSpeech();
    } else {
      stopMediaRecorder();
    }
  }

  function reset() {
    setTranscript("");
  }

  return {
    isSupported: Boolean(ctor) || useMediaRecorderFallback,
    isListening: isListening || isTranscribing,
    isTranscribing,
    transcript,
    start,
    stop,
    reset,
  };
}
