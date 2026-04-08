'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Pause,
  Play,
  RotateCcw,
  LayoutGrid,
  Plus,
  FileText,
  Code2,
  BarChart2,
  ClipboardList,
  X,
  Sparkles,
  Layers,
  ArrowUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Workstream } from '@/hooks/use-workspace-data';

/* ─── Types ─────────────────────────────────────────────────────── */

interface EdgeUtilityOverlayProps {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstream: (wsId: string) => void;
  onExitWorkstream: () => void;
  panelOpen: boolean;
  onQuickChat?: (message: string) => void;
  onCreateItem?: (type: 'note' | 'code' | 'visual' | 'planner') => void;
  onNewWorkstream?: () => void;
}

/* ─── Constants ─────────────────────────────────────────────────── */

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

const glassStyle =
  'bg-[var(--bg-elevated)]/80 backdrop-blur-xl border border-[var(--border-default)]/40 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]';

type CreateItemType = 'note' | 'code' | 'visual' | 'planner' | 'workspace' | 'ai';

interface CreateMenuItem {
  type: CreateItemType;
  icon: React.ElementType;
  label: string;
  color: string;
}

const CREATE_ITEMS_BASE: CreateMenuItem[] = [
  { type: 'note', icon: FileText, label: 'Note', color: 'var(--accent-purple)' },
  { type: 'code', icon: Code2, label: 'Code', color: 'var(--accent-mint)' },
  { type: 'visual', icon: BarChart2, label: 'Visual', color: 'var(--accent-cyan)' },
  { type: 'planner', icon: ClipboardList, label: 'Task', color: 'var(--accent-orange)' },
];

const WORKSPACE_ITEM: CreateMenuItem = {
  type: 'workspace',
  icon: Layers,
  label: 'Workspace',
  color: 'var(--accent-coral)',
};

const AI_ITEM: CreateMenuItem = {
  type: 'ai',
  icon: Sparkles,
  label: 'Create with AI',
  color: 'var(--accent-cyan)',
};

/* ─── Radial Item Sub-component ─────────────────────────────────── */

function RadialItem({
  icon: Icon,
  label,
  color,
  angle,
  radius,
  open,
  index,
  total,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  angle: number;
  radius: number;
  open: boolean;
  index: number;
  total: number;
  onClick: () => void;
}) {
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) * radius;
  const y = -Math.sin(rad) * radius;

  return (
    <motion.div
      initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
      animate={
        open
          ? { opacity: 1, x, y, scale: 1 }
          : { opacity: 0, x: 0, y: 0, scale: 0.4 }
      }
      exit={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
      transition={{
        duration: 0.3,
        delay: open ? index * 0.04 : (total - index) * 0.025,
        ease: EASE_SMOOTH,
      }}
      className="absolute"
      style={{ left: '50%', top: '50%', marginLeft: -22, marginTop: -22 }}
    >
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        title={label}
        className="group relative flex h-11 w-11 items-center justify-center rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.25)] transition-all duration-200"
        style={{
          background: `color-mix(in oklab, ${color} 15%, var(--bg-elevated))`,
          border: `1.5px solid color-mix(in srgb, ${color} 40%, transparent)`,
        }}
      >
        <Icon className="h-[18px] w-[18px]" style={{ color }} />
        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
          {label}
        </span>
      </motion.button>
    </motion.div>
  );
}

/* ─── Workspace Dock ────────────────────────────────────────────── */

function WorkspaceDock({
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstream,
  onExitWorkstream,
}: {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstream: (wsId: string) => void;
  onExitWorkstream: () => void;
}) {
  const { utilityPositions, setUtilityPosition } = useWorkspaceStore();
  const [hovered, setHovered] = useState(false);

  const activeWorkstreams = workstreams.filter(ws => ws.status === 'active');
  const isHome = !primaryWorkstreamId;

  return (
    <div
      className="absolute left-6 top-1/2 -translate-y-1/2 z-40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: -250, bottom: 250 }}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const current = utilityPositions['workstream_shortcuts'] || { x: 0, y: 0 };
          setUtilityPosition('workstream_shortcuts', {
            x: 0,
            y: current.y + info.offset.y,
          });
        }}
        animate={{
          y: utilityPositions['workstream_shortcuts']?.y ?? 0,
          width: hovered ? 220 : 56,
        }}
        transition={{ duration: 0.35, ease: EASE_SMOOTH }}
        className={cn(
          'flex flex-col rounded-[28px] overflow-hidden',
          glassStyle,
        )}
      >
        {/* Home button */}
        <button
          onClick={() => {
            if (!isHome) onExitWorkstream();
          }}
          className={cn(
            'flex items-center gap-3 px-2 py-2 transition-colors duration-200 shrink-0',
            hovered ? 'mx-2 mt-2 rounded-xl' : 'mx-auto mt-2',
            isHome
              ? 'text-[var(--accent-cyan)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
          title="All workspaces"
        >
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-200',
              isHome
                ? 'bg-[var(--accent-cyan)]/15'
                : 'hover:bg-[var(--bg-hover)]',
            )}
          >
            <LayoutGrid className="w-5 h-5" />
          </div>
          {hovered && (
            <span className="text-xs font-semibold truncate whitespace-nowrap">
              All Workspaces
            </span>
          )}
        </button>

        {/* Divider */}
        <div className={cn('mx-auto my-1.5 bg-[var(--border-default)]/50', hovered ? 'w-[calc(100%-24px)]' : 'w-8', 'h-px transition-all duration-300')} />

        {/* Workspace list */}
        <div className={cn(
          'flex flex-col gap-0.5 pb-2 overflow-y-auto',
          activeWorkstreams.length > 6 ? 'max-h-[280px] [mask-image:linear-gradient(to_bottom,black_85%,transparent)]' : '',
        )}>
          {activeWorkstreams.slice(0, hovered ? undefined : 6).map(ws => {
            const isActive = primaryWorkstreamId === ws._id;
            return (
              <button
                key={ws._id}
                onClick={() => onOpenWorkstream(ws._id)}
                className={cn(
                  'relative flex items-center gap-3 transition-all duration-200 shrink-0',
                  hovered
                    ? 'mx-2 px-2 py-2 rounded-xl hover:bg-[var(--bg-hover)]'
                    : 'mx-auto px-0 py-1.5 justify-center',
                )}
                title={hovered ? undefined : ws.title}
              >
                {/* Cyan dot indicator for active workspace */}
                {isActive && (
                  <div
                    className={cn(
                      'absolute w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_8px_var(--accent-cyan)]',
                      hovered ? '-left-0.5' : 'left-0.5',
                      'top-1/2 -translate-y-1/2',
                    )}
                  />
                )}

                <motion.span
                  whileHover={{ scale: 1.12 }}
                  transition={{ duration: 0.15, ease: EASE_SMOOTH }}
                  className={cn(
                    'text-xl leading-none shrink-0 cursor-pointer select-none',
                    hovered ? 'ml-1' : '',
                    isActive ? 'drop-shadow-sm' : 'opacity-70 hover:opacity-100',
                  )}
                >
                  {ws.emoji || '📚'}
                </motion.span>

                {hovered && (
                  <span
                    className={cn(
                      'text-xs truncate whitespace-nowrap transition-colors',
                      isActive
                        ? 'font-semibold text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]',
                    )}
                  >
                    {ws.title}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Focus Timer ───────────────────────────────────────────────── */

function FocusTimer() {
  const {
    timerState,
    startTimer,
    pauseTimer,
    resetTimer,
    utilityPositions,
    setUtilityPosition,
  } = useWorkspaceStore();

  const [hovered, setHovered] = useState(false);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const remaining = Math.max(0, timerState.sessionMinutes * 60 - timerState.elapsed);

  return (
    <div
      className="absolute bottom-10 right-6 z-40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: -300, bottom: 100 }}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const current = utilityPositions['focus_timer'] || { x: 0, y: 0 };
          setUtilityPosition('focus_timer', {
            x: 0,
            y: current.y + info.offset.y,
          });
        }}
        animate={{ y: utilityPositions['focus_timer']?.y ?? 0 }}
        className={cn(
          'flex items-center gap-2 rounded-full transition-all duration-300',
          glassStyle,
          'p-1.5',
        )}
      >
        {/* Play/Pause button */}
        <button
          onClick={() => (timerState.active ? pauseTimer() : startTimer())}
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shrink-0',
            timerState.active
              ? 'bg-[var(--accent-cyan)] text-white shadow-[0_0_20px_rgba(14,142,232,0.4)]'
              : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          {timerState.active ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>

        {/* Time display */}
        <div className="flex flex-col pr-2 overflow-hidden">
          <span
            className={cn(
              'text-[9px] uppercase tracking-[0.15em] font-bold leading-none mb-0.5 transition-colors',
              timerState.active ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-tertiary)]',
            )}
          >
            Focus
          </span>
          <span className="text-sm font-mono font-bold tabular-nums leading-none text-[var(--text-primary)]">
            {formatTime(remaining)}
          </span>
          {timerState.sessionsCompleted > 0 && (
            <span className="text-[9px] text-[var(--text-tertiary)] leading-none mt-0.5">
              {timerState.sessionsCompleted} done
            </span>
          )}
        </div>

        {/* Reset button — revealed on hover */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 36, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_SMOOTH }}
              className="overflow-hidden flex items-center"
            >
              <button
                onClick={() => resetTimer()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                title="Reset timer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ─── Unified Command Bar ───────────────────────────────────────── */

function UnifiedCommandBar({
  workstreams,
  primaryWorkstreamId,
  onExitWorkstream,
  onQuickChat,
  onCreateItem,
  onNewWorkstream,
}: {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onExitWorkstream: () => void;
  onQuickChat?: (message: string) => void;
  onCreateItem?: (type: 'note' | 'code' | 'visual' | 'planner') => void;
  onNewWorkstream?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const activeWorkspace = primaryWorkstreamId
    ? workstreams.find(ws => ws._id === primaryWorkstreamId)
    : null;

  // Build create items list based on context
  const createItems: CreateMenuItem[] = [
    ...CREATE_ITEMS_BASE,
    ...(!primaryWorkstreamId ? [WORKSPACE_ITEM] : []),
    AI_ITEM,
  ];

  // Distribute items in a semicircle from 30 to 150 degrees
  const totalItems = createItems.length;
  const angleStep = totalItems > 1 ? 120 / (totalItems - 1) : 0;

  // Close create menu on outside click (excluding the toggle button)
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!createOpen) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      // Don't close if clicking the toggle button or its container (barRef)
      if (barRef.current?.contains(target) || toggleRef.current?.contains(target)) {
        return;
      }
      if (createRef.current && !createRef.current.contains(target)) {
        setCreateOpen(false);
      }
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, [createOpen]);

  const handleSend = useCallback(() => {
    const msg = draft.trim();
    if (!msg) return;
    if (onQuickChat) {
      onQuickChat(msg);
    } else {
      router.push(`/chat?q=${encodeURIComponent(msg)}`);
    }
    setDraft('');
    inputRef.current?.blur();
  }, [draft, onQuickChat, router]);

  const handleCreateClick = (item: CreateMenuItem) => {
    setCreateOpen(false);
    if (item.type === 'workspace') {
      onNewWorkstream?.();
    } else if (item.type === 'ai') {
      // Focus the input and pre-fill
      setDraft('Create ');
      setTimeout(() => {
        inputRef.current?.focus();
        // Move cursor to end
        const len = 'Create '.length;
        inputRef.current?.setSelectionRange(len, len);
      }, 50);
    } else {
      onCreateItem?.(item.type as 'note' | 'code' | 'visual' | 'planner');
    }
  };

  const hasDraft = draft.trim().length > 0;

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40">
      <div ref={barRef} className="relative flex flex-col items-center">
        {/* Radial create menu — fans upward from the + button */}
        <div ref={createRef} className="absolute bottom-0 left-4 flex items-center justify-center">
          <AnimatePresence>
            {createOpen &&
              createItems.map((item, index) => {
                const angle = 30 + index * angleStep;
                return (
                  <RadialItem
                    key={item.type}
                    icon={item.icon}
                    label={item.label}
                    color={item.color}
                    angle={angle}
                    radius={90}
                    open={createOpen}
                    index={index}
                    total={totalItems}
                    onClick={() => handleCreateClick(item)}
                  />
                );
              })}
          </AnimatePresence>
        </div>

        {/* The command bar capsule */}
        <motion.div
          animate={{ width: focused ? 560 : 480 }}
          transition={{ duration: 0.3, ease: EASE_SMOOTH }}
          className={cn(
            'relative flex items-center gap-2 rounded-full px-2 py-1.5 transition-shadow duration-300',
            glassStyle,
            focused
              ? 'shadow-[0_8px_40px_-8px_rgba(14,142,232,0.2),0_0_0_1px_var(--accent-cyan)/20]'
              : 'hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.25)]',
          )}
        >
          {/* + Create button */}
          <motion.button
            ref={toggleRef}
            onClick={() => setCreateOpen(prev => !prev)}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            animate={{ rotate: createOpen ? 45 : 0 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
              createOpen
                ? 'bg-[var(--accent-coral)]/15 text-[var(--accent-coral)]'
                : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
            title={createOpen ? 'Close menu' : 'Create...'}
          >
            <Plus className="w-4.5 h-4.5" />
          </motion.button>

          {/* Workspace context badge */}
          <AnimatePresence>
            {activeWorkspace && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                className="flex items-center gap-1 shrink-0 overflow-hidden"
              >
                <div className="flex items-center gap-1 rounded-full bg-[var(--bg-hover)] pl-2 pr-1 py-0.5">
                  <span className="text-sm leading-none">{activeWorkspace.emoji || '📚'}</span>
                  <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[80px] font-medium">
                    {activeWorkspace.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExitWorkstream();
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Text input */}
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setCreateOpen(false);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === 'Escape') {
                setDraft('');
                inputRef.current?.blur();
              }
            }}
            placeholder="Ask anything, create, or search..."
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
          />

          {/* Send / Sparkles button */}
          <motion.button
            onClick={hasDraft ? handleSend : undefined}
            whileHover={hasDraft ? { scale: 1.08 } : {}}
            whileTap={hasDraft ? { scale: 0.92 } : {}}
            disabled={!hasDraft}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200',
              hasDraft
                ? 'bg-[var(--accent-cyan)] text-white shadow-[0_0_12px_rgba(14,142,232,0.3)] cursor-pointer'
                : 'text-[var(--text-tertiary)] cursor-default',
            )}
          >
            {hasDraft ? (
              <ArrowUp className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}

/* ─── Main Overlay ──────────────────────────────────────────────── */

export function EdgeUtilityOverlay({
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstream,
  onExitWorkstream,
  onQuickChat,
  onCreateItem,
  onNewWorkstream,
}: EdgeUtilityOverlayProps) {
  return (
    <>
      {/* Left Edge: Workspace Selector Dock */}
      <WorkspaceDock
        workstreams={workstreams}
        primaryWorkstreamId={primaryWorkstreamId}
        onOpenWorkstream={onOpenWorkstream}
        onExitWorkstream={onExitWorkstream}
      />

      {/* Bottom Center: Unified Command Bar */}
      <UnifiedCommandBar
        workstreams={workstreams}
        primaryWorkstreamId={primaryWorkstreamId}
        onExitWorkstream={onExitWorkstream}
        onQuickChat={onQuickChat}
        onCreateItem={onCreateItem}
        onNewWorkstream={onNewWorkstream}
      />

      {/* Bottom Right: Focus Timer */}
      <FocusTimer />
    </>
  );
}
