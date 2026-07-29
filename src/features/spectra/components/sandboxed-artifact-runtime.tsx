"use client";

import { AlertTriangle, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildSpectraSandboxDocument,
  isSpectraSandboxFrameMessage,
  SPECTRA_EMBED_BUDGETS,
  type SpectraSandboxFile,
  type SpectraSandboxFrameMessage,
  type SpectraSandboxAsset,
  type SpectraSandboxTest,
} from "../embed/sandbox-protocol";

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
  const [generation, setGeneration] = useState(0);
  const channel = `spectra-${stableId}-${generation}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<SpectraRuntimeStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [height, setHeight] = useState(viewportHeight ?? (compact ? 220 : 420));
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
      }),
    [approvedNetworkOrigins, assets, channel, files, tests, title],
  );

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    setStatus("loading");
    setMessage(document.diagnostics[0] ?? null);
    setHeight(viewportHeight ?? (compact ? 220 : 420));
    onStatusChangeRef.current?.(
      "loading",
      document.diagnostics[0] ?? null,
      document.diagnostics,
    );
  }, [compact, document, viewportHeight]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isSpectraSandboxFrameMessage(event.data) ||
        event.data.channel !== channel
      )
        return;
      const payload = event.data;
      onEventRef.current?.(payload);
      if (payload.type === "spectra:ready") {
        setStatus((current) => (current === "loading" ? "ready" : current));
        onStatusChangeRef.current?.(
          "ready",
          document.diagnostics[0] ?? null,
          document.diagnostics,
        );
        const reducedMotion =
          forceReducedMotion ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const dark = documentElementTheme() === "dark";
        frameRef.current?.contentWindow?.postMessage(
          {
            type: "spectra:host",
            channel,
            theme: dark ? "dark" : "light",
            reducedMotion,
            resources: safeResources,
            parameters: safeParameters,
            ...(exportRequest ? { exportRequest } : {}),
          },
          "*",
        );
      } else if (payload.type === "spectra:resize") {
        if (viewportHeight === undefined)
          setHeight(
            Math.max(
              compact ? 180 : 260,
              Math.min(SPECTRA_EMBED_BUDGETS.maxHeight, payload.height),
            ),
          );
      } else if (payload.type === "spectra:error") {
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
  }, [
    channel,
    compact,
    document.diagnostics,
    forceReducedMotion,
    exportRequest,
    safeResources,
    safeParameters,
    viewportHeight,
  ]);

  useEffect(() => {
    if (status !== "ready") return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "spectra:host",
        channel,
        theme: documentElementTheme(),
        reducedMotion:
          forceReducedMotion ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        resources: safeResources,
        parameters: safeParameters,
        ...(exportRequest ? { exportRequest } : {}),
      },
      "*",
    );
  }, [
    channel,
    exportRequest,
    forceReducedMotion,
    safeParameters,
    safeResources,
    status,
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
      className={`relative overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] ${className}`}
      data-runtime-status={status}
    >
      {description ? (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      ) : null}
      {toolbar ? (
        <div className="flex h-8 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3">
          <span className="inline-flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">
            <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
            Isolated Spectra preview
          </span>
          <button
            type="button"
            onClick={() => setGeneration((value) => value + 1)}
            className="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[8px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            aria-label="Restart interactive preview"
          >
            <RotateCw className="h-3 w-3" />
            Restart
          </button>
        </div>
      ) : null}
      <iframe
        key={channel}
        ref={frameRef}
        title={`${title} interactive preview`}
        aria-describedby={descriptionId}
        srcDoc={document.srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; serial 'none'; usb 'none'"
        className="block w-full border-0 bg-white transition-[height] duration-300 motion-reduce:transition-none"
        style={{ height }}
      />
      {status === "loading" ? (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 ${toolbar ? "top-8" : "top-0"} flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_90%,transparent)]`}
        >
          <span className="inline-flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Starting isolated preview
          </span>
        </div>
      ) : null}
      {status === "error" || status === "limited" ? (
        <div className="absolute inset-x-3 bottom-3 rounded-[8px] border border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] p-3 shadow-[0_8px_30px_rgba(31,26,18,.12)] backdrop-blur">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold text-[var(--text-primary)]">
                {status === "limited"
                  ? "Preview safety limit reached"
                  : "Preview stopped"}
              </p>
              <p className="mt-0.5 text-[8px] leading-3.5 text-[var(--text-secondary)]">
                {message ??
                  "The source is intact. Restart the preview after correcting the runtime issue."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGeneration((value) => value + 1)}
              className="h-7 rounded-[6px] border border-[var(--border-default)] px-2 text-[8px] font-semibold text-[var(--text-primary)]"
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
    <div className="rounded-[9px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-[var(--text-primary)]">
            Interactive preview unavailable
          </p>
          <p className="mt-1 text-[9px] leading-4 text-[var(--text-secondary)]">
            {message} The artifact source has not been changed.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-[6px] border border-[var(--border-default)] px-2 text-[8px] font-semibold text-[var(--text-primary)]"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function documentElementTheme() {
  return document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}
