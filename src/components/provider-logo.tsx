"use client";

import {
  siAnthropic,
  siClaude,
  siGoogle,
  siMeta,
  siMistralai,
  siOpenrouter,
  siPerplexity,
} from "simple-icons";
import { getProviderPresentation } from "@/lib/provider-icons";

type ProviderLogoProps = {
  provider?: string;
  modelId?: string;
  className?: string;
};

type SimpleIconLike = {
  path: string;
  hex: string;
  title: string;
};

function pickIcon(provider?: string, modelId?: string): SimpleIconLike | null {
  const normalized = `${provider ?? ""} ${modelId ?? ""}`.toLowerCase();
  if (/anthropic/.test(normalized)) return siAnthropic;
  if (/claude/.test(normalized)) return siClaude;
  if (/google|gemini/.test(normalized)) return siGoogle;
  if (/meta|llama/.test(normalized)) return siMeta;
  if (/perplexity|sonar/.test(normalized)) return siPerplexity;
  if (/mistral/.test(normalized)) return siMistralai;
  if (/openrouter/.test(normalized)) return siOpenrouter;
  return null;
}

export function ProviderLogo({ provider, modelId, className }: ProviderLogoProps) {
  const icon = pickIcon(provider, modelId);
  if (icon) {
    return (
      <span
        className={className ?? "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-secondary)]"}
        title={icon.title}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d={icon.path} fill={`#${icon.hex}`} />
        </svg>
      </span>
    );
  }

  const fallback = getProviderPresentation(modelId, provider);
  return (
    <span
      className={className ?? "inline-flex h-9 w-9 items-center justify-center rounded-lg"}
      style={{ backgroundColor: fallback.background, color: fallback.foreground }}
      title={fallback.label}
    >
      {fallback.initial}
    </span>
  );
}
