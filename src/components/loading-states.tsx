"use client";

import { useEffect, useState } from "react";

export function MessageSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex gap-3 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${className}`}>
      <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-24 rounded bg-[var(--bg-secondary)] animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-[90%] rounded bg-[var(--bg-secondary)] animate-pulse" />
          <div className="h-4 w-[80%] rounded bg-[var(--bg-secondary)] animate-pulse" />
          <div className="h-4 w-[60%] rounded bg-[var(--bg-secondary)] animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
      </div>
      <span className="text-xs text-[var(--text-secondary)]">AI is thinking...</span>
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
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5">
      <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
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
        <div className="h-8 w-20 rounded bg-[var(--bg-secondary)] animate-pulse" />
        <div className="h-8 w-8 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
      </div>
      <div className="h-10 w-full rounded bg-[var(--bg-secondary)] animate-pulse" />
      <div className="h-9 w-full rounded bg-[var(--bg-secondary)] animate-pulse" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 w-full rounded bg-[var(--bg-secondary)] animate-pulse" />
      ))}
    </div>
  );
}

export function ModelSelectorSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-6 w-24 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
      <div className="h-6 w-6 rounded-full bg-[var(--bg-secondary)] animate-pulse" />
    </div>
  );
}
