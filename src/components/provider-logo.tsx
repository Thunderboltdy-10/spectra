"use client";

import { memo, useEffect, useState } from "react";
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
  nous: {
    title: "Nous Research",
    path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3a2 2 0 110 4 2 2 0 010-4zm-3 6h6v2H9v-2zm0 3h6v2H9v-2z",
  },
  together: {
    title: "Together AI",
    path: "M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM7 10h4v4H7v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z",
  },
  fireworks: {
    title: "Fireworks AI",
    path: "M12 2L9.5 8.5 3 7l4.5 5L3 17l6.5-1.5L12 22l2.5-6.5L21 17l-4.5-5L21 7l-6.5 1.5L12 2z",
  },
  ai21: {
    title: "AI21 Labs",
    path: "M3 4h3v16H3V4zm5 4h3v12H8V8zm5-2h3v14h-3V6zm5 6h3v8h-3v-8z",
  },
};

const iconCache = new Map<string, IconLike | null>();

function pickIcon(key: string): IconLike | null {
  const cached = iconCache.get(key);
  if (cached !== undefined) return cached;

  let result: IconLike | null = null;
  if (key === "anthropic") result = { ...siAnthropic, title: siAnthropic.title };
  else if (key === "google") result = { ...siGoogle, title: siGoogle.title };
  else if (key === "meta") result = { ...siMeta, title: siMeta.title };
  else if (key === "perplexity") result = { ...siPerplexity, title: siPerplexity.title };
  else if (key === "mistral") result = { ...siMistralai, title: siMistralai.title };
  else if (key === "openrouter") result = { ...siOpenrouter, title: siOpenrouter.title };
  else if (key === "databricks") result = { ...siDatabricks, title: siDatabricks.title };
  else if (key === "qwen") result = { ...siAlibabacloud, title: "Alibaba Cloud" };
  else if (CUSTOM_ICONS[key]) result = CUSTOM_ICONS[key]!;

  iconCache.set(key, result);
  return result;
}

export const ProviderLogo = memo(function ProviderLogo({ provider, modelId, className }: ProviderLogoProps) {
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
});
