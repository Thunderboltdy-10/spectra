"use client";

import {
  AlertTriangle,
  LockKeyhole,
  Loader2,
  Play,
  RotateCw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPublishedCodeBuildPayload,
  type PublishedCodeBuildPayload,
} from "../code/published-build";
import { codeParameterSnapshot } from "../code/model";
import {
  runPythonInIsolatedWorker,
  type PythonRuntimeEvent,
} from "../code/python-runtime";
import { pythonChartToHtml } from "../code/python-chart";
import { publishedRuntimeSourceUrl } from "../code/published-runtime-source";
import { SandboxedArtifactRuntime } from "./sandboxed-artifact-runtime";

type RuntimeBuild = {
  buildId: string;
  artifactVersionId: string;
  runtime: "browser" | "react" | "python";
  payloadHash?: string;
  sdkVersion: string;
  payloadBytes?: number;
  storageUrl?: string;
};

const MAX_PAYLOAD_BYTES = 14_000_000;

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyEmbeddedAssets(
  payload: PublishedCodeBuildPayload,
  signal: AbortSignal,
) {
  for (const asset of payload.assets) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const marker = `data:${asset.mediaType};base64,`;
    if (!asset.dataUrl.startsWith(marker))
      throw new Error(
        `Published asset ${asset.path} has an invalid media envelope.`,
      );
    const encoded = asset.dataUrl.slice(marker.length);
    if (encoded.length > Math.ceil(asset.bytes / 3) * 4 + 8)
      throw new Error(
        `Published asset ${asset.path} exceeds its recorded size.`,
      );
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new Error(
        `Published asset ${asset.path} is not valid base64 data.`,
      );
    }
    if (binary.length !== asset.bytes)
      throw new Error(`Published asset ${asset.path} has an unexpected size.`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    const digest = await sha256(bytes.buffer);
    if (digest !== asset.sha256)
      throw new Error(
        `Published asset ${asset.path} failed its integrity check.`,
      );
  }
}

async function loadBuild(
  build: RuntimeBuild,
  signal: AbortSignal,
  embedId?: string,
) {
  const sourceUrl = publishedRuntimeSourceUrl(build, embedId);
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error("The retained runtime package is unavailable.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PAYLOAD_BYTES)
    throw new Error("The runtime package exceeds its safety budget.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PAYLOAD_BYTES)
    throw new Error("The runtime package exceeds its safety budget.");
  if (
    build.payloadBytes !== undefined &&
    bytes.byteLength !== build.payloadBytes
  ) {
    throw new Error("The retained runtime package has an unexpected size.");
  }
  const digest = await sha256(bytes);
  if (build.payloadHash && digest !== build.payloadHash) {
    throw new Error("The retained runtime package failed its integrity check.");
  }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!isPublishedCodeBuildPayload(value))
    throw new Error(
      "The retained runtime package is not valid Spectra output.",
    );
  if (
    value.artifactVersionId !== build.artifactVersionId ||
    value.runtime !== build.runtime ||
    value.sdkVersion !== build.sdkVersion
  ) {
    throw new Error(
      "The retained runtime package does not match its published record.",
    );
  }
  await verifyEmbeddedAssets(value, signal);
  return value;
}

export function PublishedCodeRuntime({
  title,
  build,
  embedId,
  compact,
  resources,
  allowInteraction = true,
}: {
  title: string;
  build: RuntimeBuild;
  embedId?: string;
  compact: boolean;
  resources?: Record<string, unknown>;
  allowInteraction?: boolean;
}) {
  const [payload, setPayload] = useState<PublishedCodeBuildPayload | null>(
    null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [pythonState, setPythonState] = useState<
    "idle" | "loading" | "running" | "ready" | "error"
  >("idle");
  const [pythonOutput, setPythonOutput] = useState<string[]>([]);
  const [pythonPreview, setPythonPreview] = useState<string | null>(null);
  const workerRef = useRef<{ cancel: () => void } | null>(null);
  const generationRef = useRef(0);

  const reload = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    workerRef.current?.cancel();
    workerRef.current = null;
    setPayload(null);
    setLoadState("loading");
    setError(null);
    setPythonState("idle");
    setPythonOutput([]);
    setPythonPreview(null);
    const controller = new AbortController();
    void loadBuild(build, controller.signal, embedId)
      .then((value) => {
        if (generation !== generationRef.current) return;
        setPayload(value);
        setLoadState("ready");
      })
      .catch((reason) => {
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The runtime package could not be loaded.",
        );
        setLoadState("error");
      });
    return () => controller.abort();
  }, [build, embedId]);

  useEffect(() => reload(), [reload]);
  useEffect(() => () => workerRef.current?.cancel(), []);

  const handlePythonEvent = useCallback((event: PythonRuntimeEvent) => {
    if (event.type === "status") {
      setPythonState(event.status);
      return;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      setPythonOutput((current) => [...current, event.text].slice(-120));
      return;
    }
    if (event.type === "render") {
      setPythonPreview(event.html);
      return;
    }
    if (event.type === "chart") {
      try {
        setPythonPreview(pythonChartToHtml(event.spec));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "The generated chart is invalid.",
        );
        setPythonState("error");
      }
      return;
    }
    if (event.type === "complete") {
      if (event.result)
        setPythonOutput((current) => [...current, event.result!].slice(-120));
      setPythonState("ready");
      workerRef.current = null;
      return;
    }
    setError(
      "message" in event ? event.message : "Python stopped unexpectedly.",
    );
    setPythonState("error");
    workerRef.current = null;
  }, []);

  const runPython = useCallback(() => {
    if (
      !payload ||
      payload.runtime !== "python" ||
      pythonState === "loading" ||
      pythonState === "running" ||
      !allowInteraction
    )
      return;
    setError(null);
    setPythonOutput([]);
    setPythonPreview(null);
    setPythonState("loading");
    try {
      workerRef.current = runPythonInIsolatedWorker({
        files: payload.files,
        entryFileId: payload.entryFileId,
        resources,
        parameters: codeParameterSnapshot(payload),
        assets: payload.assets,
        onEvent: handlePythonEvent,
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Python could not start.",
      );
      setPythonState("error");
    }
  }, [allowInteraction, handlePythonEvent, payload, pythonState, resources]);

  if (loadState === "loading") {
    return (
      <RuntimeState
        icon={Loader2}
        spinning
        title="Loading published build"
        detail="Verifying the retained runtime package before execution."
      />
    );
  }
  if (loadState === "error" || !payload) {
    return (
      <RuntimeState
        icon={AlertTriangle}
        title="Published build unavailable"
        detail={error ?? "The retained build could not be opened safely."}
        action={{ label: "Retry", onClick: reload }}
      />
    );
  }
  if (payload.runtime !== "python") {
    return (
      <div className="space-y-2">
        {!allowInteraction ? (
          <div className="flex items-center gap-1.5 px-1 text-micro font-semibold text-[var(--text-tertiary)]">
            <LockKeyhole className="h-3 w-3" /> View-only published preview
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 px-1 text-micro text-[var(--text-tertiary)]">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[.1em]">
            <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
            Verified published build
          </span>
          <span>
            {payload.runtime === "react" ? "React / TypeScript" : "Browser"}
          </span>
        </div>
        <SandboxedArtifactRuntime
          title={payload.accessibility?.title || title}
          description={
            payload.accessibility?.description ||
            payload.visualisation.description
          }
          files={payload.files}
          resources={resources}
          assets={payload.assets}
          parameters={codeParameterSnapshot(payload)}
          forceReducedMotion={payload.accessibility?.reducedMotion === true}
          networkAllowlist={
            payload.networkPolicy.mode === "allowlist"
              ? payload.networkPolicy.allowlist
              : undefined
          }
          compact={compact}
          toolbar={!compact}
          className={!allowInteraction ? "pointer-events-none" : ""}
        />
      </div>
    );
  }
  const busy = pythonState === "loading" || pythonState === "running";
  return (
    <div className="overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3">
        <span className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
          <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
          Isolated Python build
        </span>
        <button
          type="button"
          onClick={runPython}
          disabled={busy || !allowInteraction}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-45"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          ) : pythonState === "ready" ? (
            <RotateCw className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3 fill-current" />
          )}
          {!allowInteraction
            ? "View only"
            : busy
              ? "Running"
              : pythonState === "ready"
                ? "Run again"
                : "Run"}
        </button>
      </div>
      {pythonPreview ? (
        <SandboxedArtifactRuntime
          title={payload.accessibility?.title || title}
          description={
            payload.accessibility?.description ||
            payload.visualisation.description
          }
          files={[
            { path: "index.html", language: "html", source: pythonPreview },
          ]}
          compact={compact}
          toolbar={false}
          className={!allowInteraction ? "pointer-events-none" : ""}
          assets={payload.assets}
          parameters={codeParameterSnapshot(payload)}
          forceReducedMotion={payload.accessibility?.reducedMotion === true}
          networkAllowlist={
            payload.networkPolicy.mode === "allowlist"
              ? payload.networkPolicy.allowlist
              : undefined
          }
        />
      ) : (
        <div
          className={`${compact ? "min-h-32" : "min-h-56"} flex flex-col justify-center p-4`}
        >
          {pythonOutput.length ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-micro leading-4 text-[var(--text-secondary)]">
              {pythonOutput.join("\n")}
            </pre>
          ) : (
            <div className="text-center">
              <TerminalSquare className="mx-auto h-5 w-5 text-[var(--text-tertiary)]" />
              <p className="mt-2 text-micro font-semibold text-[var(--text-primary)]">
                Run the retained Python source
              </p>
              <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                Execution happens in a disposable browser worker with network
                access disabled.
              </p>
            </div>
          )}
          {error ? (
            <p className="mt-3 rounded-[6px] border border-[color-mix(in_oklab,var(--danger)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] p-2 text-micro text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RuntimeState({
  icon: Icon,
  title,
  detail,
  spinning = false,
  action,
}: {
  icon: typeof Loader2;
  title: string;
  detail: string;
  spinning?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-[9px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] p-5 text-center">
      <div>
        <Icon
          className={`mx-auto h-5 w-5 text-[var(--text-tertiary)] ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        <p className="mt-2 text-micro font-semibold text-[var(--text-primary)]">
          {title}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-micro leading-4 text-[var(--text-secondary)]">
          {detail}
        </p>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-3 h-7 rounded-[6px] border border-[var(--border-default)] px-2.5 text-micro font-semibold text-[var(--text-primary)]"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
