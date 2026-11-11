"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Eraser, PanelBottom, TerminalSquare } from "@/components/icons/glyph-icons";

/*
 * The tray under the code (EDITORS.md, "Code"): what went wrong, and what the
 * code printed. One of the two is open at a time, or neither. Its top edge
 * drags to give the output more or less room; the height is remembered on this
 * device.
 */

export type CodeProblem = {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

export type ConsoleEntry = {
  id: string;
  level: "log" | "info" | "warn" | "error" | "system";
  text: string;
  createdAt: number;
};

export type TrayPanel = "console" | "problems";

const HEIGHT_KEY = "spectra.code.tray-height";
const MIN_HEIGHT = 96;
const MAX_SHARE = 0.7;

function storedHeight() {
  try {
    const value = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(value) && value >= MIN_HEIGHT ? value : null;
  } catch {
    return null;
  }
}

export function CodeTray({
  panel,
  onPanel,
  problems,
  onClearProblems,
  onOpenProblem,
  consoleEntries,
  onClearConsole,
  runtime,
}: {
  panel: TrayPanel | null;
  onPanel: (panel: TrayPanel | null) => void;
  problems: readonly CodeProblem[];
  onClearProblems: () => void;
  onOpenProblem: (problem: CodeProblem) => void;
  consoleEntries: readonly ConsoleEntry[];
  onClearConsole: () => void;
  /** What the code runs as, said plainly ("Python"). */
  runtime: string;
}) {
  const trayRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(() => (typeof window === "undefined" ? null : storedHeight()));
  const toggle = (next: TrayPanel) => onPanel(panel === next ? null : next);
  // Tips are listed with the problems but are not counted as ones.
  const wrong = problems.filter((problem) => problem.severity !== "info").length;

  function resize(event: ReactPointerEvent<HTMLDivElement>) {
    const output = trayRef.current?.querySelector<HTMLElement>(".code-tray-output");
    const room = trayRef.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    if (!output) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = output.getBoundingClientRect().height;
    let latest = startHeight;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.round(Math.min(room * MAX_SHARE, Math.max(MIN_HEIGHT, startHeight + startY - moveEvent.clientY)));
      setHeight(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      try {
        window.localStorage.setItem(HEIGHT_KEY, String(latest));
      } catch {
        // The height is a convenience; without storage it lasts this visit.
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <div ref={trayRef} className="code-tray" data-open={panel ? "" : undefined}>
      {panel ? (
        <div
          className="code-tray-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the output"
          onPointerDown={resize}
          onDoubleClick={() => setHeight(null)}
        />
      ) : null}
      <div className="code-tray-tabs">
        <button type="button" onClick={() => toggle("problems")} className={`code-panel-tab ${panel === "problems" ? "is-active" : ""}`}>
          <AlertTriangle className="h-3 w-3" />
          Problems
          {wrong ? <span>{wrong}</span> : null}
        </button>
        <button type="button" onClick={() => toggle("console")} className={`code-panel-tab ${panel === "console" ? "is-active" : ""}`}>
          <TerminalSquare className="h-3 w-3" />
          Console
          {consoleEntries.length ? <span>{consoleEntries.length}</span> : null}
        </button>
        <span className="ml-auto truncate text-micro text-[var(--text-tertiary)]">{runtime}</span>
        {panel === "problems" && problems.length ? (
          <button type="button" onClick={onClearProblems} className="code-small-action shrink-0">
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        ) : null}
        {panel === "console" && consoleEntries.length ? (
          <button type="button" onClick={onClearConsole} className="code-small-action shrink-0">
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        ) : null}
        {panel ? (
          <button type="button" onClick={() => onPanel(null)} className="code-icon-action h-6 w-6 shrink-0" aria-label="Hide the output" title="Hide the output">
            <PanelBottom className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {panel ? (
        <div className="code-tray-output" style={height ? { height } : undefined}>
          {panel === "problems" ? (
            problems.length ? (
              problems.map((problem) => <ProblemRow key={problem.id} problem={problem} onOpen={() => onOpenProblem(problem)} />)
            ) : (
              <EmptyOutput text="Nothing is wrong right now." />
            )
          ) : consoleEntries.length ? (
            consoleEntries.map((entry) => (
              <div
                key={entry.id}
                className={`flex gap-2 border-b border-[var(--border-subtle)] px-2 py-1 last:border-0 ${entry.level === "error" ? "text-[var(--danger)]" : entry.level === "warn" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}
              >
                <span className="shrink-0 text-micro text-[var(--text-tertiary)]">{entry.level}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.text}</span>
              </div>
            ))
          ) : (
            <EmptyOutput text="Run the code to see what it prints." />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProblemRow({ problem, onOpen }: { problem: CodeProblem; onOpen: () => void }) {
  const tone =
    problem.severity === "error" ? "text-[var(--danger)]" : problem.severity === "warning" ? "text-[var(--warning)]" : "text-[var(--accent-cyan)]";
  const mark = problem.severity === "error" ? "×" : problem.severity === "warning" ? "!" : "i";
  const where = problem.line ? `:${problem.line}${problem.column !== undefined ? `:${problem.column + 1}` : ""}` : "";
  return (
    <button type="button" className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)]" onClick={onOpen}>
      <span className={tone}>{mark}</span>
      <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">{problem.message}</span>
      <span className="shrink-0 text-[var(--text-tertiary)]">
        {problem.file}
        {where}
      </span>
    </button>
  );
}

export function EmptyOutput({ text }: { text: string }) {
  return <div className="flex h-20 items-center justify-center text-[var(--text-tertiary)]">{text}</div>;
}
