'use client';

import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Pause, Play, RotateCcw, Calendar, LayoutGrid, MessageSquarePlus, Plus, FileText, Code2, BarChart2, ClipboardList, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Workstream } from '@/hooks/use-workspace-data';

interface EdgeUtilityOverlayProps {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstream: (wsId: string) => void;
  onExitWorkstream: () => void;
  panelOpen: boolean;
  onQuickChat?: (message: string) => void;
  onCreateItem?: (type: 'note' | 'code' | 'visual' | 'planner') => void;
}

export function EdgeUtilityOverlay({
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstream,
  onExitWorkstream,
  panelOpen,
  onQuickChat,
  onCreateItem,
}: EdgeUtilityOverlayProps) {
  const {
    timerState,
    startTimer,
    pauseTimer,
    resetTimer,
    utilityRevealOpen,
    utilityPositions,
    setUtilityPosition
  } = useWorkspaceStore();

  const [shortcutsHovered, setShortcutsHovered] = useState(false);
  const [timerHovered, setTimerHovered] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [quickChatDraft, setQuickChatDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const quickChatInputRef = useRef<HTMLInputElement>(null);

  const activeWorkstreams = workstreams.filter(ws => ws.status === 'active');

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const glassStyle = "bg-white/85 dark:bg-white/15 backdrop-blur-[40px] border border-white/50 dark:border-white/20 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6)] text-[var(--text-primary)]";

  return (
    <>
      {/* Top Center: Breadcrumbs (if focused) */}
      <AnimatePresence>
        {primaryWorkstreamId && !panelOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "absolute top-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-full",
              glassStyle
            )}
          >
            <button
              onClick={onExitWorkstream}
              className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold">
              {workstreams.find(ws => ws._id === primaryWorkstreamId)?.title}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Left: Focus Timer */}
      <div 
        className="absolute bottom-10 left-10 z-40"
        onMouseEnter={() => setTimerHovered(true)}
        onMouseLeave={() => setTimerHovered(false)}
      >
        <motion.div
          drag="y"
          dragConstraints={{ top: -400, bottom: 0 }}
          dragElastic={0.1}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            const current = utilityPositions['focus_timer'] || { x: 0, y: 0 };
            setUtilityPosition('focus_timer', { x: 0, y: current.y + info.offset.y });
          }}
          animate={{ 
            y: utilityPositions['focus_timer']?.y ?? 0 
          }}
          className={cn(
            "flex items-center gap-3 p-2 rounded-full transition-all duration-500",
            glassStyle,
            (timerState.active || timerHovered) ? "pr-5 pl-2" : "pr-2 pl-2"
          )}
        >
          <button
            onClick={() => timerState.active ? pauseTimer() : startTimer()}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
              timerState.active 
                ? "bg-[var(--accent-cyan)] text-white shadow-[0_0_20px_rgba(14,142,232,0.4)] scale-105" 
                : "bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] hover:bg-black/10 dark:hover:bg-white/20"
            )}
          >
            {timerState.active ? <Pause className="w-4.5 h-4.5" /> : <Play className="w-4.5 h-4.5 ml-0.5" />}
          </button>
          
          <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
            <div className="flex flex-col">
              <span className={cn(
                "text-[10px] uppercase tracking-[0.2em] font-bold leading-none mb-1 transition-colors",
                timerState.active ? "text-[var(--accent-cyan)]" : "text-[var(--text-tertiary)]"
              )}>
                Focus
              </span>
              <span className="text-[15px] font-mono font-bold tabular-nums leading-none">
                {formatTime(timerState.sessionMinutes * 60 - timerState.elapsed)}
              </span>
            </div>
            
            <AnimatePresence>
              {timerHovered && (
                <motion.div
                  initial={{ width: 0, opacity: 0, x: -10 }}
                  animate={{ width: 'auto', opacity: 1, x: 0 }}
                  exit={{ width: 0, opacity: 0, x: -10 }}
                  className="flex items-center gap-1 border-l border-black/10 dark:border-white/10 pl-3 ml-1"
                >
                  <button 
                    onClick={() => resetTimer()}
                    className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all"
                    title="Reset timer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Left Edge: Workstream Shortcuts */}
      <div 
        className="absolute left-0 top-1/2 -translate-y-1/2 z-40 pl-8"
        onMouseEnter={() => setShortcutsHovered(true)}
        onMouseLeave={() => setShortcutsHovered(false)}
      >
        <motion.div
          layout
          drag="y"
          dragConstraints={{ top: -200, bottom: 200 }}
          dragElastic={0.1}
          onDragEnd={(_, info) => {
            const current = utilityPositions['workstream_shortcuts'] || { x: 0, y: 0 };
            setUtilityPosition('workstream_shortcuts', { x: 0, y: current.y + info.offset.y });
          }}
          animate={{ 
            y: utilityPositions['workstream_shortcuts']?.y ?? 0 
          }}
          className={cn(
            "flex flex-col gap-3 p-3 rounded-[32px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            glassStyle,
            shortcutsHovered ? "w-56 items-start" : "w-16 items-center"
          )}
        >
          {!shortcutsHovered && (
            <div className="flex flex-col gap-4 py-1 items-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] shadow-sm">
                <LayoutGrid className="w-5 h-5" />
              </div>
              <div className="h-px w-8 bg-black/10 dark:bg-white/10" />
              <div className="flex flex-col gap-3">
                {activeWorkstreams.slice(0, 4).map(ws => (
                  <span key={ws._id} className="text-xl filter drop-shadow-sm opacity-60 hover:opacity-100 transition-opacity cursor-default">{ws.emoji || '📚'}</span>
                ))}
              </div>
            </div>
          )}

          {shortcutsHovered && (
            <div className="w-full px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Workspaces
            </div>
          )}

          {shortcutsHovered && activeWorkstreams.slice(0, 8).map((ws) => {
            const isActive = primaryWorkstreamId === ws._id;
            return (
              <button
                key={ws._id}
                onClick={() => onOpenWorkstream(ws._id)}
                className={cn(
                  "relative flex items-center gap-3 w-full rounded-2xl transition-all duration-200 px-3 py-2.5",
                  isActive ? "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] font-bold shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-secondary)]"
                )}
              >
                <span className="text-lg leading-none shrink-0">{ws.emoji || '📚'}</span>
                <span className="truncate text-xs tracking-tight">
                  {ws.title}
                </span>
                {isActive && (
                  <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan)]" />
                )}
              </button>
            );
          })}
          
          {shortcutsHovered && activeWorkstreams.length > 0 && (
            <div className="w-full h-px bg-black/10 dark:bg-white/10 my-1" />
          )}
          
          {shortcutsHovered && (
            <button
              className="flex items-center gap-3 w-full rounded-2xl transition-all px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Calendar className="w-4 h-4 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Schedule</span>
            </button>
          )}
        </motion.div>
      </div>

      {/* Bottom Right: Quick Chat Shell */}
      <div className="absolute bottom-10 right-10 z-40 flex flex-col items-end gap-2">
        <AnimatePresence>
          {quickChatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "flex flex-col gap-2 w-72 p-3 rounded-[20px] mb-1",
                glassStyle
              )}
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                  Quick Chat
                </span>
                <button
                  onClick={() => { setQuickChatOpen(false); setQuickChatDraft(''); }}
                  className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-tertiary)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {primaryWorkstreamId && (
                <div className="px-1 text-[11px] text-[var(--text-secondary)] truncate">
                  <span className="text-[var(--text-tertiary)]">In: </span>
                  {workstreams.find(ws => ws._id === primaryWorkstreamId)?.title ?? 'Workspace'}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!quickChatDraft.trim()) return;
                  onQuickChat?.(quickChatDraft.trim());
                  setQuickChatDraft('');
                  setQuickChatOpen(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={quickChatInputRef}
                  value={quickChatDraft}
                  onChange={(e) => setQuickChatDraft(e.target.value)}
                  placeholder="Ask anything…"
                  className="flex-1 rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2 text-[13px] placeholder:text-[var(--text-tertiary)] outline-none border border-transparent focus:border-[var(--accent-cyan)]/40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!quickChatDraft.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-cyan)] text-white disabled:opacity-40 hover:brightness-110 transition-all"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => {
            setQuickChatOpen((prev) => {
              if (!prev) setTimeout(() => quickChatInputRef.current?.focus(), 80);
              return !prev;
            });
            setCreateOpen(false);
          }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.96 }}
          className={cn(
            "flex items-center gap-2.5 px-4 py-2.5 rounded-full transition-all duration-300",
            glassStyle,
            quickChatOpen && "ring-2 ring-[var(--accent-cyan)]/50"
          )}
        >
          <MessageSquarePlus className={cn("w-4.5 h-4.5 transition-colors", quickChatOpen ? "text-[var(--accent-cyan)]" : "text-[var(--text-secondary)]")} />
          <span className="text-[12px] font-semibold">Quick Chat</span>
        </motion.button>
      </div>

      {/* Bottom Center: Create Launcher Shell */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
        <AnimatePresence>
          {createOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "flex items-center gap-1 px-2 py-2 rounded-full mb-1",
                glassStyle
              )}
            >
              {([
                { type: 'note' as const, icon: FileText, label: 'Note', color: 'text-[var(--accent-purple)]' },
                { type: 'code' as const, icon: Code2, label: 'Code', color: 'text-[var(--accent-mint)]' },
                { type: 'visual' as const, icon: BarChart2, label: 'Visual', color: 'text-[var(--accent-cyan)]' },
                { type: 'planner' as const, icon: ClipboardList, label: 'Task', color: 'text-[var(--accent-orange)]' },
              ] as const).map(({ type, icon: Icon, label, color }) => (
                <button
                  key={type}
                  onClick={() => { onCreateItem?.(type); setCreateOpen(false); }}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors group"
                >
                  <Icon className={cn("w-4 h-4", color)} />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors">
                    {label}
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={() => { setCreateOpen((p) => !p); setQuickChatOpen(false); }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.96 }}
          animate={{ rotate: createOpen ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300",
            glassStyle,
            createOpen && "ring-2 ring-[var(--accent-coral)]/50"
          )}
          title="Create"
        >
          <Plus className="w-5 h-5 text-[var(--text-primary)]" />
        </motion.button>
      </div>

      {/* REVEAL ALL Overlay */}
      <AnimatePresence>
        {utilityRevealOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40 backdrop-blur-sm pointer-events-none"
          >
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
