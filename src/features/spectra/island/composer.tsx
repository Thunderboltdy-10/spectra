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
} from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PrismLoader } from "@/components/spectra-prism-optic";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDisclosure,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SpectraRunPointer } from "../ai/use-spectra-run";
import { workTypeMeta, type PresentedWorkType } from "../artifacts/presentation";
import { readCommandAttachment, type CommandAttachment } from "../components/command-attachments";
import { getSpectraInstalledAgents, searchSpectra, type SpectraArtifact, type SpectraInstalledAgent } from "../data/api";
import { useLifeArrival, useLifeDeparture } from "../life/use-life";
import { useDictation } from "./dictation";
import { PROVIDER_LABEL, providerProblem, recheckAgentRuntimeIfStale, useAgentRuntime, warmAgentRuntime } from "../ai/use-agent-runtime";
import { useSpectraPreferences } from "../settings/preference-store";
import { applyRuntimeChoice } from "../settings/ui/runtime-settings";
import { bridgeUnavailableReason, useBridgeAvailability } from "../bridge/availability";
import { DEVICES_HREF } from "../bridge/client";

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
  /** Start the message written: a suggestion the student can still change before sending. */
  prefill(text: string, references?: SpectraRunPointer[]): void;
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

export const IslandComposer = forwardRef<
  ComposerHandle,
  {
    /** The thread it writes into, for its draft and placeholder. */
    draftKey: string;
    placeholder: string;
    /** What the empty field says once it has the keyboard, when that differs. */
    focusedPlaceholder?: string;
    /** A run started from here is still going, out of sight. */
    working?: boolean;
    visible: boolean;
    busy?: boolean;
    onSend: (send: ComposerSend) => void;
    onStop?: () => void;
    onCancel: () => void;
  }
>(function IslandComposer({ draftKey, placeholder: restingPlaceholder, focusedPlaceholder, visible, busy, working, onSend, onStop, onCancel }, forwarded) {
  const [fieldFocused, setFieldFocused] = useState(false);
  const placeholder = fieldFocused && focusedPlaceholder ? focusedPlaceholder : restingPlaceholder;
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Someone on their own Codex or Claude Code gets a fresh answer about it as they start to type.
  const chosenRuntime = useSpectraPreferences().preferences.ai.runtime;
  const ownRuntime = chosenRuntime !== "spectra";
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
    prefill: (next, pointers) => {
      setText(next);
      // An empty list clears the field's work too; a list adds to it.
      if (pointers && !pointers.length) setReferences([]);
      else if (pointers?.length) setReferences((current) => [...current, ...pointers.filter((pointer) => !current.some((existing) => existing.id === pointer.id))]);
      requestAnimationFrame(() => {
        const field = fieldRef.current;
        field?.focus({ preventScroll: true });
        field?.setSelectionRange(next.length, next.length);
      });
    },
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
  const agentLabel = agentIndex === undefined || agentIndex < 0 ? "Auto agent" : agent?.title ?? "Auto agent";

  const sending = useRef(false);
  // Each send turns the prism once: the message has gone to Spectra.
  const [sends, setSends] = useState(0);
  const departs = useCallback(() => !sending.current, []);
  const [heardTrouble, setHeardTrouble] = useState<string | null>(null);
  const dictation = useDictation({ text, onText: setText, onFailure: setHeardTrouble });

  const send = () => {
    dictation.stop();
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
    setSends((count) => count + 1);
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
      className="relative box-border flex w-[min(680px,calc(100vw-var(--spectra-rail-width,0px)-var(--spectra-lead-width,0px)-var(--spectra-side-width,0px)-32px))] flex-col rounded-surface border border-[var(--card-border)] bg-[var(--card-paper)] shadow-[var(--shadow-lg)]"
    >
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
        <AgentSwitch label={agentLabel} agent={agent} agentIndex={agentIndex} agents={agents} sends={sends} working={working} onChoose={setAgentIndex} />
        <div className="relative flex min-w-0 flex-1">
        {!text ? <PlaceholderLine text={placeholder} /> : null}
        <textarea
          ref={fieldRef}
          data-composer-text
          rows={1}
          value={text}
          aria-label="Message Spectra"
          // Read out as the field's hint; the line drawn over it crossfades as it changes.
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setFieldFocused(false)}
          onFocus={() => {
            setFieldFocused(true);
            if (ownRuntime) void recheckAgentRuntimeIfStale().then(() => warmAgentRuntime(chosenRuntime));
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-ui leading-[22px] text-[var(--text-primary)] outline-none placeholder:text-transparent"
        />
        </div>
        <input ref={fileRef} type="file" multiple hidden onChange={(event) => void addFiles(event.target.files).then(() => (event.target.value = ""))} />
        <IconButton
          icon={<Icon name="attach" size={21} />}
          label="Attach files"
          onClick={() => fileRef.current?.click()}
          disabled={attachments.length >= MAX_ATTACHMENTS}
          className="size-10 rounded-full"
        />
        {dictation.available ? (
          <IconButton
            icon={<Icon name="mic" size={21} />}
            label={dictation.listening ? "Stop listening" : "Speak your message"}
            pressed={dictation.listening}
            data-listening={dictation.listening || undefined}
            onClick={() => {
              setHeardTrouble(null);
              dictation.toggle();
            }}
            className="composer-mic size-10 rounded-full"
          />
        ) : null}
        {busy && !text.trim() && onStop ? (
          <IconButton icon={<span className="size-2.5 rounded-sm bg-current" />} label="Stop" onClick={onStop} className="composer-send size-10 rounded-full" />
        ) : (
          <IconButton
            icon="send"
            label="Send"
            shortcut="Enter"
            onClick={send}
            disabled={!text.trim()}
            data-ready={text.trim() ? true : undefined}
            className="composer-send size-10 rounded-full"
          />
        )}
      </div>
      {heardTrouble || dictation.listening ? (
        <p role="status" className="composer-heard">
          {heardTrouble ?? "Listening. Speak, then press the microphone or send."}
        </p>
      ) : null}
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

const AGENTS_SHOWN = 3;

function AgentOption({ item, index }: { item: SpectraInstalledAgent; index: number }) {
  return (
    <DropdownMenuRadioItem value={String(index)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{item.title}</span>
        {item.summary ? <span className="line-clamp-1 text-micro text-[var(--text-tertiary)]">{item.summary}</span> : null}
      </span>
    </DropdownMenuRadioItem>
  );
}

function AgentSwitch({
  label,
  agent,
  agentIndex,
  agents,
  sends,
  working,
  onChoose,
}: {
  label: string;
  working?: boolean;
  agent: SpectraInstalledAgent | null;
  /** Which agent is chosen; below zero (or none) is Auto. */
  agentIndex: number | undefined;
  agents: SpectraInstalledAgent[];
  /** Messages sent so far; each one spins the mark once. */
  sends: number;
  onChoose: (index: number) => void;
}) {
  // Auto is Spectra itself: the live prism, which turns toward the pointer and round once for each message sent.
  const face = agent ? (
    <span key={sends} className="composer-mark grid place-items-center" data-sent={sends ? "" : undefined}>
      <span className="grid size-6 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--accent-cyan)]">
        <Icon name="agent" size={15} />
      </span>
    </span>
  ) : (
    <PrismLoader size={24} optics={working ? "working" : "dormant"} interactive turns={sends} />
  );
  const chosen = agentIndex === undefined || agentIndex < 0 ? "auto" : String(agentIndex);
  // A long list folds; the chosen agent always stays in view.
  const indexed = agents.map((item, index) => ({ item, index }));
  const foldable = indexed.length > AGENTS_SHOWN + 1;
  const shownAgents = foldable ? indexed.filter(({ index }) => index < AGENTS_SHOWN || index === agentIndex) : indexed;
  const foldedAgents = foldable ? indexed.filter((entry) => !shownAgents.includes(entry)) : [];
  // The mark is the switch: pressing it opens the agents to choose from, Auto first.
  return (
    <DropdownMenu>
      <Tooltip label={`${label}. Choose an agent.`}>
        <DropdownMenuTrigger
          data-agent-switch
          data-island-home
          aria-label={`${label}. Choose an agent`}
          className="grid size-9 shrink-0 place-items-center rounded-control outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        >
          {face}
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" layer="toast" className="min-w-[16rem]">
        <DropdownMenuRadioGroup value={chosen} onValueChange={(value) => onChoose(value === "auto" ? -1 : Number(value))}>
          <div className="flex items-center justify-between gap-2">
            <DropdownMenuLabel>Agent</DropdownMenuLabel>
            <DropdownMenuItem asChild className="w-auto gap-1 px-1.5 py-1 text-micro text-[var(--text-secondary)]">
              <Link href="/agents">
                <Icon name="agents" size={12} />
                {agents.length ? "More agents" : "Find or make an agent"}
              </Link>
            </DropdownMenuItem>
          </div>
          <DropdownMenuRadioItem value="auto">
            <span className="min-w-0 flex-1 font-medium">Auto agent</span>
            <span className="text-micro text-[var(--text-tertiary)]">Spectra picks</span>
          </DropdownMenuRadioItem>
          {shownAgents.map(({ item, index }) => (
            <AgentOption key={item.agentId} item={item} index={index} />
          ))}
          {foldedAgents.length ? (
            <DropdownMenuDisclosure label={`${foldedAgents.length} more`}>
              {foldedAgents.map(({ item, index }) => (
                <AgentOption key={item.agentId} item={item} index={index} />
              ))}
            </DropdownMenuDisclosure>
          ) : null}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <RuntimeControls />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The model and how hard it thinks. */
function RuntimeControls() {
  const { preferences, update } = useSpectraPreferences();
  const { status } = useAgentRuntime();
  const ai = preferences.ai;
  const patch = (next: Partial<typeof ai>) => update("ai", next);
  const unavailable = bridgeUnavailableReason(useBridgeAvailability());
  const models = (provider: "codex" | "claude") => status?.[provider]?.models ?? [];
  const chosenModel = ai.runtime === "codex" ? ai.codexModel : ai.runtime === "claude" ? ai.claudeModel : "";
  // With Bridge away a run answers on Spectra's model, so the menu says that. The
  // choice itself is untouched: it applies again as soon as Bridge is back.
  const standingIn = ai.runtime !== "spectra" && Boolean(unavailable);
  const value = ai.runtime === "spectra" || standingIn ? "spectra" : `${ai.runtime}:${chosenModel}`;
  const modelLabel = ai.runtime === "spectra"
    ? "Spectra default"
    : standingIn
      ? "Spectra for now"
      : models(ai.runtime).find((item) => item.id === chosenModel)?.label ?? (chosenModel || "Preferred");
  const choose = (next: string) => {
    if (next === "spectra") return applyRuntimeChoice("spectra", patch);
    const [provider, ...rest] = next.split(":");
    const model = rest.join(":");
    if (provider === "codex") {
      patch({ codexModel: model });
      applyRuntimeChoice("codex", patch);
    } else if (provider === "claude") {
      patch({ claudeModel: model });
      applyRuntimeChoice("claude", patch);
    }
  };
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span className="flex-1">Model</span>
          <span className="max-w-[9rem] truncate text-micro text-[var(--text-tertiary)]">{modelLabel}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent layer="toast">
          <DropdownMenuRadioGroup value={value} onValueChange={choose}>
            {(["codex", "claude"] as const).map((provider) => {
              const entry = status?.[provider];
              const problem = entry ? providerProblem(provider, entry.state) : "Checking this computer…";
              const providerChosen = ai.runtime === provider && !standingIn;
              return (
                <div key={provider} className="mb-1.5 border-b border-[var(--border-subtle)] pb-1.5">
                  {unavailable ? (
                    <>
                      <div className="px-2 pb-1 text-micro font-medium text-[var(--text-tertiary)]">{PROVIDER_LABEL[provider]}</div>
                      <Tooltip label={unavailable} className="flex" side="right">
                        <DropdownMenuItem asChild>
                          <Link href={DEVICES_HREF} className="text-[var(--text-secondary)]">
                            Open Spectra Bridge to use it
                          </Link>
                        </DropdownMenuItem>
                      </Tooltip>
                    </>
                  ) : problem ? (
                    <>
                      <div className="px-2 pb-1 text-micro font-medium text-[var(--text-tertiary)]">{PROVIDER_LABEL[provider]}</div>
                      <p className="px-2 pb-1 text-micro leading-[18px] text-[var(--text-secondary)]">{problem}</p>
                    </>
                  ) : (
                    <DropdownMenuDisclosure
                      heading
                      label={PROVIDER_LABEL[provider]}
                      hint={providerChosen ? modelLabel : "Ready"}
                      defaultOpen={providerChosen}
                    >
                      <DropdownMenuRadioItem value={`${provider}:`}>Preferred</DropdownMenuRadioItem>
                      {entry?.models.map((item) => (
                        <DropdownMenuRadioItem key={item.id} value={`${provider}:${item.id}`}>{item.label}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuDisclosure>
                  )}
                </div>
              );
            })}
            <DropdownMenuRadioItem value="spectra">Spectra default</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-caption" onKeyDown={(event) => event.stopPropagation()}>
        <span className="text-[var(--text-primary)]">Thinking</span>
        <span role="radiogroup" aria-label="Thinking" className="inline-flex rounded-control bg-[var(--bg-secondary)] p-0.5">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={ai.thinking === level}
              onClick={() => patch({ thinking: level })}
              className={cn(
                "rounded-control px-2 py-0.5 text-micro capitalize transition-colors",
                ai.thinking === level ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {level}
            </button>
          ))}
        </span>
      </div>
    </>
  );
}

/** A file or a reference in the message: it forms from where it came (the drop, the pick) and parts when removed. */
function ComposerChip({ id, departs, ...props }: HTMLAttributes<HTMLSpanElement> & { id: string; departs: () => boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLifeArrival(ref, `composer-chip:${id}`, "human", { bars: "span" });
  useLifeDeparture(ref, departs);
  return <span ref={ref} {...props} />;
}

/**
 * The empty field's line (LAUNCH-REVIEW F4). One line is reserved: when it
 * changes, the old words fade out as the new fade in over them, so two are
 * never readable at once.
 */
function PlaceholderLine({ text }: { text: string }) {
  const [lines, setLines] = useState<{ current: string; leaving: string | null }>({ current: text, leaving: null });
  if (lines.current !== text) setLines({ current: text, leaving: lines.current });
  useEffect(() => {
    if (!lines.leaving) return;
    const timer = window.setTimeout(() => setLines((state) => ({ ...state, leaving: null })), 200);
    return () => window.clearTimeout(timer);
  }, [lines.leaving]);
  const line = "pointer-events-none absolute inset-x-0 top-0 truncate px-1.5 py-[7px] text-ui leading-[22px] text-[var(--text-tertiary)]";
  return (
    <span aria-hidden data-composer-placeholder className="contents">
      {lines.leaving ? (
        <span key={`out:${lines.leaving}`} className={cn(line, "island-content-out")}>
          {lines.leaving}
        </span>
      ) : null}
      <span key={`in:${lines.current}`} className={cn(line, lines.leaving && "island-content-in")}>
        {lines.current}
      </span>
    </span>
  );
}
