"use client";

/**
 * workspace-command-bar.tsx
 *
 * Center-stage command bar for the workspace canvas.
 * Spotlight-style: bottom-center, 440px resting, 640px expanded.
 * Workstream selector dropdown, auto-selects based on routing inference.
 * Cmd/Ctrl+K to focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FileText, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";
import type { PanelType } from "@/stores/workspace-store";

// Detect workspace creation intent from natural language
function detectWorkspaceCreationIntent(query: string): string | null {
  const lower = query.toLowerCase().trim();
  const patterns = [
    /^create\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^(?:new|add)\s+workspace(?:\s+for\s+(.+))?$/i,
    /^make\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^start\s+(?:a\s+)?(?:new\s+)?(.+?)\s+workspace$/i,
    /^workspace\s+for\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) return (match[1] ?? "New Workspace").trim();
  }
  return null;
}

// Detect when a query likely falls outside the current scope
function detectOutOfScope(query: string, scope: "artifact" | "workspace" | null): string | null {
  if (!scope || !query.trim()) return null;
  const lower = query.toLowerCase().trim();
  if (scope === "artifact") {
    const editSignals = /\b(edit|fix|change|update|revise|rewrite|improve|tighten|rephrase|reword|adjust|refine|polish|shorten|expand|reformat|proofread|correct)\b/i;
    if (!editSignals.test(lower) && lower.length > 15) {
      return "General question — scope will widen";
    }
  }
  return null;
}

type WorkspaceCommandBarProps = {
  hidden?: boolean;
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  activeArtifactId?: string;
  activeArtifactTitle?: string;
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
  onOpenPanel?: (type: PanelType, id: string) => void;
  onCreateWorkspace?: (name: string) => void;
  onClearScope?: () => void;
  layoutId?: string;
  position?: { x: number; y: number };
  onPositionChange?: (pos: { x: number; y: number }) => void;
  draggable?: boolean;
};

export function WorkspaceCommandBar({
  hidden = false,
  workstreams,
  primaryWorkstreamId,
  activeArtifactId,
  activeArtifactTitle,
  onOpenWorkstreamChat,
  onCreateWorkspace,
  onClearScope,
  layoutId = "workspace-command-bar",
  position,
  onPositionChange,
  draggable = true,
}: WorkspaceCommandBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLButtonElement>(null);

  const activeWorkstreams = useMemo(
    () => workstreams.filter((ws) => ws.status === "active"),
    [workstreams],
  );
  const selectedWs = useMemo(
    () => activeWorkstreams.find((ws) => ws._id === selectedWsId) ?? null,
    [activeWorkstreams, selectedWsId],
  );

  // Auto-select workstream
  useEffect(() => {
    if (primaryWorkstreamId) {
      if (selectedWsId !== primaryWorkstreamId) {
        setSelectedWsId(primaryWorkstreamId);
      }
      return;
    }

    if (selectedWsId && !activeWorkstreams.some((ws) => ws._id === selectedWsId)) {
      setSelectedWsId(null);
      return;
    }

    if (!focused && selectedWsId) {
      setSelectedWsId(null);
      return;
    }
  }, [activeWorkstreams, focused, primaryWorkstreamId, selectedWsId]);

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close picker on outside click
  useEffect(() => {
    if (!focused && !showPicker) return;
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setFocused(false);
      }
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [focused, showPicker]);

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return;
    const trimmed = query.trim();

    // Check for workspace creation intent first
    const workspaceCreationName = detectWorkspaceCreationIntent(trimmed);
    if (workspaceCreationName && onCreateWorkspace) {
      onCreateWorkspace(workspaceCreationName);
      setQuery("");
      setFocused(false);
      return;
    }

    const inferredWorkstream = !selectedWs
      ? activeWorkstreams.find((ws) => {
          const haystack = `${ws.title} ${ws.description ?? ""} ${ws.subjectCode ?? ""}`.toLowerCase();
          return trimmed.toLowerCase().split(/\s+/).some(word => word.length > 3 && haystack.includes(word));
        }) ?? null
      : selectedWs;

    if (inferredWorkstream) {
      onOpenWorkstreamChat(inferredWorkstream._id, trimmed);
    } else {
      router.push(`/chat?prompt=${encodeURIComponent(trimmed)}`);
    }
    setQuery("");
    setFocused(false);
  }, [activeWorkstreams, onCreateWorkspace, onOpenWorkstreamChat, query, router, selectedWs]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setQuery("");
      setFocused(false);
      setShowPicker(false);
      inputRef.current?.blur();
    }
  };

  const isScoped = !!primaryWorkstreamId && selectedWs;
  const isArtifactScoped = !!activeArtifactId;
  const placeholder = focused
    ? (isArtifactScoped
        ? `Edit ${activeArtifactTitle ?? "artifact"}...`
        : isScoped
          ? `Ask ${selectedWs?.title}...`
          : "Ask anything...")
    : "Ask Spectra...";

  const shellStyles = {
    container: focused ? "w-[600px]" : "w-[420px]",
    bar: cn(
      "border border-white/50 dark:border-white/20 bg-white/85 dark:bg-white/10 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.12)] dark:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.8)] backdrop-blur-[40px]",
      !focused && "hover:bg-white/95 dark:hover:bg-white/15 hover:border-white/60 dark:hover:border-white/30 transition-all duration-300 cursor-text"
    ),
    orb: "before:absolute before:-inset-x-20 before:-bottom-12 before:h-24 before:rounded-full before:bg-[radial-gradient(circle_at_center,rgba(14,142,232,0.12),transparent_70%)] before:blur-3xl before:content-['']",
    dock: !position ? "bottom-12 left-1/2 -translate-x-1/2" : "",
  };

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          ref={containerRef}
          layoutId={layoutId}
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: position?.y ?? 0, x: position?.x ?? 0 }}
          exit={{ opacity: 0, y: 100, scale: 0.95 }}
          drag={draggable && !!onPositionChange}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            if (onPositionChange) {
              onPositionChange({ 
                x: (position?.x ?? 0) + info.offset.x, 
                y: (position?.y ?? 0) + info.offset.y 
              });
            }
          }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className={cn("absolute z-[100]", shellStyles.dock, !position && shellStyles.orb)}
          style={{ x: position?.x, y: position?.y }}
        >
          {/* Workstream picker dropdown (above bar) */}
          <AnimatePresence>
            {showPicker && !primaryWorkstreamId && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.95 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={cn(
                  "absolute bottom-full mb-5 w-80 overflow-hidden rounded-[32px] border border-white/15 py-2.5 shadow-[0_32px_80px_-16px_rgba(0,0,0,0.85)] backdrop-blur-[60px]",
                  "left-1/2 -translate-x-1/2 bg-white/90 dark:bg-black/80",
                )}
              >
                <div className="px-6 py-3 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.3em]">
                  Route Intelligence
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedWsId(null); setShowPicker(false); }}
                  className={cn(
                    "w-full flex items-center gap-4 px-6 py-3.5 text-sm transition-all text-left",
                    !selectedWsId
                      ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 font-bold"
                      : "text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <span className="text-lg opacity-90">✨</span> 
                  <span className="flex-1">Semantic Auto-detect</span>
                </button>
                <div className="mx-5 h-px bg-black/5 dark:bg-white/10 my-1.5" />
                {activeWorkstreams.map((ws) => (
                  <button
                    key={ws._id}
                    type="button"
                    onClick={() => { setSelectedWsId(ws._id); setShowPicker(false); }}
                    className={cn(
                      "w-full flex items-center gap-4 px-6 py-3.5 text-sm transition-all text-left",
                      selectedWsId === ws._id
                        ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 font-bold"
                        : "text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                  >
                    <span className="text-lg leading-none shrink-0 opacity-90">{ws.emoji || "📚"}</span>
                    <span className="truncate flex-1 font-semibold">{ws.title}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main bar */}
          <div
            className={cn(
              "relative flex items-center gap-4 px-5 py-3",
              "transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]",
              shellStyles.bar,
              shellStyles.container,
              "rounded-[28px]",
            )}
            onClick={() => inputRef.current?.focus()}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5 text-[var(--text-tertiary)] transition-all duration-500",
              focused && "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 scale-105"
            )}>
              <Search className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full bg-transparent border-none outline-none text-[16px] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/60"
              />
              {focused && isArtifactScoped && detectOutOfScope(query, "artifact") && (
                <span className="text-[10px] text-[var(--text-tertiary)] italic mt-0.5">
                  {detectOutOfScope(query, "artifact")}
                </span>
              )}
            </div>

            {/* Workstream selector (when focused, not scoped) */}
            {focused && activeWorkstreams.length > 0 && !primaryWorkstreamId && (
              <button
                ref={selectorRef}
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowPicker((v) => !v); }}
                className={cn(
                  "shrink-0 flex items-center gap-2.5 px-3.5 py-2 rounded-[16px] text-xs transition-all shadow-sm border",
                  selectedWs
                    ? "text-[var(--text-primary)] bg-black/5 dark:bg-white/10 font-bold border-black/5 dark:border-white/10"
                    : "text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5",
                )}
              >
                <span className="max-w-[130px] truncate">
                  {selectedWs ? `${selectedWs.emoji} ${selectedWs.title}` : "Auto-routing"}
                </span>
                <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform duration-500", showPicker && "rotate-180")} />
              </button>
            )}

            {/* Artifact deep-edit scope badge */}
            {isArtifactScoped && (
              <span className={cn(
                "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[14px] text-xs font-bold transition-all border",
                focused
                  ? "text-[var(--accent-purple)] bg-[var(--accent-purple)]/10 border-[var(--accent-purple)]/20 shadow-[0_0_16px_rgba(139,92,246,0.1)]"
                  : "text-[var(--text-tertiary)] bg-black/5 dark:bg-white/5 border-transparent"
              )}>
                <FileText className="w-3.5 h-3.5" />
                <span className="truncate max-w-[100px]">{activeArtifactTitle ?? "Artifact"}</span>
                {onClearScope && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClearScope(); }}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    title="Clear artifact scope"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            )}
            {/* Workspace scoped badge when inside workstream */}
            {isScoped && !isArtifactScoped && (
              <span className={cn(
                "shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-[16px] text-xs font-bold transition-all border",
                focused 
                  ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 border-[var(--accent-cyan)]/20 shadow-[0_0_20px_rgba(14,142,232,0.1)]"
                  : "text-[var(--text-tertiary)] bg-black/5 dark:bg-white/5 border-transparent"
              )}>
                {focused && <span className="opacity-50 tracking-[0.2em] mr-1 text-[9px]">TO</span>}
                <span className="text-base leading-none">{selectedWs?.emoji}</span>
                <span className="truncate max-w-[140px]">{selectedWs?.title}</span>
                {onClearScope && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClearScope(); }}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    title="Clear workspace scope"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            )}

            {/* Clear button */}
            {query && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setQuery(""); }}
                className="shrink-0 p-1.5 rounded-xl text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Send button */}
            {focused && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
                disabled={!query.trim()}
                className={cn(
                  "shrink-0 w-9 h-9 rounded-[18px] flex items-center justify-center transition-all duration-500 shadow-2xl",
                  query.trim()
                    ? "bg-[var(--accent-cyan)] text-white hover:brightness-110 hover:scale-105 shadow-[0_0_24px_rgba(14,142,232,0.4)]"
                    : "bg-black/5 dark:bg-white/5 text-[var(--text-tertiary)]",
                )}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5 ml-0.5">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}

            {/* Keyboard shortcut hint */}
            {!focused && (
              <div className="shrink-0 flex items-center gap-2 pl-1">
                <kbd className="text-[10px] font-black text-[var(--text-tertiary)] opacity-60 px-2 py-1.5 rounded-lg border border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 tracking-[0.1em]">
                  ⌘K
                </kbd>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { WorkspaceCommandBar as QuickChatBar };
