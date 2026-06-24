"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDown, Check, ChevronDown, CircleDot, ExternalLink, FileText, FolderPlus, Loader2, MessageSquare, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { RichText } from "@/components/chat/rich-text";
import { cn } from "@/lib/utils";
import { useSpectraRun, type SpectraLiveExchange } from "../ai/use-spectra-run";
import { getSpectraThread, getSpectraWorkspaces, postSpectra, type SpectraArtifact, type SpectraThreadDetail, type SpectraThreadTrace, type SpectraWorkspace } from "../data/api";
import { CommandBar } from "./command-bar";
import { ResultCardStack } from "./result-card";

function operationLabel(type: string) {
  if (type === "artifact.create") return "Created artifact";
  if (type === "artifact.update") return "Updated artifact";
  if (type === "workspaceItem.add") return "Added to workspace";
  if (type === "workspaceItem.hide") return "Removed workspace placement";
  if (type === "workspace.create") return "Created workspace";
  return type;
}

function messageAttachments(message: SpectraThreadDetail["messages"][number]) {
  const rows = message.metadata?.attachments;
  return Array.isArray(rows) ? rows.filter((row): row is { name: string; size?: number; handling?: string } => Boolean(row) && typeof row === "object" && typeof (row as { name?: unknown }).name === "string") : [];
}

export type ConversationChoice = { title: string; description?: string | null };

function messageChoices(message: SpectraThreadDetail["messages"][number]) {
  const value = message.metadata?.choices;
  if (!value || typeof value !== "object") return null;
  const row = value as { question?: unknown; options?: unknown };
  if (typeof row.question !== "string" || !Array.isArray(row.options) || row.options.length < 2 || row.options.length > 4) return null;
  const options = row.options.flatMap((option): ConversationChoice[] => option && typeof option === "object" && typeof (option as { title?: unknown }).title === "string" ? [{ title: (option as { title: string }).title, description: typeof (option as { description?: unknown }).description === "string" ? (option as { description: string }).description : null }] : []);
  return options.length >= 2 ? { question: row.question, options } : null;
}

function ChoiceBlock({ question, options, onChoose }: { question: string; options: ConversationChoice[]; onChoose?: (choice: ConversationChoice) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="mt-4 overflow-hidden rounded-[11px] border border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] p-3" data-conversation-action="choice"><div className="mb-2 text-[12px] font-semibold text-[var(--text-primary)]">{question}</div><div className={`grid gap-2 ${options.length === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>{options.map((option, index) => <button key={`${option.title}:${index}`} type="button" disabled={Boolean(selected)} onClick={() => { setSelected(option.title); onChoose?.(option); }} className={`group rounded-[9px] border px-3 py-2.5 text-left transition ${selected === option.title ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-primary))]" : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] hover:shadow-[0_5px_18px_rgba(27,20,12,0.06)] disabled:opacity-55"}`}><span className="block text-[12px] font-semibold text-[var(--text-primary)]">{option.title}</span>{option.description ? <span className="mt-1 block text-[11px] leading-4 text-[var(--text-secondary)]">{option.description}</span> : null}</button>)}</div></section>;
}

function OperationalTrace({ trace }: { trace: SpectraThreadTrace }) {
  const [open, setOpen] = useState(trace.run.status === "awaiting_confirmation" || trace.run.status === "failed");
  const failed = trace.run.status === "failed";
  return (
    <div className="mt-4 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-hover)]">
        {failed ? <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" /> : trace.run.status === "awaiting_confirmation" ? <ShieldCheck className="h-3.5 w-3.5 text-amber-600" /> : <Wrench className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />}
        <span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          {trace.operations.length === 0 ? trace.run.status.replaceAll("_", " ") : `${trace.operations.length} ${trace.operations.length === 1 ? "action" : "actions"}`}
          <span className="ml-2 font-normal capitalize text-[var(--text-tertiary)]">{trace.run.status.replaceAll("_", " ")}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-[var(--text-tertiary)] transition", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
        {trace.operations.length === 0 ? <p className="text-[11px] text-[var(--text-tertiary)]">{trace.run.error ?? "No changes were applied."}</p> : (
          <div className="space-y-2">
            {trace.operations.map((operation) => <div key={operation._id} className="rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_58%,transparent)] px-2.5 py-2"><div className="flex items-center gap-2 text-[11px]">
              {operation.status === "executed" ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : operation.status === "failed" ? <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" /> : <CircleDot className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
              <span className="font-medium text-[var(--text-primary)]">{operationLabel(operation.type)}</span>
              <span className="capitalize text-[var(--text-tertiary)]">{operation.status}</span>
              {operation.affected.length > 0 ? <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{operation.affected.length} affected</span> : null}
            </div>{operation.output !== undefined ? <div className="mt-1.5 line-clamp-3 break-words pl-5 text-[10px] leading-4 text-[var(--text-tertiary)]">{typeof operation.output === "string" ? operation.output : JSON.stringify(operation.output)}</div> : null}</div>)}
          </div>
        )}
      </div> : null}
    </div>
  );
}

function ProviderThinking({ content, active }: { content: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); else if (content) setOpen(false); }, [active, content]);
  if (!content.trim()) return null;
  const chunks = content.trim().split(/\n{2,}/).filter(Boolean);
  return <div className="mb-3 overflow-hidden rounded-[9px] border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)]" data-run-state={active ? "thinking" : "thought"}><button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Sparkles className={`h-3.5 w-3.5 text-[var(--accent-cyan)] ${active ? "animate-pulse" : ""}`} /><span className="flex-1">{active ? "Thinking" : "Thinking trace"}</span><ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} /></button>{open ? <div className="space-y-2 border-t border-[var(--border-subtle)] px-3 py-2.5 text-[11px] leading-5 text-[var(--text-secondary)]">{chunks.slice(0, 12).map((chunk, index) => <p key={`${index}:${chunk.slice(0, 24)}`}>{chunk}</p>)}</div> : null}</div>;
}

function ArtifactResult({ artifact, workspaces, onOpen }: { artifact: SpectraArtifact; workspaces: SpectraWorkspace[]; onOpen?: (id: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-4 border-l-2 border-[#d88922] bg-[color-mix(in_oklab,#d88922_5%,var(--bg-elevated))] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] text-[#d88922]"><FileText className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-[var(--text-primary)]">{artifact.title}</div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{artifact.summary ?? artifact.blueprintKey.replaceAll("_", " ")}</div>
        </div>
        <button type="button" onClick={() => onOpen?.(artifact._id)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" aria-label="Open artifact" title="Open artifact"><ExternalLink className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setChoosing((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" aria-label="Add to workspace" title="Add to workspace"><FolderPlus className="h-3.5 w-3.5" /></button>
      </div>
      {choosing ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] pt-3">
        {workspaces.map((workspace) => <button key={workspace._id} type="button" disabled={busy} onClick={() => {
          setBusy(true);
          void postSpectra({ action: "addArtifactToWorkspace", artifactId: artifact._id, workspaceId: workspace._id })
            .then(() => { toast.success(`Added to ${workspace.title}`); setChoosing(false); })
            .catch((error) => toast.error(error instanceof Error ? error.message : "Could not add artifact."))
            .finally(() => setBusy(false));
        }} className="rounded-[6px] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">{workspace.title}</button>)}
        {workspaces.length === 0 ? <span className="text-[11px] text-[var(--text-tertiary)]">Create a workspace first.</span> : null}
      </div> : null}
    </div>
  );
}

export function ConversationSurface({
  detail,
  loading = false,
  empty,
  composer,
  activeCards,
  onCardOpen,
  onCardAction,
  workspaces = [],
  onOpenArtifact,
  compact = false,
  liveExchange,
  onChoice,
}: {
  detail: SpectraThreadDetail | null;
  loading?: boolean;
  empty?: ReactNode;
  composer?: ReactNode;
  activeCards?: Parameters<typeof ResultCardStack>[0]["cards"];
  onCardOpen?: Parameters<typeof ResultCardStack>[0]["onOpen"];
  onCardAction?: Parameters<typeof ResultCardStack>[0]["onAction"];
  workspaces?: SpectraWorkspace[];
  onOpenArtifact?: (artifactId: string) => void;
  compact?: boolean;
  liveExchange?: SpectraLiveExchange | null;
  onChoice?: (choice: ConversationChoice) => void;
}) {
  const traceByRun = useMemo(() => new Map((detail?.traces ?? []).map((trace) => [trace.run._id, trace])), [detail]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const persistedUserRunIds = useMemo(() => new Set(detail?.messages.flatMap((message) => message.role === "user" && message.runId ? [message.runId] : []) ?? []), [detail]);
  const persistedAssistantRunIds = useMemo(() => new Set(detail?.messages.flatMap((message) => message.role === "assistant" && message.runId ? [message.runId] : []) ?? []), [detail]);
  const unresolvedTraces = useMemo(() => (detail?.traces ?? []).filter((trace) => !persistedAssistantRunIds.has(trace.run._id) && trace.run.status !== "completed"), [detail, persistedAssistantRunIds]);
  useEffect(() => {
    if (!following) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: liveExchange?.content ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [detail?.messages.length, following, liveExchange?.content]);
  useEffect(() => setFollowing(true), [detail?.thread._id]);
  const messageMeta = useCallback((message: NonNullable<SpectraThreadDetail>["messages"][number]) => {
    return [
      message.role === "user" ? detail?.viewerName ?? "You" : "Spectra",
      new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(message.createdAt),
    ].filter(Boolean).join(" · ");
  }, [detail?.viewerName]);
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div ref={scrollRef} onScroll={(event) => {
        const element = event.currentTarget;
        setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 72);
      }} className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "px-5 pb-32 pt-5" : "px-5 pb-40 pt-10 sm:px-8")}>
        <div className={cn("mx-auto", compact ? "max-w-[760px]" : "max-w-[820px]")}>
          {loading ? <div className="space-y-8 py-10" aria-label="Loading conversation"><div className="ml-auto h-16 w-[58%] animate-pulse rounded-[16px] bg-[var(--bg-secondary)]" /><div className="space-y-3"><div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-secondary)]" /><div className="h-3 w-full animate-pulse rounded bg-[var(--bg-secondary)]" /><div className="h-3 w-[72%] animate-pulse rounded bg-[var(--bg-secondary)]" /></div></div> : null}
          {!loading && !detail ? empty : null}
          {detail?.messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => {
            const trace = message.runId ? traceByRun.get(message.runId) : undefined;
            return <article key={message._id} className={cn("group relative", compact ? "mb-7" : "mb-10")}>
              {message.role === "user" ? (
                <div className="ml-auto max-w-[82%]"><div className="rounded-[18px_18px_5px_18px] border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-[13px] leading-6 text-[var(--text-primary)]">{message.content}{messageAttachments(message).length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">{messageAttachments(message).map((attachment) => <span key={`${attachment.name}:${attachment.size ?? 0}`} className="flex max-w-[220px] items-center gap-1.5 rounded-[7px] bg-[color-mix(in_oklab,var(--bg-primary)_72%,transparent)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{attachment.name}</span></span>)}</div> : null}</div><div className="mt-1.5 text-right text-[10px] text-[var(--text-tertiary)]">{messageMeta(message)}</div></div>
              ) : (
                <div className="relative pl-7">
                  <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]" />
                  <RichText content={message.content} className={cn("text-[14px] leading-7 text-[var(--text-primary)]", !compact && "sm:text-[15px]")} />
                  {messageChoices(message) ? <ChoiceBlock {...messageChoices(message)!} onChoose={onChoice} /> : null}
                  <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">{messageMeta(message)}</div>
                  {trace && (trace.operations.length > 0 || ["failed", "cancelled", "awaiting_confirmation"].includes(trace.run.status)) ? <OperationalTrace trace={trace} /> : null}
                  {trace?.artifacts.map((artifact) => <ArtifactResult key={artifact._id} artifact={artifact} workspaces={workspaces} onOpen={onOpenArtifact} />)}
                </div>
              )}
            </article>;
          })}
          {liveExchange ? <>
            {!liveExchange.runId || !persistedUserRunIds.has(liveExchange.runId) ? <article className={cn("relative", compact ? "mb-7" : "mb-10")}><div className="ml-auto max-w-[82%]"><div className="rounded-[18px_18px_5px_18px] border border-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-elevated))] px-4 py-3 text-[13px] leading-6 text-[var(--text-primary)]">{liveExchange.prompt}</div><div className="mt-1.5 text-right text-[10px] text-[var(--text-tertiary)]">Sending now</div></div></article> : null}
            {!liveExchange.runId || !persistedAssistantRunIds.has(liveExchange.runId) ? <article className={cn("relative", compact ? "mb-7" : "mb-10")}><div className="relative pl-7"><span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]" /><ProviderThinking content={liveExchange.reasoning} active={!liveExchange.content && liveExchange.status === "streaming"} />{liveExchange.content ? <RichText content={liveExchange.content} className={cn("text-[14px] leading-7 text-[var(--text-primary)]", !compact && "sm:text-[15px]")} /> : <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--text-tertiary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Preparing response</div>}<div className="mt-2 text-[10px] text-[var(--text-tertiary)]">{liveExchange.status === "streaming" ? "Responding" : liveExchange.status}</div></div></article> : null}
          </> : null}
          {!liveExchange ? unresolvedTraces.map((trace) => <div key={trace.run._id} className="mb-7 ml-7 rounded-[9px] bg-[var(--bg-secondary)] px-3.5 py-3"><div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">{trace.run.status === "running" || trace.run.status === "queued" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" /> : <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />}<span className="capitalize">{trace.run.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-[10px] leading-4 text-[var(--text-tertiary)]">{trace.run.status === "running" ? "This response was still in progress when the page reloaded. Its final message will appear only after completion." : trace.run.error ?? "No incomplete assistant message was saved."}</p>{trace.operations.length > 0 || ["failed", "cancelled", "awaiting_confirmation"].includes(trace.run.status) ? <OperationalTrace trace={trace} /> : null}</div>) : null}
          {activeCards?.length ? <ResultCardStack cards={activeCards.slice(0, 2)} className="mt-5" onOpen={onCardOpen} onAction={onCardAction} /> : null}
        </div>
      </div>
      {!following ? <button type="button" onClick={() => { setFollowing(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }} className="absolute bottom-28 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 text-[11px] font-medium text-[var(--text-secondary)] shadow-[0_8px_24px_rgba(27,20,12,0.12)] hover:text-[var(--text-primary)]"><ArrowDown className="h-3.5 w-3.5" />Latest</button> : null}
      {composer ? <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,var(--bg-primary)_76%,transparent)] px-4 pb-5 pt-14 sm:px-8"><div className={cn("pointer-events-auto mx-auto", compact ? "max-w-[760px]" : "max-w-[820px]")}>{composer}</div></div> : null}
    </div>
  );
}

export function ThreadConversation({ threadId, compact = false, showComposer = true, onOpenArtifact }: { threadId: string; compact?: boolean; showComposer?: boolean; onOpenArtifact?: (artifactId: string) => void }) {
  const [detail, setDetail] = useState<SpectraThreadDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const [thread, workspaceRows] = await Promise.all([getSpectraThread(threadId), getSpectraWorkspaces()]);
    setDetail(thread);
    setWorkspaces(workspaceRows);
  }, [threadId]);
  useEffect(() => { setLoading(true); void refresh().catch((error) => toast.error(error instanceof Error ? error.message : "Could not load thread.")).finally(() => setLoading(false)); }, [refresh]);
  const runEngine = useSpectraRun({ surface: "chat", threadId, onDataChanged: refresh, onOpenArtifact });
  return <ConversationSurface detail={detail} loading={loading} compact={compact} liveExchange={runEngine.liveExchange} workspaces={workspaces} onOpenArtifact={onOpenArtifact} onChoice={(choice) => void runEngine.run(choice.description ? `${choice.title}: ${choice.description}` : choice.title)} activeCards={runEngine.cards.filter((card) => card.status !== "completed")} onCardAction={(card, action, target) => void runEngine.onCardAction(card, action, target)} composer={showComposer ? <CommandBar placeholder="Continue this thread…" busy={runEngine.submitting} allowConcurrent allowAttachments onStop={runEngine.stop} onSubmit={(value, attachments) => { void runEngine.run(value, attachments); return true; }} context={<span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"><MessageSquare className="h-3.5 w-3.5" />Thread</span>} /> : undefined} />;
}
