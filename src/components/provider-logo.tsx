"use client";

import { memo, useEffect, useState } from "react";
import type { CSSProperties, ComponentType } from "react";
import Ai21 from "@lobehub/icons/es/Ai21/components/Mono";
import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono";
import Arcee from "@lobehub/icons/es/Arcee/components/Mono";
import ByteDance from "@lobehub/icons/es/ByteDance/components/Mono";
import Cerebras from "@lobehub/icons/es/Cerebras/components/Mono";
import Cohere from "@lobehub/icons/es/Cohere/components/Mono";
import Dbrx from "@lobehub/icons/es/Dbrx/components/Mono";
import DeepInfra from "@lobehub/icons/es/DeepInfra/components/Mono";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Mono";
import Fireworks from "@lobehub/icons/es/Fireworks/components/Mono";
import Google from "@lobehub/icons/es/Google/components/Mono";
import Groq from "@lobehub/icons/es/Groq/components/Mono";
import Meta from "@lobehub/icons/es/Meta/components/Mono";
import Minimax from "@lobehub/icons/es/Minimax/components/Mono";
import Mistral from "@lobehub/icons/es/Mistral/components/Mono";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono";
import NousResearch from "@lobehub/icons/es/NousResearch/components/Mono";
import Nvidia from "@lobehub/icons/es/Nvidia/components/Mono";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenRouter from "@lobehub/icons/es/OpenRouter/components/Mono";
import Perplexity from "@lobehub/icons/es/Perplexity/components/Mono";
import Qwen from "@lobehub/icons/es/Qwen/components/Mono";
import SambaNova from "@lobehub/icons/es/SambaNova/components/Mono";
import Stepfun from "@lobehub/icons/es/Stepfun/components/Mono";
import Together from "@lobehub/icons/es/Together/components/Mono";
import XAI from "@lobehub/icons/es/XAI/components/Mono";
import ZAI from "@lobehub/icons/es/ZAI/components/Mono";
import ZeroOne from "@lobehub/icons/es/ZeroOne/components/Mono";
import { getProviderPresentation } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  meta: "#0081fb",
  mistralai: "#f7d046",
  deepseek: "#4d6bfe",
  cohere: "#39594d",
  perplexity: "#20b8cd",
  minimax: "#5046e5",
  "01-ai": "#ff5733",
  qwen: "#6b3fa0",
  microsoft: "#00a4ef",
};

function getProviderColor(provider: string): string {
  const lower = provider.toLowerCase();
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
    if (lower.includes(key)) return color;
  }
  // Generate a stable color from the provider name
  let hash = 0;
  for (let i = 0; i < lower.length; i++) {
    hash = lower.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

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
  groq: Groq,
  cerebras: Cerebras,
  fireworks: Fireworks,
  deepinfra: DeepInfra,
  minimax: Minimax,
  sambanova: SambaNova,
  stepfun: Stepfun,
  bytedance: ByteDance,
  arcee: Arcee,
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

  // Fallback: first letter in colored circle — match Icon variant container (h-9 w-9)
  const letter = (provider ?? preset.label).charAt(0).toUpperCase();
  const bgColor = getProviderColor(provider ?? preset.label);
  return (
    <span
      className={cn(
        "inline-flex aspect-square h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-white font-semibold",
        className,
      )}
      style={{
        background: bgColor,
        fontSize: size * 0.5,
        lineHeight: 1,
      }}
      title={preset.label}
    >
      {letter}
    </span>
  );
});
