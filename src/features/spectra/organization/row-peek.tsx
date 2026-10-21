"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { aiWorking } from "../artifacts/ai-working";
import { authoredSummary } from "../artifacts/registry";
import { useWorkPreview } from "../artifacts/use-work-previews";
import { WorkCardBody, workCardStyle } from "../components/work-card";
import { previewSource, workType } from "./library-note";
import { relativeTime } from "./node-identity";
import type { TreeNode } from "./tree-client";

/*
 * A glance at a work from the list (LIBRARY.md, "Views"): resting the pointer
 * on a row lifts the same card the shelf shows beside it, so the list never
 * costs the reader the faces the shelf gives. The first card waits a beat, so
 * passing over rows is quiet; once one is up, the next row's swaps in at
 * once. The card never takes the pointer, and anything that moves the list
 * (a scroll, a press, a drag) puts it away.
 */

const FIRST_DELAY = 450;
const CARD_WIDTH = 296;
const CARD_HEIGHT = 300;
const GAP = 12;

type Peek = { node: TreeNode; left: number; top: number };

/** Only work has a face to show; places say what they are in the list already. */
const peekable = (node: TreeNode) => (node.kind === "work" && Boolean(node.sourceId)) || node.kind === "thread";

export function useRowPeek(nodeById: (nodeId: string) => TreeNode | undefined, disabled: boolean) {
  const [peek, setPeek] = useState<Peek | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const showing = useRef(false);
  showing.current = peek !== null;

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPeek(null);
  }, []);

  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(() => {
    if (!peek) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
    };
  }, [peek, hide]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onPointerOver = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || event.pointerType !== "mouse" || event.buttons) return;
      const row = (event.target as Element).closest<HTMLElement>("[data-node-row]");
      const node = row ? nodeById(row.dataset.nodeRow ?? "") : undefined;
      window.clearTimeout(timer.current);
      if (!row || !node || !peekable(node)) {
        if (showing.current) timer.current = window.setTimeout(() => setPeek(null), 120);
        return;
      }
      const place = () => {
        const box = row.getBoundingClientRect();
        const left = Math.min(event.clientX + 32, window.innerWidth - CARD_WIDTH - GAP);
        const top = Math.max(GAP, Math.min(box.top + box.height / 2 - CARD_HEIGHT / 2, window.innerHeight - CARD_HEIGHT - GAP));
        setPeek((current) => (current?.node.nodeId === node.nodeId ? current : { node, left, top }));
      };
      if (showing.current) place();
      else timer.current = window.setTimeout(place, FIRST_DELAY);
    },
    [disabled, nodeById],
  );

  const onPointerLeave = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(null), 120);
  }, []);

  const card = peek && typeof document !== "undefined" ? createPortal(<PeekCard key={peek.node.nodeId} {...peek} />, document.body) : null;
  return { handlers: { onPointerOver, onPointerLeave }, card };
}

function PeekCard({ node, left, top }: Peek) {
  const ref = useRef<HTMLDivElement>(null);
  const preview = useWorkPreview(previewSource(node), ref);
  const type = workType(node);
  return (
    <div
      ref={ref}
      aria-hidden
      data-work-card={type}
      className="work-card row-peek"
      style={{ ...workCardStyle(type), left, top, width: CARD_WIDTH } as CSSProperties}
    >
      <WorkCardBody
        type={type}
        title={node.name}
        preview={preview}
        summary={authoredSummary(node.source?.blueprintKey, node.source?.summary)}
        place={node.parentPath?.at(-1)}
        when={relativeTime(node.activityAt, Date.now())}
        live={aiWorking(node.source)}
      />
    </div>
  );
}
