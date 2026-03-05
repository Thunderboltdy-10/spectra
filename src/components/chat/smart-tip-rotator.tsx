"use client";

import { useEffect, useMemo, useState } from "react";
import { ContextualTip } from "@/components/ui/contextual-tip";
import type { StudyMode } from "@/types";

type TipActionId =
  | "switch-research"
  | "open-settings"
  | "open-tour"
  | "open-timer"
  | "open-feedback"
  | "new-chat"
  | "open-orchestration";

type SmartTipRotatorProps = {
  mode: StudyMode;
  messageCount: number;
  sending: boolean;
  streamPhase?: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
  hasResources: boolean;
  onAction: (actionId: TipActionId) => void;
};

type TipCandidate = {
  id: string;
  message: string;
  actionLabel?: string;
  actionId?: TipActionId;
};

const ROTATE_MS = 9000;

export function SmartTipRotator({
  mode,
  messageCount,
  sending,
  streamPhase = "idle",
  hasResources,
  onAction,
}: SmartTipRotatorProps) {
  const candidates = useMemo(() => {
    const tips: TipCandidate[] = [];

    if (messageCount === 0) {
      tips.push(
        {
          id: "quickstart-tour",
          message: "New here: run the guided tour once to learn all controls quickly.",
          actionLabel: "Start tour",
          actionId: "open-tour",
        },
        {
          id: "quickstart-mode",
          message: "Pick a mode before your first long prompt for better routing quality.",
          actionLabel: "New chat",
          actionId: "new-chat",
        },
      );
    }

    if (messageCount >= 1 && messageCount < 10) {
      tips.push({
        id: "slash-commands",
        message: "Use /mode, /search, and /export to speed up repetitive actions.",
        actionLabel: "Open settings",
        actionId: "open-settings",
      });
    }

    if (!hasResources && messageCount >= 3) {
      tips.push({
        id: "upload-files",
        message: "Attach notes or PDFs to ground responses in your own material.",
        actionLabel: "Open settings",
        actionId: "open-settings",
      });
    }

    if (mode !== "research" && messageCount >= 1) {
      tips.push({
        id: "research-mode",
        message: "For current events, citations, or statistics, switch to Research mode.",
        actionLabel: "Switch to Research",
        actionId: "switch-research",
      });
    }

    if (hasResources && messageCount >= 2) {
      tips.push({
        id: "resource-retrieval",
        message: "Your files are available to retrieval. Ask for source-grounded answers for best quality.",
      });
    }

    if (messageCount >= 4) {
      tips.push({
        id: "focus-timer",
        message: "Use the focus timer during longer sessions to reduce context switching.",
        actionLabel: "Open timer",
        actionId: "open-timer",
      });
    }

    if (sending && (streamPhase === "routing" || streamPhase === "searching" || streamPhase === "synthesizing")) {
      tips.push({
        id: "live-orchestration",
        message: "Live orchestration is available in the right panel while this answer is generating.",
        actionLabel: "Open panel",
        actionId: "open-orchestration",
      });
    }

    if (messageCount >= 12) {
      tips.push({
        id: "long-chat-settings",
        message: "Long session detected. Keep auto-compaction enabled to maintain response quality.",
        actionLabel: "Open settings",
        actionId: "open-settings",
      });
    }

    if (messageCount >= 2) {
      tips.push({
        id: "report-feedback",
        message: "If something looks wrong, report it quickly from the feedback panel with screenshot context.",
        actionLabel: "Open feedback",
        actionId: "open-feedback",
      });
    }

    return tips;
  }, [hasResources, messageCount, mode, sending, streamPhase]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [candidates.length]);

  useEffect(() => {
    if (candidates.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % candidates.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [candidates.length]);

  const tip = candidates[Math.min(index, Math.max(0, candidates.length - 1))];
  if (!tip) return null;

  return (
    <ContextualTip
      tipId={tip.id}
      message={tip.message}
      actionLabel={tip.actionLabel}
      onAction={tip.actionId ? () => onAction(tip.actionId!) : undefined}
      className="mb-3"
    />
  );
}
