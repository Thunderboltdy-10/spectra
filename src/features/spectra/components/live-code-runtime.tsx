"use client";

import {
  AlertTriangle,
  Code2,
  Loader2,
  LockKeyhole,
  Play,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  codeParameterSnapshot,
  normalizeCodeContent,
  type CodeFile,
} from "../code/model";
import { loadCodeRuntimeAssets } from "../code/runtime-assets-client";
import { requestSpectra } from "../data/request";
import {
  runPythonInIsolatedWorker,
  type PythonRuntimeEvent,
} from "../code/python-runtime";
import { pythonChartToHtml } from "../code/python-chart";
import type { SpectraSandboxAsset } from "../embed/sandbox-protocol";
import { SandboxedArtifactRuntime } from "./sandboxed-artifact-runtime";

type RuntimeState = "loading" | "ready" | "error";

export function LiveCodeRuntime({
  artifactId,
  title,
  content: rawContent,
  compact,
  allowInteraction,
  resources,
}: {
  artifactId: string;
  title: string;
  content: unknown;
  compact: boolean;
  allowInteraction: boolean;
  resources?: Record<string, unknown>;
}) {
  const content = useMemo(() => normalizeCodeContent(rawContent), [rawContent]);
  const [state, setState] = useState<RuntimeState>("loading");
  const [message, setMessage] = useState(
    "Preparing the live preview…",
  );
  const [previewFiles, setPreviewFiles] = useState<CodeFile[] | null>(null);
  const [assets, setAssets] = useState<SpectraSandboxAsset[]>([]);
  const [pythonState, setPythonState] = useState<
    "idle" | "loading" | "running" | "ready" | "error"
  >("idle");
  const [pythonOutput, setPythonOutput] = useState<string[]>([]);
  const [pythonPreview, setPythonPreview] = useState<string | null>(null);
  const workerRef = useRef<{ cancel: () => void } | null>(null);
  const generationRef = useRef(0);

  const prepare = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    workerRef.current?.cancel();
    workerRef.current = null;
    setState("loading");
    setMessage("Preparing the live preview…");
    setPreviewFiles(null);
    setAssets([]);
    setPythonState("idle");
    setPythonOutput([]);
    setPythonPreview(null);
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadCodeRuntimeAssets(
        artifactId,
        content.assets ?? [],
      );
      if (controller.signal.aborted || generation !== generationRef.current)
        return;
      if (loaded.diagnostics.length) {
        throw new Error(loaded.diagnostics[0]);
      }
      setAssets(loaded.assets);
      if (
        content.runtime === "none" ||
        content.runtime === "python" ||
        content.visualisation.enabled === false
      ) {
        setState("ready");
        setMessage(
          content.runtime === "python"
            ? "Python source is ready in a disposable worker."
            : "Source is available without an executable preview.",
        );
        return;
      }
      const response = await requestSpectra("/api/spectra/runtime/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          runtime: content.runtime,
          entryFileId: content.entryFileId,
          files: content.files,
          dependencies: content.dependencies ?? {},
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        build?: {
          files?: CodeFile[];
          js?: string;
          css?: string;
        };
        errors?: Array<{ message?: string }>;
        error?: { message?: string } | string;
      } | null;
      if (!response.ok || !payload?.build) {
        const detail =
          payload?.errors?.[0]?.message ||
          (typeof payload?.error === "string"
            ? payload.error
            : payload?.error?.message) ||
          "The live preview could not be built safely.";
        throw new Error(detail);
      }
      if (controller.signal.aborted || generation !== generationRef.current)
        return;
      setPreviewFiles(
        content.runtime === "browser"
          ? (payload.build.files ?? [])
          : [
              {
                id: "spectra-live-root",
                path: "index.html",
                language: "html",
                source: '<main id="root"></main>',
              },
              {
                id: "spectra-live-css",
                path: "spectra-build.css",
                language: "css",
                source: payload.build.css ?? "",
              },
              {
                id: "spectra-live-js",
                path: "spectra-build.js",
                language: "javascript",
                source: payload.build.js ?? "",
              },
            ],
      );
      setState("ready");
      setMessage("Live preview rebuilt from your latest code.");
    })().catch((error) => {
      if (controller.signal.aborted || generation !== generationRef.current)
        return;
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The live preview could not open. Try again in a moment.",
      );
    });
    return () => controller.abort();
  }, [artifactId, content]);

  useEffect(() => prepare(), [prepare]);
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
      } catch (error) {
        setPythonState("error");
        setMessage(
          error instanceof Error ? error.message : "The chart is invalid.",
        );
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
    setPythonState("error");
    setMessage(
      "message" in event ? event.message : "Python stopped unexpectedly.",
    );
    workerRef.current = null;
  }, []);

  function runPython() {
    if (
      !allowInteraction ||
      content.runtime !== "python" ||
      pythonState === "loading" ||
      pythonState === "running"
    )
      return;
    setPythonOutput([]);
    setPythonPreview(null);
    setPythonState("loading");
    setMessage("Running Python without network or ambient credentials...");
    try {
      workerRef.current = runPythonInIsolatedWorker({
        files: content.files,
        entryFileId: content.entryFileId,
        resources,
        parameters: codeParameterSnapshot(content),
        assets,
        onEvent: handlePythonEvent,
      });
    } catch (error) {
      setPythonState("error");
      setMessage(
        error instanceof Error ? error.message : "Python could not start.",
      );
    }
  }

  if (state === "loading")
    return (
      <RuntimeNotice
        icon={Loader2}
        spinning
        title="Rebuilding live preview"
        detail={message}
      />
    );
  if (state === "error")
    return (
      <RuntimeNotice
        icon={AlertTriangle}
        title="Live preview unavailable"
        detail={`${message} The source remains intact.`}
        action={{ label: "Retry", onClick: prepare }}
      />
    );

  const accessibleTitle =
    content.accessibility?.title || content.visualisation.title || title;
  const description =
    content.accessibility?.description || content.visualisation.description;
  if (content.runtime === "browser" || content.runtime === "react") {
    if (content.visualisation.enabled !== false && previewFiles?.length)
      return (
        <div className="space-y-2">
          {!allowInteraction ? (
            <div className="flex items-center gap-1.5 px-1 text-micro font-semibold text-[var(--text-tertiary)]">
              <LockKeyhole className="h-3 w-3" /> View-only live preview
            </div>
          ) : null}
          <SandboxedArtifactRuntime
            title={accessibleTitle}
            description={description}
            files={previewFiles}
            assets={assets}
            resources={resources}
            parameters={codeParameterSnapshot(content)}
            forceReducedMotion={content.accessibility?.reducedMotion === true}
            networkAllowlist={
              content.networkPolicy?.mode === "allowlist"
                ? content.networkPolicy.allowlist
                : undefined
            }
            compact={compact}
            toolbar={!compact}
            className={!allowInteraction ? "pointer-events-none" : ""}
          />
        </div>
      );
  }

  if (content.runtime === "python") {
    const busy = pythonState === "loading" || pythonState === "running";
    return (
      <div className="overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)]">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3">
          <span className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
            <ShieldCheck className="h-3 w-3 text-[var(--success)]" /> Live
            Python source
          </span>
          <button
            type="button"
            onClick={runPython}
            disabled={!allowInteraction || busy}
            className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-40"
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
            title={accessibleTitle}
            description={description}
            files={[
              { path: "index.html", language: "html", source: pythonPreview },
            ]}
            assets={assets}
            parameters={codeParameterSnapshot(content)}
            forceReducedMotion={content.accessibility?.reducedMotion === true}
            compact={compact}
            toolbar={false}
            className={!allowInteraction ? "pointer-events-none" : ""}
          />
        ) : (
          <div className={`${compact ? "min-h-28" : "min-h-48"} p-4`}>
            {pythonOutput.length ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-micro leading-4 text-[var(--text-secondary)]">
                {pythonOutput.join("\n")}
              </pre>
            ) : (
              <p className="mx-auto max-w-md py-8 text-center text-micro leading-4 text-[var(--text-tertiary)]">
                {allowInteraction
                  ? "Run the current source in a fresh disposable worker. Network and ambient credentials remain unavailable."
                  : "This embed is view-only. Open the original code to see its Python files."}
              </p>
            )}
            {pythonState === "error" ? (
              <p className="mt-2 rounded-chip border border-[color-mix(in_oklab,var(--danger)_24%,var(--border-default))] p-2 text-micro text-[var(--danger)]">
                {message}
              </p>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const entry =
    content.files.find((file) => file.id === content.entryFileId) ??
    content.files[0];
  return (
    <div className="overflow-hidden rounded-control border border-[var(--border-default)] bg-[var(--text-primary)] text-[var(--bg-tertiary)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-micro text-white/55">
        <Code2 className="h-3 w-3" /> {entry?.path ?? "source"}
      </div>
      <pre
        className={`overflow-auto p-3 font-mono text-micro leading-4 ${compact ? "max-h-32" : "max-h-72"}`}
      >
        {entry?.source ?? ""}
      </pre>
    </div>
  );
}

function RuntimeNotice({
  icon: Icon,
  spinning,
  title,
  detail,
  action,
}: {
  icon: typeof AlertTriangle;
  spinning?: boolean;
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] p-5 text-center">
      <div className="max-w-sm">
        <Icon
          className={`mx-auto h-5 w-5 text-[var(--text-tertiary)] ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        <p className="mt-2 text-micro font-semibold text-[var(--text-primary)]">
          {title}
        </p>
        <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
          {detail}
        </p>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-3 h-7 rounded-chip border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro font-semibold text-[var(--text-primary)]"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
