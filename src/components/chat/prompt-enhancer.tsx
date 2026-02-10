"use client";

import { useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudyMode } from "@/types";

type EnhanceResult = {
  original: string;
  enhanced: string;
  improvements: string[];
};

type PromptEnhancerProps = {
  message: string;
  mode: StudyMode;
  onUseEnhanced: (enhanced: string) => void;
  onDismiss: () => void;
};

export function PromptEnhancerButton({
  message,
  mode,
  onShowResult,
}: {
  message: string;
  mode: StudyMode;
  onShowResult: (result: EnhanceResult) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function enhance() {
    if (!message.trim() || loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, mode }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as EnhanceResult;
      onShowResult(data);
    } catch {
      // Silently fail - enhancement is optional
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void enhance()}
      disabled={!message.trim() || loading}
      className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40"
      title="Enhance your prompt with AI"
    >
      <Sparkles className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
      {loading ? "Enhancing..." : "Enhance"}
    </button>
  );
}

export function PromptEnhancerPanel({ message, mode, onUseEnhanced, onDismiss }: PromptEnhancerProps) {
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    void (async () => {
      try {
        const response = await fetch("/api/enhance-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, mode }),
        });
        if (!response.ok) {
          onDismiss();
          return;
        }
        const data = (await response.json()) as EnhanceResult;
        setResult(data);
      } catch {
        onDismiss();
      } finally {
        setLoading(false);
      }
    })();
  });

  if (loading) {
    return (
      <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Enhancing your prompt...
        </div>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="card-entrance rounded-[var(--radius-container)] border border-[color-mix(in_oklab,var(--accent)_30%,var(--border-default))] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          Enhanced Prompt
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full p-1 hover:bg-[var(--bg-hover)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 space-y-2">
        <div className="rounded-[var(--radius-input)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-secondary)] line-through">
          {result.original}
        </div>
        <div className="flex items-center justify-center">
          <ArrowRight className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div className="rounded-[var(--radius-input)] border border-[color-mix(in_oklab,var(--accent)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent)_4%,var(--bg-primary))] p-3 text-sm">
          {result.enhanced}
        </div>
      </div>

      {result.improvements.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Improvements</p>
          <ul className="space-y-0.5 text-xs text-[var(--text-secondary)]">
            {result.improvements.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onUseEnhanced(result.enhanced)}>
          Use enhanced prompt
        </Button>
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Keep original
        </Button>
      </div>
    </div>
  );
}
