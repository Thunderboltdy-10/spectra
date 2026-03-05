"use client";

import { memo, useEffect, useState } from "react";
import type { CSSProperties, ComponentType } from "react";
import {
  Ai21,
  Anthropic,
  Cohere,
  Dbrx,
  DeepSeek,
  Google,
  Meta,
  Mistral,
  Moonshot,
  NousResearch,
  Nvidia,
  OpenAI,
  OpenRouter,
  Perplexity,
  Qwen,
  Together,
  XAI,
  ZAI,
  ZeroOne,
} from "@lobehub/icons";
import { getProviderPresentation } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

type ProviderLogoProps = {
  provider?: string;
  modelId?: string;
  className?: string;
  size?: number;
};

type LobeIconProps = {
  size?: number | string;
  style?: CSSProperties;
  className?: string;
};

const LOBE_ICONS: Record<string, ComponentType<LobeIconProps>> = {
  openai: OpenAI,
  anthropic: Anthropic,
  google: Google,
  meta: Meta,
  deepseek: DeepSeek,
  xai: XAI,
  cohere: Cohere,
  qwen: Qwen,
  nous: NousResearch,
  "01ai": ZeroOne,
  databricks: Dbrx,
  ai21: Ai21,
  together: Together,
  perplexity: Perplexity,
  mistral: Mistral,
  openrouter: OpenRouter,
  zai: ZAI,
  moonshot: Moonshot,
  nvidia: Nvidia,
};

export const ProviderLogo = memo(function ProviderLogo({ provider, modelId, className, size = 24 }: ProviderLogoProps) {
  const preset = getProviderPresentation(modelId, provider);
  const Icon = LOBE_ICONS[preset.key];
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setIsDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const background = isDark ? preset.bgDark : preset.bgLight;
  const fill = isDark ? preset.darkFill : preset.lightFill;

  if (Icon) {
    return (
      <span
        className={cn(
          "inline-flex aspect-square h-9 w-9 items-center justify-center overflow-hidden rounded-lg",
          className,
        )}
        style={{ backgroundColor: background, color: fill }}
        title={preset.label}
      >
        <Icon size={size} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex aspect-square h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-xs font-semibold leading-none",
        className,
      )}
      style={{ backgroundColor: background, color: fill }}
      title={preset.label}
    >
      {preset.initial}
    </span>
  );
});
