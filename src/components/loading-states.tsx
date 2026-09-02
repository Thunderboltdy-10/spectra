"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const activeAccentStyle = { "--card-accent": "var(--accent-cyan)" } as CSSProperties;

export function MessageSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex gap-3 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${className}`}>
      <div className="spectra-skeleton-block h-8 w-8 shrink-0 rounded-control" />
      <div className="flex-1 space-y-2">
        <div className="spectra-skeleton-line h-4 w-24" />
        <div className="space-y-2">
          <div className="spectra-skeleton-line h-4 w-[90%]" />
          <div className="spectra-skeleton-line h-4 w-[80%]" />
          <div className="spectra-skeleton-line h-4 w-[60%]" />
        </div>
      </div>
    </div>
  );
}

export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="spectra-status-dot" data-active="true" style={activeAccentStyle} />
      <span className="thinking-wave text-xs text-[var(--text-secondary)]">Working through the request...</span>
    </div>
  );
}

const THINKING_MESSAGES = [
  "Consulting trusted sources...",
  "Planning the clearest path...",
  "Reasoning step by step...",
  "Aligning to your selected mode...",
  "Refining for accuracy and clarity...",
  "Preparing final response...",
];

export function ThinkingMessages() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % THINKING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div data-spectra-card="result" data-card-state="updating" className="inline-flex items-center gap-2 px-3 py-1.5">
      <span className="spectra-status-dot" data-active="true" style={activeAccentStyle} />
      <span key={index} className="thinking-copy thinking-wave text-sm text-[var(--text-secondary)]">
        {THINKING_MESSAGES[index]}
      </span>
    </div>
  );
}

export function ChatListSkeleton() {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="spectra-skeleton-line h-8 w-20" />
        <div className="spectra-skeleton-block h-8 w-8 rounded-control" />
      </div>
      <div className="spectra-skeleton-block h-10 w-full" />
      <div className="spectra-skeleton-line h-9 w-full" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="spectra-skeleton-block h-12 w-full" />
      ))}
    </div>
  );
}

export function ModelSelectorSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="spectra-skeleton-line h-6 w-24 rounded-full" />
      <div className="spectra-skeleton-block h-6 w-6 rounded-control" />
    </div>
  );
}
