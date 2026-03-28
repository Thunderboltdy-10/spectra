"use client";

/**
 * right-push-panel.tsx
 *
 * Universal right push-panel for viewing threads, notes, artifacts, and route trace.
 * Pushes the canvas left. Adaptive width by content type.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  FileText,
  MessageSquare,
  Route,
  StickyNote,
  X,
} from "lucide-react";
import type { PanelType } from "@/stores/workspace-store";

type RightPushPanelProps = {
  type: PanelType;
  id: string;
  workstreamId?: string;
  onClose: () => void;
  onExpand?: (type: PanelType, id: string) => void;
};

const PANEL_WIDTHS: Record<PanelType, number> = {
  chat: 380,
  note: 520,
  artifact: 480,
  "route-trace": 400,
};

const PANEL_ICONS: Record<PanelType, React.ReactNode> = {
  chat: <MessageSquare className="w-4 h-4" />,
  note: <StickyNote className="w-4 h-4" />,
  artifact: <FileText className="w-4 h-4" />,
  "route-trace": <Route className="w-4 h-4" />,
};

const PANEL_LABELS: Record<PanelType, string> = {
  chat: "Thread",
  note: "Note",
  artifact: "Artifact",
  "route-trace": "Route Trace",
};

export function RightPushPanel({
  type,
  id,
  workstreamId,
  onClose,
  onExpand,
}: RightPushPanelProps) {
  const width = PANEL_WIDTHS[type];
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{
        width: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.2 },
      }}
      className="relative h-full overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-primary)] shrink-0"
    >
      <div className="flex flex-col h-full" style={{ width }}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 h-12 shrink-0 shadow-[0_1px_0_var(--border-default)]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[var(--text-tertiary)]">
              {PANEL_ICONS[type]}
            </span>
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">
              {PANEL_LABELS[type]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onExpand && type !== "route-trace" && (
              <button
                type="button"
                onClick={() => onExpand(type, id)}
                title="Open full view"
                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close panel"
              className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto">
          <PanelContent type={type} id={id} workstreamId={workstreamId} />
        </div>
      </div>
    </motion.div>
  );
}

function PanelContent({
  type,
  id,
}: {
  type: PanelType;
  id: string;
  workstreamId?: string;
}) {
  switch (type) {
    case "chat":
      return <ChatPanelContent threadId={id} />;
    case "note":
      return <NotePanelContent noteId={id} />;
    case "artifact":
      return <ArtifactPanelContent artifactId={id} />;
    case "route-trace":
      return <RouteTracePanelContent />;
    default:
      return null;
  }
}

function ChatPanelContent({
  threadId,
}: {
  threadId: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <MessageSquare className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">
            Chat thread panel
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Thread: {threadId}
          </p>
        </div>
      </div>
      {/* Composer area */}
      <div className="p-3 border-t border-[var(--border-default)]">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)]">
          <input
            type="text"
            placeholder="Ask a follow-up..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function NotePanelContent({ noteId }: { noteId: string }) {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center">
        <StickyNote className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
        <p className="text-sm text-[var(--text-secondary)]">
          Note editor panel
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Note: {noteId}
        </p>
      </div>
    </div>
  );
}

function ArtifactPanelContent({ artifactId }: { artifactId: string }) {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center">
        <FileText className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
        <p className="text-sm text-[var(--text-secondary)]">
          Artifact viewer
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Artifact: {artifactId}
        </p>
      </div>
    </div>
  );
}

function RouteTracePanelContent() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center">
        <Route className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
        <p className="text-sm text-[var(--text-secondary)]">
          Route trace panel
        </p>
      </div>
    </div>
  );
}
