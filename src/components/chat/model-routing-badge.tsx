"use client";

import { useMemo, useState } from "react";
import { RouteTraceDrawer } from "@/components/chat/route-trace-drawer";
import type { RouteTrace } from "@/types";

type ModelRoutingBadgeProps = {
  modelUsed?: string;
  whyThisResponse?: string;
  routeTrace?: RouteTrace;
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

export function ModelRoutingBadge({ modelUsed, whyThisResponse, routeTrace }: ModelRoutingBadgeProps) {
  const [traceOpen, setTraceOpen] = useState(false);

  const activeModelId = modelUsed ?? routeTrace?.selected.modelId;
  const formattedName = useMemo(() => formatModelName(activeModelId ?? ""), [activeModelId]);
  const hasTrace = Boolean(routeTrace);
  const hintText = whyThisResponse ? "Why this model" : "Routing details";

  if (!activeModelId) return null;

  return (
    <div className="inline-flex min-w-0 items-center">
      {hasTrace ? (
        <button
          type="button"
          onClick={() => setTraceOpen(true)}
          title={whyThisResponse ?? "Model route details"}
          className="group inline-flex min-w-0 cursor-pointer items-baseline gap-2 text-left"
        >
          <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{formattedName}</span>
          <span className="text-[11px] text-[var(--text-secondary)] underline decoration-dotted underline-offset-4 transition group-hover:text-[var(--text-primary)]">
            {hintText}
          </span>
        </button>
      ) : (
        <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{formattedName}</span>
      )}

      <RouteTraceDrawer
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        trace={routeTrace}
      />
    </div>
  );
}
