"use client";

import { Code2, Loader2, Play, RotateCw, ShieldCheck, AlertTriangle, LockKeyhole } from "@/components/icons/glyph-icons";
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
  chromeless = compact,
}: {
  artifactId: string;
  title: string;
  content: unknown;
  compact: boolean;
  allowInteraction: boolean;
  resources?: Record<string, unknown>;
  /** In a thread: no card or toolbar of its own, so it blends into the reply. */
  chromeless?: boolean;
}) {
  const normalized = useMemo(() => normalizeCodeContent(rawContent), [rawContent]);
  // What the preview is built from. A new object with the same code (a
  // refetch, a focus, a re-render) is not a reason to rebuild.
  const signature = useMemo(
    () =>
      JSON.stringify([
        normalized.runtime,
        normalized.entryFileId,
        normalized.files,
        normalized.dependencies ?? {},
        normalized.assets ?? [],
        normalized.visualisation.enabled,
      ]),
    [normalized],
  );
  const builtSignature = useRef<string | null>(null);
  const content = normalized;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buildContent = useMemo(() => normalized, [signature]);
  const [state, setState] = useState<RuntimeState>("loading");
  const [message, setMessage] = useState(
    "Preparing the live preview…",
  );
  const [previewFiles, setPreviewFiles] = useState<CodeFile[] | null>(null);
  // A newer version failed to build while an older one is showing.
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const previewRef = useRef<CodeFile[] | null>(null);
  previewRef.current = previewFiles;
  const [assets, setAssets] = useState<SpectraSandboxAsset[]>([]);
  const [pythonState, setPythonState] = useState<
    "idle" | "loading" | "running" | "ready" | "error"
  >("idle");
  const [pythonOutput, setPythonOutput] = useState<string[]>([]);
  const [pythonPreview, setPythonPreview] = useState<string | null>(null);
  const workerRef = useRef<{ cancel: () => void } | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const prepare = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    builtSignature.current = signature;
    abortRef.current?.abort();
    workerRef.current?.cancel();
    workerRef.current = null;
    // While a preview is showing, the next one is built behind it and swapped
    // in only once it is ready: no flash back to a loading state.
    const showing = Boolean(previewRef.current?.length);
    if (!showing) {
      setState("loading");
      setMessage("Preparing the live preview…");
    }
    setPythonState("idle");
    setPythonOutput([]);
    setPythonPreview(null);
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      const loaded = await loadCodeRuntimeAssets(
        artifactId,
        buildContent.assets ?? [],
      );
      if (controller.signal.aborted || generation !== generationRef.current)
        return;
      if (loaded.diagnostics.length) {
        throw new Error(loaded.diagnostics[0]);
      }
      setAssets(loaded.assets);
      if (
        buildContent.runtime === "none" ||
        buildContent.runtime === "python" ||
        buildContent.visualisation.enabled === false
      ) {
        setPreviewFiles(null);
        setState("ready");
        setMessage(
          buildContent.runtime === "python"
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
          runtime: buildContent.runtime,
          entryFileId: buildContent.entryFileId,
          files: buildContent.files,
          dependencies: buildContent.dependencies ?? {},
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
        buildContent.runtime === "browser"
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
      setStaleNote(null);
      setState("ready");
      setMessage("Live preview rebuilt from your latest code.");
    })().catch((error) => {
      if (controller.signal.aborted || generation !== generationRef.current)
        return;
      const detail =
        error instanceof Error
          ? error.message
          : "The live preview could not open. Try again in a moment.";
      // Half-written code (while Spectra is still writing it) often fails to
      // build: keep the last good preview and say so quietly.
      if (previewRef.current?.length) {
        setStaleNote(detail);
        return;
      }
      setState("error");
      setMessage(detail);
    });
  }, [artifactId, buildContent, signature]);

  // The first build starts at once; later changes (code streaming in, edits)
  // settle for a moment so the preview updates smoothly instead of constantly.
  useEffect(() => {
    if (builtSignature.current === signature) return;
    if (!previewRef.current?.length && builtSignature.current === null) {
      prepare();
      return;
    }
    const timer = window.setTimeout(prepare, 700);
    return () => window.clearTimeout(timer);
  }, [prepare, signature]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      workerRef.current?.cancel();
      // An aborted build never finishes: if this component mounts again
      // (StrictMode, a kept-alive embed) it must build afresh, not wait on it.
      builtSignature.current = null;
    },
    [],
  );

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
        plain={chromeless}
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
        <div className="space-y-2" data-live-code-preview="">
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
            toolbar={!chromeless}
            chromeless={chromeless}
            className={!allowInteraction ? "pointer-events-none" : ""}
          />
          {staleNote ? (
            <p className="px-1 text-micro text-[var(--text-tertiary)]" role="status">
              Showing the last version that ran. The latest change didn&apos;t build: {staleNote}
            </p>
          ) : null}
        </div>
      );
  }

  if (content.runtime === "python") {
    const busy = pythonState === "loading" || pythonState === "running";
    return (
      <div className="overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)]">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3">
          <span className="inline-flex items-center gap-1.5 text-micro font-semibold text-[var(--text-tertiary)]">
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
  plain,
}: {
  icon: typeof AlertTriangle;
  spinning?: boolean;
  /** In a thread: no card of its own, so it blends into the reply. */
  plain?: boolean;
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={`flex min-h-40 items-center justify-center p-5 text-center ${plain ? "" : "rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)]"}`}
    >
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
