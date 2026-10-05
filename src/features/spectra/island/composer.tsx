"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type HTMLAttributes,
  type MouseEvent,
} from "react";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SpectraRunPointer } from "../ai/use-spectra-run";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { readCommandAttachment, type CommandAttachment } from "../components/command-attachments";
import { getSpectraInstalledAgents, searchSpectra, type SpectraArtifact, type SpectraInstalledAgent } from "../data/api";
import { MARK_POSE, prismSvg, PRISM_PALETTES } from "../life/prism";
import { useLifeArrival, useLifeDeparture } from "../life/use-life";

/*
 * The island's composer (ISLAND.md, "The composer"): Spectra's only one.
 * Enter sends, Shift+Enter breaks the line, the field grows upward to eight
 * lines. Files come by the attach button, by dropping or by pasting. @ picks
 * an artifact to point at. The agent switch at the left is the prism (Auto)
 * until the user cycles to one of their agents.
 */

export type ComposerSend = {
  text: string;
  attachments: CommandAttachment[];
  references: SpectraRunPointer[];
  /** Undefined keeps the thread's agent; null is Auto. */
  agentId?: string | null;
  /** Where the words were on screen, for the field to carry them. */
  wordsRect: DOMRect | null;
  lineCount: number;
};

export type ComposerHandle = {
  focus(): void;
  hasContent(): boolean;
  element(): HTMLDivElement | null;
};

const MAX_ATTACHMENTS = 4;
const MAX_LINES = 8;
const LINE = 22;
const drafts = new Map<string, string>();

let agentsCache: Promise<SpectraInstalledAgent[]> | null = null;
function loadAgents() {
  agentsCache ??= getSpectraInstalledAgents()
    .then((result) => result.agents)
    .catch(() => {
      agentsCache = null;
      return [];
    });
  return agentsCache;
}

let autoMark: string | null = null;
function autoMarkUrl() {
  const dark = document.documentElement.classList.contains("dark");
  autoMark = `data:image/svg+xml;utf8,${encodeURIComponent(prismSvg(MARK_POSE, { size: 40, palette: PRISM_PALETTES[dark ? "dark" : "light"], detail: "mark" }))}`;
  return autoMark;
}

export const IslandComposer = forwardRef<
  ComposerHandle,
  {
    /** The thread it writes into, for its draft and placeholder. */
    draftKey: string;
    placeholder: string;
    /** The thread the page has in focus; the composer replies to it. */
    thread?: { title: string } | null;
    /** Lets go of that thread: the next message starts a new conversation. */
    onLetGo?: () => void;
    visible: boolean;
    busy?: boolean;
    onSend: (send: ComposerSend) => void;
    onStop?: () => void;
    onCancel: () => void;
  }
>(function IslandComposer({ draftKey, placeholder, thread, onLetGo, visible, busy, onSend, onStop, onCancel }, forwarded) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => drafts.get(draftKey) ?? "");
  const [attachments, setAttachments] = useState<CommandAttachment[]>([]);
  const [references, setReferences] = useState<SpectraRunPointer[]>([]);
  const [agents, setAgents] = useState<SpectraInstalledAgent[]>([]);
  /** -1 is Auto. Undefined: the thread's own choice, untouched. */
  const [agentIndex, setAgentIndex] = useState<number | undefined>(undefined);
  const [picker, setPicker] = useState<{ query: string; results: SpectraArtifact[]; active: number } | null>(null);

  useImperativeHandle(forwarded, () => ({
    focus: () => fieldRef.current?.focus({ preventScroll: true }),
    hasContent: () => Boolean(fieldRef.current?.value.trim()) || attachments.length > 0,
    element: () => rootRef.current,
  }));

  // Each thread keeps its own unsent words.
  useEffect(() => {
    setText(drafts.get(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    if (text) drafts.set(draftKey, text);
    else drafts.delete(draftKey);
  }, [draftKey, text]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void loadAgents().then((list) => live && setAgents(list.slice(0, 5)));
    return () => {
      live = false;
    };
  }, [visible]);

  // The field grows upward, line by line, then scrolls.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, LINE * MAX_LINES + 8)}px`;
  }, [text, visible]);

  // @ opens the picker of the user's things.
  useEffect(() => {
    if (!picker) return;
    const query = picker.query;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchSpectra(query || "", { signal: controller.signal })
        .then((result) => setPicker((current) => (current && current.query === query ? { ...current, results: result.artifacts.slice(0, 6), active: 0 } : current)))
        .catch(() => undefined);
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Only the query drives a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker?.query]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (!list.length) return;
    const read = await Promise.all(list.slice(0, MAX_ATTACHMENTS).map(readCommandAttachment));
    setAttachments((current) => [...current, ...read].slice(0, MAX_ATTACHMENTS));
  }, []);

  const agent = agentIndex !== undefined && agentIndex >= 0 ? agents[agentIndex] : null;
  const agentLabel = agentIndex === undefined || agentIndex < 0 ? "Auto: Spectra picks the agent" : agent?.title ?? "Auto";

  const cycleAgent = (event: MouseEvent) => {
    if (!agents.length) return;
    const stops = agents.length + 1;
    const position = (agentIndex ?? -1) + 1;
    const next = (position + (event.shiftKey ? -1 : 1) + stops) % stops;
    setAgentIndex(next - 1);
  };

  const sending = useRef(false);
  const departs = useCallback(() => !sending.current, []);

  const send = () => {
    const clean = text.trim();
    if (!clean || attachments.some((attachment) => attachment.error)) return;
    const field = fieldRef.current;
    const wordsRect = field?.getBoundingClientRect() ?? null;
    const lineCount = Math.max(1, Math.round((field?.scrollHeight ?? LINE) / LINE));
    onSend({
      text: clean,
      attachments,
      references,
      agentId: agentIndex === undefined ? undefined : agentIndex < 0 ? null : agents[agentIndex]?.agentId ?? null,
      wordsRect,
      lineCount,
    });
    // What was sent goes into the prism with the words; it does not part here.
    sending.current = true;
    requestAnimationFrame(() => (sending.current = false));
    setText("");
    setAttachments([]);
    setReferences([]);
    setPicker(null);
  };

  const pick = (artifact: SpectraArtifact) => {
    setReferences((current) =>
      current.some((item) => item.id === artifact._id) ? current : [...current, { id: artifact._id, type: artifact.blueprintKey, title: artifact.title }],
    );
    setText((current) => current.replace(/@([^\s@]*)$/, ""));
    setPicker(null);
    fieldRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && picker.results.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPicker({ ...picker, active: (picker.active + step + picker.results.length) % picker.results.length });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(picker.results[picker.active]);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (picker) setPicker(null);
      else onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const onChange = (value: string) => {
    setText(value);
    const mention = /(?:^|\s)@([^\s@]*)$/.exec(value);
    setPicker(mention ? (current) => ({ query: mention[1], results: current?.results ?? [], active: 0 }) : null);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    // Pasted files attach; pasted text, however long, stays text.
    if (event.clipboardData.files.length) {
      event.preventDefault();
      void addFiles(event.clipboardData.files);
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  const chips = useMemo(
    () => [
      ...references.map((reference) => ({ id: reference.id, label: reference.title, glyph: (workTypeMeta[reference.type as PresentedWorkType] ?? workTypeMeta.document).glyph, error: undefined as string | undefined, image: undefined as string | undefined, kind: "reference" as const })),
      ...attachments.map((attachment) => ({ id: attachment.id, label: attachment.name, glyph: attachment.handling === "image" ? ("image" as const) : ("attach" as const), error: attachment.error, image: attachment.handling === "image" ? attachment.data : undefined, kind: "file" as const })),
    ],
    [attachments, references],
  );

  return (
    <div
      ref={rootRef}
      data-island-composer
      onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
      onDrop={onDrop}
      className="relative box-border flex w-[min(600px,calc(100vw-32px))] flex-col rounded-surface border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
    >
      {thread && onLetGo ? (
        <div data-composer-thread className="flex items-center gap-1.5 px-3 pt-2 text-caption text-[var(--text-tertiary)]">
          <Icon name="conversations" size={14} />
          <span className="min-w-0 flex-1 truncate">
            Replying in <span className="text-[var(--text-secondary)]">{thread.title}</span>
          </span>
          <Tooltip label="Start a new conversation instead">
            <button
              type="button"
              onClick={onLetGo}
              className="inline-flex h-6 items-center gap-1 rounded-control px-1.5 text-caption text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              <Icon name="add" size={12} />
              New
            </button>
          </Tooltip>
        </div>
      ) : null}
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {chips.map((chip) => (
            <ComposerChip
              key={chip.id}
              id={chip.id}
              departs={departs}
              title={chip.error}
              className={cn(
                "inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-chip border pl-1.5 pr-1 text-caption",
                chip.error ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--border-default)] text-[var(--text-secondary)]",
              )}
            >
              {chip.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chip.image} alt="" className="size-5 rounded-chip object-cover" />
              ) : (
                <Icon name={chip.glyph} size={14} />
              )}
              <span className="min-w-0 truncate">{chip.kind === "reference" ? `@${chip.label}` : chip.label}</span>
              <IconButton
                icon="close"
                label={`Remove ${chip.label}`}
                size="compact"
                className="size-5"
                onClick={() =>
                  chip.kind === "reference"
                    ? setReferences((current) => current.filter((item) => item.id !== chip.id))
                    : setAttachments((current) => current.filter((item) => item.id !== chip.id))
                }
              />
            </ComposerChip>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 p-2">
        <AgentSwitch label={agentLabel} agent={agent} agents={agents} onCycle={cycleAgent} onChoose={setAgentIndex} />
        <textarea
          ref={fieldRef}
          data-composer-text
          rows={1}
          value={text}
          aria-label="Message Spectra"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-ui leading-[22px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <input ref={fileRef} type="file" multiple hidden onChange={(event) => void addFiles(event.target.files).then(() => (event.target.value = ""))} />
        <IconButton icon="attach" label="Attach files" onClick={() => fileRef.current?.click()} disabled={attachments.length >= MAX_ATTACHMENTS} className="size-9" />
        {busy && !text.trim() && onStop ? (
          <IconButton icon={<span className="size-2.5 rounded-sm bg-current" />} label="Stop" onClick={onStop} className="size-9 text-[var(--text-primary)]" />
        ) : (
          <IconButton
            icon="send"
            label="Send"
            shortcut="Enter"
            onClick={send}
            disabled={!text.trim()}
            className="size-9 bg-[var(--text-primary)] [color:var(--bg-primary)] hover:bg-[var(--text-primary)] hover:opacity-90 hover:[color:var(--bg-primary)]"
          />
        )}
      </div>
      {picker && picker.results.length ? (
        <div role="listbox" aria-label="Point Spectra at" className="absolute inset-x-2 bottom-[calc(100%+6px)] rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]">
          {picker.results.map((artifact, index) => {
            const meta = workTypeMeta[artifact.blueprintKey as PresentedWorkType] ?? workTypeMeta.document;
            return (
              <button
                key={artifact._id}
                type="button"
                role="option"
                aria-selected={index === picker.active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(artifact)}
                className={cn("flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-caption", index === picker.active ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]")}
              >
                <Icon name={meta.glyph} size={16} accent={meta.color} />
                <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{artifact.title}</span>
                <span className="shrink-0 text-micro text-[var(--text-tertiary)]">{meta.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

function AgentSwitch({
  label,
  agent,
  agents,
  onCycle,
  onChoose,
}: {
  label: string;
  agent: SpectraInstalledAgent | null;
  agents: SpectraInstalledAgent[];
  onCycle: (event: MouseEvent) => void;
  onChoose: (index: number) => void;
}) {
  const [mark, setMark] = useState<string | null>(autoMark);
  useEffect(() => setMark(autoMarkUrl()), []);
  const face = agent ? (
    <span className="grid size-6 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-micro font-semibold text-[var(--text-primary)]">
      {agent.title.slice(0, 1).toUpperCase()}
    </span>
  ) : mark ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mark} alt="" className="size-6" />
  ) : (
    <Icon name="agent" size={18} />
  );
  if (!agents.length) {
    return (
      <Tooltip label="Auto: Spectra picks the agent">
        <span data-agent-switch className="grid size-9 shrink-0 place-items-center">
          {face}
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="flex shrink-0 items-center">
      <Tooltip label={`${label}. Click for the next agent, Shift-click for the previous one.`}>
        <button type="button" data-agent-switch aria-label={label} onClick={onCycle} className="grid size-9 place-items-center rounded-control outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]">
          {face}
        </button>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="All agents" className="grid h-9 w-4 place-items-center rounded-control text-[var(--text-tertiary)] outline-none hover:text-[var(--text-primary)]">
          <Icon name="chevronDown" size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" layer="toast" className="min-w-[14rem]">
          <DropdownMenuItem onSelect={() => onChoose(-1)}>
            <span className="min-w-0 flex-1">Auto</span>
            <span className="text-micro text-[var(--text-tertiary)]">Spectra picks</span>
          </DropdownMenuItem>
          {agents.map((item, index) => (
            <DropdownMenuItem key={item.agentId} onSelect={() => onChoose(index)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{item.title}</span>
              {item.summary ? <span className="line-clamp-1 text-micro text-[var(--text-tertiary)]">{item.summary}</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** A file or a reference in the message: it forms from where it came (the drop, the pick) and parts when removed. */
function ComposerChip({ id, departs, ...props }: HTMLAttributes<HTMLSpanElement> & { id: string; departs: () => boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLifeArrival(ref, `composer-chip:${id}`, "human", { bars: "span" });
  useLifeDeparture(ref, departs);
  return <span ref={ref} {...props} />;
}
