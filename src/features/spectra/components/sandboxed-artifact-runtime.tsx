"use client";

import { Loader2, RotateCw, ShieldCheck, AlertTriangle } from "@/components/icons/glyph-icons";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildSpectraSandboxDocument,
  isSpectraSandboxFrameMessage,
  SPECTRA_EMBED_BUDGETS,
  type SpectraSandboxFile,
  type SpectraSandboxFrameMessage,
  type SpectraSandboxAsset,
  type SpectraSandboxTest,
  isBenignRuntimeError,
} from "../embed/sandbox-protocol";
import { readSpectraSandboxTheme } from "../embed/theme-tokens";

export type SpectraRuntimeStatus = "loading" | "ready" | "error" | "limited";
const EMPTY_NETWORK_ALLOWLIST: string[] = [];

export function SandboxedArtifactRuntime({
  title,
  description,
  files,
  tests,
  assets,
  compact,
  toolbar = true,
  chromeless = false,
  viewportHeight,
  className = "",
  onEvent,
  onStatusChange,
  resources,
  parameters,
  exportRequest,
  forceReducedMotion = false,
  networkAllowlist,
}: {
  title: string;
  description?: string;
  files: SpectraSandboxFile[];
  tests?: SpectraSandboxTest[];
  assets?: SpectraSandboxAsset[];
  compact: boolean;
  toolbar?: boolean;
  /** No card of its own: it sits straight on the page (thread embeds). */
  chromeless?: boolean;
  viewportHeight?: number;
  className?: string;
  onEvent?: (event: SpectraSandboxFrameMessage) => void;
  onStatusChange?: (
    status: SpectraRuntimeStatus,
    message: string | null,
    diagnostics: string[],
  ) => void;
  resources?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
  exportRequest?: { id: string; format: "svg" | "png" | "webm" } | null;
  forceReducedMotion?: boolean;
  networkAllowlist?: string[];
}) {
  const stableId = useId().replaceAll(":", "");
  const descriptionId = description
    ? `spectra-runtime-${stableId}-description`
    : undefined;
  const approvedNetworkOrigins = networkAllowlist ?? EMPTY_NETWORK_ALLOWLIST;
  const [clientMounted, setClientMounted] = useState(false);
  const [generation, setGeneration] = useState(0);
  const channel = `spectra-${stableId}-${generation}`;
  // Frames on screen: the one showing, plus the next build loading behind it.
  // A new version is swapped in only once it says it is ready, so changes
  // (code streaming in, an edit, a refetch) never flash back to loading.
  const [frames, setFrames] = useState<Array<{ key: number; srcDoc: string; ready: boolean }>>([]);
  const frameKey = useRef(0);
  const frameEls = useRef(new Map<number, HTMLIFrameElement>());
  const [status, setStatus] = useState<SpectraRuntimeStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [height, setHeight] = useState(viewportHeight ?? (compact ? 220 : 420));
  // The frame shares the page's colour scheme, so its transparent paper shows the page behind it.
  const [scheme, setScheme] = useState(() => readSpectraSandboxTheme().theme);
  const growthRef = useRef({ last: 0, step: 0, repeats: 0 });
  const onEventRef = useRef(onEvent);
  const onStatusChangeRef = useRef(onStatusChange);
  const safeResources = useMemo(() => {
    if (!resources) return {};
    try {
      const encoded = JSON.stringify(resources);
      if (encoded.length > 220_000) return {};
      return JSON.parse(encoded) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [resources]);
  const safeParameters = useMemo(() => {
    if (!parameters) return {};
    const entries = Object.entries(parameters).slice(0, 80);
    const bounded = Object.fromEntries(
      entries
        .filter(([, value]) =>
          ["string", "number", "boolean"].includes(typeof value),
        )
        .map(([key, value]) => [
          key.slice(0, 80),
          typeof value === "string" ? value.slice(0, 2_000) : value,
        ]),
    );
    try {
      const encoded = JSON.stringify(bounded);
      if (encoded.length > 32_000) return {};
      return JSON.parse(encoded) as Record<string, string | number | boolean>;
    } catch {
      return {};
    }
  }, [parameters]);
  const document = useMemo(
    () =>
      buildSpectraSandboxDocument({
        files,
        tests,
        assets,
        channel,
        title,
        networkAllowlist: approvedNetworkOrigins,
        initialTheme: clientMounted
          ? readSpectraSandboxTheme(forceReducedMotion)
          : undefined,
      }),
    // Theme updates are messages, not a reason to reconstruct the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      approvedNetworkOrigins,
      assets,
      channel,
      clientMounted,
      files,
      tests,
      title,
    ],
  );

  useEffect(() => {
    // Capture real computed tokens before artifact code runs, while keeping
    // server output and the first hydration render identical.
    setClientMounted(true);
  }, []);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const srcDoc = clientMounted ? document.srcDoc : null;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  useEffect(() => {
    if (!srcDoc) return;
    const current = framesRef.current;
    if (current.some((frame) => frame.srcDoc === srcDoc)) return;
    const shown = [...current].reverse().find((frame) => frame.ready);
    frameKey.current += 1;
    const next = { key: frameKey.current, srcDoc, ready: false };
    setFrames(shown ? [shown, next] : [next]);
    if (shown) return;
    setStatus("loading");
    setMessage(document.diagnostics[0] ?? null);
    onStatusChangeRef.current?.("loading", document.diagnostics[0] ?? null, document.diagnostics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcDoc]);

  useEffect(() => {
    setHeight(viewportHeight ?? (compact ? 220 : 420));
  }, [compact, viewportHeight]);

  /** The frame on screen: the newest ready one, else the one still loading. */
  const shownKey = [...frames].reverse().find((frame) => frame.ready)?.key ?? frames.at(-1)?.key ?? null;
  const newestKey = frames.at(-1)?.key ?? null;
  const shownKeyRef = useRef(shownKey);
  shownKeyRef.current = shownKey;
  const newestKeyRef = useRef(newestKey);
  newestKeyRef.current = newestKey;

  useEffect(() => {
    function receive(event: MessageEvent) {
      let from: number | null = null;
      for (const [key, element] of frameEls.current)
        if (element.contentWindow && event.source === element.contentWindow) from = key;
      if (
        from === null ||
        !isSpectraSandboxFrameMessage(event.data) ||
        event.data.channel !== channel
      )
        return;
      const payload = event.data;
      const shown = from === shownKeyRef.current;
      const newest = from === newestKeyRef.current;
      // A frame being replaced has nothing more to say; the one loading behind
      // it only reports that it is ready, its size, or that it failed.
      if (!shown && !newest) return;
      if (!shown && payload.type !== "spectra:ready" && payload.type !== "spectra:resize" && payload.type !== "spectra:error") return;
      if (payload.type === "spectra:ready" || (!shown && payload.type === "spectra:error")) {
        // The next version is ready (or failed, which the reader should see):
        // it replaces the one showing.
        const ready = from;
        setFrames((current) =>
          current
            .filter((frame) => frame.key >= ready)
            .map((frame) => (frame.key === ready ? { ...frame, ready: true } : frame)),
        );
      }
      onEventRef.current?.(payload);
      if (payload.type === "spectra:ready") {
        setStatus("ready");
        onStatusChangeRef.current?.(
          "ready",
          document.diagnostics[0] ?? null,
          document.diagnostics,
        );
      } else if (payload.type === "spectra:resize") {
        if (viewportHeight === undefined && newest) {
          // As tall as the work inside, however short. A page sized to the
          // frame (100vh plus a margin) grows by the same step every time it
          // is given room: after a few equal steps, stop feeding it.
          const next = Math.max(48, Math.min(SPECTRA_EMBED_BUDGETS.maxHeight, payload.height));
          const loop = growthRef.current;
          const step = next - loop.last;
          loop.repeats = step > 0 && step === loop.step ? loop.repeats + 1 : 0;
          loop.step = step;
          loop.last = next;
          if (loop.repeats < 3) setHeight(next);
        }
      } else if (payload.type === "spectra:error") {
        if (isBenignRuntimeError(payload.message)) return;
        setStatus("error");
        setMessage(payload.message);
        onStatusChangeRef.current?.(
          "error",
          payload.message,
          document.diagnostics,
        );
      } else if (payload.type === "spectra:limit") {
        setStatus("limited");
        setMessage(payload.message);
        onStatusChangeRef.current?.(
          "limited",
          payload.message,
          document.diagnostics,
        );
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, document.diagnostics, viewportHeight]);

  useEffect(() => {
    if (status !== "ready") return;
    const sendHostState = () => {
      const theme = readSpectraSandboxTheme(forceReducedMotion);
      setScheme(theme.theme);
      for (const element of frameEls.current.values())
        element.contentWindow?.postMessage(
          {
            type: "spectra:host",
            channel,
            ...theme,
            resources: safeResources,
            parameters: safeParameters,
            ...(exportRequest ? { exportRequest } : {}),
          },
          "*",
        );
    };
    sendHostState();
    const observer = new MutationObserver(sendHostState);
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-spectra-motion"],
    });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener("change", sendHostState);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", sendHostState);
    };
  }, [
    channel,
    exportRequest,
    forceReducedMotion,
    safeParameters,
    safeResources,
    status,
    shownKey,
  ]);

  if (!document.srcDoc)
    return (
      <RuntimeFailure
        message={
          document.diagnostics[0] ?? "This source cannot be rendered safely."
        }
        onRetry={() => setGeneration((value) => value + 1)}
      />
    );
  return (
    <section
      className={`relative overflow-hidden ${chromeless ? "" : "rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)]"} ${className}`}
      data-runtime-status={status}
      data-chromeless={chromeless ? "" : undefined}
    >
      {description ? (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      ) : null}
      {toolbar ? (
        <div className="flex h-8 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3">
          <span className="inline-flex items-center gap-1.5 text-micro font-semibold text-[var(--text-tertiary)]">
            <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
            Isolated Spectra preview
          </span>
          <button
            type="button"
            onClick={() => setGeneration((value) => value + 1)}
            className="flex h-6 items-center gap-1 rounded-chip px-1.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            aria-label="Restart interactive preview"
          >
            <RotateCw className="h-3 w-3" />
            Restart
          </button>
        </div>
      ) : null}
      {frames.length ? (
        <div
          key="frames"
          data-runtime-frames=""
          className="relative transition-[height] duration-[var(--motion-slow)] ease-standard motion-reduce:transition-none"
          style={{ height }}
        >
          {frames.map((frame) => {
            const shown = frame.key === shownKey;
            return (
              <iframe
                key={`${channel}:${frame.key}`}
                ref={(element) => {
                  if (element) frameEls.current.set(frame.key, element);
                  else frameEls.current.delete(frame.key);
                }}
                title={`${title} interactive preview`}
                aria-describedby={shown ? descriptionId : undefined}
                aria-hidden={shown ? undefined : true}
                tabIndex={shown ? undefined : -1}
                srcDoc={frame.srcDoc}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; serial 'none'; usb 'none'"
                className={`absolute inset-0 block h-full w-full border-0 bg-transparent ${shown ? "" : "pointer-events-none opacity-0"}`}
                style={{ colorScheme: scheme }}
              />
            );
          })}
        </div>
      ) : (
        <div key="reserve" aria-hidden="true" style={{ height }} />
      )}
      {status === "loading" ? (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 ${toolbar ? "top-8" : "top-0"} flex items-center justify-center ${chromeless ? "" : "bg-[color-mix(in_oklab,var(--bg-primary)_90%,transparent)]"}`}
        >
          <span className="inline-flex items-center gap-2 text-micro text-[var(--text-secondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Starting isolated preview
          </span>
        </div>
      ) : null}
      {status === "error" || status === "limited" ? (
        <div className="absolute inset-x-3 bottom-3 rounded-control border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] p-3 shadow-card backdrop-blur">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-semibold text-[var(--text-primary)]">
                {status === "limited"
                  ? "Preview safety limit reached"
                  : "Preview stopped"}
              </p>
              <p className="mt-0.5 text-micro leading-3.5 text-[var(--text-secondary)]">
                {message ??
                  "The source is intact. Restart the preview after correcting the runtime issue."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGeneration((value) => value + 1)}
              className="h-7 rounded-chip border border-[var(--border-default)] px-2 text-micro font-semibold text-[var(--text-primary)]"
            >
              Restart
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RuntimeFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="text-micro font-semibold text-[var(--text-primary)]">
            Interactive preview unavailable
          </p>
          <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
            {message} The artifact source has not been changed.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-chip border border-[var(--border-default)] px-2 text-micro font-semibold text-[var(--text-primary)]"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
