"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useState, type PointerEvent, type ReactNode } from "react";
import {
  activateWorkbenchTab,
  collectWorkbenchPaneIds,
  moveWorkbenchTab,
  removeWorkbenchTab,
  setSplitRatio,
  splitWorkbenchPane,
  type WorkbenchNode,
  type WorkbenchTab,
} from "../workbench";

export function WorkbenchSplitTree({
  node,
  onChange,
  renderTab,
  showPaneFocus = true,
  chrome = "pane",
}: {
  node: WorkbenchNode;
  onChange: (node: WorkbenchNode) => void;
  renderTab: (tab: WorkbenchTab) => ReactNode;
  showPaneFocus?: boolean;
  chrome?: "pane" | "none";
}) {
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  const updateRatio = useCallback(
    (splitId: string, ratio: number) => onChange(setSplitRatio(node, splitId, ratio)),
    [node, onChange],
  );

  function render(current: WorkbenchNode): ReactNode {
    if (current.type === "pane") {
      if (focusedPaneId && focusedPaneId !== current.paneId) return null;
      const active = current.tabs.find((tab) => tab.id === current.activeTabId) ?? current.tabs[0]!;
      return (
        <section className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)] ${chrome === "pane" ? "rounded-card border border-[var(--border-default)]" : ""}`} data-workbench-pane={current.paneId}>
          {chrome === "pane" ? (
          <header className="flex h-9 shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] pr-1">
            <div className="spectra-thin-scrollbar flex min-w-0 flex-1 overflow-x-auto">
              {current.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChange(activateWorkbenchTab(node, current.paneId, tab.id))}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    if (event.key === "Backspace" || event.key === "Delete") {
                      const next = removeWorkbenchTab(node, tab.id);
                      if (next) onChange(next);
                      event.preventDefault();
                      return;
                    }
                    if (event.shiftKey && (event.key.toLowerCase() === "h" || event.key.toLowerCase() === "v")) {
                      onChange(splitWorkbenchPane(node, current.paneId, tab.id, event.key.toLowerCase() === "h" ? "horizontal" : "vertical"));
                      event.preventDefault();
                      return;
                    }
                    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                      const paneIds = collectWorkbenchPaneIds(node);
                      const index = paneIds.indexOf(current.paneId);
                      const offset = event.key === "ArrowLeft" ? -1 : 1;
                      const target = paneIds[(index + offset + paneIds.length) % paneIds.length];
                      if (target) onChange(moveWorkbenchTab(node, tab.id, target));
                      event.preventDefault();
                    }
                  }}
                  className={`h-9 max-w-[220px] shrink-0 truncate border-r border-[var(--border-subtle)] px-3 text-micro font-medium ${tab.id === active.id ? "bg-[var(--bg-primary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                  aria-pressed={tab.id === active.id}
                  title={`${tab.title} · Alt+Delete close · Alt+Shift+H/V split · Alt+Shift+Arrow move`}
                >
                  {tab.title}
                </button>
              ))}
            </div>
            {showPaneFocus ? (
              <button type="button" onClick={() => setFocusedPaneId((value) => value === current.paneId ? null : current.paneId)} className="flex h-7 w-7 items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]" aria-label={focusedPaneId ? "Restore split layout" : `Focus ${active.title}`}>
                {focusedPaneId ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </button>
            ) : null}
          </header>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{renderTab(active)}</div>
        </section>
      );
    }
    if (focusedPaneId) {
      const first = render(current.first);
      if (first) return first;
      return render(current.second);
    }
    const horizontal = current.direction === "horizontal";
    const beginResize = (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const host = event.currentTarget.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const move = (next: globalThis.PointerEvent) => {
        const ratio = horizontal
          ? (next.clientX - rect.left) / rect.width
          : (next.clientY - rect.top) / rect.height;
        updateRatio(current.splitId, ratio);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
    };
    return (
      <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? "flex-row" : "flex-col"}`} data-workbench-split={current.splitId}>
        <div className="flex h-full min-h-0 min-w-0" style={{ flexBasis: `${current.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}>{render(current.first)}</div>
        <button
          type="button"
          onPointerDown={beginResize}
          onKeyDown={(event) => {
            const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -0.05 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 0.05 : 0;
            if (delta) { event.preventDefault(); updateRatio(current.splitId, current.ratio + delta); }
          }}
          className={`${horizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"} group relative shrink-0 bg-transparent outline-none focus-visible:bg-[color-mix(in_oklab,var(--accent-cyan)_18%,transparent)]`}
          aria-label={`Resize ${horizontal ? "columns" : "rows"}`}
        >
          <span className={`absolute bg-[var(--border-default)] group-hover:bg-[var(--accent-cyan)] ${horizontal ? "inset-y-0 left-1/2 w-px" : "inset-x-0 top-1/2 h-px"}`} />
        </button>
        <div className="flex h-full min-h-0 min-w-0 flex-1">{render(current.second)}</div>
      </div>
    );
  }

  return <div className="flex h-full min-h-0 min-w-0 flex-1">{render(node)}</div>;
}
