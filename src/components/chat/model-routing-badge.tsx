"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Cpu } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";

type ModelRoutingBadgeProps = {
  modelUsed?: string;
  whyThisResponse?: string;
};

function formatModelName(modelId: string) {
  const raw = modelId.split("/").pop() || modelId;
  const withoutSuffix = raw.replace(/:free$/i, "").replace(/-\d{4}-\d{2}-\d{2}$/i, "");
  const normalized = withoutSuffix
    .replace(/gpt-4\.1/gi, "GPT-4.1")
    .replace(/gpt-5/gi, "GPT-5")
    .replace(/claude/gi, "Claude")
    .replace(/gemini/gi, "Gemini")
    .replace(/sonar/gi, "Sonar")
    .replace(/deepseek/gi, "DeepSeek");

  return normalized
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      if (/^(gpt|claude|gemini|r1|o3|o4)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function providerFromModel(modelId: string) {
  return modelId.split("/")[0] ?? "AI";
}

export function ModelRoutingBadge({ modelUsed, whyThisResponse }: ModelRoutingBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const formattedName = useMemo(() => formatModelName(modelUsed ?? ""), [modelUsed]);

  if (!modelUsed) return null;

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
      >
        <ProviderLogo
          provider={providerFromModel(modelUsed)}
          modelId={modelUsed}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-transparent"
        />
        <Cpu className="h-3.5 w-3.5" />
        <span className="max-w-[190px] truncate">{formattedName}</span>
        {whyThisResponse && (
          <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {expanded && whyThisResponse && (
        <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">Routing rationale:</span> {whyThisResponse}
        </div>
      )}
    </div>
  );
}
