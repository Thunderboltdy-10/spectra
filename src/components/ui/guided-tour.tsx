"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export type GuidedTourStep = {
  selector: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
};

type GuidedTourProps = {
  open: boolean;
  steps: GuidedTourStep[];
  onClose: () => void;
  onComplete?: () => void;
};

const PANEL_WIDTH = 340;
const EDGE_GAP = 12;
const TARGET_PADDING = 8;
const CALLOUT_GAP = 14;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function firstVisibleTarget(selector: string) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const element of candidates) {
    const styles = window.getComputedStyle(element);
    if (styles.display === "none" || styles.visibility === "hidden" || styles.opacity === "0") {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    return element;
  }
  return null;
}

function resolveTooltipPosition(
  rect: DOMRect,
  position: GuidedTourStep["position"],
  viewport: { width: number; height: number },
) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxLeft = Math.max(EDGE_GAP, viewport.width - PANEL_WIDTH - EDGE_GAP);
  const defaultLeft = clamp(centerX - PANEL_WIDTH / 2, EDGE_GAP, maxLeft);

  if (position === "top") {
    return {
      left: defaultLeft,
      top: clamp(rect.top - CALLOUT_GAP - 220, EDGE_GAP, viewport.height - 220 - EDGE_GAP),
    };
  }
  if (position === "left") {
    return {
      left: clamp(rect.left - PANEL_WIDTH - CALLOUT_GAP, EDGE_GAP, maxLeft),
      top: clamp(centerY - 110, EDGE_GAP, viewport.height - 220 - EDGE_GAP),
    };
  }
  if (position === "right") {
    return {
      left: clamp(rect.right + CALLOUT_GAP, EDGE_GAP, maxLeft),
      top: clamp(centerY - 110, EDGE_GAP, viewport.height - 220 - EDGE_GAP),
    };
  }
  return {
    left: defaultLeft,
    top: clamp(rect.bottom + CALLOUT_GAP, EDGE_GAP, viewport.height - 220 - EDGE_GAP),
  };
}

export function GuidedTour({ open, steps, onClose, onComplete }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const findAvailableStepIndex = useCallback((fromIndex: number, direction: 1 | -1 = 1) => {
    for (
      let index = fromIndex;
      direction === 1 ? index < steps.length : index >= 0;
      index += direction
    ) {
      if (firstVisibleTarget(steps[index]?.selector ?? "")) return index;
    }
    return -1;
  }, [steps]);

  const step = steps[stepIndex];
  const isLastStep = stepIndex >= steps.length - 1;

  useEffect(() => {
    if (!open) return;
    const firstAvailable = findAvailableStepIndex(0, 1);
    setStepIndex(firstAvailable >= 0 ? firstAvailable : 0);
  }, [findAvailableStepIndex, open]);

  useEffect(() => {
    if (!open) return;

    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    const updateTarget = () => {
      const element = firstVisibleTarget(step.selector);
      if (!element) {
        setTargetRect(null);
        const forward = findAvailableStepIndex(stepIndex + 1, 1);
        if (forward >= 0) {
          setStepIndex(forward);
          return;
        }
        const backward = findAvailableStepIndex(stepIndex - 1, -1);
        if (backward >= 0) setStepIndex(backward);
        return;
      }
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      requestAnimationFrame(() => {
        setTargetRect(element.getBoundingClientRect());
      });
    };

    updateViewport();
    updateTarget();

    const handler = () => {
      updateViewport();
      updateTarget();
    };

    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [findAvailableStepIndex, open, step.selector, stepIndex]);

  const highlightedRect = useMemo(() => {
    if (!targetRect || viewport.width <= 0 || viewport.height <= 0) return null;
    const left = clamp(targetRect.left - TARGET_PADDING, EDGE_GAP, viewport.width - EDGE_GAP);
    const top = clamp(targetRect.top - TARGET_PADDING, EDGE_GAP, viewport.height - EDGE_GAP);
    const right = clamp(targetRect.right + TARGET_PADDING, EDGE_GAP, viewport.width - EDGE_GAP);
    const bottom = clamp(targetRect.bottom + TARGET_PADDING, EDGE_GAP, viewport.height - EDGE_GAP);
    return {
      left,
      top,
      width: Math.max(20, right - left),
      height: Math.max(20, bottom - top),
    };
  }, [targetRect, viewport.height, viewport.width]);

  const cardPosition = useMemo(() => {
    if (!highlightedRect || viewport.width <= 0 || viewport.height <= 0) {
      return {
        left: EDGE_GAP,
        top: EDGE_GAP,
      };
    }

    const syntheticRect = new DOMRect(
      highlightedRect.left,
      highlightedRect.top,
      highlightedRect.width,
      highlightedRect.height,
    );

    return resolveTooltipPosition(syntheticRect, step.position, viewport);
  }, [highlightedRect, step.position, viewport]);

  if (!open || !step) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120]" aria-hidden={!open}>
      {highlightedRect ? (
        <div
          className="pointer-events-none fixed rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_58%,white)]"
          style={{
            left: highlightedRect.left,
            top: highlightedRect.top,
            width: highlightedRect.width,
            height: highlightedRect.height,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.62)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/60" />
      )}

      <div
        className="pointer-events-auto fixed w-[min(90vw,340px)] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]"
        style={{ left: cardPosition.left, top: cardPosition.top }}
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
      >
        <p className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{step.description}</p>
        {!highlightedRect ? (
          <p className="mt-2 text-xs text-[var(--warning)]">Target is currently off-screen or unavailable.</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
              disabled={stepIndex === 0}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (isLastStep) {
                  onComplete?.();
                  onClose();
                  return;
                }
                const nextIndex = findAvailableStepIndex(stepIndex + 1, 1);
                if (nextIndex >= 0) {
                  setStepIndex(nextIndex);
                  return;
                }
                onComplete?.();
                onClose();
              }}
            >
              {isLastStep ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
