"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import { usePathname, useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFollowAi } from "../collaboration/follow-ai";
import { appSurfaceFromPathname } from "../collaboration/app-choreography";
import { spectraBus } from "../events";
import { useSpectraPreferences } from "../settings/preference-store";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import {
  APP_COMMANDS,
  buildKBarEntries,
  commandContextForKBar,
  KBAR_SEMANTIC_KINDS,
  mergeKBarResults,
  searchKBarWorkspaces,
  semanticKBarResults,
  type KBarSearchResult,
  type KBarContext,
  type KBarEntry,
} from "../commands";
import { postSpectra } from "../data/api";
import { useSemanticSearch } from "../semantic/use-semantic";
import { requestViewportAction, type ViewportView } from "../viewport-readiness";

function routeTarget(href: string): { view: ViewportView; targetId: string } {
  const url = new URL(href, "http://spectra.local");
  if (url.pathname.startsWith("/chat")) {
    return { view: "conversation", targetId: url.searchParams.get("threadId") ?? "chat" };
  }
  if (url.pathname.startsWith("/settings")) {
    return { view: "settings", targetId: url.searchParams.get("section") ?? "settings" };
  }
  if (url.pathname.startsWith("/calendar")) return { view: "calendar", targetId: "calendar" };
  if (url.pathname.startsWith("/workspace")) {
    return { view: "workspace", targetId: url.pathname.split("/")[2] ?? "workspace" };
  }
  if (url.pathname.startsWith("/library")) {
    const artifactId = url.pathname.split("/")[2];
    return artifactId
      ? { view: "artifact", targetId: decodeURIComponent(artifactId) }
      : { view: "library", targetId: "library" };
  }
  return { view: appSurfaceFromPathname(url.pathname) as ViewportView, targetId: url.pathname };
}

function commandFailureMessage(error: unknown, label: string) {
  const raw = error instanceof Error ? error.message : "";
  if (raw.startsWith("APPLICATION_COMMAND_INVALID_PARAMS"))
    return `${label} needs one more valid detail.`;
  if (raw.startsWith("APPLICATION_COMMAND_HANDLER_UNAVAILABLE"))
    return `${label} is not available on this surface yet.`;
  if (raw.includes("TARGET_NOT_FOUND") || raw === "RUN_THREAD_NOT_FOUND")
    return "That item is no longer available.";
  if (raw.includes("could not") || raw.includes("Could not")) return raw;
  return `${label} could not be completed. Try again when the target surface is ready.`;
}

function initialContext(pathname: string, searchParams: URLSearchParams, activeRunIds: readonly string[], followingAi: boolean, continueCurrentConversation: boolean, mountedArtifactId?: string, mountedArtifactType?: string): KBarContext {
  const segments = pathname.split("/").filter(Boolean);
  const idAfter = (prefix: string) => pathname.startsWith(`/${prefix}/`) ? decodeURIComponent(segments[1] ?? "") : undefined;
  const activeArtifactId = searchParams.get("artifactId") ?? idAfter("library") ?? idAfter("artifacts") ?? mountedArtifactId;
  return {
    pathname,
    activeArtifactId,
    ...(activeArtifactId && activeArtifactId === mountedArtifactId && mountedArtifactType
      ? { activeArtifactType: mountedArtifactType as KBarContext["activeArtifactType"] }
      : {}),
    activeWorkspaceId: searchParams.get("workspaceId") ?? idAfter("workspace"),
    activeThreadId: searchParams.get("threadId") ?? undefined,
    activeRunIds,
    followingAi,
    continueCurrentConversation,
  };
}

export function UniversalKBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { following } = useFollowAi();
  const { preferences, replace: replacePreferences } = useSpectraPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [workspaceResults, setWorkspaceResults] = useState<KBarSearchResult[]>([]);
  const [searchingWorkspaces, setSearchingWorkspaces] = useState(false);
  const [selected, setSelected] = useState(0);
  const [parametersFor, setParametersFor] = useState<KBarEntry | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [confirming, setConfirming] = useState<KBarEntry | null>(null);
  const [running, setRunning] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [activeRunIds, setActiveRunIds] = useState<readonly string[]>(
    () => spectraBus.getQuery("run.active")?.runIds ?? [],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => spectraBus.subscribe("run.active", ({ runIds }) => {
    setActiveRunIds(runIds);
  }), []);

  const mountedStudio = open && typeof document !== "undefined"
    ? document.querySelector<HTMLElement>("[data-spectra-studio]")
    : null;
  const mountedArtifactId = mountedStudio?.dataset.spectraStudio;
  const mountedArtifactType = mountedStudio?.dataset.spectraType;
  const context = useMemo(
    () => initialContext(
      pathname,
      new URLSearchParams(searchParams.toString()),
      activeRunIds,
      following,
      preferences.ai.continueCurrentConversation,
      mountedArtifactId,
      mountedArtifactType,
    ),
    [activeRunIds, following, mountedArtifactId, mountedArtifactType, pathname, preferences.ai.continueCurrentConversation, searchParams],
  );
  const readCurrentContext = useCallback(() => {
    const currentStudio = document.querySelector<HTMLElement>("[data-spectra-studio]");
    return initialContext(
      window.location.pathname,
      new URLSearchParams(window.location.search),
      spectraBus.getQuery("run.active")?.runIds ?? activeRunIds,
      following,
      preferences.ai.continueCurrentConversation,
      currentStudio?.dataset.spectraStudio,
      currentStudio?.dataset.spectraType,
    );
  }, [activeRunIds, following, preferences.ai.continueCurrentConversation]);

  const openKBar = useCallback(() => {
    setOpen(true);
    setParametersFor(null);
    setConfirming(null);
    setResultMessage(null);
    setQuery("");
    setSelected(0);
  }, []);

  const closeKBar = useCallback(() => {
    searchAbortRef.current?.abort();
    setOpen(false);
    setParametersFor(null);
    setConfirming(null);
    setRunning(false);
  }, []);

  useEffect(
    () => spectraBus.on("shell.openCommandBar", openKBar),
    [openKBar],
  );

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      if (!open) openKBar();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [open, openKBar]);

  // The search box takes focus for the list only. A parameter step focuses its
  // own first field (autoFocus); refocusing the read-only search box here took
  // the cursor away from the value the command had just asked for.
  useEffect(() => {
    if (!open || parametersFor) return;
    inputRef.current?.focus();
  }, [open, parametersFor, confirming]);

  useEffect(() => {
    if (!open || parametersFor || confirming) return;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      const trimmed = query.trim();
      if (!trimmed) {
        setWorkspaceResults([]);
        setSearchingWorkspaces(false);
        return;
      }
      setSearchingWorkspaces(true);
      void searchKBarWorkspaces(trimmed, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            setWorkspaceResults(next);
            setSelected(0);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setWorkspaceResults([]);
            setResultMessage(error instanceof Error ? error.message : "Search could not be completed.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingWorkspaces(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [confirming, open, parametersFor, query]);

  // Work and chats come from the semantic layer, by meaning and words; what is open ranks first.
  const semantic = useSemanticSearch(query, {
    kinds: [...KBAR_SEMANTIC_KINDS],
    limit: 20,
    enabled: open && !parametersFor && !confirming,
    openItemIds: [context.activeArtifactId, context.activeThreadId].filter((id): id is string => Boolean(id)),
  });
  const results = useMemo(
    () => mergeKBarResults(semanticKBarResults(semantic.results), workspaceResults),
    [semantic.results, workspaceResults],
  );
  const searching = searchingWorkspaces || (semantic.status === "loading" && !semantic.results.length);
  const entries = useMemo(
    () => buildKBarEntries(APP_COMMANDS, context, query, results),
    [context, query, results],
  );

  const openRoute = useCallback((href: string) => {
    const target = routeTarget(href);
    return requestViewportAction({
      ...target,
      navigate: () => { router.push(href); },
    });
  }, [router]);

  const openArtifact = useCallback((artifactId: string, surface?: "full" | "panel" | "tile") => {
    return requestViewportAction({
      targetId: artifactId,
      view: "artifact",
      navigate: async () => {
        const listeners = await spectraBus.commandAsync("work.open", {
          workId: artifactId,
          surface: surface ?? "panel",
        });
        if (listeners === 0) {
          // Agent Library and other full-page surfaces own their studio
          // locally; use the canonical Library route when no panel host is
          // mounted rather than inventing a second preview surface.
          router.push(`/library/${encodeURIComponent(artifactId)}`);
        }
      },
    });
  }, [router]);

  const navigate = useCallback((destination: "library" | "calendar" | "settings" | "workspace", targetId?: string) => {
    const href = destination === "library"
      ? targetId ? `/library/${encodeURIComponent(targetId)}` : "/library"
      : destination === "workspace"
        ? targetId ? `/workspace/${encodeURIComponent(targetId)}` : "/workspace?home=1"
        : destination === "settings"
          ? targetId ? `/settings?section=${encodeURIComponent(targetId)}` : "/settings"
          : "/calendar";
    return openRoute(href);
  }, [openRoute]);

  const dispatch = useMemo(() => createApplicationCommandDispatcher({
    openArtifact,
    navigate,
    openRoute,
    openThread: (threadId) => openRoute(`/chat?threadId=${encodeURIComponent(threadId)}`),
    addComment: ({ artifactId, body, regionId }) => postSpectra({
      action: "createArtifactComment",
      artifactId,
      commentBody: body,
      regionId: regionId ?? "artifact:structure",
      fallbackExcerpt: regionId ?? "artifact structure",
    }),
    preferences,
    replacePreferences,
  }), [navigate, openArtifact, openRoute, preferences, replacePreferences]);
  const commandContext = useMemo(() => commandContextForKBar(context, dispatch), [context, dispatch]);

  const executeEntry = useCallback(async (entry: KBarEntry, params: Record<string, unknown>) => {
    setRunning(true);
    setResultMessage(null);
    try {
      const currentContext = readCurrentContext();
      let currentTarget: string | undefined;
      let targetField: "artifactId" | "threadId" | "runId" | undefined;
      if (entry.command.id === "app.comments.open" || entry.command.id === "app.comments.add") {
        targetField = "artifactId";
        currentTarget = currentContext.activeArtifactId;
      } else if (entry.command.id === "app.chat.continue") {
        targetField = "threadId";
        currentTarget = currentContext.activeThreadId;
      } else if (entry.command.id === "app.run.stop") {
        targetField = "runId";
        currentTarget = currentContext.activeRunIds[0];
      }
      if (targetField) {
        const rankedTarget = params[targetField];
        if (!currentTarget || rankedTarget !== currentTarget) {
          setResultMessage("The active target changed. Close this command and open it again for the current work.");
          return;
        }
        params = { ...params, [targetField]: currentTarget };
      }
      const currentCommandContext = commandContextForKBar(currentContext, dispatch);
      const value = await entry.command.execute(currentCommandContext, params);
      if (value === false) {
        setResultMessage("No changes were made.");
        return;
      }
      if (value && typeof value === "object" && value.status !== "completed") {
        setResultMessage(value.message);
        return;
      }
      const message = value && typeof value === "object"
        ? value.message
        : `${entry.label} completed.`;
      const effect = value && typeof value === "object"
        ? value.effect
        : entry.command.effect?.kind;
      setResultMessage(message);
      setParametersFor(null);
      setConfirming(null);
      closeKBar();
      // The bar closes on success, so its status line is never read. A
      // change with nothing new on screen (a setting, a saved edit) says what
      // happened in a toast; navigation and opening show their own result.
      if (effect === "toggle" || effect === "mutate") toast.success(message);
    } catch (error) {
      setResultMessage(commandFailureMessage(error, entry.label));
    } finally {
      setRunning(false);
    }
  }, [closeKBar, dispatch, readCurrentContext]);

  const startEntry = useCallback((entry: KBarEntry) => {
    const availability = entry.command.availability(commandContext);
    if (availability.state !== "enabled") {
      setResultMessage(availability.state === "disabled" ? availability.reason : "This action is not available here.");
      return;
    }
    const seeded = { ...(entry.params ?? {}) };
    const missing = (entry.command.parameters ?? []).find((parameter) =>
      parameter.required && (seeded[parameter.name] === undefined || seeded[parameter.name] === ""),
    );
    if (missing) {
      setDraft(seeded);
      setParametersFor(entry);
      setResultMessage(null);
      return;
    }
    if (entry.command.effect?.confirmation && entry.command.effect.confirmation !== "none") {
      setConfirming(entry);
      setDraft(seeded);
      setResultMessage(null);
      return;
    }
    void executeEntry(entry, seeded);
  }, [commandContext, executeEntry]);

  const submitParameters = useCallback((event: FormEvent) => {
    event.preventDefault();
    if (!parametersFor) return;
    const missing = (parametersFor.command.parameters ?? []).find((parameter) =>
      parameter.required && (draft[parameter.name] === undefined || draft[parameter.name] === ""),
    );
    if (missing) {
      setResultMessage(`${missing.label} is required.`);
      return;
    }
    if (parametersFor.command.effect?.confirmation && parametersFor.command.effect.confirmation !== "none") {
      setConfirming(parametersFor);
      return;
    }
    void executeEntry(parametersFor, draft);
  }, [draft, executeEntry, parametersFor]);

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys from a portalled list (an open Select) bubble through React but
    // belong to that list: its Escape closes the list, not this step.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (parametersFor || confirming || !entries.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) => (value + 1) % entries.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => (value - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      startEntry(entries[selected] ?? entries[0]!);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeKBar();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        hideCloseButton
        onKeyDown={onDialogKeyDown}
        onEscapeKeyDown={(event) => {
          // Escape steps back one level; only the list closes the bar.
          if (confirming) setConfirming(null);
          else if (parametersFor) setParametersFor(null);
          else return;
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className="top-[12vh] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Spectra command bar</DialogTitle>
        <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={parametersFor || confirming ? "" : query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResultMessage(null);
            }}
            placeholder={parametersFor ? "Enter a value…" : confirming ? "Review this action" : "Search commands, work, workspaces, conversations…"}
            readOnly={Boolean(parametersFor || confirming)}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-body outline-none ring-0 placeholder:text-[var(--text-tertiary)] focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none"
          />
          <button type="button" aria-label="Close command bar" onClick={closeKBar} className="rounded-chip p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        {parametersFor ? (
          <form onSubmit={submitParameters} className="space-y-4 p-4">
            <div>
              <p className="text-caption font-semibold text-[var(--text-primary)]">{parametersFor.label}</p>
              <p className="mt-1 text-caption text-[var(--text-secondary)]">{parametersFor.description}</p>
            </div>
            {(parametersFor.command.parameters ?? []).map((parameter) => {
              const value = draft[parameter.name];
              if (parameter.kind === "toggle") {
                return <label key={parameter.name} className="flex items-center justify-between rounded-chip border border-[var(--border-default)] px-3 py-3 text-caption">
                  <span>{parameter.label}</span>
                  <input type="checkbox" checked={value === true} onChange={(event) => setDraft((current) => ({ ...current, [parameter.name]: event.target.checked }))} />
                </label>;
              }
              if (parameter.kind === "select" && parameter.options?.length) {
                return <SelectField
                  key={parameter.name}
                  label={parameter.label}
                  value={typeof value === "string" ? value : ""}
                  onChange={(next) => setDraft((current) => ({ ...current, [parameter.name]: next }))}
                  options={parameter.options}
                  placeholder="Choose…"
                />;
              }
              const multiline = parameter.kind === "textarea";
              return <label key={parameter.name} className="block space-y-1 text-caption font-medium">
                {parameter.label}
                {multiline ? <textarea autoFocus value={typeof value === "string" ? value : ""} onChange={(event) => setDraft((current) => ({ ...current, [parameter.name]: event.target.value }))} placeholder={parameter.placeholder} rows={5} className="w-full resize-y rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-body font-normal outline-none focus:border-[var(--accent-primary)]" /> : <input autoFocus value={typeof value === "string" ? value : ""} onChange={(event) => setDraft((current) => ({ ...current, [parameter.name]: event.target.value }))} placeholder={parameter.placeholder} className="w-full rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-body font-normal outline-none focus:border-[var(--accent-primary)]" />}
              </label>;
            })}
            {resultMessage ? <p role="status" className="text-caption text-[var(--text-secondary)]">{resultMessage}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setParametersFor(null)}>Back</Button>
              <Button type="submit" variant="primary" size="sm" disabled={running}>{running ? "Running…" : "Continue"}</Button>
            </div>
          </form>
        ) : confirming ? (
          <div className="space-y-4 p-4">
            <div>
              <p className="text-caption font-semibold text-[var(--text-primary)]">Confirm {confirming.label}</p>
              <p className="mt-1 text-caption text-[var(--text-secondary)]">{confirming.command.effect?.outcome ?? confirming.description}</p>
            </div>
            {resultMessage ? <p role="status" className="text-caption text-[var(--text-secondary)]">{resultMessage}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button type="button" variant="primary" size="sm" disabled={running} onClick={() => void executeEntry(confirming, draft)}>{running ? "Running…" : "Confirm"}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-h-[min(60vh,520px)] overflow-y-auto p-2">
              {searching ? <p className="px-3 py-4 text-caption text-[var(--text-tertiary)]">Searching…</p> : null}
              {semantic.degraded && semantic.degraded !== "index_partial" && query.trim() ? <p role="status" className="px-3 py-1 text-caption text-[var(--text-tertiary)]">Matching exact words only right now.</p> : null}
              {!searching && !entries.length ? <p className="px-3 py-8 text-center text-caption text-[var(--text-tertiary)]">Nothing matches “{query.trim()}”.</p> : null}
              {entries.map((entry, index) => (
                <button
                  type="button"
                  key={entry.id}
                  aria-label={entry.label}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => startEntry(entry)}
                  className={cn("flex w-full items-start gap-3 rounded-chip px-3 py-2.5 text-left transition-colors", index === selected ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]")}
                >
                  <entry.command.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-caption font-semibold text-[var(--text-primary)]">
                      {entry.label}
                      {entry.contextLabel ? <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-tertiary)]">{entry.contextLabel}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-micro text-[var(--text-secondary)]">{entry.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-default)] px-4 py-2 text-micro text-[var(--text-tertiary)]">
              <span>↑↓ navigate · Enter open · Esc close</span>
              {resultMessage ? <span role="status" className="max-w-[55%] truncate text-[var(--text-secondary)]">{resultMessage}</span> : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
