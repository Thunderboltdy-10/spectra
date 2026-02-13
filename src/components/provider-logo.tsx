"use client";

import { useEffect, useState } from "react";
import {
  siAlibabacloud,
  siAnthropic,
  siDatabricks,
  siGoogle,
  siMeta,
  siMistralai,
  siOpenrouter,
  siPerplexity,
} from "simple-icons";
import { getProviderPresentation } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

type ProviderLogoProps = {
  provider?: string;
  modelId?: string;
  className?: string;
};

type IconLike = {
  path: string;
  title: string;
  hex?: string;
};

const CUSTOM_ICONS: Record<string, IconLike> = {
  openai: {
    title: "OpenAI",
    path: "M12.02 2.38a3.84 3.84 0 0 1 3.53 2.34l2.1 1.2a3.84 3.84 0 0 1 1.9 3.33c0 .53-.11 1.05-.33 1.53l.03 2.4a3.84 3.84 0 0 1-1.92 3.35l-2.11 1.22a3.84 3.84 0 0 1-3.2 1.72 3.84 3.84 0 0 1-3.2-1.72l-2.11-1.22a3.84 3.84 0 0 1-1.92-3.34v-2.4a3.84 3.84 0 0 1 1.9-4.87l2.08-1.2a3.84 3.84 0 0 1 3.25-2.34Zm0 2.02a1.82 1.82 0 0 0-1.63 1.03l-.16.32-2.26 1.3a1.82 1.82 0 0 0-.9 1.58v2.61c0 .65.35 1.25.9 1.58l2.26 1.3.16.32a1.82 1.82 0 0 0 3.25 0l.16-.32 2.26-1.3a1.82 1.82 0 0 0 .9-1.58v-2.61c0-.65-.35-1.25-.9-1.58l-2.26-1.3-.16-.32a1.82 1.82 0 0 0-1.62-1.03Z",
  },
  deepseek: {
    title: "DeepSeek",
    path: "M3 4h9.6c4.2 0 7.4 2.9 7.4 7.1 0 4.2-3.1 7.2-7.4 7.2H3V4Zm2.3 2.2v10h7.1c2.8 0 5-2.1 5-5.1 0-2.9-2.2-5-5-5H5.3Zm3.4 1.8h2.6c1.7 0 3 1.3 3 3.1 0 1.8-1.3 3.1-3 3.1H8.7V8Z",
  },
  xai: {
    title: "xAI",
    path: "M4 5h3.1l4.9 6.4L16.9 5H20l-6.4 8L20 19h-3.1L12 12.6 7.1 19H4l6.4-6L4 5Z",
  },
  cohere: {
    title: "Cohere",
    path: "M4 6.5A2.5 2.5 0 0 1 6.5 4h4A2.5 2.5 0 0 1 13 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 4 17.5v-11Zm7 3A2.5 2.5 0 0 1 13.5 7h4A2.5 2.5 0 0 1 20 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 11 17.5v-8Z",
  },
  qwen: {
    title: "Qwen",
    path: "M12 4a8 8 0 1 1-4.92 14.3L4 21.38 2.62 20l3.07-3.08A8 8 0 0 1 12 4Zm0 2.1A5.9 5.9 0 1 0 12 17.9a5.9 5.9 0 0 0 0-11.8Z",
  },
};

function pickIcon(key: string): IconLike | null {
  if (key === "anthropic") return { ...siAnthropic, title: siAnthropic.title };
  if (key === "google") return { ...siGoogle, title: siGoogle.title };
  if (key === "meta") return { ...siMeta, title: siMeta.title };
  if (key === "perplexity") return { ...siPerplexity, title: siPerplexity.title };
  if (key === "mistral") return { ...siMistralai, title: siMistralai.title };
  if (key === "openrouter") return { ...siOpenrouter, title: siOpenrouter.title };
  if (key === "databricks") return { ...siDatabricks, title: siDatabricks.title };
  if (key === "qwen") return { ...siAlibabacloud, title: "Alibaba Cloud" };
  if (CUSTOM_ICONS[key]) return CUSTOM_ICONS[key]!;
  return null;
}

export function ProviderLogo({ provider, modelId, className }: ProviderLogoProps) {
  const preset = getProviderPresentation(modelId, provider);
  const icon = pickIcon(preset.key);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setIsDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const background = isDark ? preset.bgDark : preset.bgLight;
  const fill = icon?.hex ? `#${icon.hex}` : isDark ? preset.darkFill : preset.lightFill;

  if (icon) {
    return (
      <span
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg",
          className,
        )}
        style={{ backgroundColor: background }}
        title={icon.title}
      >
        <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" className="h-4 w-4 shrink-0" aria-hidden>
          <path d={icon.path} fill={fill} />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg text-xs font-semibold leading-none",
        className,
      )}
      style={{ backgroundColor: background, color: isDark ? preset.darkFill : preset.lightFill }}
      title={preset.label}
    >
      {preset.initial}
    </span>
  );
}
