"use client";

import { useWorkAvailability } from "./use-work-availability";

import { Tooltip } from "@/components/ui/tooltip";
import { DismissibleArtifactNotice } from "./dismissible-artifact-notice";
import { useQuery } from "convex/react";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { describeFailure } from "@/components/ui/truthful-state";
import { uniqueToken } from "@/lib/unique-token";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";
import {
  documentBlocksFromJson,
  docxRichBlockToJson,
} from "../lenses/document-projection";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Archive,
  Bold,
  BookOpen,
  CalendarCheck2,
  Code2,
  Copy,
  Download,
  Eye,
  FileDown,
  FileText,
  History,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  PanelRight,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Sigma,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import NextLink from "next/link";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { isArtifactTypeKey } from "../artifacts/registry";
import { ResourceSurface } from "../bridge/resource-surface";
import { FileStorageControls } from "../bridge/file-storage-controls";
import { useNow } from "@/hooks/use-now";
import { ArtifactHeaderActions, type HeaderCommand } from "./artifact-header-actions";
import { ArtifactStatusControl } from "./artifact-status-control";
import { useEditorFieldMoments } from "./editor-field-moments";
import { beginCreation, useLifeLanding, useLifeReturn } from "../life/use-life";
import { artifactStatusOf, type ArtifactStatusActionKind } from "./artifact-status";
import { humanizeNativeError, humanizePublicFailure } from "../bridge/humanize";
import { useBridgeHealth } from "../bridge/use-bridge";
import { mountsForConnectedDevice } from "../bridge/mount-selection";
import { useSyncPresentation } from "../bridge/use-sync-presentation";
import { DEVICES_HREF, openBridgeFile, revealBridgeFile } from "../bridge/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import {
  isProtectedOriginalWork,
  PROTECTED_ORIGINAL_TOGGLE,
} from "../bridge/sync-toggles";
import {
  artifactAccessBanner,
  sharedSessionIsReadOnly,
} from "./artifact-access-copy";
import { formatByteCount } from "../../../../shared/human-format";
import type { ArtifactTypeKey } from "../artifacts/types";
import {
  codeParameterSnapshot,
  normalizeCodeContent,
  type CodeFile,
} from "../code/model";
import { pythonChartToHtml } from "../code/python-chart";
import {
  runPythonInIsolatedWorker,
  type PythonRuntimeEvent,
} from "../code/python-runtime";
import { loadCodeRuntimeAssets } from "../code/runtime-assets-client";
import { publishArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { changedArtifactRegionIds } from "../collaboration/artifact-yjs-model";
import {
  isGeneratedArtifactSummary,
  refreshGeneratedArtifactSummary,
} from "../operations/hollow-content";
import {
  disengageFollow,
  noteFollowLocation,
  useFollow,
} from "../collaboration/follow";
import { stableAiActorId } from "../collaboration/ai-actor-id";
import {
  clearAiLocation,
  disengageFollowAi,
  noteAiLocation,
  useFollowAi,
} from "../collaboration/follow-ai";
import {
  HELD_DECLINED_EVENT,
  useHeldControlGuard,
  type HeldDeclinedDetail,
} from "../collaboration/held-controls";
import {
  resolveTargetElement,
  revealTarget,
  scheduleRevealTarget,
} from "../collaboration/interaction-geometry";
import { getSpectraMotionSnapshot } from "../motion/motion-level";
import {
  actorLabel,
  describeAct,
  describeState,
  pathSegments,
  stateIsVisible,
  type ActorIdentity,
  type InteractionState,
} from "../collaboration/interaction-model";
import { resolvePresenceAnchorFromPoint } from "../collaboration/presence-anchor";
import { useJoinLateArrival } from "../collaboration/presentation-lane";
import { targetAttrs } from "../collaboration/target-attributes";
import type { AdmittedUpdateDescriptor, CollaborationPresence } from "../collaboration/types";
import { useArtifactLiveModel } from "../collaboration/use-artifact-live-model";
import { usePresencePreview } from "../collaboration/scoped-hooks";
import { useInteractionPresence } from "../collaboration/use-interaction-presence";
import { contextSourceRegistry } from "../context";
import {
  getSpectraArtifactLinks,
  getSpectraArtifactVersions,
  getSpectraArtifactVersion,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactLink,
  type SpectraArtifactVersion,
  type SpectraArtifactVersionSummary,
} from "../data/api";
import type { SpectraSandboxAsset } from "../embed/sandbox-protocol";
import { spectraBus } from "../events";
import type { SpectraCommandOutcome } from "../events/contracts";
import { StudioViewportContext, withStudioViewportReady } from "./studio-viewport-ready";
import {
  normalizePresentationContent,
  presentationObjectText,
  type PresentationObject,
} from "../presentation/model";
import { normalizeSheetsContent, parseAddress } from "../sheets/model";
import { sharedTimetableContent } from "../timetable/model";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { encodeDocumentRelativeSelection } from "../work/models/yjs";
import { getWorkDefinition, workCan, type WorkType } from "../work/registry";
import {
  aiRegionAttr,
  contentDerivedHighlightPaths,
  creationHighlightFallbackPaths,
  materializeAiChangedPaths,
  preferStreamingContentSource,
  resolveAiHighlightPaths,
  updatingHighlightFallbackPaths,
} from "./ai-region-path";
import { useArtifactNativeSync } from "./artifact-native-sync";
import {
  nativeOfficeDraftPending,
  writeStudioDirty,
} from "./native-office-draft";
import {
  UnsavedCloseDialog,
  claimCloseAction,
  decideClose,
  persistableTitle,
} from "./artifact-persistence";
import { workTypeMeta } from "./artifact-card";
import { SpectraRichContent, SpectraStoredText } from "./spectra-rich-content";
import {
  identifyBlocks,
  richContentAst,
  richContentFromProseMirror,
  type RichBlockDraft,
  type SpectraRichContentAst,
} from "../rich-content";
import {
  ArtifactCommentsPanel,
  type ArtifactCommentRegion,
} from "./artifact-comments-panel";
import { ArtifactEmbedsPanel } from "./artifact-embeds-panel";
import { ArtifactDraftRecovery, describeLocalRecoveryFailure } from "./artifact-draft-recovery";
import { ChatBrowserButton } from "./chat-browser-panel";
import {
  WorkbarMenuAction,
  WorkbarSelect,
} from "./artifact-workbar";
import {
  downloadDocumentBlob,
} from "./artifact-studio-file-utils";
import {
  StudioContractProvider,
  StudioSplitShell,
  useStudioContractValue,
  useStudioDensity,
  useOptionalStudioContract,
  type StudioInspectorPanel,
  type StudioTab,
} from "./artifact-studio-shell";
import { dispatchFormatChrome } from "../commands";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";
import type { ApplicationCommandDispatcher } from "../commands/application-dispatcher";
import {
  decideRemoteStudioIncoming,
  createReconciliationSnapshotKey,
  incomingReconciliationKey,
  rebaseCollaborativeSnapshot,
  draftContentForLiveWrite,
  createStudioHistory,
  rememberLocalSyncKey,
  setAtPointers,
  studioHistoryShortcut,
  studioIncomingSource,
  tagsFromDraft,
} from "./artifact-studio-value-utils";
import {
  arrayOfRecords,
  record,
  type DeckCard,
  type QuizQuestion,
} from "./artifact-content-model";
export { tagsFromDraft } from "./artifact-studio-value-utils";
import {
  StudioInteractionLayer,
  StudioLegacyCursorLayer,
  StudioPresenceIndicator,
} from "./studio-presence-layer";
import { ContextSourceBoundary } from "./context-source-boundary";
import { ThreadConversation } from "./conversation-surface";
import { SandboxedArtifactRuntime } from "./sandboxed-artifact-runtime";
import { canPublishAgentArtifact } from "./agent-publish-gates";
import {
  artifactPlacements,
  formatRelativeTime,
  formatShortDate,
  linkedArtifacts,
} from "./spectra-view-model";
import { requestSpectra } from "../data/request";
import { isSingleTask } from "../plan/model";
function StudioTypePlaceholder() {
  return <div className="min-h-0 min-w-0 flex-1" role="status" aria-busy="true" aria-label="Opening editor" />;
}

const DocumentStudio = dynamic(
  () => import("./document-studio").then((module) => module.DocumentStudio),
  { loading: StudioTypePlaceholder },
);
const FlashcardStudio = dynamic(
  () => import("./flashcard-studio").then((module) => withStudioViewportReady(module.FlashcardStudio)),
  { loading: StudioTypePlaceholder },
);
const QuizStudio = dynamic(
  () => import("./quiz-studio").then((module) => withStudioViewportReady(module.QuizStudio)),
  { loading: StudioTypePlaceholder },
);
const PlanStudio = dynamic(
  () => import("./plan-studio").then((module) => withStudioViewportReady(module.PlanStudio)),
  { loading: StudioTypePlaceholder },
);
const TaskStudio = dynamic(
  () => import("./task-studio").then((module) => withStudioViewportReady(module.TaskStudio)),
  { loading: StudioTypePlaceholder },
);
const SheetsStudio = dynamic(
  () => import("./sheets-studio").then((module) => withStudioViewportReady(module.SheetsStudio)),
  { loading: StudioTypePlaceholder },
);
const CodeStudio = dynamic(
  () => import("./code-studio").then((module) => withStudioViewportReady(module.CodeStudio)),
  { loading: StudioTypePlaceholder },
);
const PresentationStudio = dynamic(
  () =>
    import("./presentation-studio").then((module) => withStudioViewportReady(module.PresentationStudio)),
  { loading: StudioTypePlaceholder },
);
const WhiteboardStudio = dynamic(
  () => import("./whiteboard-studio").then((module) => withStudioViewportReady(module.WhiteboardStudio)),
  { loading: StudioTypePlaceholder },
);
const TimetableStudio = dynamic(
  () => import("./timetable-studio").then((module) => withStudioViewportReady(module.TimetableStudio)),
  { loading: StudioTypePlaceholder },
);
const AgentFoundry = dynamic(
  () => import("./agent-foundry").then((module) => withStudioViewportReady(module.AgentFoundry)),
  { loading: StudioTypePlaceholder },
);

const WAVE_C_BLUEPRINTS = new Set([
  "presentation",
  "sheets",
  "code",
  "whiteboard",
  "timetable",
]);

function waveCIdentityStats(
  blueprintKey: SpectraArtifact["blueprintKey"],
  content: unknown,
): Array<[string, string]> | null {
  switch (blueprintKey) {
    case "presentation": {
      const deck = normalizePresentationContent(content);
      const minutes = Math.max(1, Math.ceil(deck.slides.length * 0.75));
      const complexity =
        deck.slides.length > 14
          ? "Complex"
          : deck.slides.length > 6
            ? "Medium"
            : "Light";
      return [
        [String(deck.slides.length), "Slides"],
        [`~${minutes} min`, "Est. time"],
        [complexity, "Complexity"],
      ];
    }
    case "sheets": {
      const workbook = normalizeSheetsContent(content);
      const sheet =
        workbook.sheets.find((item) => item.id === workbook.activeSheetId) ??
        workbook.sheets[0];
      if (!sheet) return null;
      const addresses = Object.keys(sheet.cells ?? {});
      let maxRow = 0;
      let maxCol = 0;
      for (const address of addresses) {
        const coordinate = parseAddress(address);
        if (!coordinate) continue;
        maxRow = Math.max(maxRow, coordinate.row + 1);
        maxCol = Math.max(maxCol, coordinate.column + 1);
      }
      const chartCount = (sheet.charts ?? []).length;
      return [
        [String(maxRow || addresses.length), "Rows"],
        [String(maxCol || 1), "Columns"],
        [String(chartCount), chartCount === 1 ? "Chart" : "Charts"],
      ];
    }
    case "code": {
      const project = normalizeCodeContent(content);
      const lines = project.files.reduce(
        (total, file) => total + file.source.split("\n").length,
        0,
      );
      const runtimeLabel =
        project.runtime === "none"
          ? "Source"
          : project.runtime === "python"
            ? "Python"
            : "Browser";
      return [
        [String(project.files.length), "Files"],
        [String(lines), "Lines"],
        [runtimeLabel, "Runtime"],
      ];
    }
    case "whiteboard": {
      const board = normalizeWhiteboardContent(content);
      const pageCount = board.pages.length;
      return [
        [String(pageCount), pageCount === 1 ? "Page" : "Pages"],
        [String(board.nodes.length), "Objects"],
        [String(board.edges.length), "Links"],
      ];
    }
    case "timetable": {
      const shared = sharedTimetableContent(content);
      const eventCount = shared.events.length;
      const layerCount = shared.layers.filter((layer) => layer.visible).length;
      const viewLabel =
        shared.view?.kind === "month"
          ? "Month"
          : shared.view?.kind === "day"
            ? "Day"
            : shared.view?.kind === "agenda"
              ? "Agenda"
              : "Week";
      return [
        [String(eventCount), "Events"],
        [String(layerCount), "Calendars"],
        [viewLabel, "View"],
      ];
    }
    default:
      return null;
  }
}


function pointerSegments(path: string) {
  return path === "/"
    ? []
    : path
        .split("/")
        .slice(1)
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function valueAtPointer(value: unknown, path: string) {
  let current = value;
  for (const segment of pointerSegments(path)) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const ARTIFACT_LIVE_METADATA_POINTERS = new Set([
  "/title",
  "/summary",
  "/tags",
]);

/**
 * Protocol-v2 canonical paths are content-relative: `/content/blocks/1/text`
 * travels over awareness as `/blocks/1/text`. Reattach the live-value envelope
 * only at the boundary that projects a patch over `{title, summary, tags,
 * content}`. Legacy frames that still include `/content` remain valid.
 */
function livePreviewOuterPointer(path: string) {
  if (path === "/content" || path.startsWith("/content/")) return path;
  if (ARTIFACT_LIVE_METADATA_POINTERS.has(path)) return path;
  return path === "/" ? "/content" : `/content${path}`;
}

/** Content-relative destination for a canonical live patch. */
function livePreviewContentPointer(path: string): string | null {
  if (ARTIFACT_LIVE_METADATA_POINTERS.has(path)) return null;
  if (path === "/content") return "/";
  if (path.startsWith("/content/")) return path.slice("/content".length);
  return path;
}

function mergeAiRegions(
  local: unknown,
  preview: unknown,
  changedPaths: string[],
) {
  if (preview === undefined) return local;
  if (!changedPaths.length || changedPaths.includes("/")) return preview;
  return setAtPointers(
    local,
    changedPaths.map((path) => [path, valueAtPointer(preview, path)] as const),
  );
}

function semanticPathToPointer(path: readonly (string | number)[]) {
  return `/${path
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .join("/")}`;
}

type ArtifactSnapshot = {
  title: string;
  summary?: string;
  content: unknown;
  tags: string[];
};

function ReadonlyCodeSnapshot({
  artifactId,
  content,
}: {
  artifactId: string;
  content: unknown;
}) {
  const code = useMemo(() => normalizeCodeContent(content), [content]);
  const [view, setView] = useState<"source" | "preview">("source");
  const [activeFileId, setActiveFileId] = useState(code.entryFileId);
  const [previewFiles, setPreviewFiles] = useState<CodeFile[] | null>(null);
  const [state, setState] = useState<"idle" | "building" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(
    "Historical source is inert until you explicitly rebuild it.",
  );
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [historicalAssets, setHistoricalAssets] = useState<
    SpectraSandboxAsset[]
  >([]);
  const pythonRef = useRef<{ cancel: () => void } | null>(null);
  const sequenceRef = useRef(0);
  const activeFile =
    code.files.find((file) => file.id === activeFileId) ?? code.files[0]!;

  useEffect(() => () => pythonRef.current?.cancel(), []);

  function pythonEvent(event: PythonRuntimeEvent, sequence: number) {
    if (sequence !== sequenceRef.current) return;
    if (event.type === "status") {
      setState("building");
      setMessage(
        event.status === "loading"
          ? "Loading the isolated Python runtime…"
          : "Running this historical checkpoint…",
      );
    } else if (event.type === "stdout" || event.type === "stderr") {
      setConsoleLines((current) => [...current, event.text].slice(-80));
    } else if (event.type === "render" || event.type === "chart") {
      try {
        setPreviewFiles([
          {
            id: "historical-python-preview",
            path: "index.html",
            language: "html",
            source:
              event.type === "render"
                ? event.html
                : pythonChartToHtml(event.spec),
          },
        ]);
      } catch (error) {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "The historical chart is invalid.",
        );
      }
    } else if (event.type === "complete") {
      if (event.result)
        setConsoleLines((current) => [...current, event.result!].slice(-80));
      setState("ready");
      setMessage("Historical Python run completed in a disposable worker.");
      pythonRef.current = null;
    } else {
      setState("error");
      setMessage(
        "message" in event ? event.message : "The historical runtime stopped.",
      );
      pythonRef.current = null;
    }
  }

  async function rebuild() {
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    pythonRef.current?.cancel();
    pythonRef.current = null;
    setState("building");
    setMessage("Rebuilding this checkpoint with its recorded runtime profile…");
    setConsoleLines([]);
    setPreviewFiles(null);
    setHistoricalAssets([]);
    setView("preview");
    if (code.runtime === "none") {
      setState("error");
      setMessage("This checkpoint uses a source-only language profile.");
      return;
    }
    let assets: SpectraSandboxAsset[] = [];
    if (code.assets?.length) {
      try {
        const loaded = await loadCodeRuntimeAssets(artifactId, code.assets);
        if (loaded.diagnostics.length) {
          setState("error");
          setMessage(
            `Historical playback is unavailable: ${loaded.diagnostics.join(" ")}`,
          );
          return;
        }
        assets = loaded.assets;
        setHistoricalAssets(assets);
      } catch {
        setState("error");
        setMessage(
          "Historical permission-bound assets could not be verified. Source remains available.",
        );
        return;
      }
    }
    if (code.runtime === "browser") {
      try {
        const response = await requestSpectra("/api/spectra/runtime/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runtime: "browser",
            entryFileId: code.entryFileId,
            files: code.files,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          build?: { files: CodeFile[] };
          errors?: Array<{ message?: string }>;
        } | null;
        if (sequence !== sequenceRef.current) return;
        if (!response.ok || !payload?.build)
          throw new Error(
            payload?.errors?.[0]?.message ||
              "This historical browser source could not be prepared safely.",
          );
        setPreviewFiles(payload.build.files);
        setState("ready");
        setMessage(
          "Historical browser source rebuilt with synchronous-loop guards.",
        );
      } catch (error) {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Historical browser source could not be rebuilt.",
        );
      }
      return;
    }
    if (code.runtime === "python") {
      try {
        pythonRef.current = runPythonInIsolatedWorker({
          files: code.files,
          entryFileId: code.entryFileId,
          parameters: codeParameterSnapshot(code),
          assets,
          onEvent: (event) => pythonEvent(event, sequence),
        });
      } catch (error) {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Historical Python could not start.",
        );
      }
      return;
    }
    try {
      const response = await requestSpectra("/api/spectra/runtime/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtime: "react",
          entryFileId: code.entryFileId,
          files: code.files,
          dependencies: code.dependencies ?? {},
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        build?: { js: string; css: string };
        errors?: Array<{ message?: string }>;
      } | null;
      if (!response.ok || !payload?.ok || !payload.build)
        throw new Error(
          payload?.errors?.[0]?.message ||
            "This checkpoint can no longer be rebuilt with its recorded dependencies.",
        );
      if (sequence !== sequenceRef.current) return;
      setPreviewFiles([
        {
          id: "historical-react-root",
          path: "index.html",
          language: "html",
          source: '<main id="root"></main>',
        },
        {
          id: "historical-react-css",
          path: "styles.css",
          language: "css",
          source: payload.build.css,
        },
        {
          id: "historical-react-js",
          path: "bundle.js",
          language: "javascript",
          source: payload.build.js,
        },
      ]);
      setState("ready");
      setMessage(
        "Historical React source rebuilt with the recorded allowlist.",
      );
    } catch (error) {
      if (sequence !== sequenceRef.current) return;
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The historical preview could not be rebuilt.",
      );
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView("source")}
            className={`code-pane-tab ${view === "source" ? "is-active" : ""}`}
          >
            <Code2 className="h-3 w-3" />
            Source
          </button>
          <button
            type="button"
            onClick={() => setView("preview")}
            className={`code-pane-tab ${view === "preview" ? "is-active" : ""}`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
        <button
          type="button"
          onClick={() => void rebuild()}
          disabled={state === "building" || code.runtime === "none"}
          className="code-small-action border border-[var(--border-default)] disabled:opacity-40"
        >
          {state === "building" ? (
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <Play className="h-3 w-3 fill-current" />
          )}
          Rebuild safely
        </button>
      </header>
      {view === "source" ? (
        <div className="grid min-h-[360px] sm:grid-cols-[180px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] p-2 sm:border-b-0 sm:border-r">
            {code.files.map((file) => (
              <button
                type="button"
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                className={`flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-micro ${file.id === activeFile.id ? "bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
              >
                <FileText className="h-3 w-3" />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </aside>
          <div className="min-w-0 bg-[var(--text-primary)] text-[var(--bg-tertiary)]">
            <div className="border-b border-white/10 px-3 py-2 text-micro text-white/55">
              {activeFile.path} · {activeFile.language}
            </div>
            <pre className="max-h-[520px] overflow-auto p-4 font-mono text-micro leading-4">
              {activeFile.source}
            </pre>
          </div>
        </div>
      ) : (
        <div className="p-2">
          <p
            className={`mb-2 rounded-chip px-2 py-1.5 text-micro ${state === "error" ? "bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-primary))] text-[var(--danger)]" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}
          >
            {message}
          </p>
          {previewFiles ? (
            <SandboxedArtifactRuntime
              title="Historical code preview"
              description={
                code.accessibility?.description ||
                code.visualisation.description
              }
              files={previewFiles}
              assets={historicalAssets}
              compact={false}
              toolbar={false}
              viewportHeight={460}
              parameters={codeParameterSnapshot(code)}
              forceReducedMotion={code.accessibility?.reducedMotion === true}
              networkAllowlist={
                code.runtime !== "python" &&
                code.networkPolicy?.mode === "allowlist"
                  ? code.networkPolicy.allowlist
                  : undefined
              }
            />
          ) : consoleLines.length ? (
            <pre className="max-h-[360px] overflow-auto rounded-control bg-[var(--text-primary)] p-4 font-mono text-micro leading-4 text-[var(--bg-tertiary)]">
              {consoleLines.join("\n")}
            </pre>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center text-center text-micro text-[var(--text-tertiary)]">
              Choose Rebuild safely to render this inert checkpoint.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A document checkpoint as the shared model: its editor JSON when the
 * checkpoint carries one, otherwise its semantic blocks as plain text.
 */
function snapshotDocumentContent(
  body: Record<string, unknown>,
): SpectraRichContentAst {
  const doc = record(body.tiptap);
  if (doc.type === "doc") return richContentFromProseMirror(doc);
  return richContentAst(
    arrayOfRecords(body.blocks).map((block): RichBlockDraft => {
      const content = [
        { type: "text" as const, text: typeof block.text === "string" ? block.text : "" },
      ];
      if (block.type === "heading") return { type: "heading", level: 2, content };
      if (block.type === "callout")
        return {
          type: "callout",
          tone: "info",
          blocks: identifyBlocks([{ type: "paragraph", content }]),
        };
      return { type: "paragraph", content };
    }),
  );
}

function ReadonlyArtifactSnapshot({
  artifactId,
  blueprintKey,
  snapshot,
}: {
  artifactId: string;
  blueprintKey: SpectraArtifact["blueprintKey"];
  snapshot: ArtifactSnapshot;
}) {
  const body = record(
    blueprintKey === "sheets"
      ? normalizeSheetsContent(snapshot.content)
      : snapshot.content,
  );
  const cards =
    blueprintKey === "flashcard_deck" ? deckCards(snapshot.content) : [];
  const questions =
    blueprintKey === "quiz" ? quizQuestions(snapshot.content) : [];
  const documentContent =
    blueprintKey === "document" ? snapshotDocumentContent(body) : null;
  const subtasks =
    blueprintKey === "planner_task" ? arrayOfRecords(body.subtasks) : [];
  const slides =
    blueprintKey === "presentation" ? arrayOfRecords(body.slides) : [];
  const sheets = blueprintKey === "sheets" ? arrayOfRecords(body.sheets) : [];
  const nodes = blueprintKey === "whiteboard" ? arrayOfRecords(body.nodes) : [];
  const edges = blueprintKey === "whiteboard" ? arrayOfRecords(body.edges) : [];
  const events =
    blueprintKey === "timetable" ? arrayOfRecords(body.events) : [];
  return (
    <article className="min-h-full bg-[var(--bg-primary)] px-5 py-6 text-[var(--text-primary)]">
      <h3 className="font-display text-metric font-semibold leading-tight">
        {snapshot.title}
      </h3>
      {snapshot.summary ? (
        <p className="mt-2 text-caption leading-5 text-[var(--text-secondary)]">
          {snapshot.summary}
        </p>
      ) : null}
      {documentContent ? (
        <SpectraRichContent ast={documentContent} className="mt-7" />
      ) : null}
      {blueprintKey === "flashcard_deck" ? (
        <div className="mt-6 grid gap-3">
          {cards.map((card, index) => (
            <section
              key={card.id}
              className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--brand-primary)]">
                Card {index + 1} · {card.section}
              </div>
              <SpectraStoredText
                value={card.front}
                className="mt-2 font-display text-title font-semibold"
              />
              <SpectraStoredText
                value={card.back}
                className="mt-3 text-caption leading-5 text-[var(--text-secondary)]"
              />
              {card.hint ? (
                <div className="mt-3 rounded-control bg-[color-mix(in_oklab,var(--brand-primary)_6%,var(--bg-primary))] px-3 py-2 text-micro text-[var(--text-secondary)]">
                  {card.hint}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
      {blueprintKey === "quiz" ? (
        <div className="mt-6 grid gap-3">
          {questions.map((question, index) => (
            <section
              key={question.id}
              className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--accent-mint)]">
                Question {index + 1}
              </div>
              <SpectraStoredText
                value={question.prompt}
                className="mt-2 font-display text-title font-semibold"
              />
              {question.options?.length ? (
                <ol className="mt-3 space-y-1.5 text-caption text-[var(--text-secondary)]">
                  {question.options.map((option, optionIndex) => (
                    <li
                      key={`${question.id}:${optionIndex}`}
                      className="rounded-control border border-[var(--border-subtle)] px-3 py-2"
                    >
                      {String.fromCharCode(65 + optionIndex)}.{" "}
                      <SpectraStoredText inline value={option} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
      {blueprintKey === "planner_task" ? (
        <div className="mt-6 space-y-4">
          <section className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="grid grid-cols-2 gap-4 text-micro">
              <div>
                <span className="block text-[var(--text-tertiary)]">
                  Status
                </span>
                <strong className="mt-1 block capitalize">
                  {String(body.status ?? "Not set")}
                </strong>
              </div>
              <div>
                <span className="block text-[var(--text-tertiary)]">
                  Priority
                </span>
                <strong className="mt-1 block capitalize">
                  {String(body.priority ?? "Not set")}
                </strong>
              </div>
            </div>
          </section>
          {subtasks.map((task, index) => (
            <div
              key={String(task.id ?? index)}
              className="flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-caption"
            >
              <span
                className={`h-4 w-4 rounded-full border ${task.completed ? "border-[var(--success)] bg-[var(--success)]" : "border-[var(--border-default)]"}`}
              />
              <span>{String(task.title ?? task.text ?? "Untitled step")}</span>
            </div>
          ))}
        </div>
      ) : null}
      {blueprintKey === "presentation" ? (
        <div className="mt-6 grid gap-3">
          {slides.map((slide, index) => (
            <section
              key={String(slide.id ?? index)}
              className="overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]"
            >
              <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
                <span className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
                  Slide {index + 1}
                </span>
                <h4 className="mt-1 font-display text-subhead font-semibold leading-tight">
                  {String(slide.title ?? "Untitled slide")}
                </h4>
              </header>
              <div className="space-y-2 p-3">
                {arrayOfRecords(slide.objects)
                  .filter((object) => object.hidden !== true)
                  .sort(
                    (left, right) =>
                      Number(left.readingOrder ?? 0) -
                      Number(right.readingOrder ?? 0),
                  )
                  .slice(0, 8)
                  .map((object, objectIndex) => (
                    <div
                      key={String(object.id ?? objectIndex)}
                      className="rounded-control border border-[var(--border-subtle)] px-2.5 py-2"
                    >
                      <span className="block text-micro font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                        {humanizeKey(String(object.type ?? "object"))}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap text-micro leading-4 text-[var(--text-secondary)]">
                        {historyPresentationObjectSummary(object)}
                      </p>
                    </div>
                  ))}
                {arrayOfRecords(slide.objects).length === 0 ? (
                  <p className="py-3 text-micro text-[var(--text-tertiary)]">
                    Empty slide
                  </p>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {blueprintKey === "sheets" ? (
        <div className="mt-6 space-y-4">
          {sheets.map((sheet, index) => {
            const cells = record(sheet.cells);
            const visibleCells = Object.entries(cells)
              .filter(([, value]) => {
                if (
                  value === null ||
                  typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "boolean"
                )
                  return true;
                const cell = record(value);
                return cell.value !== undefined || cell.formula !== undefined;
              })
              .slice(0, 48);
            return (
              <section
                key={String(sheet.id ?? index)}
                className="overflow-hidden rounded-card border border-[var(--border-default)]"
              >
                <header className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-micro font-semibold">
                  {String(sheet.name ?? `Sheet ${index + 1}`)}
                </header>
                <div className="grid grid-cols-4 gap-px bg-[var(--border-subtle)]">
                  {visibleCells.map(([address, value]) => (
                    <div
                      key={address}
                      className="min-h-10 bg-[var(--bg-elevated)] px-2 py-1"
                    >
                      <span className="block text-micro text-[var(--text-tertiary)]">
                        {address}
                      </span>
                      <span className="block truncate text-micro">
                        {humanValue(
                          record(value).value ?? record(value).formula ?? value,
                        )}
                      </span>
                    </div>
                  ))}
                  {visibleCells.length === 0 ? (
                    <div className="col-span-4 p-8 text-center text-micro text-[var(--text-tertiary)]">
                      Empty sheet
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {blueprintKey === "code" ? (
        <ReadonlyCodeSnapshot
          artifactId={artifactId}
          content={snapshot.content}
        />
      ) : null}
      {blueprintKey === "whiteboard" ? (
        <div className="relative mt-6 min-h-[430px] overflow-hidden rounded-card border border-[var(--border-default)] bg-[radial-gradient(circle_at_1px_1px,var(--border-subtle)_1px,transparent_0)] bg-[size:20px_20px]">
          {edges.map((edge, index) => (
            <div
              key={String(edge.id ?? index)}
              className="absolute h-px w-24 origin-left bg-[var(--border-strong)]"
              style={{
                left: `${10 + index * 11}%`,
                top: `${24 + index * 13}%`,
                transform: `rotate(${12 + index * 17}deg)`,
              }}
            />
          ))}
          {nodes.map((node, index) => (
            <div
              key={String(node.id ?? index)}
              className="absolute max-w-[150px] rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-micro shadow-sm"
              style={{
                left: `${8 + ((index * 27) % 72)}%`,
                top: `${10 + ((index * 31) % 72)}%`,
              }}
            >
              {String(
                node.text ?? node.content ?? node.label ?? node.type ?? "Node",
              )}
            </div>
          ))}
          {nodes.length === 0 ? (
            <div className="flex min-h-[430px] items-center justify-center text-micro text-[var(--text-tertiary)]">
              Empty canvas
            </div>
          ) : null}
        </div>
      ) : null}
      {blueprintKey === "timetable" ? (
        <div className="mt-6 space-y-2">
          {events.map((event, index) => (
            <section
              key={String(event.id ?? index)}
              className="flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3"
            >
              <CalendarCheck2 className="h-4 w-4 text-[var(--accent-cyan)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-micro font-semibold">
                  {String(event.title ?? "Untitled event")}
                </div>
                <div className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                  {typeof event.start === "string"
                    ? new Date(event.start).toLocaleString()
                    : typeof event.startAt === "number"
                      ? new Date(event.startAt).toLocaleString()
                      : "Time not set"}
                  {typeof event.end === "string"
                    ? ` – ${new Date(event.end).toLocaleString()}`
                    : typeof event.endAt === "number"
                      ? ` – ${new Date(event.endAt).toLocaleString()}`
                      : ""}
                </div>
              </div>
            </section>
          ))}
          {events.length === 0 ? (
            <p className="text-micro text-[var(--text-tertiary)]">
              No calendar events.
            </p>
          ) : null}
        </div>
      ) : null}
      {blueprintKey === "agent" ? (
        <div className="mt-6 grid gap-4">
          <section className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)]">
              Instructions
            </div>
            <p className="mt-2 whitespace-pre-wrap text-caption leading-6 text-[var(--text-primary)]">
              {String(record(body.instructions).text ?? "No instructions")}
            </p>
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricSnapshot
              label="Skills"
              values={arrayOfRecords(body.skills)}
            />
            <MetricSnapshot label="Tools" values={arrayOfRecords(body.tools)} />
            <MetricSnapshot
              label="Resources"
              values={arrayOfRecords(body.resources)}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function historyPresentationObjectSummary(
  value: Record<string, unknown>,
): string {
  const object = value as unknown as PresentationObject;
  const directText = presentationObjectText(object).trim();
  if (directText) return directText.slice(0, 520);
  const content = record(value.content);
  if (Array.isArray(content.rows)) {
    return content.rows
      .slice(0, 4)
      .map((row) =>
        Array.isArray(row)
          ? row.map((cell) => String(cell ?? "")).join(" · ")
          : String(row ?? ""),
      )
      .join("\n")
      .slice(0, 520);
  }
  if (Array.isArray(content.labels)) {
    const chartType = humanizeKey(String(content.chartType ?? "chart"));
    return `${chartType} · ${content.labels.slice(0, 6).map(String).join(", ")}`;
  }
  if (typeof value.altText === "string" && value.altText.trim())
    return value.altText.trim();
  const binding = record(value.sourceBinding);
  if (typeof binding.artifactId === "string")
    return `Linked ${humanizeKey(String(binding.kind ?? "artifact"))}`;
  return `${humanizeKey(String(value.type ?? "object"))} object`;
}

function MetricSnapshot({
  label,
  values,
}: {
  label: string;
  values: Record<string, unknown>[];
}) {
  return (
    <section className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
      <div className="text-micro font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-heading font-semibold text-[var(--text-primary)]">
        {values.length}
      </div>
      <p className="mt-1 line-clamp-3 text-micro leading-4 text-[var(--text-secondary)]">
        {values
          .slice(0, 4)
          .map((value) =>
            String(value.name ?? value.title ?? value.key ?? "Item"),
          )
          .join(", ") || "None configured"}
      </p>
    </section>
  );
}

function historyKind(version: SpectraArtifactVersion) {
  if (version.name) return version.name;
  if (version.source === "ai") return "AI edit";
  if (version.source === "restore" || version.source === "revert")
    return "Restored version";
  if (version.source === "checkpoint") return "User checkpoint";
  if (version.source === "import") return "Imported version";
  if (version.source === "migration") return "Migrated version";
  return "User edit";
}

function HistoryComparisonOverlay({
  artifact,
  current,
  versions,
  selected,
  changes,
  selectedRegions,
  busyVersionId,
  listLoading,
  listError,
  hasMore,
  previewLoading,
  previewError,
  readOnly,
  onSelect,
  onLoadMore,
  onRetryList,
  onSelectedRegionsChange,
  onRestore,
  onCreateCheckpoint,
  onClose,
}: {
  artifact: SpectraArtifact;
  current: ArtifactSnapshot;
  versions: SpectraArtifactVersionSummary[];
  selected: SpectraArtifactVersion | null;
  changes: HumanChange[];
  selectedRegions: Set<string>;
  busyVersionId: string | null;
  listLoading: boolean;
  listError: string | null;
  hasMore: boolean;
  previewLoading: boolean;
  previewError: string | null;
  readOnly: boolean;
  onSelect: (version: SpectraArtifactVersionSummary) => void;
  onLoadMore: () => void;
  onRetryList: () => void;
  onSelectedRegionsChange: (regions: Set<string>) => void;
  onRestore: (
    version: SpectraArtifactVersion,
    regions?: readonly string[],
  ) => void;
  onCreateCheckpoint: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const [split, setSplit] = useState(50);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointName, setCheckpointName] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const element = comparisonRef.current;
    if (!element) return;
    const move = (pointer: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      setSplit(
        Math.max(
          30,
          Math.min(70, ((pointer.clientX - bounds.left) / bounds.width) * 100),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  async function createCheckpoint() {
    const name = checkpointName.trim();
    if (!name) return;
    setCheckpointBusy(true);
    setCheckpointError(null);
    try {
      await onCreateCheckpoint(name);
      setCheckpointName("");
      setCheckpointOpen(false);
    } catch (error) {
      setCheckpointError(
        error instanceof Error
          ? error.message
          : "Could not create this checkpoint.",
      );
    } finally {
      setCheckpointBusy(false);
    }
  }

  return (
    <section
      className="absolute inset-0 z-composer-dock flex min-h-0 flex-col bg-[var(--bg-primary)] pb-[88px]"
      aria-label="Version history comparison"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <History className="h-4 w-4 text-[var(--text-secondary)]" />
          <span className="text-ui font-medium text-[var(--text-secondary)]">
            Comparing versions
          </span>
          {selected ? (
            <span className="truncate rounded-chip bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-secondary))] px-2 py-1 text-caption font-medium text-[var(--brand-primary)]">
              Previewing {historyKind(selected)} from{" "}
              {new Date(selected.createdAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 items-center gap-1.5 rounded-control px-2.5 text-ui font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
        >
          <X className="h-3.5 w-3.5" />
          Close comparison
        </button>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="flex min-h-0 flex-col border-r border-[var(--border-default)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="truncate font-display text-editor font-semibold text-[var(--text-primary)]">
                {artifact.title}
              </h2>
              <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                This earlier version is for reference only. Your current work stays editable after you close the comparison.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowChanges((value) => !value)}
              className={`h-8 rounded-control border px-3 text-micro font-medium ${showChanges ? "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
            >
              {showChanges
                ? "Show comparison"
                : `${changes.length} changed ${changes.length === 1 ? "field" : "fields"}`}
            </button>
          </div>
          {selected?.after ? (
            showChanges ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
                {changes.map((change, index) => (
                  <article
                    key={`${index}:${change.label}`}
                    className="overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                  >
                    <header className="border-b border-[var(--border-subtle)] px-3 py-2">
                      <label className="flex cursor-pointer items-center gap-2 text-micro font-semibold text-[var(--text-primary)]">
                        <input
                          type="checkbox"
                          disabled={!change.regionId || readOnly}
                          checked={Boolean(
                            change.regionId &&
                            selectedRegions.has(change.regionId),
                          )}
                          onChange={(event) => {
                            if (!change.regionId) return;
                            const next = new Set(selectedRegions);
                            if (event.target.checked) next.add(change.regionId);
                            else next.delete(change.regionId);
                            onSelectedRegionsChange(next);
                          }}
                          className="h-3.5 w-3.5 accent-[var(--accent-cyan)]"
                        />
                        {change.label}
                      </label>
                    </header>
                    <div className="grid md:grid-cols-2">
                      <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--danger)_3%,var(--bg-primary))] p-3 md:border-b-0 md:border-r">
                        <div className="mb-1.5 text-micro font-semibold uppercase tracking-[.1em] text-[var(--danger)]">
                          Selected version
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-micro leading-4 text-[var(--text-secondary)]">
                          {change.before}
                        </pre>
                      </div>
                      <div className="bg-[color-mix(in_oklab,var(--accent-cyan)_3%,var(--bg-primary))] p-3">
                        <div className="mb-1.5 text-micro font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)]">
                          Current live
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-micro leading-4 text-[var(--text-primary)]">
                          {change.after}
                        </pre>
                      </div>
                    </div>
                  </article>
                ))}
                {changes.length === 0 ? (
                  <div className="flex min-h-[260px] items-center justify-center text-micro text-[var(--text-secondary)]">
                    This version matches your current work.
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                ref={comparisonRef}
                className="grid min-h-0 flex-1 overflow-hidden"
                style={{ gridTemplateColumns: `${split}% 8px minmax(0,1fr)` }}
              >
                <section className="min-h-0 overflow-auto">
                  <div className="sticky top-0 z-chrome flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 py-2 backdrop-blur">
                    <span className="text-micro font-semibold text-[var(--text-primary)]">
                      {historyKind(selected)}
                    </span>
                    <span className="rounded-chip bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-secondary))] px-1.5 py-0.5 text-micro font-medium text-[var(--brand-primary)]">
                      Preview only
                    </span>
                  </div>
                  <ReadonlyArtifactSnapshot
                    artifactId={artifact._id}
                    blueprintKey={artifact.blueprintKey}
                    snapshot={selected.after}
                  />
                </section>
                <button
                  type="button"
                  onPointerDown={startResize}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft")
                      setSplit((value) => Math.max(30, value - 2));
                    if (event.key === "ArrowRight")
                      setSplit((value) => Math.min(70, value + 2));
                  }}
                  className="group relative cursor-col-resize border-x border-[var(--border-subtle)] bg-[var(--bg-secondary)] outline-none focus:bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-secondary))]"
                  aria-label="Resize version comparison"
                  aria-valuemin={30}
                  aria-valuemax={70}
                  aria-valuenow={Math.round(split)}
                  role="separator"
                >
                  <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--border-strong)] group-hover:bg-[var(--accent-cyan)]" />
                </button>
                <section className="min-h-0 overflow-auto">
                  <div className="sticky top-0 z-chrome flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 py-2 backdrop-blur">
                    <span className="text-micro font-semibold text-[var(--text-primary)]">
                      Current live version
                    </span>
                    <span className="rounded-chip bg-[color-mix(in_oklab,var(--success)_8%,var(--bg-secondary))] px-1.5 py-0.5 text-micro font-medium text-[var(--success)]">
                      Live
                    </span>
                  </div>
                  <ReadonlyArtifactSnapshot
                    artifactId={artifact._id}
                    blueprintKey={artifact.blueprintKey}
                    snapshot={current}
                  />
                </section>
              </div>
            )
          ) : previewLoading ? (
            <div role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-8 text-micro text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading saved version…
            </div>
          ) : previewError ? (
            <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-micro text-[var(--text-secondary)]">
              <p>{previewError}</p>
              {selected ? <button type="button" onClick={() => onSelect(selected)} className="h-8 rounded-control border border-[var(--border-default)] px-3">Retry preview</button> : null}
            </div>
          ) : selected ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-[380px]">
                <AlertCircle className="mx-auto h-5 w-5 text-[var(--warning)]" />
                <h4 className="mt-3 text-micro font-semibold text-[var(--text-primary)]">
                  This version cannot be rendered
                </h4>
                <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
                  Its retained snapshot is{" "}
                  {selected.snapshotState === "corrupt"
                    ? "damaged"
                    : "unavailable"}
                  . Later history remains intact and this version cannot be
                  restored until repaired.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-micro text-[var(--text-secondary)]">
              Select a version from the timeline.
            </div>
          )}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
            <div>
              <div className="text-micro font-semibold text-[var(--text-primary)]">
                Restore creates a new version
              </div>
              <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                Nothing in the later timeline is overwritten or deleted.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  !selected?.after ||
                  readOnly ||
                  selectedRegions.size === 0 ||
                  Boolean(busyVersionId)
                }
                onClick={() =>
                  selected?.after && onRestore(selected, [...selectedRegions])
                }
                className="h-8 rounded-control border border-[var(--border-default)] px-3 text-micro font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
              >
                Restore {selectedRegions.size} selected
              </button>
              <button
                type="button"
                disabled={
                  !selected?.after || readOnly || Boolean(busyVersionId)
                }
                onClick={() => selected?.after && onRestore(selected)}
                className="inline-flex h-8 items-center gap-1.5 rounded-control bg-[var(--brand-primary)] px-3 text-micro font-semibold text-[var(--text-inverse)] disabled:opacity-35"
              >
                {busyVersionId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Restore as new version
              </button>
            </div>
          </footer>
        </main>
        <aside className="flex min-h-0 flex-col bg-[var(--bg-elevated)]">
          <header className="flex shrink-0 items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div>
              <h3 className="text-caption font-semibold text-[var(--text-primary)]">
                Version history
              </h3>
              <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                {versions.length} versions loaded{hasMore ? " · more available" : ""}
              </p>
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => {
                  setCheckpointOpen((value) => !value);
                  setCheckpointError(null);
                }}
                className="flex h-7 items-center gap-1 rounded-chip px-2 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Plus className="h-3 w-3" />
                Checkpoint
              </button>
            ) : null}
          </header>
          {checkpointOpen ? (
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
              <label
                className="text-micro font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]"
                htmlFor="history-checkpoint-name"
              >
                Checkpoint name
              </label>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  id="history-checkpoint-name"
                  value={checkpointName}
                  onChange={(event) => {
                    setCheckpointName(event.target.value.slice(0, 180));
                    setCheckpointError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createCheckpoint();
                  }}
                  autoFocus
                  placeholder="e.g. Before teacher review"
                  className="h-8 min-w-0 flex-1 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-micro text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  disabled={!checkpointName.trim() || checkpointBusy}
                  onClick={() => void createCheckpoint()}
                  className="h-8 rounded-control bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-35"
                >
                  {checkpointBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
              {checkpointError ? (
                <p
                  role="alert"
                  className="mt-2 text-micro leading-4 text-[var(--danger)]"
                >
                  {checkpointError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="relative mb-1 flex gap-3 rounded-control px-3 py-2.5">
              <span className="relative z-chrome mt-1.5 h-2 w-2 rounded-full bg-[var(--success)]" />
              <div className="absolute bottom-[-8px] left-[18px] top-5 w-px bg-[var(--border-default)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-micro font-semibold text-[var(--text-primary)]">
                    Live
                  </span>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Now
                  </span>
                </div>
                <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                  Current synchronized state
                </p>
              </div>
            </div>
            {versions.map((version, index) => {
              const selectedVersion = selected?._id === version._id;
              const creator =
                version.source === "ai"
                  ? "Spectra AI"
                  : version.creators?.map((entry) => entry.name).join(", ") ||
                    "A collaborator";
              return (
                <button
                  type="button"
                  key={version._id}
                  onClick={() => onSelect(version)}
                  disabled={busyVersionId !== null}
                  className={`relative flex w-full gap-3 rounded-control border px-3 py-2.5 text-left ${selectedVersion ? "border-[color-mix(in_oklab,var(--brand-primary)_50%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-primary))]" : "border-transparent hover:bg-[var(--bg-hover)]"}`}
                >
                  <span
                    className={`relative z-chrome mt-1.5 h-2 w-2 shrink-0 rounded-full ${version.source === "ai" ? "bg-[var(--brand-primary)]" : version.source === "restore" || version.source === "revert" ? "bg-[#278bd8]" : version.source === "checkpoint" ? "bg-[var(--brand-primary)]" : "bg-[var(--text-secondary)]"}`}
                  />
                  {index < versions.length - 1 ? (
                    <span className="absolute bottom-[-8px] left-[18px] top-5 w-px bg-[var(--border-default)]" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-micro font-semibold text-[var(--text-primary)]">
                        {version.name || historyKind(version)}
                      </span>
                      <span className="shrink-0 text-micro text-[var(--text-tertiary)]">
                        {new Date(version.createdAt).toLocaleString([], {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-secondary)]">
                        {historyKind(version)}
                      </span>
                      <span className="truncate text-micro text-[var(--text-tertiary)]">
                        {creator}
                      </span>
                    </span>
                    {version.summary ? (
                      <span className="mt-1 block line-clamp-2 text-micro leading-3.5 text-[var(--text-tertiary)]">
                        {version.summary}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {listError ? (
              <div role="alert" className="px-4 py-3 text-micro text-[var(--text-secondary)]">
                <p>{listError}</p>
                <button type="button" onClick={onRetryList} disabled={listLoading} className="mt-2 h-8 rounded-control border border-[var(--border-default)] px-3">Retry history</button>
              </div>
            ) : null}
            {listLoading ? (
              <p role="status" className="px-4 py-3 text-micro text-[var(--text-secondary)]">Loading history…</p>
            ) : hasMore && !listError ? (
              <button type="button" onClick={onLoadMore} className="m-2 h-8 rounded-control border border-[var(--border-default)] px-3 text-micro text-[var(--text-primary)]">Load older versions</button>
            ) : null}
            {versions.length === 0 && !listLoading && !listError ? (
              <div className="px-4 py-10 text-center text-micro leading-5 text-[var(--text-tertiary)]">
                Meaningful human and AI editing sessions will appear here.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

type HumanChange = {
  label: string;
  before: string;
  after: string;
  path: string[];
  regionId?: string;
};

function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function humanValue(value: unknown) {
  if (value == null || value === "") return "Not set";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ") || "None";
  return JSON.stringify(value, null, 2);
}

function humanFieldLabel(path: string[]) {
  const clean = path[0] === "content" ? path.slice(1) : path;
  if (clean[0] === "cards" && /^\d+$/.test(clean[1] ?? ""))
    return `Card ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "questions" && /^\d+$/.test(clean[1] ?? ""))
    return `Question ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "blocks" && /^\d+$/.test(clean[1] ?? ""))
    return `Document block ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  if (clean[0] === "subtasks" && /^\d+$/.test(clean[1] ?? ""))
    return `Subtask ${Number(clean[1]) + 1} · ${clean.slice(2).map(humanizeKey).join(" · ") || "Content"}`;
  return clean.map(humanizeKey).join(" · ") || "Work";
}

function humanDiff(
  current: ArtifactSnapshot,
  historical: ArtifactSnapshot,
  blueprintKey?: SpectraArtifact["blueprintKey"],
): HumanChange[] {
  const changes: HumanChange[] = [];
  const visit = (before: unknown, after: unknown, path: string[]) => {
    if (Object.is(before, after)) return;
    if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      const keys = new Set([
        ...Object.keys(before as Record<string, unknown>),
        ...Object.keys(after as Record<string, unknown>),
      ]);
      for (const key of keys)
        visit(
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
          [...path, key],
        );
      return;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      Math.max(before.length, after.length) <= 60
    ) {
      const primitiveArray = [...before, ...after].every(
        (item) =>
          item == null || ["string", "number", "boolean"].includes(typeof item),
      );
      if (!primitiveArray) {
        for (
          let index = 0;
          index < Math.max(before.length, after.length);
          index += 1
        )
          visit(before[index], after[index], [...path, String(index)]);
        return;
      }
    }
    if (
      JSON.stringify(before) === JSON.stringify(after) ||
      path.at(-1) === "id"
    )
      return;
    changes.push({
      label: humanFieldLabel(path),
      before: humanValue(before),
      after: humanValue(after),
      path,
    });
  };
  if (blueprintKey === "code") {
    const historicalContent = record(historical.content);
    const currentContent = record(current.content);
    visit(
      { ...historical, content: { ...historicalContent, files: undefined } },
      { ...current, content: { ...currentContent, files: undefined } },
      [],
    );
    const historicalFiles = arrayOfRecords(historicalContent.files);
    const currentFiles = arrayOfRecords(currentContent.files);
    const historicalById = new Map(
      historicalFiles.map((file, index) => [
        String(file.id ?? `historical-${index}`),
        { file, index },
      ]),
    );
    const currentById = new Map(
      currentFiles.map((file, index) => [
        String(file.id ?? `current-${index}`),
        { file, index },
      ]),
    );
    const fileIds = [
      ...new Set([...historicalById.keys(), ...currentById.keys()]),
    ];
    for (const fileId of fileIds) {
      const before = historicalById.get(fileId);
      const after = currentById.get(fileId);
      const path = String(
        after?.file.path ?? before?.file.path ?? "Source file",
      );
      if (!before || !after) {
        changes.push({
          label: `${path} · ${before ? "File removed" : "File added"}`,
          before: before
            ? `${String(before.file.language ?? "text")} · ${String(before.file.source ?? "").split("\n").length} lines`
            : "Not present",
          after: after
            ? `${String(after.file.language ?? "text")} · ${String(after.file.source ?? "").split("\n").length} lines`
            : "Not present",
          path: [
            "content",
            "files",
            String(after?.index ?? before?.index ?? 0),
          ],
          regionId: after ? fileId : "artifact:structure",
        });
        continue;
      }
      for (const key of ["path", "language", "mediaType"] as const) {
        if (before.file[key] === after.file[key]) continue;
        changes.push({
          label: `${path} · ${humanizeKey(key)}`,
          before: humanValue(before.file[key]),
          after: humanValue(after.file[key]),
          path: ["content", "files", String(after.index), key],
          regionId: fileId,
        });
      }
      const beforeLines = String(before.file.source ?? "").split("\n");
      const afterLines = String(after.file.source ?? "").split("\n");
      const beforeIds = Array.isArray(before.file.lineIds)
        ? before.file.lineIds.map(String)
        : beforeLines.map((_, index) => `${fileId}:line:${index + 1}`);
      const afterIds = Array.isArray(after.file.lineIds)
        ? after.file.lineIds.map(String)
        : afterLines.map((_, index) => `${fileId}:line:${index + 1}`);
      const beforeLineMap = new Map(
        beforeIds.map((id, index) => [
          id,
          { text: beforeLines[index] ?? "", index },
        ]),
      );
      const afterLineMap = new Map(
        afterIds.map((id, index) => [
          id,
          { text: afterLines[index] ?? "", index },
        ]),
      );
      for (const lineId of new Set([...beforeIds, ...afterIds])) {
        const oldLine = beforeLineMap.get(lineId);
        const newLine = afterLineMap.get(lineId);
        if (oldLine?.text === newLine?.text) continue;
        const lineNumber = (newLine?.index ?? oldLine?.index ?? 0) + 1;
        changes.push({
          label: `${path} · Line ${lineNumber}${!oldLine ? " added" : !newLine ? " removed" : ""}`,
          before: oldLine ? oldLine.text || "Blank line" : "Not present",
          after: newLine ? newLine.text || "Blank line" : "Not present",
          path: [
            "content",
            "files",
            String(after.index),
            "source",
            String(newLine?.index ?? oldLine?.index ?? 0),
          ],
          regionId: newLine ? lineId : fileId,
        });
      }
    }
  } else {
    visit(historical, current, []);
  }
  return changes.slice(0, 120);
}

function inlineMathContent(text: string): JSONContent[] | undefined {
  if (!text) return undefined;
  const nodes: JSONContent[] = [];
  // The canonical document model deliberately remains transport-friendly:
  // model-authored emphasis and inline maths are stored as lightweight
  // markup, then compiled to editor nodes at the UI boundary. Parsing both in
  // one pass ensures an AI update looks identical immediately, after refresh,
  // and when viewed from history.
  const pattern = /(\*\*(.+?)\*\*)|\\\((.+?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor)
      nodes.push({ type: "text", text: text.slice(cursor, start) });
    if (match[2] !== undefined)
      nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    else
      nodes.push({
        type: "inlineEquation",
        attrs: { latex: (match[3] ?? match[4] ?? "").trim() },
      });
    cursor = start + match[0].length;
  }
  if (cursor < text.length)
    nodes.push({ type: "text", text: text.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", text }];
}

function calloutInlineContent(text: string): JSONContent[] | undefined {
  const prefix = text.match(/^(Key idea|Remember|Note|Tip):\s*/i);
  if (!prefix) return inlineMathContent(text);
  const label = `${prefix[1]}:`;
  const rest = text.slice(prefix[0].length);
  return [
    { type: "text", text: label, marks: [{ type: "bold" }] },
    ...(rest
      ? [
          { type: "text", text: " " } as JSONContent,
          ...(inlineMathContent(rest) ?? []),
        ]
      : []),
  ];
}

function normalizeDocumentInlineMarkup(node: JSONContent): JSONContent {
  if (node.type === "text" && typeof node.text === "string") {
    const pattern =
      /(\*\*(.+?)\*\*)|\\\((.+?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
    const content: JSONContent[] = [];
    let cursor = 0;
    for (const match of node.text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > cursor)
        content.push({ ...node, text: node.text.slice(cursor, start) });
      if (match[2] !== undefined) {
        content.push({
          ...node,
          text: match[2],
          marks: [...(node.marks ?? []), { type: "bold" }],
        });
      } else {
        content.push({
          type: "inlineEquation",
          attrs: { latex: (match[3] ?? match[4] ?? "").trim() },
        });
      }
      cursor = start + match[0].length;
    }
    if (!content.length) return node;
    if (cursor < node.text.length)
      content.push({ ...node, text: node.text.slice(cursor) });
    return { type: "inlineMarkupFragment", content };
  }
  if (!Array.isArray(node.content)) return node;
  const content = node.content.flatMap((child) => {
    const normalized = normalizeDocumentInlineMarkup(child);
    return normalized.type === "inlineMarkupFragment"
      ? (normalized.content ?? [])
      : [normalized];
  });
  return { ...node, content };
}

/**
 * Studios whose only undo would otherwise be the browser's text-field undo.
 * The shell keeps their history: deleting a question, card, task or lesson
 * is one Ctrl+Z away, and undo never reverts a collaborator's later edit.
 */
const SHELL_HISTORY_TYPES = new Set([
  "quiz",
  "flashcard_deck",
  "planner_task",
  "timetable",
]);
/** A removed button leaves focus on <body>; undo belongs to the last studio used. */
let lastInteractedStudioSurface: HTMLElement | null = null;

export function documentJsonFromContent(
  content: unknown,
  title: string,
): JSONContent {
  const source = record(content);
  const nativeBinding = source.nativeBinding;
  const tiptap = source.tiptap;
  const blocks = arrayOfRecords(source.blocks);
  const nativeBlocks = new Map(
    blocks
      .filter((block) => typeof block.id === "string" && block.id)
      .map((block) => [block.id as string, block]),
  );
  const nativeBlockSemantics = (node: JSONContent): JSONContent => {
    if (!node.attrs || typeof node.attrs.blockId !== "string") return node;
    const nativeBlock = nativeBlocks.get(node.attrs.blockId);
    if (!nativeBlock) return node;
    const richNode = docxRichBlockToJson(nativeBlock, nativeBinding);
    if (richNode) return richNode as JSONContent;
    const attrs = record(nativeBlock.attrs);
    const styleId =
      typeof attrs.styleId === "string" ? attrs.styleId : undefined;
    const headingMatch = styleId?.match(/^Heading([1-3])$/i);
    if (
      headingMatch &&
      (node.type === "paragraph" || node.type === "heading")
    ) {
      return {
        ...node,
        type: "heading",
        attrs: {
          ...node.attrs,
          level: Number(headingMatch[1]),
          blockId: nativeBlock.id,
          ...(attrs.nativeReadOnly === true ? { nativeReadOnly: true } : {}),
        },
      };
    }
    if (attrs.nativeReadOnly === true) {
      return {
        ...node,
        attrs: { ...node.attrs, nativeReadOnly: true },
      };
    }
    return node;
  };
  if (tiptap && typeof tiptap === "object" && record(tiptap).type === "doc") {
    const existingIds = new Set(
      arrayOfRecords(record(tiptap).content).flatMap((node) => {
        const blockId = record(node.attrs).blockId;
        return typeof blockId === "string" && blockId ? [blockId] : [];
      }),
    );
    const missingNativeBlocks = blocks.some(
      (block) =>
        typeof block.id === "string" &&
        block.id &&
        !existingIds.has(block.id),
    );
    if (!missingNativeBlocks) {
    const protectedIds = new Set(
      blocks.flatMap((block) =>
        record(block.attrs).nativeReadOnly === true &&
        typeof block.id === "string" &&
        block.id
          ? [block.id]
          : [],
      ),
    );
    const normalized = normalizeDocumentInlineMarkup(tiptap as JSONContent);
    const semanticallyMapped = {
      ...normalized,
      content: normalized.content?.map(nativeBlockSemantics),
    };
    if (!protectedIds.size) return semanticallyMapped;
    return {
      ...semanticallyMapped,
      content: semanticallyMapped.content?.map((node) =>
        typeof node.attrs?.blockId === "string" &&
        protectedIds.has(node.attrs.blockId)
          ? {
              ...node,
              attrs: { ...node.attrs, nativeReadOnly: true },
            }
          : node,
      ),
    };
    }
  }
  const contentNodes =
    blocks.length > 0
      ? blocks.map((block) => {
          const text = typeof block.text === "string" ? block.text : "";
          const blockAttrs = record(block.attrs);
          const richNode = docxRichBlockToJson(block, nativeBinding);
          if (richNode) return richNode as JSONContent;
          const nativeAttrs = {
            ...(typeof block.id === "string" && block.id
              ? { blockId: block.id }
              : {}),
            ...(blockAttrs.nativeReadOnly === true
              ? { nativeReadOnly: true }
              : {}),
          };
          if (block.type === "equation" || block.type === "math") {
            const attrs = record(block.attrs);
            return {
              type: "equation",
              attrs: {
                latex: typeof block.latex === "string" ? block.latex : text,
                display: attrs.display === "inline" ? "inline" : "block",
                alignment: ["left", "right"].includes(String(attrs.alignment))
                  ? attrs.alignment
                  : "center",
              },
            };
          }
          if (block.type === "callout") {
            const attrs = record(block.attrs);
            const semanticType = /^(remember|warning|important)/i.test(text)
              ? "warning"
              : /^(tip|key idea)/i.test(text)
                ? "tip"
                : attrs.tone === "warning"
                  ? "warning"
                  : attrs.tone === "success"
                    ? "tip"
                    : "info";
            return {
              type: "callout",
              attrs: { type: semanticType },
              content: [
                { type: "paragraph", content: calloutInlineContent(text) },
              ],
            };
          }
          if (block.type === "table") {
            const rows = text
              .split(/\r?\n/)
              .map((line) => {
                const clean = line.trim().replace(/^\|/, "").replace(/\|$/, "");
                const cells = clean.includes("|")
                  ? clean.split("|")
                  : clean.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
                return cells.map((cell) => cell.trim().replace(/^\"|\"$/g, ""));
              })
              .filter(
                (row) =>
                  row.some(Boolean) &&
                  !row.every((cell) => /^:?-{3,}:?$/.test(cell)),
              );
            const normalizedRows = rows.length > 0 ? rows : [[""]];
            return {
              type: "table",
              attrs: nativeAttrs,
              content: normalizedRows.map((row, rowIndex) => ({
                type: "tableRow",
                content: row.map((cell) => ({
                  type: rowIndex === 0 ? "tableHeader" : "tableCell",
                  content: [
                    { type: "paragraph", content: inlineMathContent(cell) },
                  ],
                })),
              })),
            };
          }
          const type =
            block.type === "heading"
              ? "heading"
              : block.type === "list"
                ? "bulletList"
                : block.type === "quote"
                  ? "blockquote"
                  : "paragraph";
          if (type === "heading") {
            const attrs = record(block.attrs);
            const styleId =
              typeof attrs.styleId === "string" ? attrs.styleId : "";
            const styleLevel = Number(
              styleId.match(/^Heading([1-3])$/i)?.[1] ?? 0,
            );
            return {
              type: "heading",
              attrs: {
                level: [1, 2, 3].includes(Number(attrs.level))
                  ? Number(attrs.level)
                  : [1, 2, 3].includes(styleLevel)
                    ? styleLevel
                    : 2,
                ...nativeAttrs,
              },
              content: inlineMathContent(text),
            };
          }
          if (type === "bulletList") {
            const items = text
              .split(/\r?\n/)
              .map((line) =>
                line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim(),
              )
              .filter(Boolean);
            return {
              type: "bulletList",
              attrs: nativeAttrs,
              content: (items.length > 0 ? items : [text]).map((item) => ({
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: inlineMathContent(item),
                  },
                ],
              })),
            };
          }
          if (type === "blockquote")
            return {
              type: "blockquote",
              attrs: nativeAttrs,
              content: [
                {
                  type: "paragraph",
                  content: inlineMathContent(text),
                },
              ],
            };
          return {
            type: "paragraph",
            attrs: nativeAttrs,
            content: inlineMathContent(text),
          };
        })
      : [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: title }],
          },
          { type: "paragraph" },
        ];
  return { type: "doc", content: contentNodes };
}

export const blocksFromJson = documentBlocksFromJson;

export { documentContentFromJson } from "./document-content";

export function deckCards(content: unknown): DeckCard[] {
  const cards = arrayOfRecords(record(content).cards).map(
    (card, index): DeckCard => ({
      id: typeof card.id === "string" ? card.id : `card-${index + 1}`,
      variant:
        card.variant === "cloze" || card.variant === "image_occlusion"
          ? card.variant
          : "basic",
      front: typeof card.front === "string" ? card.front : "",
      back: typeof card.back === "string" ? card.back : "",
      hint: typeof card.hint === "string" ? card.hint : "",
      explanation: typeof card.explanation === "string" ? card.explanation : "",
      acceptedAlternatives: Array.isArray(card.acceptedAlternatives)
        ? card.acceptedAlternatives.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      section: typeof card.section === "string" ? card.section : "Section 1",
      confidence: (card.confidence === "weak" ||
      card.confidence === "medium" ||
      card.confidence === "strong"
        ? card.confidence
        : "unknown") as DeckCard["confidence"],
      difficulty:
        card.difficulty === "easy" || card.difficulty === "hard"
          ? card.difficulty
          : "medium",
      learningObjective:
        typeof card.learningObjective === "string"
          ? card.learningObjective
          : "",
      language: typeof card.language === "string" ? card.language : "",
      bidirectional: card.bidirectional === true,
      media:
        typeof record(card.media).assetId === "string" &&
        typeof record(card.media).name === "string" &&
        typeof record(card.media).mediaType === "string"
          ? {
              assetId: String(record(card.media).assetId),
              name: String(record(card.media).name),
              mediaType: String(record(card.media).mediaType),
              altText:
                typeof record(card.media).altText === "string"
                  ? String(record(card.media).altText)
                  : "",
              placement:
                record(card.media).placement === "back" ? "back" : "front",
            }
          : undefined,
      occlusions: arrayOfRecords(card.occlusions).flatMap((mask, maskIndex) => {
        const x = Number(mask.x);
        const y = Number(mask.y);
        const width = Number(mask.width);
        const height = Number(mask.height);
        if (
          ![x, y, width, height].every(Number.isFinite) ||
          width <= 0 ||
          height <= 0
        )
          return [];
        const normalizedX = Math.max(0, Math.min(0.99, x));
        const normalizedY = Math.max(0, Math.min(0.99, y));
        return [
          {
            id:
              typeof mask.id === "string"
                ? mask.id
                : `mask-${index + 1}-${maskIndex + 1}`,
            x: normalizedX,
            y: normalizedY,
            width: Math.max(0.01, Math.min(1 - normalizedX, width)),
            height: Math.max(0.01, Math.min(1 - normalizedY, height)),
            label: typeof mask.label === "string" ? mask.label : "",
          },
        ];
      }),
      sourceRefs: Array.isArray(card.sourceRefs)
        ? card.sourceRefs.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      tags: Array.isArray(card.tags)
        ? card.tags.filter((item): item is string => typeof item === "string")
        : [],
      review: record(card.review) as DeckCard["review"],
    }),
  );
  return cards.length > 0
    ? cards
    : [
        {
          id: "card-1",
          front: "",
          back: "",
          hint: "",
          section: "Section 1",
          confidence: "unknown",
        },
      ];
}

export function quizQuestions(content: unknown): QuizQuestion[] {
  const questions = arrayOfRecords(record(content).questions).map(
    (question, index) => {
      const options = Array.isArray(question.options)
        ? question.options.filter(
            (option): option is string => typeof option === "string",
          )
        : [];
      const questionId =
        typeof question.id === "string" ? question.id : `question-${index + 1}`;
      const existingOptionIds = Array.isArray(question.optionIds)
        ? question.optionIds.filter(
            (optionId): optionId is string => typeof optionId === "string",
          )
        : [];
      return {
        id: questionId,
        prompt: typeof question.prompt === "string" ? question.prompt : "",
        type: ([
          "multiple_choice",
          "short_answer",
          "true_false",
          "select_all",
          "ordering",
          "numeric",
          "fill_blank",
          "long_response",
          "matching",
        ].includes(String(question.type))
          ? question.type
          : options.length > 0
            ? "multiple_choice"
            : "short_answer") as QuizQuestion["type"],
        options,
        optionIds: options.map(
          (_, optionIndex) =>
            existingOptionIds[optionIndex] ??
            `${questionId}:option:${optionIndex + 1}`,
        ),
        correctAnswer:
          typeof question.correctAnswer === "string"
            ? question.correctAnswer
            : "",
        correctAnswers: Array.isArray(question.correctAnswers)
          ? question.correctAnswers.filter(
              (item): item is string => typeof item === "string",
            )
          : typeof question.correctAnswer === "string" &&
              question.type === "select_all"
            ? question.correctAnswer.split("|").filter(Boolean)
            : [],
        numericTolerance:
          typeof question.numericTolerance === "number" &&
          Number.isFinite(question.numericTolerance)
            ? Math.max(0, question.numericTolerance)
            : 0,
        rubric: typeof question.rubric === "string" ? question.rubric : "",
        matchingPairs: arrayOfRecords(question.matchingPairs).map(
          (pair, pairIndex) => ({
            id: typeof pair.id === "string" ? pair.id : `pair-${pairIndex + 1}`,
            left: typeof pair.left === "string" ? pair.left : "",
            right: typeof pair.right === "string" ? pair.right : "",
          }),
        ),
        explanation:
          typeof question.explanation === "string" ? question.explanation : "",
        difficulty: (question.difficulty === "easy" ||
        question.difficulty === "hard"
          ? question.difficulty
          : "medium") as QuizQuestion["difficulty"],
        points: typeof question.points === "number" ? question.points : 1,
        timeLimitSeconds:
          typeof question.timeLimitSeconds === "number"
            ? question.timeLimitSeconds
            : 90,
        sourceRefs: Array.isArray(question.sourceRefs)
          ? question.sourceRefs.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        feedback:
          typeof question.feedback === "string" ? question.feedback : "",
        bloomLevel: ([
          "remember",
          "understand",
          "apply",
          "analyze",
          "evaluate",
          "create",
        ].includes(String(question.bloomLevel))
          ? question.bloomLevel
          : "remember") as QuizQuestion["bloomLevel"],
        standards: Array.isArray(question.standards)
          ? question.standards.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        tags: Array.isArray(question.tags)
          ? question.tags.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        poolId:
          typeof question.poolId === "string" && question.poolId.trim()
            ? question.poolId
            : undefined,
        poolDrawCount:
          typeof question.poolDrawCount === "number" &&
          Number.isFinite(question.poolDrawCount)
            ? Math.max(1, Math.min(100, Math.floor(question.poolDrawCount)))
            : undefined,
        section:
          typeof question.section === "string" && question.section.trim()
            ? question.section
            : undefined,
        media:
          question.media && typeof question.media === "object"
            ? (record(question.media) as QuizQuestion["media"])
            : undefined,
      };
    },
  );
  return questions.length > 0
    ? questions
    : [
        {
          id: "question-1",
          prompt: "",
          type: "multiple_choice",
          options: ["", "", "", ""],
          optionIds: [
            "question-1:option:1",
            "question-1:option:2",
            "question-1:option:3",
            "question-1:option:4",
          ],
          correctAnswer: "",
          explanation: "",
          difficulty: "medium",
          points: 1,
          timeLimitSeconds: 90,
        },
      ];
}

function artifactEditorSnapshot(artifact: SpectraArtifact) {
  return {
    title: artifact.title,
    summary: artifact.summary ?? "",
    tagDraft: (artifact.tags ?? []).join(", "),
    content: artifact.content,
  };
}


function collaborationFailureMessage(error: unknown) {
  return humanizePublicFailure(error);
}

export function ArtifactStudio({
  mode,
  artifact,
  artifacts,
  busy = false,
  panelWidth,
  panelOverlay,
  sourceLabel,
  onPanelWidthChange,
  onClose,
  onCloseTab,
  onExpand,
  onArchive,
  onShare,
  onDirtyChange,
  onContinueThread,
  onOpenChats,
  continuedThreadId,
  compact = false,
  executeApplicationCommand,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  dirtyIds: Set<string>;
  busy?: boolean;
  panelWidth?: number;
  /** Workbench-row controlled presentation (`resolveWorkbenchPanes`). */
  panelOverlay?: boolean;
  sourceLabel: string;
  onPanelWidthChange?: (width: number) => void;
  onClose: () => void;
  onExpand: (artifact: SpectraArtifact) => void;
  onActivateTab: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
  onArchive?: (artifact: SpectraArtifact) => Promise<void> | void;
  onShare?: (artifact: SpectraArtifact) => void;
  onDirtyChange: (artifactId: string, dirty: boolean) => void;
  onContinueThread?: (threadId: string, title: string) => void;
  onOpenChats?: () => void;
  continuedThreadId?: string | null;
  compact?: boolean;
  executeApplicationCommand?: ApplicationCommandDispatcher;
}) {
  const router = useRouter();
  const width = panelWidth ?? 720;
  const handleClose = useCallback(
    () => (mode === "tab" ? onCloseTab(artifact._id) : onClose()),
    [artifact._id, mode, onClose, onCloseTab],
  );
  const handleArchive = useMemo(
    () => (onArchive ? () => onArchive(artifact) : undefined),
    [artifact, onArchive],
  );
  const handleDirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(artifact._id, dirty),
    [artifact._id, onDirtyChange],
  );

  const contextRegistration = useMemo(() => {
    if (!isArtifactTypeKey(artifact.blueprintKey)) return null;
    const definition = getWorkDefinition(artifact.blueprintKey);
    const summary =
      artifact.summary?.trim() ||
      `${definition.userFacingName} named ${artifact.title}`;
    return {
      id: `work:${artifact._id}:root`,
      anchor: {
        workId: artifact._id,
        workType: artifact.blueprintKey,
        kind: "work:root",
        path: ["work", "root"],
        stableIds: { workId: artifact._id },
        fallbackExcerpt: summary.slice(0, 240),
        schemaVersion: definition.model.schemaVersion,
      },
      label: artifact.title,
      type: `${definition.userFacingName} root`,
      workspaceId: artifact.placements?.[0]?.workspaceId,
      permissions: "allowed" as const,
    };
  }, [
    artifact._id,
    artifact.blueprintKey,
    artifact.placements,
    artifact.summary,
    artifact.title,
  ]);

  useEffect(
    () =>
      spectraBus.handle("work.revealAnchor", ({ anchor, focus }) => {
        if (anchor.workId !== artifact._id) return;
        const host = contextSourceRegistry
          .get(`work:${artifact._id}:root`)
          ?.element?.();
        if (!host) return;
        const regionId =
          anchor.stableIds?.regionId ??
          (anchor.path[0] === "region" ? anchor.path.at(-1) : undefined);
        const revealed =
          anchor.kind === "work:root"
            ? false
            : revealTarget(host, {
                artifactId: artifact._id,
                path: `/${anchor.path.join("/")}`,
                primitive: "richtext",
                ...(regionId ? { regionId } : {}),
              });
        if (!revealed)
          host.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth",
          });
        if (focus) {
          // One restrained target pulse on the revealed control itself —
          // attention lands where the comment points, then settles.
          const pulseHost =
            (resolveTargetElement(host, {
              artifactId: artifact._id,
              path: `/${anchor.path.join("/")}`,
              primitive: "richtext",
              ...(regionId ? { regionId } : {}),
            })?.element as HTMLElement | null) ?? host;
          pulseHost.dataset.anchorFocus = "true";
          window.setTimeout(() => {
            if (pulseHost.dataset.anchorFocus === "true")
              delete pulseHost.dataset.anchorFocus;
          }, 1_200);
        }
      }),
    [artifact._id],
  );

  const threadId =
    artifact.blueprintKey === "thread_reference" &&
    typeof record(artifact.content).threadId === "string"
      ? String(record(artifact.content).threadId).trim()
      : "";
  const body =
    artifact.blueprintKey === "resource" ? (
      <ResourceSurface key={artifact._id} artifact={artifact} onClose={handleClose} />
    ) : artifact.blueprintKey === "thread_reference" ? (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex min-h-[78px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-elevated))] text-[var(--brand-primary)]">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div
                className="truncate font-display text-heading font-semibold text-[var(--text-primary)]"
                title={artifact.title}
              >
                {artifact.title}
              </div>
              <div className="mt-0.5 text-micro uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
                Conversation · {sourceLabel}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {threadId && onContinueThread ? (
              <button
                type="button"
                onClick={() => onContinueThread(threadId, artifact.title)}
                className={`spectra-icon-action ${continuedThreadId === threadId ? "is-selected" : ""}`}
                aria-label={
                  continuedThreadId === threadId
                    ? "Remove this thread from the Live Dock"
                    : "Add this thread to the Live Dock"
                }
                title={
                  continuedThreadId === threadId
                    ? "Remove from Live Dock"
                    : "Add to Live Dock"
                }
                aria-pressed={continuedThreadId === threadId}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            ) : null}
            <IconButton
              label="Open conversation in Chat"
              onClick={() => {
                if (threadId)
                  router.push(`/chat?threadId=${encodeURIComponent(threadId)}`);
              }}
              icon={Maximize2}
            />
            {onOpenChats ? <ChatBrowserButton onClick={onOpenChats} label="Browse chats about this work" /> : null}
            <IconButton label="Close" onClick={handleClose} icon={X} />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {threadId ? (
            <ThreadConversation
              threadId={threadId}
              compact
            />
          ) : (
            <ThreadReferenceStudio content={artifact.content} />
          )}
        </div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col bg-transparent">
        <ArtifactStudioEditor
          // Editor identity must remain stable while its clean/dirty state
          // changes. A key derived from `dirtyIds` remounted this tree on the
          // first keystroke, restoring the server snapshot and making every
          // artifact editor appear non-interactive. Remote revisions are
          // reconciled by ArtifactStudioEditor's snapshot effects.
          key={`${artifact._id}:editor`}
          mode={mode}
          artifact={artifact}
          artifacts={artifacts}
          busy={busy}
          sourceLabel={sourceLabel}
          onClose={handleClose}
          onExpand={() => onExpand(artifact)}
          onOpenArtifact={(artifactId) => {
            const source = artifacts.find(
              (candidate) => candidate._id === artifactId,
            );
            if (source) onExpand(source);
          }}
          onArchive={handleArchive}
          onShare={onShare ? () => onShare(artifact) : undefined}
          onDirtyChange={handleDirtyChange}
          onOpenChats={onOpenChats}
          compact={compact}
          executeApplicationCommand={executeApplicationCommand}
        />
      </div>
    );

  const contextualBody = contextRegistration ? (
    <ContextSourceBoundary
      registration={contextRegistration}
      className="h-full min-h-0"
    >
      {body}
    </ContextSourceBoundary>
  ) : (
    body
  );

  if (mode === "tab") {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--border-default)]">
        {contextualBody}
      </section>
    );
  }

  return (
    <StudioSplitShell
      width={width}
      onWidthChange={onPanelWidthChange}
      ariaLabel="Work studio"
      cssWidthVariable="--spectra-studio-width"
      overlay={panelOverlay}
      // The registry states how narrow this type can get before it stops
      // working; the panel floor comes from there rather than from one number
      // that has to suit a flashcard and a spreadsheet equally.
      minWidth={
        isArtifactTypeKey(artifact.blueprintKey)
          ? getWorkDefinition(artifact.blueprintKey).responsive.minInlineSize
          : 560
      }
    >
      {contextualBody}
    </StudioSplitShell>
  );
}

function ArtifactStudioEditor({
  mode,
  artifact,
  artifacts,
  busy,
  sourceLabel: _sourceLabel,
  onClose,
  onExpand,
  onOpenArtifact,
  onArchive,
  onShare,
  onDirtyChange,
  onOpenChats,
  compact,
  executeApplicationCommand,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  busy: boolean;
  sourceLabel: string;
  onClose: () => void;
  onExpand: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onArchive?: () => Promise<void> | void;
  onShare?: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenChats?: () => void;
  compact: boolean;
  executeApplicationCommand?: ApplicationCommandDispatcher;
}) {
  const [editorReady, setEditorReady] = useState(false);
  const [snapshotKey] = useState(createReconciliationSnapshotKey);
  const viewportContext = useMemo(
    () => ({ artifactId: artifact._id, onReady: setEditorReady }),
    [artifact._id],
  );
  const replicaTruth = useQuery(
    api.replicas.forWork,
    useAuthedArgs({
      workId: artifact._id as never,
    }),
  );
  useWorkAvailability(artifact._id, replicaTruth);
  const effectivePolicy = useQuery(
    api.syncPolicy.effective,
    useAuthedArgs({
      itemId: artifact._id,
    }),
  );
  const bridge = useBridgeHealth();
  const router = useRouter();
  const activeBridgeMounts = useQuery(
    api.bridge.activeMounts,
    useAuthedArgs({}),
  );
  const currentDeviceMounts = useMemo(
    () =>
      mountsForConnectedDevice(
        activeBridgeMounts,
        bridge.status,
        bridge.state === "connected",
      ),
    [activeBridgeMounts, bridge.state, bridge.status],
  );
  const workType = isArtifactTypeKey(artifact.blueprintKey)
    ? artifact.blueprintKey
    : null;
  const protectedOriginal = isProtectedOriginalWork({
    preset: effectivePolicy?.preset,
    replicas: replicaTruth?.replicas,
  });
  const sharingRole =
    artifact.accessLevel === "read" || protectedOriginal
      ? "read_only"
      : "edit";
  const permissionReadOnly = replicaTruth === null || (workType
    ? !workCan(workType, sharingRole, "edit")
    : artifact.accessLevel === "read");
  // The live room is the editing substrate, not a feature unlocked by sharing.
  // Owners need the identical interaction fabric for private AI work; access
  // policy still decides who else may authenticate into that room.
  const isCollaborativeArtifact = true;
  const initialLiveValue = useMemo(
    () => ({
      title: artifact.title,
      ...(artifact.summary ? { summary: artifact.summary } : {}),
      tags: artifact.tags ?? [],
      content: artifact.content,
    }),
    [artifact.content, artifact.summary, artifact.tags, artifact.title],
  );

  const live = useArtifactLiveModel(
    artifact._id,
    artifact.blueprintKey,
    initialLiveValue,
    // Always connect for persistence (Yjs is the write path), but never treat
    // a slow/missing socket as a reason to freeze private editing.
    !(permissionReadOnly && artifact.blueprintKey === "quiz"),
    artifact.aiState === "edited" && artifact.aiRunId
      ? `${artifact.aiRunId}:${artifact.updatedAt}`
      : ["document", "sheets", "presentation"].includes(
            artifact.blueprintKey,
          ) && artifact.nativeFormat
        ? String(artifact.updatedAt)
        : null,
  );
  const [localDraftsArtifactId, setLocalDraftsArtifactId] = useState<string | null>(null);
  const recoveryViewRef = useRef({ artifactId: artifact._id });
  if (recoveryViewRef.current.artifactId !== artifact._id)
    recoveryViewRef.current = { artifactId: artifact._id };
  const recoveryAdoptionRequest = useRef<AbortController | null>(null);
  const recoveryNeedsReview = useRef<string | null>(null);
  const observedRecoveryAdoption = useRef({ artifactId: artifact._id, adoptionId: live.recovery.adoptionId });
  useEffect(() => () => {
    recoveryAdoptionRequest.current?.abort();
    recoveryAdoptionRequest.current = null;
  }, [artifact._id]);
  const liveRecovery = useMemo(
    () =>
      describeFailure(
        live.initializationError ?? live.modelSnapshot.error ?? "unknown",
        {
          fallback:
            "Part of this work was saved in a shape Spectra no longer recognises, so live editing is paused. Your saved content is intact — reload, and tell your teacher or an administrator if it keeps happening.",
        },
      ),
    [live.initializationError, live.modelSnapshot.error],
  );
  const liveDescriptor = useCallback(
    (regionId: string) => {
      if (!live.modelSnapshot.initialized) return undefined;
      try {
        return live.model?.descriptor(regionId);
      } catch (error) {
        // A transport can publish the model object one render before its
        // native root metadata arrives. Descriptor reads are supportive UI
        // (highlights, labels, comments), so that brief bootstrap boundary
        // must render without them instead of taking down the artifact.
        if (
          error instanceof Error &&
          error.message.includes("WORK_YJS_UNINITIALIZED")
        )
          return undefined;
        throw error;
      }
    },
    [live.model, live.modelSnapshot.initialized],
  );
  const livePermissionLost =
    isCollaborativeArtifact && live.state === "permission_lost";
  // Owners stay editable if a room token glitches to read. Shared
  // collaborators follow the live token as soon as a downgrade arrives,
  // even when the Library snapshot still says modify.
  const readOnly = sharedSessionIsReadOnly({
    ownership: artifact.ownership,
    durableReadOnly: permissionReadOnly,
    liveLevel: live.level,
  });
  const accessBanner = artifactAccessBanner({
    ownership: artifact.ownership,
    accessLevel: artifact.accessLevel,
    accessReason: artifact.accessReason,
    workspaceTitles: artifact.placements
      ?.map((placement) => placement.workspaceTitle)
      .filter(Boolean)
      .join(", "),
    liveLevel: live.level,
    protectedOriginal,
    protectedOriginalCopy: PROTECTED_ORIGINAL_TOGGLE.consequence,
  });
  const [title, setTitle] = useState(artifact.title);
  const [summary, setSummary] = useState(() =>
    (artifact.summary ?? "").replace(/^(\d+) bytes$/i, (_, value: string) =>
      formatByteCount(Number(value)),
    ),
  );
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // Whether the collapsed summary is actually cut off. This has to be measured,
  // not guessed from a character count: the same 60-character sentence fits on
  // one line in a wide tab and wraps to three in a narrow split pane, so a
  // length threshold either hides the reveal on text the reader cannot finish
  // or offers it on text that is already whole.
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);
  const [summaryClipped, setSummaryClipped] = useState(false);
  useEffect(() => {
    const element = summaryRef.current;
    if (!element) return;
    const measure = () => {
      setSummaryClipped(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [summary, summaryExpanded]);
  const [tagDraft, setTagDraft] = useState((artifact.tags ?? []).join(", "));
  const [content, setContent] = useState<unknown>(artifact.content);
  const contentHistoryRef = useRef(createStudioHistory<unknown>());
  const [contentHistoryState, setContentHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const publishContentHistory = useCallback(() => {
    const canUndo = contentHistoryRef.current.canUndo();
    const canRedo = contentHistoryRef.current.canRedo();
    setContentHistoryState((current) =>
      current.canUndo === canUndo && current.canRedo === canRedo
        ? current
        : { canUndo, canRedo },
    );
  }, []);
  const latestContentRef = useRef(content);
  latestContentRef.current = content;
  const [baseline, setBaseline] = useState(() =>
    artifactEditorSnapshot(artifact),
  );
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const [dirty, setDirty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [requestedComment, setRequestedComment] = useState<{
    id: string;
    body: string;
    regionId?: string;
    submit?: boolean;
    resolve?: (outcome: SpectraCommandOutcome) => void;
    reject?: (error: unknown) => void;
  } | null>(null);
  const [activeCommentRegionId, setActiveCommentRegionId] = useState<string>();
  const [commentRelativePosition, setCommentRelativePosition] =
    useState<Uint8Array>();
  useEffect(() => {
    const removeOpen = spectraBus.handle("comments.open", (input) => {
      if (input.artifactId !== artifact._id) return;
      setRequestedComment(null);
      setCommentsOpen(true);
      return {
        status: "completed",
        message: "Comments opened.",
        data: { artifactId: artifact._id },
      } satisfies SpectraCommandOutcome;
    });
    const removeAdd = spectraBus.handle("comments.add", (input) => {
      if (input.artifactId !== artifact._id) return;
      return new Promise<SpectraCommandOutcome>((resolve, reject) => {
        setRequestedComment({
          id: globalThis.crypto?.randomUUID?.() ?? `comment-${Date.now()}`,
          body: input.body,
          ...(input.regionId ? { regionId: input.regionId } : {}),
          submit: true,
        resolve,
          reject,
        });
        setCommentsOpen(true);
      });
    });
    return () => {
      removeOpen();
      removeAdd();
    };
  }, [artifact._id]);
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const detailsEligible =
    artifact.blueprintKey !== "planner_task" &&
    artifact.blueprintKey !== "thread_reference";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsPinnedRef = useRef(false);
  const [aiHighlightDismissed, setAiHighlightDismissed] = useState(false);
  const [versions, setVersions] = useState<SpectraArtifactVersionSummary[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const historyRequestRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const historyActiveArtifactRef = useRef<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] =
    useState<SpectraArtifactVersion | null>(null);
  const restoreInFlightRef = useRef(false);
  const pendingRestoreRequestRef = useRef<{ key: string; requestId: string } | null>(null);
  const restoreSelectionRef = useRef({ artifactId: artifact._id, versionId: previewVersion?._id });
  restoreSelectionRef.current = { artifactId: artifact._id, versionId: previewVersion?._id };
  const selectHistoryVersion = useCallback(async (version: SpectraArtifactVersionSummary) => {
    if (version.artifactId !== artifact._id || historyActiveArtifactRef.current !== artifact._id) return;
    previewRequestRef.current?.abort();
    const request = new AbortController();
    previewRequestRef.current = request;
    setPreviewVersion(version);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const result = await getSpectraArtifactVersion(artifact._id, version._id, request.signal);
      if (request.signal.aborted) return;
      if (!result.version || result.version._id !== version._id || result.version.artifactId !== artifact._id)
        throw new Error("This saved version is no longer available to you.");
      setPreviewVersion({ ...version, ...result.version });
    } catch (error) {
      if (!request.signal.aborted)
        setPreviewError(error instanceof Error ? error.message : "Could not load this saved version.");
    } finally {
      if (!request.signal.aborted) setPreviewLoading(false);
    }
  }, [artifact._id]);
  const loadHistoryPage = useCallback(async (cursor?: string) => {
    if (historyActiveArtifactRef.current !== artifact._id) return;
    historyRequestRef.current?.abort();
    const request = new AbortController();
    historyRequestRef.current = request;
    setHistoryLoading(true);
    setHistoryError(null);
    if (cursor === undefined) {
      previewRequestRef.current?.abort();
      setVersions([]);
      setHistoryCursor(null);
      setPreviewVersion(null);
      setPreviewError(null);
      setPreviewLoading(false);
    }
    try {
      const result = await getSpectraArtifactVersions(artifact._id, 20, cursor, request.signal);
      if (request.signal.aborted) return;
      setVersions(current => cursor === undefined ? result.versions :
        [...new Map([...current, ...result.versions].map(version => [version._id, version])).values()]);
      setHistoryCursor(result.isDone ? null : result.continueCursor);
      if (cursor === undefined && result.versions[0]) void selectHistoryVersion(result.versions[0]);
    } catch (error) {
      if (!request.signal.aborted)
        setHistoryError(error instanceof Error ? error.message : "Could not load version history.");
    } finally {
      if (!request.signal.aborted) setHistoryLoading(false);
    }
  }, [artifact._id, selectHistoryVersion]);
  useEffect(() => {
    historyActiveArtifactRef.current = historyOpen ? artifact._id : null;
    if (historyOpen) void loadHistoryPage();
    else {
      setVersions([]);
      setPreviewVersion(null);
      setHistoryCursor(null);
    }
    return () => {
      historyActiveArtifactRef.current = null;
      historyRequestRef.current?.abort();
      previewRequestRef.current?.abort();
    };
  }, [artifact._id, historyOpen, loadHistoryPage]);
  const [selectedRestoreRegions, setSelectedRestoreRegions] = useState<
    Set<string>
  >(() => new Set());
  const [remoteConflict, setRemoteConflict] = useState<ReturnType<
    typeof artifactEditorSnapshot
  > | null>(null);
  const [dismissedRemoteKey, setDismissedRemoteKey] = useState<string | null>(
    null,
  );
  const [previewClock, setPreviewClock] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [liveConflict, setLiveConflict] = useState<{
    message: string;
  } | null>(null);
  const [nativeRecoveryBusy, setNativeRecoveryBusy] = useState<
    "download" | "materialize" | null
  >(null);
  const [nativeRecoveryError, setNativeRecoveryError] = useState<string>();
  const [nativeFolderDialogOpen, setNativeFolderDialogOpen] = useState(false);
  const [nativeFolderSelection, setNativeFolderSelection] = useState("");
  const [nativeCopyName, setNativeCopyName] = useState("");
  const [unsavedCloseOpen, setUnsavedCloseOpen] = useState(false);
  const [closeActionBusy, setCloseActionBusy] = useState(false);
  const closeActionRef = useRef(false);
  const meta = workTypeMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const dirtyRef = useRef(dirty);
  // A snapshot difference is not, by itself, evidence of a local edit. Rich
  // editors normalize their document during hydration and streamed AI updates
  // reconcile several fields across separate React commits. Track user intent
  // explicitly so a freshly opened or AI-updated artifact never advertises
  // unsaved work that the student did not create.
  const userHasEditedRef = useRef(false);
  const [localDraftEpoch, setLocalDraftEpoch] = useState(0);
  const localDraftBumpRef = useRef(false);

  const bumpLocalDraft = useCallback(() => {
    if (localDraftBumpRef.current) return;
    localDraftBumpRef.current = true;
    window.requestAnimationFrame(() => {
      localDraftBumpRef.current = false;
      setLocalDraftEpoch((epoch) => epoch + 1);
    });
  }, []);

  useEffect(() => {
    detailsPinnedRef.current = false;
    setDetailsOpen(false);
  }, [artifact._id, detailsEligible]);

  useEffect(() => {
    if (mode !== "tab") return;
    const shareFromShell = () => onShare?.();
    return spectraBus.handle("surface.share", shareFromShell);
  }, [mode, onShare]);
  // Updating the four editor fields and their baseline is intentionally a
  // single logical reconciliation, but React commits those state updates
  // independently. Without this guard the intermediate render (new baseline,
  // old fields) marks the editor dirty and the next streamed AI patch is then
  // mistaken for a user/remote conflict. The visible editor consequently stays
  // stale until it is closed and reopened.
  const reconcilingRemoteRef = useRef(false);
  const activeArtifactIdRef = useRef(artifact._id);
  const lastReconciledIncomingKeyRef = useRef<string | null>(null);
  const reconciliationOriginRef = useRef({
    initialRevision: artifact.updatedAt,
    latestRevision: artifact.updatedAt,
    hasAcceptedLiveValue: false,
  });
  const generatedSummaryRepairRef = useRef<string | null>(null);
  const currentSnapshotRef = useRef(artifactEditorSnapshot(artifact));
  const aiMergeRef = useRef<{
    paths: string[];
    title: boolean;
    summary: boolean;
    tags: boolean;
  } | null>(null);
  const localSyncKeysRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const nativeFallbackEditedRef = useRef(false);
  const reconciliationFrameRef = useRef<number | null>(null);
  const nativeBodyBinding =
    artifact.blueprintKey === "document" || artifact.blueprintKey === "code";
  const titleNativeFormat = artifact.title
    .match(/\.([a-z0-9]+)$/i)?.[1]
    ?.toLowerCase();
  const storedNativeFormat = artifact.nativeFormat?.toLowerCase();
  const officeFormatNames = new Set([
    "docx",
    "docm",
    "dotx",
    "dotm",
    "xlsx",
    "xlsm",
    "xltx",
    "xltm",
    "xlam",
    "pptx",
    "pptm",
    "potx",
    "potm",
    "ppsx",
    "ppsm",
    "ppam",
  ]);
  const inferredNativeFormat = officeFormatNames.has(titleNativeFormat ?? "")
    ? titleNativeFormat
    : storedNativeFormat;
  const nativeOfficeDocument = [
    "docx",
    "docm",
    "dotx",
    "dotm",
    "xlsx",
    "xlsm",
    "xltx",
    "xltm",
    "xlam",
    "pptx",
    "pptm",
    "potx",
    "potm",
    "ppsx",
    "ppsm",
    "ppam",
  ].includes(inferredNativeFormat ?? "");
  const nativePortableArtifact =
    nativeOfficeDocument ||
    [
      "flashcard_deck",
      "quiz",
      "planner_task",
      "agent",
      "whiteboard",
      "presentation",
    ].includes(artifact.blueprintKey);
  const nativeWordDocument =
    artifact.blueprintKey === "document" &&
    ["docx", "docm", "dotx", "dotm"].includes(inferredNativeFormat ?? "");
  const nativeOfficeApplication = nativeWordDocument
    ? "Word"
    : artifact.blueprintKey === "sheets"
      ? "Excel"
      : artifact.blueprintKey === "presentation"
        ? "PowerPoint"
        : "Office";
  const nativeSync = useArtifactNativeSync({
    artifactId: artifact._id,
    nativeOfficeDocument,
    nativeWordDocument,
    nativeOfficeApplication,
    dirty,
    userHasEditedRef,
    reconcilingRemoteRef,
    currentSnapshotRef,
    live,
    initialLiveValue,
    replicas: replicaTruth?.replicas,
    recentOperations: replicaTruth?.recentOperations,
    bridgeAvailable:
      !replicaTruth?.replicas.some((replica) => replica.kind === "local") ||
      bridge.reachability === "connected",
    conflicts: replicaTruth?.conflicts,
    setContent,
    setBaseline,
    setDirty,
  });
  const {
    nativeWriteError,
    setNativeWriteError,
    nativeMaterialization,
    setNativeAttribution,
    nativeProjectionReady,
    nativeProjectionOverrideRef,
    nativeConflict,
    queueNativeMaterialization,
    reconcileNativeRevision,
  } = nativeSync;
  const humanSummary = useCallback(
    (value: string | undefined) =>
      (value ?? "").replace(/^(\d+) bytes$/i, (_, bytes: string) =>
        formatByteCount(Number(bytes)),
      ),
    [],
  );
  const incomingLiveContent = nativeBodyBinding ? null : live.liveValue.content;
  const incomingLiveTagDraft = live.liveValue.tags.join(", ");
  const incomingReactBody = nativeBodyBinding ? null : content;
  const incomingLiveSummary = humanSummary(live.liveValue.summary);
  const incomingSummary =
    workType &&
    isGeneratedArtifactSummary(incomingLiveSummary, workType) &&
    isGeneratedArtifactSummary(humanSummary(artifact.summary), workType)
      ? refreshGeneratedArtifactSummary({
          blueprintKey: workType,
          title: live.liveValue.title,
          content: live.liveValue.content,
          currentSummary: incomingLiveSummary,
          nextSummary: artifact.summary,
        }) ?? incomingLiveSummary
      : incomingLiveSummary;
  const incomingSnapshot = useMemo(
    () => ({
      title: live.liveValue.title,
      summary: incomingSummary,
      tagDraft: incomingLiveTagDraft,
      // Native document/code editors already consume their Yjs types directly.
      // Feeding every live-origin body projection back through React creates a
      // second full-document reconciliation path on each keystroke.
      content: nativeBodyBinding
        ? currentSnapshotRef.current.content
        : (nativeProjectionOverrideRef.current ??
          (nativeProjectionReady ? incomingReactBody : incomingLiveContent)),
    }),
    [
      incomingLiveContent,
      incomingLiveTagDraft,
      incomingReactBody,
      incomingSummary,
      live.liveValue.title,
      nativeBodyBinding,
      nativeProjectionOverrideRef,
      nativeProjectionReady,
    ],
  );
  const currentSnapshot = useMemo(
    () => ({ title, summary, tagDraft, content }),
    [content, summary, tagDraft, title],
  );
  const downloadNativeCopy = useCallback(async () => {
    if (!nativePortableArtifact) return;
    setNativeRecoveryBusy("download");
    setNativeRecoveryError(undefined);
    try {
      const response = await requestSpectra(
        `/api/spectra/native?artifactId=${encodeURIComponent(artifact._id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          result?.message ?? "The retained native copy is unavailable.",
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const name = match
        ? decodeURIComponent(match[1]!)
        : `${artifact.title}.spectra-pkg`;
      downloadDocumentBlob(name, blob);
      setNativeAttribution("Downloaded a verified native copy");
    } catch (error) {
      setNativeRecoveryError(
        error instanceof Error
          ? error.message
          : "The retained native copy is unavailable.",
      );
    } finally {
      setNativeRecoveryBusy(null);
    }
  }, [artifact._id, artifact.title, nativePortableArtifact, setNativeAttribution]);
  const materializeNativeCopy = useCallback(async (
    deviceId: string,
    mountId: string,
    fileName: string,
  ) => {
    if (!nativePortableArtifact || !deviceId || !mountId || !fileName.trim())
      return;
    setNativeRecoveryBusy("materialize");
    setNativeRecoveryError(undefined);
    try {
      const response = await requestSpectra("/api/spectra/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId: artifact._id, deviceId, mountId, fileName }),
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
        state?: string;
        relativePath?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          result?.message ??
            "The native copy could not be queued on this device.",
        );
      setNativeAttribution(
        result?.state === "existing"
          ? "This work already has a copy on this computer"
          : `Queued a local copy${result?.relativePath ? ` at ${result.relativePath}` : ""}`,
      );
    } catch (error) {
      setNativeRecoveryError(
        error instanceof Error
          ? error.message
          : "The native copy could not be queued on this device.",
      );
    } finally {
      setNativeRecoveryBusy(null);
    }
  }, [artifact._id, nativePortableArtifact, setNativeAttribution]);
  const requestNativeCopy = useCallback(() => {
    if (!nativePortableArtifact) return;
    setNativeRecoveryError(undefined);
    if (currentDeviceMounts.length > 0) {
      const extension = inferredNativeFormat ?? "spectra-pkg";
      const stem = artifact.title.replace(/\.[^.]+$/, "");
      const defaultFileName = `${stem}.${extension}`;
      const existing = replicaTruth?.replicas.find(
        (replica) =>
          replica.kind === "local" &&
          replica.deviceId === bridge.status?.deviceId &&
          replica.relativePath?.toLocaleLowerCase() ===
            defaultFileName.toLocaleLowerCase(),
      );
      if (
        existing?.state === "current" &&
        replicaTruth?.replicas.some(
          (replica) =>
            replica.kind === "cloud" &&
            replica.contentHash === existing.contentHash,
        )
      ) {
        setNativeAttribution("This work already has a current copy on this computer");
        return;
      }
      if (existing?.state === "pending" || existing?.state === "ahead") {
        setNativeAttribution("This work is already syncing to this computer");
        return;
      }
      let fileName = stem;
      if (existing && ["diverged", "error", "unavailable"].includes(existing.state)) {
        const usedPaths = new Set(
          replicaTruth?.replicas
            .filter(
              (replica) =>
                replica.kind === "local" &&
                replica.deviceId === bridge.status?.deviceId,
            )
            .map((replica) => replica.relativePath?.toLocaleLowerCase())
            .filter((path): path is string => Boolean(path)) ?? [],
        );
        let copyNumber = 2;
        while (
          usedPaths.has(
            `${stem} - copy ${copyNumber}.${extension}`.toLocaleLowerCase(),
          )
        )
          copyNumber += 1;
        fileName = `${stem} - copy ${copyNumber}`;
      }
      setNativeFolderSelection(
        currentDeviceMounts.length === 1 ? currentDeviceMounts[0]!._id : "",
      );
      setNativeCopyName(fileName);
      setNativeFolderDialogOpen(true);
      return;
    }
    setNativeRecoveryError(
      "Connect Spectra Bridge and add a folder in Spectra Settings before keeping a local copy.",
    );
  }, [
    artifact.title,
    bridge.status?.deviceId,
    currentDeviceMounts,
    inferredNativeFormat,
    nativePortableArtifact,
    replicaTruth?.replicas,
    setNativeAttribution,
  ]);
  const synchronizeDraft = useCallback(
    async (snapshot = currentSnapshotRef.current) => {
      if (
        artifact.blueprintKey === "thread_reference" ||
        permissionReadOnly ||
        syncingRef.current
      )
        return false;
      const titled = {
        ...snapshot,
        title: persistableTitle(snapshot.title),
      };
      const key = snapshotKey(titled);
      syncingRef.current = true;
      rememberLocalSyncKey(localSyncKeysRef.current, key);
      setSyncBusy(true);
      setLiveConflict(null);
      try {
        if (!live.supported) throw new Error("ARTIFACT_LIVE_MODEL_UNAVAILABLE");
        const hadPendingTransportUpdate = live.unsynchronizedChanges > 0;
        if (
          live.state === "reconnecting" ||
          live.state === "unsynchronized" ||
          hadPendingTransportUpdate
        ) {
          if (!live.transport) throw new Error("COLLABORATION_NOT_AVAILABLE");
          await live.transport.retry();
          if (hadPendingTransportUpdate) {
            setBaseline(snapshot);
            setLiveConflict(null);
            // A successful transport retry only persists the semantic Yjs
            // update. Native Office files are a separate verified replica and
            // still need to pass through the lens materializer below. Returning
            // here left Sheets/Slides visibly edited in Spectra while never
            // creating the Bridge write request.
          }
        }
        // Sheets plan cell writes against the room itself, and document/code
        // bodies are bound natively; every other body is replayed onto the
        // room's current value so a peer's unabsorbed edit is not reverted.
        const liveContent =
          nativeBodyBinding ||
          artifact.blueprintKey === "sheets" ||
          !live.modelSnapshot.initialized
            ? undefined
            : (live.flushSnapshot?.() ?? undefined)?.content;
        const nextLiveValue = {
          title: persistableTitle(snapshot.title),
          ...(snapshot.summary.trim()
            ? { summary: snapshot.summary.trim() }
            : {}),
          content: draftContentForLiveWrite({
            baseline: baselineRef.current.content,
            draft: snapshot.content,
            live: liveContent,
          }),
          tags: tagsFromDraft(snapshot.tagDraft),
        };
        // Document and code bodies are already committed through their native
        // Y.XmlFragment/Y.Text bindings. A metadata save must never replay the
        // React snapshot over that live body: the snapshot can lag the editor
        // by a render while the user types and would turn a title change into a
        // false structural rewrite.
        if (
          (artifact.blueprintKey === "document" ||
            artifact.blueprintKey === "code") &&
          live.modelSnapshot.initialized &&
          !nativeFallbackEditedRef.current
        )
          await live.synchronizeMetadata(nextLiveValue);
        else await live.synchronize(nextLiveValue);
        const acknowledgedValue =
          live.flushSnapshot?.() ?? live.model?.getSnapshot().value;
        if (acknowledgedValue) {
          nativeFallbackEditedRef.current = false;
          const acknowledgedContent =
            nativeBodyBinding && artifact.blueprintKey === "document"
              ? {
                  ...record(acknowledgedValue.content),
                  // The Word body is already authoritative in Yjs. Page
                  // chrome lives beside that body, though, and a metadata-only
                  // collaboration save otherwise reuses the previous
                  // pageSetup and silently drops a freshly edited header or
                  // footer before native materialization.
                  ...(record(snapshot.content).pageSetup !== undefined
                    ? { pageSetup: record(snapshot.content).pageSetup }
                    : {}),
                }
              : acknowledgedValue.content;
          const acknowledged = {
            title: acknowledgedValue.title,
            summary: acknowledgedValue.summary ?? "",
            tagDraft: acknowledgedValue.tags.join(", "),
            content: acknowledgedContent,
          };
          rememberLocalSyncKey(
            localSyncKeysRef.current,
            snapshotKey(acknowledged),
          );
          // Region decomposition may normalize IDs/defaults while applying an
          // otherwise identical draft (notably code line IDs). Reconcile to
          // the locally acknowledged Yjs value so byte-level normalization
          // cannot leave the editor in an endless save loop. Never replace
          // keystrokes made while the network request was in flight.
          if (
            snapshotKey(currentSnapshotRef.current) === snapshotKey(snapshot) ||
            snapshotKey(currentSnapshotRef.current) === snapshotKey(titled)
          ) {
            reconcilingRemoteRef.current = true;
            userHasEditedRef.current = false;
            setTitle(acknowledged.title);
            setSummary(acknowledged.summary);
            setTagDraft(acknowledged.tagDraft);
            setContent(acknowledged.content);
            setBaseline(acknowledged);
            writeStudioDirty(dirtyRef, setDirty, false);
          } else {
            setBaseline(acknowledged);
          }
          await queueNativeMaterialization(acknowledged);
        } else {
          await queueNativeMaterialization(snapshot);
        }
        return true;
      } catch (error) {
        localSyncKeysRef.current.delete(key);
        // Programmatic editor hydration can briefly report a changed value
        // while a newly opened native room is still bootstrapping. Only a
        // genuine human edit earns a persistent local-sync warning.
        if (isCollaborativeArtifact && userHasEditedRef.current) {
          setLiveConflict({
            message: collaborationFailureMessage(error),
          });
        }
        return false;
      } finally {
        syncingRef.current = false;
        setSyncBusy(false);
      }
    },
    [
      artifact.blueprintKey,
      isCollaborativeArtifact,
      live,
      nativeBodyBinding,
      permissionReadOnly,
      queueNativeMaterialization,
      snapshotKey,
    ],
  );
  const previewDiff = useMemo(() => {
    if (!previewVersion?.after) return [];
    return humanDiff(
      {
        title,
        summary: summary || undefined,
        content,
        tags: tagsFromDraft(tagDraft),
      },
      previewVersion.after,
      artifact.blueprintKey,
    ).map((change) => {
      if (change.regionId) return change;
      if (change.path[0] === "title")
        return { ...change, regionId: "metadata:title" };
      if (change.path[0] === "summary")
        return { ...change, regionId: "metadata:summary" };
      if (change.path[0] === "tags")
        return { ...change, regionId: "metadata:tags" };
      const contentPath =
        change.path[0] === "content" ? change.path.slice(1) : change.path;
      const descriptor = live.modelSnapshot.regionIds
        .map((regionId) => liveDescriptor(regionId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter((entry) =>
          entry.path.every(
            (segment, index) => String(contentPath[index]) === String(segment),
          ),
        )
        .sort((left, right) => right.path.length - left.path.length)[0];
      return {
        ...change,
        regionId: descriptor?.regionId ?? "artifact:structure",
      };
    });
  }, [
    artifact.blueprintKey,
    content,
    liveDescriptor,
    live.modelSnapshot.regionIds,
    previewVersion,
    summary,
    tagDraft,
    title,
  ]);

  useEffect(() => setSelectedRestoreRegions(new Set()), [previewVersion?._id]);
  const activeAiEffects = useMemo(
    () =>
      live.state === "permission_lost"
        ? []
        : (artifact.aiEffects ?? []).filter(
            (effect) =>
              (!effect.expiresAt || effect.expiresAt > previewClock) &&
              (artifact.aiState === "creating" ||
                artifact.aiState === "updating" ||
                artifact.aiState === "edited"),
          ),
    [artifact.aiEffects, artifact.aiState, live.state, previewClock],
  );
  const liveWorkingAiEffects = useMemo(
    () =>
      activeAiEffects.filter(
        (effect) =>
          effect.state !== "settling" &&
          (artifact.aiState === "creating" || artifact.aiState === "updating"),
      ),
    [activeAiEffects, artifact.aiState],
  );
  const presencePreviewState = usePresencePreview(live.transport);
  const activeAiCollaborator = presencePreviewState.aiCollaborator;
  const activeAiPreviewPatches = presencePreviewState.patches;
  const activeAiPresence =
    activeAiCollaborator && activeAiPreviewPatches.length > 0
      ? activeAiCollaborator
      : null;
  const aiActivitySourceRef = useRef(uniqueToken());
  useEffect(() => {
    const sourceId = aiActivitySourceRef.current;
    publishArtifactAiActivity(
      artifact._id,
      sourceId,
      activeAiCollaborator &&
        (activeAiCollaborator.interactionState
          ? stateIsVisible(activeAiCollaborator.interactionState)
          : activeAiCollaborator.previewPhase === "streaming" ||
            activeAiPreviewPatches.length > 0)
        ? {
            phase: activeAiPresence ? "editing" : "preparing",
            ...(activeAiCollaborator.interactionState?.speculation?.sequence !==
            undefined
              ? {
                  sequence:
                    activeAiCollaborator.interactionState.speculation.sequence,
                }
              : activeAiCollaborator.previewSequence !== undefined
                ? { sequence: activeAiCollaborator.previewSequence }
                : {}),
            // Prefer the semantic frame so every surface describes the same
            // operation the editor is performing.
            ...(activeAiCollaborator.interactionState
              ? {
                  label: actorLabel(
                    activeAiCollaborator.interactionState.actor,
                  ),
                  detail: describeAct(
                    activeAiCollaborator.interactionState.act,
                    activeAiCollaborator.interactionState.target,
                  ),
                  kind: activeAiCollaborator.interactionState.act.kind,
                }
              : {}),
          }
        : null,
    );
    return () => publishArtifactAiActivity(artifact._id, sourceId, null);
  }, [
    activeAiCollaborator,
    activeAiPresence,
    activeAiPreviewPatches.length,
    artifact._id,
  ]);
  const presencePreview = useMemo(() => {
    if (!activeAiPresence || activeAiPreviewPatches.length === 0) return null;
    const next = setAtPointers(
      { title, summary, tags: tagsFromDraft(tagDraft), content },
      activeAiPreviewPatches.map(
        (patch) => [livePreviewOuterPointer(patch.path), patch.value] as const,
      ),
    ) as { title: string; summary: string; tags: string[]; content: unknown };
    const paths: string[] = [];
    for (const patch of activeAiPreviewPatches) {
      const contentPointer = livePreviewContentPointer(patch.path);
      if (contentPointer) paths.push(contentPointer);
    }
    return {
      ...next,
      paths: [...new Set(paths)],
    };
  }, [
    activeAiPresence,
    activeAiPreviewPatches,
    content,
    summary,
    tagDraft,
    title,
  ]);
  const presencePathMemoryRef = useRef<{
    operationKey: string;
    paths: string[];
  } | null>(null);
  const activeAiOperationKey = activeAiCollaborator
    ? `${activeAiCollaborator.runId ?? ""}:${activeAiCollaborator.operationId ?? ""}`
    : "";
  if (presencePreview?.paths.length) {
    presencePathMemoryRef.current = {
      operationKey: activeAiOperationKey,
      paths: presencePreview.paths,
    };
  } else if (!activeAiCollaborator) {
    presencePathMemoryRef.current = null;
  }
  const presenceHighlightPaths = (() => {
    const base =
      presencePreview?.paths.length && presencePreview.paths.length > 0
        ? presencePreview.paths
        : activeAiCollaborator &&
            presencePathMemoryRef.current?.operationKey === activeAiOperationKey
          ? presencePathMemoryRef.current.paths
          : [];
    const lineIndex = activeAiCollaborator?.cursor?.anchor?.lineIndex;
    const blockId =
      activeAiCollaborator?.cursor?.anchor?.kind === "block"
        ? activeAiCollaborator.cursor.anchor.id
        : undefined;
    if (
      typeof lineIndex !== "number" ||
      lineIndex < 0 ||
      !blockId ||
      base.length === 0
    )
      return base;
    const linePath = `/blocks/${blockId}/lines/${lineIndex}`;
    const withoutCoarse = base.filter((path) => {
      if (path.includes("/lines/")) return true;
      const match = path.match(/^\/(?:content\/)?blocks\/([^/]+)/i);
      if (!match) return true;
      const id = decodeURIComponent(match[1]!);
      return id !== blockId && !/^\d+$/.test(id);
    });
    return [...new Set([...withoutCoarse, linePath])];
  })();
  const aiPreviewActive =
    Boolean(artifact.aiPreview) &&
    (artifact.aiState === "creating" || artifact.aiState === "updating");
  /**
   * Work this run changed here that this client may never have watched, because
   * the artifact was closed while it happened. The arrival walks it in route
   * order; a run that has already finished is history and plays nothing.
   */
  const runChangedPaths = useMemo(
    () => [
      ...new Set([
        ...(artifact.aiPreview?.changedPaths ?? []),
        ...activeAiEffects.flatMap((effect) => effect.changedPaths),
      ]),
    ],
    [artifact.aiPreview?.changedPaths, activeAiEffects],
  );
  const joinLateArrival = useJoinLateArrival({
    runId: artifact.aiRunId ?? null,
    changedPaths: runChangedPaths,
    // While the AI is publishing frames here, the live performance *is* the
    // arrival. Playing both would put one actor in two places at once.
    enabled: !activeAiCollaborator,
  });
  const catchUpActive = joinLateArrival.active;
  // Pending creates often attach an empty aiPreview / aiEffects shell for
  // progress chrome before any concrete changedPaths arrive. Do not let that
  // empty shell suppress the create fallback — otherwise mid-open whiteboard
  // (and peers) show rich content with 0 `data-ai-region` attributes.
  // Focused updates stay visually quiet until an exact region arrives. A
  // whole-artifact fallback reads as a refresh and obscures the real edit.
  const liveCreationPaths = useMemo(
    () =>
      creationHighlightFallbackPaths(artifact.aiState, artifact.blueprintKey),
    [artifact.aiState, artifact.blueprintKey],
  );
  const catchUpFallbackPaths = joinLateArrival.paths;
  const streamingSource = presencePreview
    ? "presence"
    : artifact.aiState === "creating" &&
        aiPreviewActive &&
        artifact.aiPreview?.content !== undefined
      ? preferStreamingContentSource({
          local: content,
          preview: artifact.aiPreview.content,
          blueprintKey: artifact.blueprintKey,
          aiState: artifact.aiState,
        })
      : "local";
  const streamingContent =
    streamingSource === "presence"
      ? presencePreview?.content
      : streamingSource === "preview" &&
          artifact.aiPreview?.content !== undefined
        ? artifact.aiPreview.content
        : content;
  const contentDerivedPaths = useMemo(
    () =>
      artifact.aiState === "creating"
        ? contentDerivedHighlightPaths(artifact.blueprintKey, streamingContent)
        : [],
    [artifact.aiState, artifact.blueprintKey, streamingContent],
  );
  const previewHighlightPaths = useMemo(
    () =>
      materializeAiChangedPaths(
        // A durable update preview describes the complete operation, not the
        // control the actor owns *now*. Painting it before awareness arrives
        // exposes every future target as one blue batch and makes the later
        // caret look like a reenactment. Existing-artifact updates are lit only
        // by the canonical interaction frame below. Creates may still use the
        // preview because there is no prior native canvas to preserve.
        artifact.aiState === "creating" && (aiPreviewActive || catchUpActive)
          ? (artifact.aiPreview?.changedPaths ?? [])
          : [],
        streamingContent,
        artifact.blueprintKey,
      ),
    [
      aiPreviewActive,
      artifact.aiPreview?.changedPaths,
      artifact.aiState,
      artifact.blueprintKey,
      catchUpActive,
      streamingContent,
    ],
  );
  const effectHighlightPaths = useMemo(() => {
    // Effects are durable operation metadata. During an update, only the live
    // actor may reveal a target; otherwise staged effects accumulate and every
    // edited control lights simultaneously before any native gesture occurs.
    if (artifact.aiState !== "creating") return [];
    const effectPaths = activeAiEffects.flatMap(
      (effect) => effect.changedPaths,
    );
    const previewPaths =
      artifact.aiState === "creating" || artifact.aiState === "edited"
        ? (artifact.aiPreview?.changedPaths ?? [])
        : [];
    const merged = [...effectPaths, ...previewPaths];
    const hasLineScope = merged.some((path) => path.includes("/lines/"));
    const preferred = hasLineScope
      ? merged.filter(
          (path) =>
            path.includes("/lines/") ||
            (path !== "/" && !/^\/(?:content\/)?blocks\//i.test(path)),
        )
      : merged;
    return materializeAiChangedPaths(
      preferred,
      streamingContent,
      artifact.blueprintKey,
    );
  }, [
    activeAiEffects,
    artifact.aiPreview?.changedPaths,
    artifact.aiState,
    artifact.blueprintKey,
    streamingContent,
  ]);
  const effectRegionHighlightPaths = useMemo(
    () =>
      artifact.aiState !== "creating"
        ? []
        : materializeAiChangedPaths(
            activeAiEffects.flatMap((effect) =>
              effect.regionIds.flatMap((regionId) => {
                const descriptor = liveDescriptor(regionId);
                return descriptor
                  ? [semanticPathToPointer(descriptor.path)]
                  : [];
              }),
            ),
            streamingContent,
            artifact.blueprintKey,
          ),
    [
      activeAiEffects,
      artifact.aiState,
      artifact.blueprintKey,
      liveDescriptor,
      streamingContent,
    ],
  );
  const presenceRegionHighlightPaths = useMemo(
    () =>
      materializeAiChangedPaths(
        activeAiCollaborator?.activeRegionId &&
          (!activeAiCollaborator.interactionState ||
            activeAiCollaborator.interactionState.target)
          ? (() => {
              const descriptor = liveDescriptor(
                activeAiCollaborator.activeRegionId,
              );
              return descriptor ? [semanticPathToPointer(descriptor.path)] : [];
            })()
          : [],
        streamingContent,
        artifact.blueprintKey,
      ),
    [
      activeAiCollaborator?.activeRegionId,
      activeAiCollaborator?.interactionState,
      artifact.blueprintKey,
      liveDescriptor,
      streamingContent,
    ],
  );
  const semanticInteractionTargetPaths = useMemo(
    () =>
      activeAiCollaborator?.interactionState?.target
        ? materializeAiChangedPaths(
            [activeAiCollaborator.interactionState.target.path],
            streamingContent,
            artifact.blueprintKey,
          )
        : [],
    [
      activeAiCollaborator?.interactionState?.target,
      artifact.blueprintKey,
      streamingContent,
    ],
  );
  const presenceTargetPaths = useMemo(() => {
    // Protocol v2 owns one semantic control at a time. The same target that
    // places the actor also places its native trace, including the settle
    // frame; cumulative speculative patches must never fan one body out across
    // several controls.
    if (semanticInteractionTargetPaths.length > 0)
      return semanticInteractionTargetPaths;
    if (activeAiCollaborator?.interactionState) return [];
    // During live streaming, light only the active region — completed fields
    // stay visible via content patches without stacking blue traces on every
    // previously touched control.
    if (activeAiCollaborator?.previewPhase === "streaming") {
      if (presenceRegionHighlightPaths.length > 0)
        return presenceRegionHighlightPaths;
      return presenceHighlightPaths.slice(-1);
    }
    const combined = [
      ...presenceRegionHighlightPaths,
      ...presenceHighlightPaths,
    ];
    return [
      ...new Set(
        combined.filter(
          (path) =>
            !combined.some(
              (candidate) =>
                candidate !== path && candidate.startsWith(`${path}/`),
            ),
        ),
      ),
    ];
  }, [
    activeAiCollaborator?.interactionState,
    activeAiCollaborator?.previewPhase,
    presenceHighlightPaths,
    presenceRegionHighlightPaths,
    semanticInteractionTargetPaths,
  ]);
  const hasConcreteHighlightPaths =
    presenceTargetPaths.length > 0 ||
    previewHighlightPaths.length > 0 ||
    effectHighlightPaths.length > 0 ||
    effectRegionHighlightPaths.length > 0;
  const liveUpdatingPaths = useMemo(
    () =>
      updatingHighlightFallbackPaths(
        artifact.aiState,
        artifact.blueprintKey,
        hasConcreteHighlightPaths,
      ),
    [artifact.aiState, artifact.blueprintKey, hasConcreteHighlightPaths],
  );
  const aiChangedPaths = resolveAiHighlightPaths({
    previewPaths:
      activeAiCollaborator?.previewPhase === "streaming"
        ? presenceTargetPaths.length > 0
          ? presenceTargetPaths
          : previewHighlightPaths.slice(-1)
        : [...presenceTargetPaths, ...previewHighlightPaths],
    effectChangedPaths:
      activeAiCollaborator?.previewPhase === "streaming"
        ? []
        : effectHighlightPaths,
    effectRegionPointers:
      activeAiCollaborator?.previewPhase === "streaming"
        ? []
        : effectRegionHighlightPaths,
    creationFallbackPaths:
      liveCreationPaths.length > 0
        ? liveCreationPaths
        : liveUpdatingPaths.length > 0
          ? liveUpdatingPaths
          : artifact.aiState !== "creating"
            ? []
            : catchUpFallbackPaths,
    contentDerivedPaths:
      activeAiCollaborator?.previewPhase === "streaming"
        ? []
        : contentDerivedPaths,
  });
  const liveStreamingAi = Boolean(
    activeAiCollaborator &&
    (activeAiCollaborator.interactionState
      ? stateIsVisible(activeAiCollaborator.interactionState)
      : activeAiCollaborator.previewPhase === "streaming" ||
        activeAiPreviewPatches.length > 0),
  );
  const aiEffectTitles = [
    ...new Set([
      ...liveWorkingAiEffects.map((effect) => effect.title),
      ...(aiPreviewActive && artifact.aiPreview?.effectTitle
        ? [artifact.aiPreview.effectTitle]
        : []),
    ]),
  ];
  const aiWorkingActive =
    liveStreamingAi ||
    aiPreviewActive ||
    liveWorkingAiEffects.length > 0 ||
    (catchUpActive && aiChangedPaths.length > 0) ||
    ((artifact.aiState === "creating" || artifact.aiState === "updating") &&
      aiChangedPaths.length > 0 &&
      (aiPreviewActive || liveWorkingAiEffects.length > 0 || liveStreamingAi));
  const visibleAiWorking =
    aiWorkingActive && (liveStreamingAi || !aiHighlightDismissed);
  const highlightPaths = useMemo(
    () =>
      activeAiCollaborator?.previewPhase === "streaming"
        ? presenceTargetPaths.length > 0
          ? presenceTargetPaths
          : aiChangedPaths.slice(0, 1)
        : activeAiCollaborator
          ? aiChangedPaths
          : aiHighlightDismissed
            ? []
            : aiChangedPaths,
    [
      activeAiCollaborator,
      presenceTargetPaths,
      aiChangedPaths,
      aiHighlightDismissed,
    ],
  );
  // Never manufacture a second AI body from durable status. If awareness has
  // not arrived yet, the run may say "preparing", but no cursor is invented.
  // The real actor's canonical frame is the only source of visible action.
  const displayPresence = presencePreviewState.people;
  // Existing-artifact edits may only become provisional through the live
  // actor's awareness frames. The Convex preview is a recovery ledger, not a
  // rendering source: using it during cursor/focus/menu beats lets a later
  // staged value jump ahead of the actor and makes the native gesture look
  // decorative. Creates are different because no prior native canvas exists;
  // their preview remains the bounded mid-open bootstrap.
  const durableEditorContent = presencePreview
    ? presencePreview.content
    : artifact.aiState === "creating" &&
        aiPreviewActive &&
        artifact.aiPreview?.content !== undefined
      ? streamingSource === "local"
        ? content
        : mergeAiRegions(content, artifact.aiPreview.content, aiChangedPaths)
      : content;
  /* ---------------------------------------------------------------- *
   * Interaction fabric
   * ---------------------------------------------------------------- */

  /**
   * The editor's scroll container. Presence and AI traces are painted over this
   * box and resolved against it, so they stay correct in split and full layouts.
   */
  const presenceSurfaceRef = useRef<HTMLElement | null>(null);

  /** Semantic identity of this client, used for every published frame. */
  const localActor = useMemo<ActorIdentity | null>(() => {
    const clientId = live.transport?.clientId;
    if (!clientId) return null;
    return {
      clientId,
      kind: "human",
      name: live.displayName ?? "Collaborator",
      ...(live.accountId ? { accountId: live.accountId } : {}),
    };
  }, [live.accountId, live.displayName, live.transport?.clientId]);

  /** Remote v2 frames, including the synthetic stand-in for a just-started run. */
  const remoteInteractionStates = useMemo<InteractionState[]>(
    () =>
      displayPresence
        .filter((person) => person.clientId !== live.transport?.clientId)
        .map((person) => person.interactionState)
        .filter((state): state is InteractionState => Boolean(state)),
    [displayPresence, live.transport?.clientId],
  );

  const publishInteraction = useCallback(
    (state: InteractionState | null) => {
      try {
        live.transport?.setPresence({ interactionState: state });
      } catch {
        // Presence is supportive metadata, never a prerequisite for editing.
      }
    },
    [live.transport],
  );

  const liveRegionByPathKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const regionId of live.modelSnapshot.regionIds) {
      const entry = liveDescriptor(regionId);
      if (!entry) continue;
      map.set(entry.path.map(String).join("\0"), entry.regionId);
    }
    return map;
  }, [live.modelSnapshot.regionIds, liveDescriptor]);
  const regionIdForSegments = useCallback(
    (segments: string[]) => {
      for (let len = segments.length; len > 0; len -= 1) {
        const hit = liveRegionByPathKey.get(segments.slice(0, len).join("\0"));
        if (hit) return hit;
      }
      return undefined;
    },
    [liveRegionByPathKey],
  );
  const presenceRegionForPath = useCallback(
    (path: string) => {
      const segments = pathSegments(path);
      if (segments[0] === "title") return "metadata:title";
      if (segments[0] === "summary") return "metadata:summary";
      if (segments[0] === "tags") return "metadata:tags";
      return regionIdForSegments(segments);
    },
    [regionIdForSegments],
  );

  /* ---------------------------------------------------------------- *
   * Follow AI (spectator mode)
   * ---------------------------------------------------------------- */

  const followAi = useFollowAi();

  /** The AI's own frame, when it is operating in this artifact. */
  const aiInteractionState = useMemo(
    () =>
      remoteInteractionStates.find((state) => state.actor.kind === "ai") ??
      null,
    [remoteInteractionStates],
  );

  // Publish where the AI is so Follow AI can find it from the thread panel.
  useEffect(() => {
    if (!aiInteractionState?.target) return;
    noteAiLocation({
      ...(stableAiActorId(aiInteractionState.actor)
        ? { actorId: stableAiActorId(aiInteractionState.actor)! }
        : {}),
      artifactId: artifact._id,
      path: aiInteractionState.target.path,
      note: describeState(aiInteractionState),
    });
  }, [artifact._id, aiInteractionState]);

  useEffect(() => () => clearAiLocation(artifact._id), [artifact._id]);

  // While spectating, keep the exact working target on screen: give the studio
  // a beat to switch to the right view, then scroll the control into view.
  const lastRevealedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!followAi.following) {
      lastRevealedPathRef.current = null;
      return;
    }
    const target = aiInteractionState?.target;
    if (!target || lastRevealedPathRef.current === target.path) return;
    lastRevealedPathRef.current = target.path;
    void spectraBus.command("work.reveal", {
      workId: artifact._id,
      path: target.path,
    });
    return scheduleRevealTarget(() => presenceSurfaceRef.current, target, {
      reducedMotion: getSpectraMotionSnapshot().reduced,
    });
  }, [followAi.following, aiInteractionState, artifact._id]);

  /* ---------------------------------------------------------------- *
   * Follow collaborator / presenter (generalized spectator mode)
   * ---------------------------------------------------------------- */

  const followState = useFollow();
  const followedClientId =
    followState.target && followState.target.kind !== "ai"
      ? followState.target.clientId
      : null;

  /** The followed person's own frame, when they are in this artifact. */
  const followedInteractionState = useMemo(
    () =>
      followedClientId
        ? (remoteInteractionStates.find(
            (state) => state.actor.clientId === followedClientId,
          ) ?? null)
        : null,
    [followedClientId, remoteInteractionStates],
  );

  // Publish the followed actor's location and keep their working target on
  // screen — the same contract as Follow AI, without touching focus.
  const lastFollowRevealRef = useRef<string | null>(null);
  useEffect(() => {
    if (!followedClientId) {
      lastFollowRevealRef.current = null;
      return;
    }
    const state = followedInteractionState;
    if (!state?.target) return;
    const followTarget = state.target;
    noteFollowLocation({
      clientId: followedClientId,
      artifactId: artifact._id,
      path: followTarget.path,
      note: describeState(state),
    });
    if (lastFollowRevealRef.current === followTarget.path) return;
    lastFollowRevealRef.current = followTarget.path;
    return scheduleRevealTarget(
      () => presenceSurfaceRef.current,
      followTarget,
      { reducedMotion: getSpectraMotionSnapshot().reduced },
    );
  }, [followedClientId, followedInteractionState, artifact._id]);

  // Local input always wins: the first gesture ends spectating immediately
  // and leaves the "Return to …" affordance offered by the header cluster.
  useEffect(() => {
    if (!followedClientId) return;
    const surface = presenceSurfaceRef.current;
    if (!surface) return;
    const disengage = () => disengageFollow("user_input");
    surface.addEventListener("pointerdown", disengage, true);
    surface.addEventListener("keydown", disengage, true);
    surface.addEventListener("wheel", disengage, {
      capture: true,
      passive: true,
    });
    return () => {
      surface.removeEventListener("pointerdown", disengage, true);
      surface.removeEventListener("keydown", disengage, true);
      surface.removeEventListener("wheel", disengage, true);
    };
  }, [followedClientId]);

  useInteractionPresence({
    artifactId: artifact._id,
    typeKey: artifact.blueprintKey as ArtifactTypeKey,
    actor: localActor,
    surfaceRef: presenceSurfaceRef,
    onPublish: publishInteraction,
    resolveRegionId: presenceRegionForPath,
    // The region this client is working is published with its frames, so the
    // same ownership rules apply to it as to any AI operation.
    ...(activeCommentRegionId
      ? { heldRegionIds: [activeCommentRegionId] }
      : {}),
    enabled: !readOnly && isCollaborativeArtifact,
  });

  /**
   * Smallest-scope contention. A control another actor is actively operating
   * declines the local user's keystrokes and says why; every other control in
   * the artifact stays fully editable.
   */
  useHeldControlGuard({
    states: remoteInteractionStates,
    localClientId: live.transport?.clientId,
    surfaceRef: presenceSurfaceRef,
    enabled: !readOnly,
  });

  const [heldNotice, setHeldNotice] = useState<HeldDeclinedDetail | null>(null);
  useEffect(() => {
    const onDeclined = (event: Event) => {
      const detail = (event as CustomEvent<HeldDeclinedDetail>).detail;
      if (detail) setHeldNotice(detail);
    };
    window.addEventListener(HELD_DECLINED_EVENT, onDeclined);
    return () => window.removeEventListener(HELD_DECLINED_EVENT, onDeclined);
  }, []);
  useEffect(() => {
    if (!heldNotice) return;
    // State the reason once, then leave. This is not a persistent banner.
    const timer = window.setTimeout(() => setHeldNotice(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [heldNotice]);

  /**
   * Values a peer or AI is provisionally showing. Merged over the durable content
   * so a collaborator's in-progress typing is visible before it commits, and
   * disappears cleanly if their operation is reversed.
   */
  const remoteSpeculation = useMemo(() => {
    const patches = new Map<string, unknown>();
    for (const state of remoteInteractionStates) {
      if (!state.speculation) continue;
      // A settled or failed frame is no longer speculative: its value either
      // became durable or was reversed, and continuing to overlay it is how a
      // preview gets stuck on screen after the work ended.
      if (state.lifecycle === "settled" || state.lifecycle === "failed")
        continue;
      for (const patch of state.speculation.patches) {
        patches.set(patch.path, patch.value);
      }
    }
    return patches;
  }, [remoteInteractionStates]);

  /**
   * Durable content with peers' in-flight values layered on top. This is what
   * makes remote work feel live rather than arriving as one late commit: the
   * provisional value is visible while the peer is still typing, and vanishes
   * on its own if their operation never lands.
   */
  const editorContent = useMemo(() => {
    if (remoteSpeculation.size === 0) return durableEditorContent;
    let documentBlocksAreSpeculative = false;
    const patches: Array<readonly [string, unknown]> = [];
    for (const [pointer, value] of remoteSpeculation) {
      const contentPointer = livePreviewContentPointer(pointer);
      if (!contentPointer) continue;
      if (/^\/blocks(?:\/|$)/.test(contentPointer))
        documentBlocksAreSpeculative = true;
      // A whole-content frame with no value keeps what is already layered.
      if (contentPointer === "/" && value == null) continue;
      patches.push([contentPointer, value]);
    }
    const next = setAtPointers(durableEditorContent, patches);
    if (
      artifact.blueprintKey === "document" &&
      documentBlocksAreSpeculative &&
      next &&
      typeof next === "object" &&
      !Array.isArray(next)
    ) {
      // Document content deliberately stores both semantic blocks and TipTap
      // JSON. An AI frame patches the semantic block first; if the stale TipTap
      // mirror remains present, DocumentStudio correctly prefers it and the
      // entire visible stream is hidden until the durable commit refreshes both
      // representations. During this causal window, project from the patched
      // blocks while preserving every other content field.
      const { tiptap: _staleTiptap, ...blockProjection } = next as Record<
        string,
        unknown
      >;
      return blockProjection;
    }
    return next;
  }, [artifact.blueprintKey, durableEditorContent, remoteSpeculation]);

  const editorChange =
    aiPreviewActive && artifact.aiPreview?.content !== undefined
      ? (next: unknown) =>
          changeContent(
            streamingSource === "local"
              ? next
              : mergeAiRegions(
                  next,
                  artifact.aiPreview?.content,
                  aiChangedPaths,
                ),
          )
      : changeContent;

  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);
  useEffect(() => {
    setPreviewClock(Date.now());
  }, []);
  useEffect(() => {
    const nextExpiry = (artifact.aiEffects ?? [])
      .flatMap((effect) => (effect.expiresAt ? [effect.expiresAt] : []))
      .filter((expiresAt) => expiresAt > Date.now())
      .sort((left, right) => left - right)[0];
    if (!nextExpiry) return;
    const timer = window.setTimeout(
      () => setPreviewClock(Date.now()),
      Math.max(0, nextExpiry - Date.now()) + 24,
    );
    return () => window.clearTimeout(timer);
  }, [artifact.aiEffects]);
  useEffect(() => {
    if (!aiPreviewActive || !artifact.aiPreview) return;
    aiMergeRef.current = {
      paths: artifact.aiPreview.changedPaths ?? [],
      title: artifact.aiPreview.title !== undefined,
      summary: artifact.aiPreview.summary !== undefined,
      tags: artifact.aiPreview.tags !== undefined,
    };
  }, [aiPreviewActive, artifact.aiPreview]);

  useEffect(() => {
    onDirtyChange(dirty);
    dirtyRef.current = dirty;
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setAiHighlightDismissed(false);
  }, [artifact._id, artifact.aiState]);
  useEffect(() => {
    if (activeAiPresence) setAiHighlightDismissed(false);
  }, [activeAiPresence]);

  const lastPresenceRegionRef = useRef<string | null>(null);
  const lastPresenceModeRef = useRef<"typing" | "focus" | "selecting" | null>(
    null,
  );
  const setActivePresence = useCallback(
    (
      regionId: string,
      options?: { mode?: "typing" | "focus" | "selecting" },
    ) => {
      try {
        const mode = options?.mode ?? "focus";
        // Presence used to stamp `updatedAt: Date.now()` on every studio
        // region-effect, even when the caret had not moved. Tab mode then
        // rebuilt the live snapshot, the studio re-rendered, the effect ran
        // again, and React hit its update cap before the grid could settle.
        if (
          lastPresenceRegionRef.current === regionId &&
          lastPresenceModeRef.current === mode
        ) {
          return;
        }
        lastPresenceRegionRef.current = regionId;
        lastPresenceModeRef.current = mode;
        live.transport?.setPresence({
          activeRegionId: regionId,
          interaction: {
            kind:
              mode === "selecting"
                ? "selecting"
                : mode === "typing"
                  ? "typing"
                  : "focus",
            targetId: regionId,
          },
          cursor: {
            x: pendingCursorRef.current?.x ?? 0.5,
            y: pendingCursorRef.current?.y ?? 0.42,
            updatedAt: Date.now(),
            mode: mode === "selecting" ? "selecting" : "typing",
            anchor: regionId.startsWith("metadata:")
              ? {
                  kind: "path" as const,
                  id: `/${regionId.slice("metadata:".length)}`,
                  offsetX: 0.08,
                  offsetY: 0.45,
                  offset: 0.08,
                }
              : {
                  kind: "block" as const,
                  id: regionId,
                  offsetX: 0.08,
                  offsetY: 0.35,
                  offset: 0.08,
                },
          },
        });
      } catch {
        // Presence is supportive metadata, never a prerequisite for editing.
      }
    },
    [live.transport],
  );
  const presenceFrameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<{
    x: number;
    y: number;
    mode?: NonNullable<CollaborationPresence["cursor"]>["mode"];
    anchor?: NonNullable<CollaborationPresence["cursor"]>["anchor"];
  } | null>(null);
  const studioSurfaceRef = useRef<HTMLDivElement>(null);
  // Things in the work form, unform and leave wakes in the field.
  useEditorFieldMoments(studioSurfaceRef);
  // Opened from a card or a row, the work grows out of it (MOTION.md, "Shared elements"), wherever it opens.
  useLifeLanding(studioSurfaceRef, artifact._id);
  // Closed, it folds back into its card.
  useLifeReturn(studioSurfaceRef, `artifact:${artifact._id}`, ".spectra-artifact-studio");
  const lastStudioInteractionAtRef = useRef(0);
  const noteStudioInteraction = useCallback(() => {
    lastStudioInteractionAtRef.current = Date.now();
    lastInteractedStudioSurface = studioSurfaceRef.current;
    // Any direct input returns control of the viewport to the user instantly.
    disengageFollowAi();
  }, []);
  // Never steal the peer's viewport for AI edits — they may be reading or
  // typing elsewhere. Cyan ink and the AI caret are the only locators.
  const handlePresencePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!live.transport || live.state !== "synchronized") return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        event.currentTarget.contains(active) &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        // While typing/focusing a control, never overwrite the caret with a
        // hover pointer — peers should only see the action cursor.
        return;
      }
      const anchor = resolvePresenceAnchorFromPoint(
        event.currentTarget,
        event.clientX,
        event.clientY,
      );
      pendingCursorRef.current = {
        x: Math.max(
          0,
          Math.min(1, (event.clientX - bounds.left) / bounds.width),
        ),
        y: Math.max(
          0,
          Math.min(1, (event.clientY - bounds.top) / bounds.height),
        ),
        mode: "pointer" as const,
        ...(anchor ? { anchor } : {}),
      };
      if (presenceFrameRef.current !== null) return;
      presenceFrameRef.current = window.requestAnimationFrame(() => {
        presenceFrameRef.current = null;
        const cursor = pendingCursorRef.current;
        if (!cursor) return;
        live.transport?.setPresence({
          actorKind: "human",
          interaction: { kind: "pointer" },
          selection: null,
          cursor: { ...cursor, updatedAt: Date.now(), mode: "pointer" },
        });
      });
    },
    [live.state, live.transport],
  );
  const clearPresenceCursor = useCallback(() => {
    pendingCursorRef.current = null;
    live.transport?.setPresence({ cursor: null, selection: null });
  }, [live.transport]);
  useEffect(() => {
    if (!live.transport || live.state !== "synchronized") return;
    const onPresenceSelection = (event: Event) => {
      const root = studioSurfaceRef.current;
      if (
        !root ||
        !(event.target instanceof Node) ||
        !root.contains(event.target)
      )
        return;
      const detail = (
        event as CustomEvent<
          CollaborationPresence["selection"] & {
            caretOffset?: number;
            primaryBlockId?: string;
          }
        >
      ).detail;
      if (!detail || typeof detail !== "object") return;
      const collapsed = Boolean(detail.collapsed);
      const primary =
        detail.primaryBlockId ?? detail.ranges?.[0]?.blockId ?? undefined;
      const caretOffset =
        typeof detail.caretOffset === "number" &&
        Number.isFinite(detail.caretOffset)
          ? Math.max(0, Math.floor(detail.caretOffset))
          : (detail.ranges?.[0]?.startOffset ?? 0);
      if (detail.relative)
        setCommentRelativePosition(
          encodeDocumentRelativeSelection(detail.relative),
        );
      live.transport?.setPresence({
        actorKind: "human",
        selection: {
          kind: "text",
          collapsed,
          ...(typeof detail.text === "string"
            ? { text: detail.text.slice(0, 280) }
            : {}),
          ranges: Array.isArray(detail.ranges) ? detail.ranges : [],
          ...(detail.relative ? { relative: detail.relative } : {}),
        },
        interaction: {
          kind: collapsed ? "typing" : "selecting",
          ...(primary
            ? { targetId: primary, targetKind: "block" as const }
            : {}),
        },
        cursor: {
          x: pendingCursorRef.current?.x ?? 0.5,
          y: pendingCursorRef.current?.y ?? 0.4,
          updatedAt: Date.now(),
          mode: collapsed ? "typing" : "selecting",
          ...(primary
            ? {
                anchor: {
                  kind: "block" as const,
                  id: primary,
                  charOffset: caretOffset,
                },
              }
            : pendingCursorRef.current?.anchor
              ? { anchor: pendingCursorRef.current.anchor }
              : {}),
        },
      });
    };
    document.addEventListener(
      "spectra-presence-selection",
      onPresenceSelection,
    );
    return () =>
      document.removeEventListener(
        "spectra-presence-selection",
        onPresenceSelection,
      );
  }, [live.state, live.transport]);
  useEffect(
    () => () => {
      if (presenceFrameRef.current !== null)
        window.cancelAnimationFrame(presenceFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (
      !workType ||
      readOnly ||
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid" ||
      live.state !== "synchronized" ||
      live.unsynchronizedChanges > 0 ||
      dirtyRef.current ||
      userHasEditedRef.current
    )
      return;
    const expected = humanSummary(artifact.summary);
    const actual = humanSummary(live.liveValue.summary);
    if (
      !isGeneratedArtifactSummary(expected, workType) ||
      expected === actual ||
      (actual && !isGeneratedArtifactSummary(actual, workType))
    )
      return;
    const repairKey = `${artifact._id}:${artifact.updatedAt}:${actual}:${expected}`;
    if (generatedSummaryRepairRef.current === repairKey) return;
    generatedSummaryRepairRef.current = repairKey;
    void live
      .synchronizeMetadata({
        ...live.liveValue,
        summary: expected,
      })
      .catch(() => {
        generatedSummaryRepairRef.current = null;
      });
  }, [
    artifact._id,
    artifact.summary,
    artifact.updatedAt,
    humanSummary,
    live,
    readOnly,
    workType,
  ]);

  useEffect(() => {
    const snapshotsDiffer =
      snapshotKey(currentSnapshot) !== snapshotKey(baseline);
    const nextDirty = nativeOfficeDraftPending({
      nativeOfficeDocument,
      userHasEdited: userHasEditedRef.current,
      snapshotsDiffer,
    });
    if (reconcilingRemoteRef.current) {
      if (!nextDirty) reconcilingRemoteRef.current = false;
      // A Yjs echo of a local Office edit hydrates React without writing the
      // native file. Swallowing dirty here left Word/Excel/PowerPoint bytes
      // unchanged while the editor already showed the draft.
      writeStudioDirty(dirtyRef, setDirty, nextDirty);
      return;
    }
    if (!snapshotsDiffer && !nextDirty) userHasEditedRef.current = false;
    writeStudioDirty(dirtyRef, setDirty, nextDirty);
  }, [baseline, currentSnapshot, nativeOfficeDocument, snapshotKey]);

  useEffect(() => {
    const switchedArtifacts = activeArtifactIdRef.current !== artifact._id;
    // The recovery controller publishes this only after durable archival and
    // replacement-model readiness. Reuse normal model reconciliation once;
    // never hydrate from the old cached artifact or write another Yjs update.
    const adoptedRecovery = observedRecoveryAdoption.current.artifactId === artifact._id &&
      Boolean(live.recovery.adoptionId) && observedRecoveryAdoption.current.adoptionId !== live.recovery.adoptionId;
    observedRecoveryAdoption.current = { artifactId: artifact._id, adoptionId: live.recovery.adoptionId };
    const incomingKey = snapshotKey(incomingSnapshot);
    if (switchedArtifacts) {
      reconciliationOriginRef.current = {
        initialRevision: artifact.updatedAt,
        latestRevision: artifact.updatedAt,
        hasAcceptedLiveValue: false,
      };
    }
    const incomingSource = studioIncomingSource({
      ...reconciliationOriginRef.current,
      revision: artifact.updatedAt,
      liveValueSource: live.liveValueSource,
    });
    const isLocalSyncKey = localSyncKeysRef.current.has(incomingKey);
    // Identical content must be reconsidered when the room initializes, a
    // saved revision advances, or a local acknowledgement arrives. Object
    // identity alone still must not cause a new reconciliation on every render.
    const reconciliationKey = incomingReconciliationKey(
      artifact._id,
      incomingSnapshot,
      { source: incomingSource, revision: artifact.updatedAt, localSync: isLocalSyncKey },
      incomingKey,
    );
    if (lastReconciledIncomingKeyRef.current === reconciliationKey && !adoptedRecovery) {
      return;
    }
    lastReconciledIncomingKeyRef.current = reconciliationKey;
    const decision = switchedArtifacts || adoptedRecovery ? "accept-bootstrap" : decideRemoteStudioIncoming({
        dirty: dirtyRef.current,
        userHasEdited: userHasEditedRef.current,
        incomingKey,
        baselineKey: snapshotKey(baseline),
        dismissedRemoteKey,
        isLocalSyncKey,
        isCollaborative: isCollaborativeArtifact,
        nativeOfficeDocument,
        currentContent: currentSnapshotRef.current.content,
        incomingContent: incomingSnapshot.content,
        incomingSource,
      });
    reconciliationOriginRef.current.latestRevision = Math.max(
      reconciliationOriginRef.current.latestRevision, artifact.updatedAt,
    );
    if (incomingSource === "live")
      reconciliationOriginRef.current.hasAcceptedLiveValue = true;
    if (decision === "ignore") {
        // Native Office bodies already live on the bound Yjs fragment. A Yjs
        // echo is not a new human draft; keep React still and clear claim noise.
        if (nativeOfficeDocument) setLiveConflict(null);
        return;
    }
    if (decision === "accept-local-sync") {
        localSyncKeysRef.current.delete(incomingKey);
        setBaseline(incomingSnapshot);
        setLiveConflict(null);
        return;
    }
    if (!switchedArtifacts && dirtyRef.current) {
      if (decision === "accept-bootstrap") {
        // Normalize/bootstrap echoes can report dirty without a human edit.
        // Accept the saved projection instead of raising a false conflict.
        reconcilingRemoteRef.current = true;
        userHasEditedRef.current = false;
        writeStudioDirty(dirtyRef, setDirty, false);
        setRemoteConflict(null);
        setLiveConflict(null);
        setTitle(incomingSnapshot.title);
        setSummary(incomingSnapshot.summary);
        setTagDraft(incomingSnapshot.tagDraft);
        setContent(incomingSnapshot.content);
        setBaseline(incomingSnapshot);
        if (reconciliationFrameRef.current !== null)
          window.cancelAnimationFrame(reconciliationFrameRef.current);
        reconciliationFrameRef.current = window.requestAnimationFrame(() => {
          reconcilingRemoteRef.current = false;
          reconciliationFrameRef.current = null;
        });
        return;
      }
      const aiMerge = aiMergeRef.current;
      if (aiMerge) {
        const local = currentSnapshotRef.current;
        setTitle(aiMerge.title ? incomingSnapshot.title : local.title);
        setSummary(
          aiMerge.summary ? incomingSnapshot.summary : local.summary,
        );
        setTagDraft(
          aiMerge.tags ? incomingSnapshot.tagDraft : local.tagDraft,
        );
        setContent(
          mergeAiRegions(
            local.content,
            incomingSnapshot.content,
            aiMerge.paths,
          ),
        );
        setBaseline(incomingSnapshot);
        setRemoteConflict(null);
        aiMergeRef.current = null;
      } else if (decision === "rebase") {
        const local = currentSnapshotRef.current;
        const rebased = rebaseCollaborativeSnapshot(
          baseline,
          local,
          incomingSnapshot,
        );
        reconcilingRemoteRef.current = true;
        setTitle(rebased.snapshot.title);
        setSummary(rebased.snapshot.summary);
        setTagDraft(rebased.snapshot.tagDraft);
        setContent(rebased.snapshot.content);
        setBaseline(incomingSnapshot);
        setRemoteConflict(rebased.conflicts.length ? incomingSnapshot : null);
        // A successful remote-only merge remains an unsaved local draft. A
        // same-leaf collision is also preserved locally for explicit review.
        userHasEditedRef.current = true;
        writeStudioDirty(dirtyRef, setDirty, true);
        window.requestAnimationFrame(() => {
          reconcilingRemoteRef.current = false;
        });
      } else setRemoteConflict(incomingSnapshot);
      return;
    }
    activeArtifactIdRef.current = artifact._id;
    reconcilingRemoteRef.current = true;
    userHasEditedRef.current = false;
    writeStudioDirty(dirtyRef, setDirty, false);
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
    setLiveConflict(null);
    setTitle(incomingSnapshot.title);
    setSummary(incomingSnapshot.summary);
    setTagDraft(incomingSnapshot.tagDraft);
    setContent(incomingSnapshot.content);
    setBaseline(incomingSnapshot);
    // Reconciliation is a bounded render-cycle guard, not an editor mode. A
    // previously unbounded flag could swallow the first real keystroke after
    // opening or refreshing an artifact and leave Save permanently disabled.
    if (reconciliationFrameRef.current !== null)
      window.cancelAnimationFrame(reconciliationFrameRef.current);
    reconciliationFrameRef.current = window.requestAnimationFrame(() => {
      reconcilingRemoteRef.current = false;
      reconciliationFrameRef.current = null;
    });
  }, [
    artifact._id,
    artifact.updatedAt,
    baseline,
    dismissedRemoteKey,
    incomingSnapshot,
    isCollaborativeArtifact,
    live.liveValueSource,
    live.recovery.adoptionId,
    nativeOfficeDocument,
    snapshotKey,
  ]);

  useEffect(
    () => () => {
      if (reconciliationFrameRef.current !== null)
        window.cancelAnimationFrame(reconciliationFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    function requestClose({ workId }: { workId: string }) {
      if (workId === artifact._id) requestStudioClose();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Capture while overlays still exist. A bubble listener runs after Radix
      // closes the menu, so Escape on More would close the whole studio.
      if (
        document.querySelector(
          '[data-state="open"][aria-haspopup], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [role="dialog"][data-state="open"], details[open], [aria-expanded="true"][aria-haspopup], .slash-command-portal, .spectra-document-studio[data-focus]',
        )
      ) {
        return;
      }
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      if (commentsOpen) {
        setCommentsOpen(false);
        return;
      }
      if (embedsOpen) {
        setEmbedsOpen(false);
        return;
      }
      event.preventDefault();
      requestStudioClose();
    }
    const removeRequestClose = spectraBus.handle("work.requestClose", requestClose);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      removeRequestClose();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // requestStudioClose reads latest dirty/panel flags via this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close handler closes over latest studio state
  }, [artifact._id, commentsOpen, dirty, embedsOpen, historyOpen, live.unsynchronizedChanges]);

  const shellHistoryEnabled =
    !readOnly && SHELL_HISTORY_TYPES.has(artifact.blueprintKey);
  const changeContentRef = useRef(changeContent);
  changeContentRef.current = changeContent;
  // The keyboard shortcut and the workbar's Undo and Redo share this step.
  const stepContentHistory = useCallback(
    (direction: "undo" | "redo") => {
      const next = contentHistoryRef.current.step(
        direction,
        latestContentRef.current,
      );
      publishContentHistory();
      if (next === null) return false;
      changeContentRef.current(next, false);
      return true;
    },
    [publishContentHistory],
  );
  const contentHistory = useMemo(
    () =>
      shellHistoryEnabled
        ? {
            ...contentHistoryState,
            step: (direction: "undo" | "redo") =>
              void stepContentHistory(direction),
          }
        : undefined,
    [contentHistoryState, shellHistoryEnabled, stepContentHistory],
  );
  useEffect(() => {
    contentHistoryRef.current.reset();
    publishContentHistory();
    if (!shellHistoryEnabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const direction = studioHistoryShortcut(event);
      if (!direction) return;
      const surface = studioSurfaceRef.current;
      const target = event.target;
      const inside = target instanceof Node && Boolean(surface?.contains(target));
      const unfocused =
        target === document.body || target === document.documentElement;
      if (!surface || !(inside || (unfocused && lastInteractedStudioSurface === surface)))
        return;
      if (surface.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (stepContentHistory(direction)) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [artifact._id, publishContentHistory, shellHistoryEnabled, stepContentHistory]);

  useEffect(() => {
    if (
      !dirty ||
      readOnly ||
      busy ||
      // Speculative AI previews must never freeze human region sync. Peers
      // render AI frames via awareness; durable Yjs writes remain region-
      // scoped and only claim the blocks the human actually changed.
      syncBusy ||
      ((artifact.blueprintKey === "document" ||
        artifact.blueprintKey === "code") &&
        !live.modelSnapshot.initialized)
    )
      return;
    const timer = window.setTimeout(
      () => void synchronizeDraft(currentSnapshotRef.current),
      liveConflict ? 420 : 140,
    );
    return () => window.clearTimeout(timer);
  }, [
    artifact.blueprintKey,
    busy,
    dirty,
    live.modelSnapshot.initialized,
    localDraftEpoch,
    liveConflict,
    readOnly,
    syncBusy,
    synchronizeDraft,
  ]);

  function changeBase(
    next: Partial<{ title: string; summary: string; tagDraft: string }>,
  ) {
    if (readOnly) return;
    userHasEditedRef.current = true;
    // Mark intent synchronously. Collaboration snapshots can arrive between
    // this handler and the effect that derives `dirty` from React state. If
    // `dirtyRef` is still false, that snapshot is treated as authoritative and
    // can erase the user's first edit (most visibly: adding the first slide or
    // object appears to do nothing).
    reconcilingRemoteRef.current = false;
    writeStudioDirty(dirtyRef, setDirty, true);
    bumpLocalDraft();
    if (next.title !== undefined) {
      setActivePresence("metadata:title");
      setTitle(next.title);
      if (artifact.blueprintKey === "planner_task") {
        setContent((current: unknown) => ({
          ...record(current),
          taskTitle: next.title,
        }));
      }
    }
    if (next.summary !== undefined) {
      setActivePresence("metadata:summary");
      setSummary(next.summary);
    }
    if (next.tagDraft !== undefined) {
      setActivePresence("metadata:tags");
      setTagDraft(next.tagDraft);
    }
  }

  function changeContent(next: unknown, recordHistory = true) {
    if (readOnly) return;
    if (recordHistory && SHELL_HISTORY_TYPES.has(artifact.blueprintKey)) {
      contentHistoryRef.current.record(latestContentRef.current, next);
      publishContentHistory();
    }
    latestContentRef.current = next;
    userHasEditedRef.current = true;
    reconcilingRemoteRef.current = false;
    writeStudioDirty(dirtyRef, setDirty, true);
    bumpLocalDraft();
    if (
      (artifact.blueprintKey === "document" ||
        artifact.blueprintKey === "code") &&
      !live.modelSnapshot.initialized
    )
      nativeFallbackEditedRef.current = true;
    if (isArtifactTypeKey(artifact.blueprintKey)) {
      try {
        const regions = changedArtifactRegionIds(
          artifact.blueprintKey,
          content,
          next,
        );
        setActivePresence(regions[0] ?? "artifact:structure", {
          mode: "typing",
        });
        // Editing an AI-touched region accepts that trace for the local view.
        if (
          !aiHighlightDismissed &&
          activeAiEffects.some((effect) =>
            effect.regionIds.some((regionId) => regions.includes(regionId)),
          )
        )
          setAiHighlightDismissed(true);
      } catch {
        setActivePresence("artifact:structure", { mode: "typing" });
      }
    }
    setContent(next);
  }

  async function save() {
    if (readOnly || syncBusy) return false;
    if (artifact.blueprintKey === "thread_reference") return false;
    const snapshot = {
      title: persistableTitle(title),
      summary: summary.trim(),
      tagDraft: tagsFromDraft(tagDraft).join(", "),
      content,
    };
    return synchronizeDraft(snapshot);
  }

  function requestStudioClose() {
    if (decideClose(dirty, live.unsynchronizedChanges) === "close") {
      onClose();
      return;
    }
    setUnsavedCloseOpen(true);
  }

  async function saveAndClose() {
    if (!claimCloseAction(closeActionRef)) return;
    setCloseActionBusy(true);
    try {
      const synchronized = await save();
      if (!synchronized) return;
      setUnsavedCloseOpen(false);
      onClose();
    } finally {
      closeActionRef.current = false;
      setCloseActionBusy(false);
    }
  }

  async function discardAndClose() {
    if (!claimCloseAction(closeActionRef)) return;
    setCloseActionBusy(true);
    try {
      if (!(await discardQueuedDraft())) return;
      setUnsavedCloseOpen(false);
      onClose();
    } finally {
      closeActionRef.current = false;
      setCloseActionBusy(false);
    }
  }

  async function discardQueuedDraft() {
    if (recoveryAdoptionRequest.current) return false;
    const branch = live.recovery.branches.find((candidate) => candidate.id === live.recovery.activeBranchId);
    if (!branch?.canReadCurrent || !branch.currentAnchor || recoveryNeedsReview.current === branch.id) {
      setUnsavedCloseOpen(false);
      setLocalDraftsArtifactId(artifact._id);
      return false;
    }
    const origin = recoveryViewRef.current;
    const request = new AbortController();
    recoveryAdoptionRequest.current = request;
    try {
      await live.archiveAndAdoptCurrent({
        branchId: branch.id,
        expectedGeneration: branch.generation,
        expectedCurrentAnchor: branch.currentAnchor,
        signal: request.signal,
      });
      if (origin !== recoveryViewRef.current || request.signal.aborted) return false;
      recoveryNeedsReview.current = null;
      return origin === recoveryViewRef.current && !request.signal.aborted;
    } catch (error) {
      if (origin === recoveryViewRef.current && !request.signal.aborted) {
        recoveryNeedsReview.current = branch.id;
        toast.error(describeLocalRecoveryFailure(error, "adopt"));
      }
      return false;
    } finally {
      if (recoveryAdoptionRequest.current === request) recoveryAdoptionRequest.current = null;
    }
  }

  async function restoreVersion(
    version: SpectraArtifactVersion,
    regionIds?: readonly string[],
  ) {
    if (readOnly || restoreInFlightRef.current || version.artifactId !== artifact._id || version._id !== previewVersion?._id) return;
    if (!version.after) {
      setLiveConflict({
        message:
          "This historical snapshot is unavailable and cannot be restored until it is repaired.",
      });
      return;
    }
    restoreInFlightRef.current = true;
    setHistoryBusy(version._id);
    try {
      // History actions commonly follow the last auto-save by only a few
      // milliseconds. Treat that save as part of the same ordered session
      // instead of silently dropping the restore while `syncingRef` is held.
      const syncDeadline = Date.now() + 12_000;
      while (
        syncingRef.current &&
        Date.now() < syncDeadline
      )
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      if (syncingRef.current)
        throw new Error(
          "Spectra is still saving your latest edit. The restore was not applied; try again in a moment.",
        );
      if (dirtyRef.current) {
        const synchronized = await synchronizeDraft(currentSnapshotRef.current);
        if (!synchronized)
          throw new Error(
            "Your latest edit could not be saved, so the restore was safely withheld.",
          );
      }
      if (!live.supported || !live.transport) throw new Error("ARTIFACT_LIVE_MODEL_UNAVAILABLE");
      await live.transport.flush();
      if (restoreSelectionRef.current.artifactId !== artifact._id || restoreSelectionRef.current.versionId !== version._id)
        throw new Error("The selected version changed before restoration. Review it and try again.");
      const key = JSON.stringify([artifact._id, version._id, [...(regionIds ?? [])].sort()]);
      if (pendingRestoreRequestRef.current?.key !== key)
        pendingRestoreRequestRef.current = { key, requestId: crypto.randomUUID() };
      // The server closes preceding history and admits this exact restore in
      // one transaction. No optimistic restore is authored in the local Y.Doc.
      const requestId = pendingRestoreRequestRef.current.requestId;
      const result = await postSpectra<{
        state: "committed" | "unchanged";
        receipt: { versionId?: string; roomId?: string; sequence?: number; updateDigest?: string };
        admitted?: AdmittedUpdateDescriptor;
      }>({
        action: "commitArtifactRestore",
        artifactId: artifact._id,
        sourceVersionId: version._id,
        requestId,
        clientId: live.transport.clientId,
        ...(regionIds?.length ? { regionIds: [...regionIds] } : {}),
      });
      if (!result.receipt || (result.state !== "unchanged" && (result.state !== "committed" || !result.receipt.versionId)))
        throw new Error("The restore was not confirmed. Try again to recover its result.");
      pendingRestoreRequestRef.current = null;
      if (restoreSelectionRef.current.artifactId === artifact._id) {
        setHistoryOpen(false);
        // Consume the exact admitted server delta through the provider path,
        // which does not create another authored restore or another append.
        try {
          const { roomId, sequence, updateDigest } = result.receipt;
          if (result.state === "committed" && result.admitted && roomId && sequence && updateDigest)
            await live.transport.consumeAdmittedUpdate?.(result.admitted, { roomId, sequence, updateDigest }, `restore:${requestId}`);
          await live.transport.retry();
        }
        catch { setLiveConflict({ message: "This version was restored. Reconnect to display the latest changes." }); }
      }
    } catch (error) {
      setLiveConflict({
        message:
          error instanceof Error
            ? error.message
            : "This restore could not be applied safely.",
      });
    } finally {
      restoreInFlightRef.current = false;
      setHistoryBusy(null);
    }
  }

  async function createNamedCheckpoint(name: string) {
    if (readOnly)
      throw new Error("Read-only access cannot create checkpoints.");
    if (dirty) {
      const synchronized = await save();
      if (!synchronized)
        throw new Error(
          "Synchronize the current live changes before creating a checkpoint.",
        );
    }
    await postSpectra({
      action: "createArtifactCheckpoint",
      artifactId: artifact._id,
      name,
    });
    await loadHistoryPage();
  }

  function keepLocalEdits() {
    if (remoteConflict) setDismissedRemoteKey(snapshotKey(remoteConflict));
    setRemoteConflict(null);
  }

  function reloadRemoteVersion() {
    if (!remoteConflict) return;
    setTitle(remoteConflict.title);
    setSummary(remoteConflict.summary);
    setTagDraft(remoteConflict.tagDraft);
    setContent(remoteConflict.content);
    setBaseline(remoteConflict);
    writeStudioDirty(dirtyRef, setDirty, false);
    userHasEditedRef.current = false;
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
  }

  // Plans provide their own List/Board/Timeline surface with a task detail
  // panel; nesting the generic details rail beside it creates an unusable
  // three-column editor.
  const showDetails =
    detailsOpen && !compact && artifact.blueprintKey !== "planner_task";
  const contentMode = compact ? ("split" as const) : mode;
  const editorLayoutClass = "block";
  // The scrollport's padding lives in CSS so one rule can reserve room for the
  // fixed composer for every type at once (`--spectra-composer-safe-area`).
  const mainClass = "min-h-0 flex-1";
  const currentAccountId = live.accountId;
  const commentRegions = useMemo<ArtifactCommentRegion[]>(() => {
    const semantic = live.modelSnapshot.regionIds.map((regionId) => {
      const descriptor = liveDescriptor(regionId);
      return {
        regionId,
        label: descriptor?.label || descriptor?.kind || regionId,
        kind: descriptor?.kind,
      };
    });
    return [
      { regionId: "work:root", label: "General comment", kind: "root" },
      { regionId: "metadata:title", label: "Work title", kind: "metadata" },
      {
        regionId: "metadata:summary",
        label: "Work summary",
        kind: "metadata",
      },
      ...semantic,
    ];
  }, [live.modelSnapshot.regionIds, liveDescriptor]);
  const wordComments = useMemo(() => {
    const binding =
      editorContent && typeof editorContent === "object" && !Array.isArray(editorContent)
        ? ((editorContent as Record<string, unknown>).nativeBinding as
            | Record<string, unknown>
            | undefined)
        : undefined;
    const raw = binding && Array.isArray(binding.wordComments) ? binding.wordComments : [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const comment = value as Record<string, unknown>;
      return typeof comment.id === "string" && typeof comment.text === "string"
        ? [
            {
              id: comment.id,
              author: typeof comment.author === "string" ? comment.author : undefined,
              date: typeof comment.date === "string" ? comment.date : undefined,
              text: comment.text,
            },
          ]
        : [];
    });
  }, [editorContent]);
  const handleActiveRegionChange = useCallback(
    (regionId: string) => {
      setActiveCommentRegionId((current) =>
        current === regionId ? current : regionId,
      );
      setActivePresence(regionId, { mode: "typing" });
    },
    [setActivePresence],
  );
  const presentation = useSyncPresentation(
    replicaTruth
      ? {
          replicas: replicaTruth.replicas.map((replica) => ({
            kind: replica.kind,
            state: replica.state,
            lastVerifiedAt: replica.lastVerifiedAt,
            retryAt: replica.retryAt,
            errorCode: replica.errorCode,
            unavailableReason: replica.unavailableReason,
          })),
          openConflictCount: replicaTruth.openConflictCount,
          pendingCount: replicaTruth.pendingCount,
        }
      : null,
    {
      queuedChangeCount: live.unsynchronizedChanges,
      transportState: live.state,
      dirty: dirty || syncBusy,
      nativeActivity: Boolean(nativeMaterialization),
      nativeBridgeAvailable:
        !replicaTruth?.replicas.some((replica) => replica.kind === "local") ||
        bridge.reachability === "connected",
      readOnly,
      protectedOriginal,
      collaborative: isCollaborativeArtifact,
      transportError: live.error,
    },
  );
  const statusNow = useNow(30_000);
  const [statusActionBusy, setStatusActionBusy] = useState(false);
  const [statusCompareOpen, setStatusCompareOpen] = useState(false);
  const statusLocalReplica = replicaTruth?.replicas.find(
    (replica) => replica.kind === "local",
  );
  const statusFolderLabel = statusLocalReplica?.mountId
    ? activeBridgeMounts?.find(
        (mount) => mount._id === statusLocalReplica.mountId,
      )?.rootLabel
    : undefined;
  // The work's file on this computer: a local copy in a folder selected here.
  const statusLocalFile = useMemo(() => {
    for (const replica of replicaTruth?.replicas ?? []) {
      if (replica.kind !== "local" || replica.state === "unavailable" || !replica.relativePath) continue;
      const mount = currentDeviceMounts.find((candidate) => candidate._id === replica.mountId);
      if (mount) return { grantId: mount.grantId, relativePath: replica.relativePath };
    }
    return null;
  }, [currentDeviceMounts, replicaTruth?.replicas]);
  const artifactStatus = useMemo(
    () =>
      artifactStatusOf({
        presentation,
        replicas:
          replicaTruth?.replicas.map((replica) => ({
            kind: replica.kind,
            state: replica.state,
            lastVerifiedAt: replica.lastVerifiedAt,
            retryAt: replica.retryAt,
            errorCode: replica.errorCode,
            relativePath: replica.relativePath,
          })) ?? [],
        folderLabel: statusFolderLabel,
        officeApplication: nativeOfficeDocument
          ? nativeOfficeApplication
          : undefined,
        nativeActivity: Boolean(nativeMaterialization),
        nativeConflict: Boolean(nativeConflict),
        savedAt: dirty ? undefined : artifact.updatedAt,
        now: statusNow || Date.now(),
        can: {
          retry: !readOnly,
          "sign-in": true,
          reconnect: true,
          "keep-spectra": Boolean(nativeConflict) && !readOnly,
          "keep-office": Boolean(nativeConflict) && !readOnly,
          compare: true,
          history: true,
          "open-in-office": Boolean(statusLocalFile) && nativeOfficeDocument,
          "show-in-folder": Boolean(statusLocalFile),
        },
      }),
    [
      artifact.updatedAt,
      dirty,
      nativeConflict,
      nativeMaterialization,
      nativeOfficeApplication,
      nativeOfficeDocument,
      presentation,
      readOnly,
      replicaTruth?.replicas,
      statusFolderLabel,
      statusLocalFile,
      statusNow,
    ],
  );
  const handleStatusAction = (kind: ArtifactStatusActionKind) => {
    if (kind === "retry") {
      void save();
      return;
    }
    if (kind === "sign-in") {
      router.push("/sign-in");
      return;
    }
    if (kind === "reconnect") {
      router.push(DEVICES_HREF);
      return;
    }
    if (kind === "history") {
      setHistoryOpen(true);
      return;
    }
    if (kind === "open-in-office" || kind === "show-in-folder") {
      if (!statusLocalFile) return;
      void (kind === "open-in-office" ? openBridgeFile : revealBridgeFile)(statusLocalFile).catch(
        (error: unknown) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "Spectra Bridge could not reach this file.",
          ),
      );
      return;
    }
    if (kind === "compare") {
      if (nativeConflict?.previews?.length) {
        setStatusCompareOpen((open) => !open);
      } else {
        setHistoryOpen(true);
      }
      return;
    }
    if (kind === "keep-spectra" || kind === "keep-office") {
      setStatusActionBusy(true);
      void reconcileNativeRevision(kind === "keep-spectra" ? "spectra" : "word")
        .catch((error: unknown) =>
          setNativeWriteError(
            error instanceof Error
              ? error.message
              : "The conflict could not be resolved safely.",
          ),
        )
        .finally(() => setStatusActionBusy(false));
    }
  };
  const statusDetails =
    statusCompareOpen && nativeConflict?.previews?.length ? (
      <div className="grid gap-1 text-micro leading-4 text-[var(--text-tertiary)]">
        {nativeConflict.previews.slice(0, 3).map((preview) => (
          <div
            key={preview.regionId}
            className="grid gap-0.5 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium text-[var(--text-secondary)]">
                Spectra:
              </span>{" "}
              {preview.spectra}
            </span>
            <span className="min-w-0 truncate">
              <span className="font-medium text-[var(--text-secondary)]">
                {nativeOfficeApplication}:
              </span>{" "}
              {preview.external}
            </span>
          </div>
        ))}
      </div>
    ) : null;
  const headerCommands: HeaderCommand[] = [
    {
      id: "comments",
      label: "Comments",
      icon: MessageSquare,
      onSelect: () => setCommentsOpen(true),
    },
    ...(onOpenChats
      ? [
          {
            id: "chats",
            label: "Browse chats about this work",
            icon: MessagesSquare,
            onSelect: onOpenChats,
          },
        ]
      : []),
    ...(mode === "split" && !compact
      ? [{ id: "open-full", label: "Open full", icon: Maximize2, onSelect: onExpand }]
      : []),
  ];
  const syncTruth = useMemo(
    () => ({ state: presentation.state, label: presentation.label }),
    [presentation.label, presentation.state],
  );

  /* ---- the studio contract ------------------------------------------
     One shell answer for permissions, modes, density and inspectors,
     handed to whichever studio renders. A studio that derives its own
     answers is the failure this replaces. */
  // thread_reference is not a registered work type and does not consume the
  // contract; the fallback only keeps the hooks below unconditional.
  const contractType: WorkType = workType ?? "document";
  const responsiveContract = useMemo(
    () => getWorkDefinition(contractType).responsive,
    [contractType],
  );
  const studioDensity = useStudioDensity(studioSurfaceRef, responsiveContract);
  const loadVersionHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);
  const showInspector = useCallback(
    (panel: StudioInspectorPanel) => {
      if (panel === "history") {
        loadVersionHistory();
        return;
      }
      if (panel === "comments") {
        setCommentsOpen(true);
        return;
      }
      if (panel === "references") {
        setEmbedsOpen(true);
        return;
      }
      detailsPinnedRef.current = true;
      setDetailsOpen(true);
    },
    [loadVersionHistory],
  );
  const hideInspector = useCallback(() => {
    setHistoryOpen(false);
    setCommentsOpen(false);
    setEmbedsOpen(false);
    setDetailsOpen(false);
  }, []);
  const openInspector: StudioInspectorPanel | null = historyOpen
    ? "history"
    : commentsOpen
      ? "comments"
      : embedsOpen
        ? "references"
        : showDetails
          ? "details"
          : null;
  const inspector = useMemo(
    () => ({ open: openInspector, show: showInspector, hide: hideInspector }),
    [hideInspector, openInspector, showInspector],
  );

  const markLocalCollaborativeDocumentChange = useCallback(
    (userInitiated = false) => {
      if (readOnly || artifact.blueprintKey !== "document") return;
      // A native save and incoming Yjs hydration are not typing. Clearing the
      // reconciling guard here re-dirtied the studio and nested React updates.
      if (!userInitiated && reconcilingRemoteRef.current) return;
      userHasEditedRef.current = true;
      writeStudioDirty(dirtyRef, setDirty, true);
      bumpLocalDraft();
      setActivePresence("artifact:structure", { mode: "typing" });
    },
    [artifact.blueprintKey, bumpLocalDraft, readOnly, setActivePresence],
  );

  /**
   * The live fidelity map every command in the bar is gated by.
   *
   * The lens reports a native package in the package's own terms; a command
   * declares what it writes in the shared region vocabulary. `fidelityRegionMap`
   * is the one translation between them, and it only accepts region-level facts
   * — a single preserved paragraph must not refuse typing across the whole body.
   */
  const nativeFidelity = useMemo(() => {
    const entries =
      replicaTruth?.replicas.flatMap((replica) => {
        const map = record(replica.fidelityMap);
        return Array.isArray(map.entries) ? map.entries.map(record) : [];
      }) ?? [];
    return fidelityRegionMap(entries);
  }, [replicaTruth?.replicas]);
  const nativeReadOnlyRegionIds = useMemo(
    () =>
      replicaTruth?.replicas.flatMap((replica) => {
        const map = record(replica.fidelityMap);
        return Array.isArray(map.entries)
          ? map.entries.flatMap((value) => {
              const entry = record(value);
              return entry.readOnly === true &&
                typeof entry.regionId === "string" &&
                entry.regionId.startsWith("docx:paragraph:")
                ? [entry.regionId]
                : [];
            })
          : [];
      }) ?? [],
    [replicaTruth?.replicas],
  );
  const studioContract = useStudioContractValue({
    artifactId: artifact._id,
    type: contractType,
    role: sharingRole,
    surface: mode === "tab" ? "full" : "panel",
    sync: syncTruth,
    density: studioDensity,
    inspector,
    compatibilityProfile: artifact.compatibilityProfile ?? "spectra-native",
    fidelity: nativeFidelity,
    executeApplicationCommand,
    history: contentHistory,
  });
  const identityBlock = (
    <div className="spectra-artifact-identity flex min-w-0 flex-1 items-start">
      <div className="min-w-0 flex-1">
        <div className="rounded-control">
          <textarea
            value={presencePreview?.title ?? title}
            readOnly={readOnly}
            onChange={(event) => changeBase({ title: event.target.value })}
            rows={1}
            onFocus={() => {
              setActiveCommentRegionId("metadata:title");
              setActivePresence("metadata:title", { mode: "typing" });
            }}
            data-ai-region={aiRegionAttr(
              !aiHighlightDismissed &&
                ((presencePreview?.paths.includes("/title") ?? false) ||
                  (aiPreviewActive &&
                    artifact.aiPreview?.title !== undefined) ||
                  activeAiEffects.some((effect) =>
                    effect.regionIds.includes("metadata:title"),
                  )),
            )}
            className="spectra-artifact-title min-h-6 w-full resize-none overflow-hidden bg-transparent font-display font-semibold leading-tight text-[var(--text-primary)] outline-none [field-sizing:content]"
            placeholder="Untitled work"
          />
        </div>
        <div className="mt-0.5 rounded-control">
          <div className="relative">
            <textarea
              ref={summaryRef}
              value={presencePreview?.summary ?? summary}
              readOnly={readOnly}
              rows={summaryExpanded ? 4 : 1}
              onFocus={() => {
                setSummaryExpanded(true);
                setActiveCommentRegionId("metadata:summary");
                setActivePresence("metadata:summary", { mode: "typing" });
              }}
              onBlur={() => {
                if (!readOnly) setSummaryExpanded(false);
              }}
              onChange={(event) => changeBase({ summary: event.target.value })}
              data-ai-region={aiRegionAttr(
                !aiHighlightDismissed &&
                  ((presencePreview?.paths.includes("/summary") ?? false) ||
                    (aiPreviewActive &&
                      artifact.aiPreview?.summary !== undefined) ||
                    activeAiEffects.some((effect) =>
                      effect.regionIds.includes("metadata:summary"),
                    )),
              )}
              className={`spectra-artifact-summary w-full resize-none overflow-hidden bg-transparent text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-tertiary)] [field-sizing:content]${summaryExpanded ? " is-expanded" : ""}`}
              placeholder="Short useful summary"
            />
            {!summaryExpanded && summaryClipped ? (
              <button
                type="button"
                className="absolute bottom-0 right-0 bg-[var(--bg-primary)] pl-2 text-micro font-semibold tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setSummaryExpanded(true);
                }}
                aria-label="Read the full summary"
              >
                …
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={studioSurfaceRef}
      className="spectra-artifact-studio relative flex h-full min-h-0 flex-col"
      onPointerMove={handlePresencePointerMove}
      onPointerLeave={clearPresenceCursor}
      onPointerDownCapture={noteStudioInteraction}
      onKeyDownCapture={noteStudioInteraction}
      onWheelCapture={noteStudioInteraction}
      onTouchStartCapture={noteStudioInteraction}
      data-studio-mode={mode}
      data-studio-density={studioDensity}
      data-ai-state={
        artifact.aiState === "creating" && visibleAiWorking
          ? "creating"
          : (artifact.aiState === "edited" || catchUpActive) &&
              (visibleAiWorking || activeAiEffects.length > 0)
            ? "edited"
            : visibleAiWorking
              ? "updating"
              : undefined
      }
      data-ai-catchup={
        catchUpActive && highlightPaths.length > 0 ? "true" : undefined
      }
      data-blueprint={artifact.blueprintKey}
      data-canvas-extent={
        isArtifactTypeKey(artifact.blueprintKey)
          ? getWorkDefinition(artifact.blueprintKey).responsive.canvasExtent
          : "infinite"
      }
      data-native-office={nativeOfficeDocument ? "true" : "false"}
      data-native-format={inferredNativeFormat}
      data-draft-pending={dirty ? "true" : "false"}
      data-ai-highlight-paths={highlightPaths.join("|") || undefined}
      data-ai-protocol={
        activeAiCollaborator?.interactionState
          ? "v2"
          : activeAiCollaborator
            ? "legacy"
            : undefined
      }
      data-ai-lifecycle={activeAiCollaborator?.interactionState?.lifecycle}
      data-ai-act={activeAiCollaborator?.interactionState?.act.kind}
      data-ai-target={activeAiCollaborator?.interactionState?.target?.path}
      data-ai-speculation-count={
        activeAiCollaborator?.interactionState?.speculation?.patches.length
      }
      data-ai-speculation-shape={
        activeAiCollaborator?.interactionState?.speculation?.patches
          .slice(0, 3)
          .map(
            (patch) =>
              `${patch.path}:${typeof patch.value === "string" ? patch.value.length : typeof patch.value}`,
          )
          .join("|") || undefined
      }
      data-ai-gesture={
        activeAiCollaborator?.previewGesture ??
        (activeAiCollaborator?.previewPhase === "streaming"
          ? "typing"
          : undefined)
      }
      style={{ "--studio-accent": meta.color } as CSSProperties}
    >
      {/* Legacy coarse cursors are only for peers on the pre-v2 protocol.
          Anyone publishing a semantic frame is rendered by InteractionLayer,
          which is what keeps a peer from appearing twice. */}
      <StudioLegacyCursorLayer
        transport={live.transport}
        currentAccountId={live.accountId}
        currentDisplayName={live.displayName}
      />
      {aiEffectTitles.length ? (
        <div className="sr-only" role="status" aria-live="polite">
          {aiEffectTitles.map((title) => (
            <span key={title}>{title}. </span>
          ))}
        </div>
      ) : null}
      <header className="spectra-artifact-header relative z-chrome flex shrink-0 flex-col bg-transparent">
        <div className="spectra-artifact-header-topline flex min-w-0 items-start justify-between gap-3">
          <div className="spectra-artifact-identity-cluster flex min-w-0 flex-1 items-start gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]"
              style={{ color: meta.color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="spectra-artifact-kind block truncate text-micro font-semibold uppercase tracking-[.12em] text-[var(--text-tertiary)]">
                {meta.label}
              </span>
              {identityBlock}
            </div>
          </div>
          <ArtifactHeaderActions
            presence={
              <StudioPresenceIndicator
                transport={live.transport}
                currentAccountId={live.accountId}
                currentDisplayName={live.displayName}
                regions={commentRegions}
                onFocusPresence={(person) => {
                  const studio = studioSurfaceRef.current;
                  if (!studio) return;
                  const blockId =
                    person.cursor?.anchor?.kind === "block"
                      ? person.cursor.anchor.id
                      : person.selection?.ranges[0]?.blockId;
                  const lineIndex =
                    person.cursor?.anchor?.lineIndex ??
                    person.selection?.ranges[0]?.lineIndex;
                  const regionId = person.activeRegionId;
                  const target =
                    (blockId
                      ? studio.querySelector<HTMLElement>(
                          `[data-block-id="${
                            typeof CSS !== "undefined" && CSS.escape
                              ? CSS.escape(blockId)
                              : blockId.replace(/["\\]/g, "\\$&")
                          }"]`,
                        )
                      : null) ??
                    (regionId
                      ? studio.querySelector<HTMLElement>(
                          `[data-region-id="${
                            typeof CSS !== "undefined" && CSS.escape
                              ? CSS.escape(regionId)
                              : regionId.replace(/["\\]/g, "\\$&")
                          }"], [data-ai-path="${
                            typeof CSS !== "undefined" && CSS.escape
                              ? CSS.escape(regionId)
                              : regionId.replace(/["\\]/g, "\\$&")
                          }"]`,
                        )
                      : null) ??
                    studio.querySelector<HTMLElement>('[data-ai-region="true"]');
                  if (!target) return;
                  let focus: HTMLElement = target;
                  if (
                    typeof lineIndex === "number" &&
                    lineIndex >= 0 &&
                    (target.matches("ul,ol") ||
                      target.querySelector(":scope > li"))
                  ) {
                    const items =
                      target.querySelectorAll<HTMLElement>(":scope > li");
                    focus =
                      items[Math.min(lineIndex, Math.max(0, items.length - 1))] ??
                      target;
                  }
                  focus.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                    behavior: "smooth",
                  });
                }}
              />
            }
            status={
              <ArtifactStatusControl
                status={artifactStatus}
                onAction={handleStatusAction}
                busy={syncBusy || statusActionBusy}
                details={statusDetails}
              />
            }
            commands={headerCommands}
            moreLabel="More work actions"
            more={
              <>
                {nativePortableArtifact ? (
                  <>
                    <WorkbarMenuAction
                      disabled={nativeRecoveryBusy !== null}
                      onSelect={() => void downloadNativeCopy()}
                    >
                      <FileDown className="h-4 w-4" />{" "}
                      {nativeRecoveryBusy === "download"
                        ? "Preparing copy…"
                        : "Download native copy"}
                    </WorkbarMenuAction>
                    <WorkbarMenuAction
                      disabled={nativeRecoveryBusy !== null}
                      onSelect={requestNativeCopy}
                    >
                      <Download className="h-4 w-4" />{" "}
                      {nativeRecoveryBusy === "materialize"
                        ? "Queueing local copy…"
                        : "Keep a copy on this computer"}
                    </WorkbarMenuAction>
                  </>
                ) : null}
                {onShare ? (
                  <WorkbarMenuAction
                    onSelect={() => {
                      onShare();
                    }}
                  >
                    <Share2 className="h-4 w-4" /> Share work
                  </WorkbarMenuAction>
                ) : null}
                <WorkbarMenuAction
                  onSelect={() => {
                    setEmbedsOpen(true);
                  }}
                >
                  <Link2 className="h-4 w-4" /> References
                </WorkbarMenuAction>
                {artifact.blueprintKey !== "planner_task" ? (
                  <WorkbarMenuAction
                    onSelect={() => {
                      detailsPinnedRef.current = true;
                      setDetailsOpen((open) => !open);
                    }}
                  >
                    <PanelRight className="h-4 w-4" />
                    {detailsOpen ? "Close details" : "Open details"}
                  </WorkbarMenuAction>
                ) : null}
                <WorkbarMenuAction
                  onSelect={() => {
                    loadVersionHistory();
                  }}
                >
                  <History className="h-4 w-4" /> Version history
                </WorkbarMenuAction>
                <WorkbarMenuAction onSelect={() => setLocalDraftsArtifactId(artifact._id)}>
                  <RotateCcw className="h-4 w-4" /> Local drafts
                </WorkbarMenuAction>
              </>
            }
            close={
              <IconButton
                label={
                  decideClose(dirty, live.unsynchronizedChanges) === "confirm"
                    ? "Save or discard before closing"
                    : "Close"
                }
                onClick={requestStudioClose}
                icon={X}
              />
            }
          />
        </div>
      </header>
      <ArtifactDraftRecovery
        artifactId={artifact._id}
        controller={live}
        open={localDraftsArtifactId === artifact._id}
        onOpenChange={(open) => setLocalDraftsArtifactId(open ? artifact._id : null)}
      />
      {accessBanner && !livePermissionLost ? (
        <div className="shrink-0 border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-2 text-micro text-[var(--text-secondary)]">
          {accessBanner.text}
        </div>
      ) : null}
      {livePermissionLost ? (
        <div
          role="status"
          className="shrink-0 border-y border-[color-mix(in_oklab,var(--accent-gold)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-gold)_6%,var(--bg-primary))] px-5 py-2 text-micro text-[var(--text-secondary)]"
        >
          Spectra is refreshing this work’s access. You can keep editing your
          local draft; it will synchronize after edit access is confirmed.
        </div>
      ) : null}
      {presentation.action?.kind === "sign-in" ? (
        <div
          role="status"
          className="shrink-0 border-y border-[color-mix(in_oklab,var(--accent-gold)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-gold)_6%,var(--bg-primary))] px-5 py-2 text-micro text-[var(--text-secondary)]"
        >
          Your session ended. This draft stays on this device until you{" "}
          <NextLink
            href="/sign-in"
            className="font-semibold text-[var(--text-primary)]"
          >
            sign in
          </NextLink>{" "}
          again.
        </div>
      ) : null}
      {!permissionReadOnly &&
      isCollaborativeArtifact &&
      dirty &&
      (live.state === "reconnecting" || live.state === "unsynchronized") ? (
        <div className="relative z-dropdown h-0 shrink-0">
          <DismissibleArtifactNotice
            artifactId={artifact._id}
            identity="reconnecting"
            className="spectra-collaboration-notice absolute right-3 top-2"
          >
            Connection interrupted. Reconnecting while keeping your draft.
          </DismissibleArtifactNotice>
        </div>
      ) : null}
      {isCollaborativeArtifact && liveConflict && dirty && live.recovery.state !== "review_required" ? (
        <div className="relative z-dropdown h-0 shrink-0">
          <DismissibleArtifactNotice
            artifactId={artifact._id}
            identity={liveConflict.message}
            role="alert"
            className="spectra-collaboration-notice absolute right-3 top-2 flex items-center gap-2"
          >
            <span className="min-w-0 flex-1">
              {liveConflict.message}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-chip border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-micro font-medium"
              onClick={() => void synchronizeDraft(currentSnapshotRef.current)}
            >
              Retry
            </button>
            <button
              type="button"
              className="shrink-0 rounded-chip px-2 py-1 text-micro font-medium text-[var(--text-tertiary)]"
              onClick={() => setLocalDraftsArtifactId(artifact._id)}
            >
              Review draft
            </button>
          </DismissibleArtifactNotice>
        </div>
      ) : null}
      {nativeConflict ? (
        <DismissibleArtifactNotice
          artifactId={artifact._id}
          identity={JSON.stringify(nativeConflict)}
          role="alert"
          className="shrink-0 border-y border-[color-mix(in_oklab,var(--warning)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_7%,var(--bg-primary))] px-5 py-2.5"
        >
          <div className="flex flex-wrap items-start gap-2 text-caption text-[var(--text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--warning)]" />
            <div className="min-w-0 flex-1 basis-60">
              <p>{nativeConflict.message}</p>
              {nativeConflict.previews?.length ? (
                <div className="mt-1.5 grid gap-1 text-micro leading-4 text-[var(--text-tertiary)]">
                  {nativeConflict.previews.slice(0, 3).map((preview) => (
                    <div
                      key={preview.regionId}
                      className="grid gap-x-3 rounded-control border border-[color-mix(in_oklab,var(--warning)_18%,var(--border-default))] bg-[var(--bg-primary)] px-2 py-1 sm:grid-cols-2"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-[var(--text-secondary)]">
                          Spectra:
                        </span>{" "}
                        {preview.spectra}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-[var(--text-secondary)]">
                          {nativeOfficeApplication}:
                        </span>{" "}
                        {preview.external}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-control px-2.5 py-1 text-micro font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              onClick={() =>
                void reconcileNativeRevision("spectra").catch(
                  (error: unknown) =>
                    setNativeWriteError(
                      error instanceof Error
                        ? error.message
                        : "The conflict could not be resolved safely.",
                    ),
                )
              }
            >
              Keep Spectra version
            </button>
            <button
              type="button"
              className="rounded-control bg-[var(--text-primary)] px-2.5 py-1 text-micro font-medium text-[var(--bg-primary)]"
              onClick={() =>
                void reconcileNativeRevision("word").catch((error: unknown) =>
                  setNativeWriteError(
                    error instanceof Error
                      ? error.message
                      : "The conflict could not be resolved safely.",
                  ),
                )
              }
            >
              Keep {nativeOfficeApplication} version
            </button>
          </div>
        </DismissibleArtifactNotice>
      ) : nativeWriteError ? (
        <DismissibleArtifactNotice
          artifactId={artifact._id}
          identity={`native-write:${nativeWriteError}`}
          role="alert"
          className="flex shrink-0 items-center gap-2 border-y border-[color-mix(in_oklab,var(--danger)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] px-5 py-2 text-micro text-[var(--text-secondary)]"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
          <span className="min-w-0 flex-1">
            {humanizeNativeError(nativeWriteError, nativeOfficeApplication)}
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold text-[var(--text-primary)]"
            disabled={syncBusy || readOnly}
            onClick={() => void save()}
          >
            Try again
          </button>
        </DismissibleArtifactNotice>
      ) : nativeRecoveryError ? (
        <DismissibleArtifactNotice
          artifactId={artifact._id}
          identity={`native-recovery:${nativeRecoveryError}`}
          role="alert"
          className="flex shrink-0 items-center gap-2 border-y border-[color-mix(in_oklab,var(--danger)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] px-5 py-2 text-micro text-[var(--text-secondary)]"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
          <span>
            {humanizeNativeError(nativeRecoveryError, nativeOfficeApplication)}
          </span>
          {currentDeviceMounts.length === 0 ? (
            <NextLink
              href={DEVICES_HREF}
              className="shrink-0 font-semibold text-[var(--text-primary)] underline underline-offset-2"
            >
              Open Spectra Settings
            </NextLink>
          ) : null}
        </DismissibleArtifactNotice>
      ) : null}
      {isCollaborativeArtifact &&
      (live.initializationError ||
        live.modelSnapshot.validity === "invalid") ? (
        // The raw reason used to be printed here, which put Zod's own words on
        // screen ("Invalid input: expected number, received undefined"). A
        // person cannot act on that. They get the sentence and a reference they
        // can quote; the raw text stays in the console outside production.
        <DismissibleArtifactNotice
          artifactId={artifact._id}
          identity={`live-recovery:${liveRecovery.reference}:${liveRecovery.message}`}
          className="flex shrink-0 items-center gap-2 border-y border-[color-mix(in_oklab,var(--accent-gold)_20%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--accent-gold)_5%,var(--bg-primary))] px-5 py-2 text-micro text-[var(--text-secondary)]"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--accent-gold)]" />
          <span className="min-w-0 flex-1">{liveRecovery.message}</span>
          <span className="shrink-0 font-mono text-micro text-[var(--text-tertiary)]">
            {liveRecovery.reference}
          </span>
        </DismissibleArtifactNotice>
      ) : null}
      {remoteConflict ? (
        <DismissibleArtifactNotice
          artifactId={artifact._id}
          identity={remoteConflict}
          className="shrink-0 border-b border-[color-mix(in_oklab,var(--accent-gold)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-gold)_7%,var(--bg-primary))] px-5 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--accent-gold)]" />
            <span className="min-w-0 flex-1">
              A newer saved version arrived while you were editing. Your local
              changes are still untouched.
            </span>
            <button
              type="button"
              onClick={keepLocalEdits}
              className="rounded-control px-2.5 py-1 text-micro font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Keep local edits
            </button>
            <button
              type="button"
              onClick={reloadRemoteVersion}
              className="rounded-control bg-[var(--text-primary)] px-2.5 py-1 text-micro font-medium text-[var(--bg-primary)]"
            >
              Reload latest
            </button>
          </div>
        </DismissibleArtifactNotice>
      ) : null}
      <section
        aria-label="Work surface"
        ref={presenceSurfaceRef}
        className={`spectra-artifact-main ${mainClass}`}
        data-spectra-studio={artifact._id}
        data-spectra-editor-ready={editorReady ? "true" : "false"}
        data-spectra-type={artifact.blueprintKey}
        data-spectra-surface="artifact"
        data-ai-preview={visibleAiWorking || undefined}
        data-ai-effect-count={activeAiEffects.length || undefined}
        data-ai-activity={
          activeAiEffects.at(-1)?.activity ??
          (aiPreviewActive ? artifact.aiPreview?.effectActivity : undefined)
        }
        aria-busy={
          visibleAiWorking &&
          (artifact.aiState === "creating" || artifact.aiState === "updating")
        }
      >
        {/* The presence layer is a sticky zero-height node, so it pins to the
            scroll viewport instead of scrolling away with the content. It must
            stay the first child of the scroll container. */}
        <StudioInteractionLayer transport={live.transport} />
        <div className={`spectra-editor-layout ${editorLayoutClass}`}>
          <section className="min-w-0">
            <StudioViewportContext.Provider value={viewportContext}>
            <StudioContractProvider value={studioContract}>
              {artifact.blueprintKey === "document" ? (
                <DocumentStudio
                  key={`${artifact._id}:document`}
                  artifactId={artifact._id}
                  title={title}
                  content={editorContent}
                  contentIsProvisional={streamingSource !== "local" || remoteSpeculation.size > 0}
                  onChange={editorChange}
                  onBeforeNativeExport={async () => !dirty || save()}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  nativeReadOnlyRegionIds={nativeReadOnlyRegionIds}
                  collaborationDocument={
                    live.modelSnapshot.initialized
                      ? live.transport?.document
                      : undefined
                  }
                  onLocalCollaborativeChange={
                    markLocalCollaborativeDocumentChange
                  }
                  header={null}
                  mode={contentMode}
                />
              ) : null}
              {artifact.blueprintKey === "flashcard_deck" ? (
                <FlashcardStudio
                  key={`${artifact._id}:deck`}
                  artifactId={artifact._id}
                  mode={contentMode}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "quiz" ? (
                <QuizStudio
                  key={`${artifact._id}:quiz`}
                  artifactId={artifact._id}
                  mode={contentMode}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  synchronizationReady={presentation.ready}
                />
              ) : null}
              {artifact.blueprintKey === "planner_task" && isSingleTask(editorContent) ? (
                <TaskStudio
                  key={`${artifact._id}:task`}
                  mode={contentMode}
                  title={title}
                  content={editorContent}
                  onChange={editorChange}
                  readOnly={readOnly}
                />
              ) : null}
              {artifact.blueprintKey === "planner_task" && !isSingleTask(editorContent) ? (
                <PlanStudio
                  key={`${artifact._id}:plan`}
                  mode={contentMode}
                  title={title}
                  content={editorContent}
                  onChange={editorChange}
                  readOnly={readOnly}
                  onOpenArtifact={onOpenArtifact}
                />
              ) : null}
              {artifact.blueprintKey === "sheets" ? (
                <SheetsStudio
                  key={`${artifact._id}:sheets`}
                  artifactId={artifact._id}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  mode={contentMode}
                  synchronizationReady={presentation.ready}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "code" ? (
                <CodeStudio
                  key={`${artifact._id}:code`}
                  artifactId={artifact._id}
                  artifacts={artifacts}
                  title={title}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  collaborationDocument={
                    live.modelSnapshot.initialized
                      ? live.transport?.document
                      : undefined
                  }
                  synchronizationReady={presentation.ready}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "presentation" ? (
                <PresentationStudio
                  key={`${artifact._id}:presentation`}
                  artifactId={artifact._id}
                  artifacts={artifacts}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  synchronizationReady={presentation.ready}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "whiteboard" ? (
                <WhiteboardStudio
                  key={`${artifact._id}:whiteboard`}
                  artifactId={artifact._id}
                  artifacts={artifacts}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  synchronizationReady={presentation.ready}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "timetable" ? (
                <TimetableStudio
                  key={`${artifact._id}:timetable`}
                  artifactId={artifact._id}
                  artifacts={artifacts}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  synchronizationReady={presentation.ready}
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "agent" ? (
                <AgentFoundry
                  key={`${artifact._id}:agent`}
                  artifactId={artifact._id}
                  artifactTitle={title || artifact.title}
                  mode={mode}
                  artifacts={artifacts}
                  content={editorContent}
                  onChange={editorChange}
                  aiChangedPaths={highlightPaths}
                  readOnly={readOnly}
                  canPublish={
                    canPublishAgentArtifact(artifact)
                  }
                  onActiveRegionChange={handleActiveRegionChange}
                />
              ) : null}
              {artifact.blueprintKey === "thread_reference" ? (
                <ThreadReferenceStudio content={content} />
              ) : null}
            </StudioContractProvider>
            </StudioViewportContext.Provider>
          </section>
          {showDetails ? (
            <div className="spectra-studio-inspector-overlay">
              <StudioDetails
                artifact={artifact}
                artifacts={artifacts}
                tagDraft={tagDraft}
                onTagDraftChange={(value) => changeBase({ tagDraft: value })}
                onArchive={onArchive}
                onOpenArtifact={onOpenArtifact}
              />
            </div>
          ) : null}
        </div>
      </section>
      {/* Pinned to the pane, not to the scrolling content: the reason an edit
          was declined must not scroll away from the user who triggered it. */}
      {heldNotice ? (
        <div className="spectra-held-notice" role="status">
          <span className="spectra-held-notice-dot" aria-hidden="true" />
          <span>{heldNotice.message}</span>
        </div>
      ) : null}
      <UnsavedCloseDialog
        open={unsavedCloseOpen}
        title={title}
        busy={syncBusy || closeActionBusy}
        onSave={() => void saveAndClose()}
        onDiscard={() => void discardAndClose()}
        onKeepEditing={() => setUnsavedCloseOpen(false)}
      />
      <ArtifactCommentsPanel
        open={commentsOpen}
        artifactId={artifact._id}
        artifactTitle={title || artifact.title}
        regions={commentRegions}
        preferredRegionId={activeCommentRegionId}
        currentAccountId={currentAccountId}
        relativePosition={commentRelativePosition}
        wordComments={wordComments}
        requestedComment={requestedComment}
        onRequestedCommentResult={(error) => {
          const pending = requestedComment;
          setRequestedComment(null);
          if (error) pending?.reject?.(error);
          else
            pending?.resolve?.({
              status: "completed",
              message: "Comment added.",
              data: { artifactId: artifact._id },
            });
        }}
        onClose={() => {
          setCommentsOpen(false);
          setRequestedComment(null);
        }}
      />
      <ArtifactEmbedsPanel
        open={embedsOpen}
        containerId={artifact._id}
        containerTitle={title || artifact.title}
        containerWorkType={
          isArtifactTypeKey(artifact.blueprintKey)
            ? artifact.blueprintKey
            : undefined
        }
        compatibilityProfile={studioContract.compatibilityProfile}
        artifacts={artifacts}
        regions={commentRegions}
        onOpenSource={onOpenArtifact}
        onClose={() => setEmbedsOpen(false)}
      />
      <Dialog
        open={nativeFolderDialogOpen}
        onOpenChange={setNativeFolderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a save folder</DialogTitle>
            <DialogDescription>
              Spectra will save this copy to a folder selected for the connected
              Bridge on this computer.
            </DialogDescription>
          </DialogHeader>
          <SelectField
            label="Folder on this computer"
            value={nativeFolderSelection}
            onChange={setNativeFolderSelection}
            options={currentDeviceMounts.map((mount) => ({
              value: mount._id,
              label: mount.rootLabel,
            }))}
            placeholder="Choose a folder"
            layer="modal"
          />
          <div className="space-y-1.5">
            <label
              htmlFor="native-copy-name"
              className="text-micro font-semibold text-[var(--text-secondary)]"
            >
              File name
            </label>
            <input
              id="native-copy-name"
              type="text"
              value={nativeCopyName}
              onChange={(event) => setNativeCopyName(event.target.value)}
              className="h-10 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-caption text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-micro text-[var(--text-secondary)]">
              Spectra will save it as {inferredNativeFormat ?? "a Spectra file"}.
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              className="rounded-control px-3 py-2 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              onClick={() => setNativeFolderDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-control bg-[var(--text-primary)] px-3 py-2 text-caption font-medium text-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !currentDeviceMounts.some(
                  (mount) => mount._id === nativeFolderSelection,
                ) ||
                !nativeCopyName.trim() ||
                nativeRecoveryBusy !== null
              }
              onClick={() => {
                setNativeFolderDialogOpen(false);
                void materializeNativeCopy(
                  bridge.status?.deviceId ?? "",
                  nativeFolderSelection,
                  nativeCopyName.trim(),
                );
              }}
            >
              Keep a copy
            </button>
          </DialogFooter>
          {currentDeviceMounts.length === 0 ? (
            <div role="status" className="space-y-2 text-micro text-[var(--text-secondary)]">
              <p>No active folder is available. Add one in Spectra Settings.</p>
              <NextLink
                href={DEVICES_HREF}
                className="font-medium text-[var(--text-primary)] underline underline-offset-2"
              >
                Open Spectra Settings
              </NextLink>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {historyOpen ? (
        <HistoryComparisonOverlay
          artifact={artifact}
          current={{
            title,
            summary: summary || undefined,
            content,
            tags: tagsFromDraft(tagDraft),
          }}
          versions={versions.filter(version => version.artifactId === artifact._id)}
          selected={previewVersion?.artifactId === artifact._id ? previewVersion : null}
          changes={previewDiff}
          selectedRegions={selectedRestoreRegions}
          busyVersionId={historyBusy}
          listLoading={historyLoading}
          listError={historyError}
          hasMore={historyCursor !== null}
          previewLoading={previewLoading}
          previewError={previewError}
          readOnly={readOnly}
          onSelect={(version) => void selectHistoryVersion(version)}
          onLoadMore={() => { if (historyCursor) void loadHistoryPage(historyCursor); }}
          onRetryList={() => void loadHistoryPage(historyCursor ?? undefined)}
          onSelectedRegionsChange={setSelectedRestoreRegions}
          onRestore={(version, regionIds) =>
            void restoreVersion(version, regionIds)
          }
          onCreateCheckpoint={createNamedCheckpoint}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const ArtifactRichTextEditor = dynamic(
  () => import("./artifact-rich-text-editor").then((module) => module.ArtifactRichTextEditor),
  { loading: StudioTypePlaceholder },
);

/**
 * Spectra's one rich-text format bar.
 *
 * There used to be two: this inline row, and a separate `.spectra-document-
 * toolbar` that carried the same twelve verbs with different markup, different
 * heights and its own CSS. They drifted until the document one collapsed to
 * 24px and stopped rendering at any width. One component, both surfaces.
 *
 * It is attached to a text field, not bolted under the shared workbar: the
 * controls apply to the selection, so they belong to the surface that holds it.
 */
export function RichTextFormatBar({
  editor,
  disabled,
  label = "Text formatting",
  withTextStyle = false,
  inserts = true,
  trailing,
  unavailable,
}: {
  editor: TiptapEditor | null;
  disabled?: boolean;
  label?: string;
  /** Adds the Text/Heading 1-3 selector. Documents have headings; captions do not. */
  withTextStyle?: boolean;
  /**
   * Equation and other insert verbs. Field-attached bars keep these; a
   * selection toolbar does not, because slash and the block handle insert.
   */
  inserts?: boolean;
  /** Type-specific inserts (tables, callouts). Kept after the shared verbs. */
  trailing?: ReactNode;
  /**
   * Commands this field's text cannot hold, by label, and why: a linked
   * PowerPoint text box has no checklists, quotes, code or equations.
   */
  unavailable?: { labels: readonly string[]; reason: string };
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const reasonFor = (command: string) =>
    unavailable?.labels.includes(command) ? unavailable.reason : undefined;
  const [linkDraft, setLinkDraft] = useState("https://");
  const textStyle = editor?.isActive("heading", { level: 1 })
    ? "h1"
    : editor?.isActive("heading", { level: 2 })
      ? "h2"
      : editor?.isActive("heading", { level: 3 })
        ? "h3"
        : "paragraph";
  function applyLink() {
    const href = linkDraft.trim();
    if (!editor || !href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }
  return (
    <>
      <fieldset
        disabled={disabled}
        className="spectra-rich-text-format-bar contents"
      >
        <div role="toolbar" aria-label={label}>
          {withTextStyle ? (
            <WorkbarSelect
              ariaLabel="Text style"
              value={textStyle}
              options={[
                { value: "paragraph", label: "Text" },
                { value: "h1", label: "Heading 1" },
                { value: "h2", label: "Heading 2" },
                { value: "h3", label: "Heading 3" },
              ]}
              onChange={(value) => {
                if (value === "paragraph")
                  editor?.chain().focus().setParagraph().run();
                else
                  editor
                    ?.chain()
                    .focus()
                    .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                    .run();
              }}
            />
          ) : null}
          <ToolbarTextButton
            label="Bold"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            active={editor?.isActive("bold")}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarTextButton>
          <ToolbarTextButton
            label="Italic"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            active={editor?.isActive("italic")}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarTextButton>
          <ToolbarTextButton
            label="Underline"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            active={editor?.isActive("underline")}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolbarTextButton>
          {inserts ? (
            <ToolbarTextButton
              label="Strikethrough"
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              active={editor?.isActive("strike")}
            >
              <span className="text-caption font-semibold line-through">S</span>
            </ToolbarTextButton>
          ) : null}
          <ToolbarButton
            label="Bullet list"
            icon={List}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            label="Numbered list"
            icon={ListOrdered}
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            label="Checklist"
            icon={ListChecks}
            reason={reasonFor("Checklist")}
            active={editor?.isActive("taskList")}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          />
          {inserts ? (
            <>
              <ToolbarButton
                label="Quote"
                icon={MessageSquare}
                reason={reasonFor("Quote")}
                active={editor?.isActive("blockquote")}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              />
              <ToolbarButton
                label="Inline code"
                icon={Code2}
                reason={reasonFor("Inline code")}
                active={editor?.isActive("code")}
                onClick={() => editor?.chain().focus().toggleCode().run()}
              />
            </>
          ) : null}
          <ToolbarButton
            label="Link"
            icon={Link2}
            active={linkOpen || editor?.isActive("link")}
            onClick={() => {
              setLinkDraft(
                String(editor?.getAttributes("link").href ?? "https://"),
              );
              setLinkOpen((open) => !open);
            }}
          />
          {inserts ? (
            <>
              <ToolbarButton
                label="Inline equation"
                icon={Sigma}
                reason={reasonFor("Inline equation")}
                active={editor?.isActive("inlineEquation")}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent({
                      type: "inlineEquation",
                      attrs: { latex: "x" },
                    })
                    .run()
                }
              />
              <ToolbarTextButton
                label="Block equation"
                reason={reasonFor("Block equation")}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent({
                      type: "equation",
                      attrs: {
                        latex: "x",
                        display: "block",
                        alignment: "center",
                      },
                    })
                    .run()
                }
                active={editor?.isActive("equation")}
              >
                <span className="text-micro font-semibold">fx</span>
              </ToolbarTextButton>
            </>
          ) : null}
          {trailing}
        </div>
      </fieldset>
      {linkOpen ? (
        <form
          className="spectra-rich-text-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
          <input
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLinkOpen(false);
            }}
            aria-label="Link URL"
          />
          <button type="submit">Apply</button>
          {editor?.isActive("link") ? (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setLinkOpen(false);
              }}
            >
              Remove
            </button>
          ) : null}
        </form>
      ) : null}
    </>
  );
}

function ThreadReferenceStudio({ content }: { content: unknown }) {
  const threadId =
    typeof record(content).threadId === "string"
      ? (record(content).threadId as string)
      : "";
  if (threadId.trim()) {
    return (
      <div className="h-[min(760px,calc(100vh-230px))] min-h-[460px] overflow-hidden bg-[var(--bg-primary)]">
        <ThreadConversation
          threadId={threadId.trim()}
          compact
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-[var(--bg-primary)] p-8 text-center">
      <div className="max-w-[420px]">
        <MessageSquare className="mx-auto h-10 w-10 rounded-card bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-elevated))] p-2.5 text-[var(--brand-primary)]" />
        <div>
          <h3 className="mt-4 font-display text-metric font-semibold text-[var(--text-primary)]">
            Conversation unavailable
          </h3>
          <p className="mt-2 text-ui leading-6 text-[var(--text-secondary)]">
            This older item is a saved reference, not a conversation. Start a new chat to keep working on it.
          </p>
        </div>
      </div>
    </div>
  );
}

function StudioDetails({
  artifact,
  artifacts,
  tagDraft,
  onTagDraftChange,
  onArchive,
  onOpenArtifact,
}: {
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  onArchive?: () => Promise<void> | void;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const meta = workTypeMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const placements = artifactPlacements(artifact);
  const detailWaveStats = WAVE_C_BLUEPRINTS.has(artifact.blueprintKey)
    ? waveCIdentityStats(artifact.blueprintKey, artifact.content)
    : null;
  const detailWaveTitle =
    artifact.blueprintKey === "presentation"
      ? "Presentation metrics"
      : artifact.blueprintKey === "sheets"
        ? "Sheet overview"
        : artifact.blueprintKey === "code"
          ? "Project overview"
          : artifact.blueprintKey === "whiteboard"
            ? "Board overview"
            : "Calendar overview";
  const links = linkedArtifacts(artifact, artifacts);
  const [durableLinks, setDurableLinks] = useState<SpectraArtifactLink[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"details" | "history">(
    "details",
  );
  const [historyVersions, setHistoryVersions] = useState<
    SpectraArtifactVersionSummary[]
  >([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = useRef<AbortController | null>(null);
  const loadHistoryPage = useCallback(async (cursor?: string) => {
    historyRequestRef.current?.abort();
    const request = new AbortController();
    historyRequestRef.current = request;
    setHistoryLoading(true);
    setHistoryError(null);
    if (cursor === undefined) {
      setHistoryVersions([]);
      setHistoryCursor(null);
    }
    try {
      const result = await getSpectraArtifactVersions(artifact._id, 20, cursor, request.signal);
      if (request.signal.aborted) return;
      setHistoryVersions(current => cursor === undefined ? result.versions :
        [...new Map([...current, ...result.versions].map(version => [version._id, version])).values()]);
      setHistoryCursor(result.isDone ? null : result.continueCursor);
    } catch (error) {
      if (!request.signal.aborted)
        setHistoryError(error instanceof Error ? error.message : "Could not load version history.");
    } finally {
      if (!request.signal.aborted) setHistoryLoading(false);
    }
  }, [artifact._id]);
  const visibleTags = tagsFromDraft(tagDraft);
  const detailDeckCards =
    artifact.blueprintKey === "flashcard_deck"
      ? deckCards(artifact.content)
      : [];
  const detailDeckSections = new Set(
    detailDeckCards.map((card) => card.section ?? "Section 1"),
  ).size;
  useEffect(() => {
    void getSpectraArtifactLinks(artifact._id)
      .then((result) => setDurableLinks(result.links))
      .catch(() => setDurableLinks([]));
  }, [artifact._id]);
  useEffect(() => {
    if (detailsTab !== "history") return;
    void loadHistoryPage();
    return () => historyRequestRef.current?.abort();
  }, [detailsTab, loadHistoryPage]);
  const linkedIds = new Set(
    durableLinks.flatMap((link) =>
      link.artifact?.id ? [link.artifact.id] : [],
    ),
  );
  const suggestions = artifacts
    .filter(
      (candidate) =>
        candidate._id !== artifact._id && !linkedIds.has(candidate._id),
    )
    .map((candidate) => {
      const sharedWorkspace = artifactPlacements(candidate).some((placement) =>
        placements.some(
          (source) => source.workspaceId === placement.workspaceId,
        ),
      );
      const sharedTags = candidate.tags.filter((tag) =>
        artifact.tags.includes(tag),
      ).length;
      const titleWords = artifact.title
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3);
      const titleMatch = titleWords.some((word) =>
        `${candidate.title} ${candidate.summary ?? ""}`
          .toLowerCase()
          .includes(word),
      );
      return {
        candidate,
        score:
          Number(sharedWorkspace) * 5 +
          sharedTags * 3 +
          Number(titleMatch) * 2 +
          Number(candidate.blueprintKey === artifact.blueprintKey),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.candidate.updatedAt - a.candidate.updatedAt,
    )
    .slice(0, 3);

  async function confirmLink(target: SpectraArtifact) {
    setLinkingId(target._id);
    try {
      await postSpectra({
        action: "createArtifactLink",
        sourceArtifactId: artifact._id,
        targetArtifactId: target._id,
        relationType: "related",
        workspaceId: placements[0]?.workspaceId,
        explanation: "Confirmed from a suggested link",
      });
      const result = await getSpectraArtifactLinks(artifact._id);
      setDurableLinks(result.links);
    } finally {
      setLinkingId(null);
    }
  }
  async function removeLink(linkId: string) {
    await postSpectra({ action: "removeArtifactLink", linkId });
    const result = await getSpectraArtifactLinks(artifact._id);
    setDurableLinks(result.links);
  }
  async function duplicateCurrentArtifact() {
    setDuplicating(true);
    const creation = beginCreation();
    try {
      const result = await postSpectra<{ artifactId: string }>({
        action: "createArtifact",
        blueprintKey: artifact.blueprintKey,
        title: `${artifact.title} copy`,
        summary: artifact.summary,
        content: artifact.content,
        tags: artifact.tags,
        workspaceId: placements[0]?.workspaceId,
      });
      spectraBus.emit("workspace.refreshRequested", {});
      creation.land();
      onOpenArtifact(result.artifactId);
    } catch (error) {
      creation.cancel();
      throw error;
    } finally {
      setDuplicating(false);
    }
  }
  return (
    <aside className="spectra-studio-details overflow-hidden rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="grid grid-cols-2 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 pt-1">
        <button
          type="button"
          onClick={() => setDetailsTab("details")}
          className={`h-11 border-b-2 text-caption font-semibold ${detailsTab === "details" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setDetailsTab("history")}
          className={`h-11 border-b-2 text-caption font-semibold ${detailsTab === "history" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          Activity
        </button>
      </div>
      {detailsTab === "details" ? (
        <div className="space-y-3 p-3">
          <SideCard title="Blueprint">
            <div className="flex items-center gap-2 text-caption font-semibold text-[var(--text-primary)]">
              <Icon className="h-4 w-4" style={{ color: meta.color }} />
              {meta.label}
            </div>
          </SideCard>
          <SideCard title="Placement">
            <div className="space-y-2">
              {placements.length > 0 ? (
                placements.map((placement) => (
                  <div
                    key={placement.nodeId}
                    className="rounded-control px-1 py-1 text-caption font-medium text-[var(--text-primary)]"
                  >
                    {placement.workspaceTitle}
                    <div className="text-micro font-normal text-[var(--text-secondary)]">
                      Workspace
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-ui text-[var(--text-secondary)]">
                  Library inbox
                </div>
              )}
            </div>
          </SideCard>
          <FileStorageControls
            artifactId={artifact._id}
            artifactTitle={artifact.title}
            embedded
          />
          {detailWaveStats?.length ? (
            <SideCard title={detailWaveTitle}>
              <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] text-center">
                {detailWaveStats.map(([value, label]) => (
                  <div key={label} className="px-1">
                    <strong className="block font-sans text-ui font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                      {value}
                    </strong>
                    <span className="text-micro text-[var(--text-tertiary)]">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </SideCard>
          ) : null}
          {artifact.blueprintKey === "flashcard_deck" ? (
            <SideCard title="Deck metrics">
              <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] text-center">
                <div>
                  <strong className="block font-display text-body text-[var(--text-primary)]">
                    {detailDeckCards.length}
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Cards
                  </span>
                </div>
                <div>
                  <strong className="block font-display text-body text-[var(--text-primary)]">
                    {detailDeckSections}
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Sections
                  </span>
                </div>
                <div>
                  <strong className="block font-display text-body text-[var(--text-primary)]">
                    ~{Math.max(1, Math.round(detailDeckCards.length * 0.75))}{" "}
                    min
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Study time
                  </span>
                </div>
              </div>
            </SideCard>
          ) : null}
          <SideCard title="Linked work">
            <div className="space-y-2">
              {durableLinks.slice(0, 8).map((link) =>
                link.artifact ? (
                  <div
                    key={link._id}
                    className="group rounded-control px-1 py-1.5 text-micro text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    data-link-direction={link.direction}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {link.artifact.title}
                      </span>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {link.direction === "incoming" ? "←" : "→"}{" "}
                        {link.relationType.replaceAll("_", " ")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeLink(link._id)}
                        className="text-[var(--text-tertiary)] opacity-0 transition hover:text-[var(--danger)] group-hover:opacity-100"
                        aria-label={`Remove link to ${link.artifact.title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ) : null,
              )}
              {links.slice(0, 4).map(({ artifact: linked }) => {
                const linkedMeta = workTypeMeta[linked.blueprintKey];
                const LinkedIcon = linkedMeta.icon;
                return (
                  <div
                    key={linked._id}
                    className="flex items-center gap-2 text-caption text-[var(--text-primary)]"
                  >
                    <LinkedIcon
                      className="h-4 w-4"
                      style={{ color: linkedMeta.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {linked.title}
                    </span>
                  </div>
                );
              })}
              {links.length === 0 && durableLinks.length === 0 ? (
                <div className="text-caption text-[var(--text-secondary)]">
                  No confirmed links yet.
                </div>
              ) : null}
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-chip px-1.5 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setLinkPickerOpen((open) => !open)}
                aria-expanded={linkPickerOpen}
              >
                <Plus className="h-3 w-3" /> Link work
              </button>
              {linkPickerOpen ? (
                <div className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
                  {suggestions.map(({ candidate }) => (
                    <div
                      key={candidate._id}
                      className="flex items-center gap-2 rounded-chip px-1 py-1 text-micro"
                    >
                      <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
                        {candidate.title}
                      </span>
                      <button
                        type="button"
                        disabled={linkingId === candidate._id}
                        className="text-[var(--accent-cyan)]"
                        onClick={() => void confirmLink(candidate)}
                      >
                        {linkingId === candidate._id ? "Linking…" : "Add"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </SideCard>
          {suggestions.length > 0 ? (
            <details
              open
              className="spectra-related-artifacts rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
            >
              <summary className="text-micro font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                Related suggestions · {suggestions.length}
              </summary>
              <div className="space-y-1.5">
                {suggestions.map(({ candidate }) => (
                  <div
                    key={candidate._id}
                    className="group flex items-center gap-2 rounded-control px-1.5 py-1.5 hover:bg-[var(--bg-primary)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-micro text-[var(--text-secondary)]">
                      {candidate.title}
                    </span>
                    <button
                      type="button"
                      disabled={linkingId === candidate._id}
                      onClick={() => void confirmLink(candidate)}
                      className="rounded-chip px-1.5 py-1 text-micro font-medium text-[var(--accent-cyan)] opacity-70 hover:bg-[var(--bg-hover)] group-hover:opacity-100"
                    >
                      {linkingId === candidate._id
                        ? "Linking…"
                        : "Confirm link"}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {artifact.createdFrom ? (
            <SideCard title="Provenance">
              <div className="text-micro leading-5 text-[var(--text-secondary)]">
                <div className="font-medium text-[var(--text-primary)]">
                  {artifact.createdFrom.contextSummary ??
                    `Created from ${artifact.createdFrom.source}`}
                </div>
                {artifact.createdFrom.sourceArtifactIds?.length ? (
                  <div className="mt-1">
                    Used {artifact.createdFrom.sourceArtifactIds.length} source
                    artifact
                    {artifact.createdFrom.sourceArtifactIds.length === 1
                      ? ""
                      : "s"}
                  </div>
                ) : null}
                {artifact.createdFrom.threadId ? (
                  <div>Includes conversation context</div>
                ) : null}
                {artifact.createdFrom.sourceAttachmentNames?.length ? (
                  <div>
                    {artifact.createdFrom.sourceAttachmentNames.length}{" "}
                    attachment
                    {artifact.createdFrom.sourceAttachmentNames.length === 1
                      ? ""
                      : "s"}
                  </div>
                ) : null}
              </div>
            </SideCard>
          ) : null}
          <SideCard title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-micro font-medium text-[var(--text-secondary)]"
                  data-artifact-tag={tag}
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onTagDraftChange(
                        visibleTags.filter((item) => item !== tag).join(", "),
                      )
                    }
                    aria-label={`Remove ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-chip border border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setTagEditorOpen((open) => !open)}
                aria-label="Add tag"
                aria-expanded={tagEditorOpen}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {tagEditorOpen ? (
              <div className="mt-2 flex gap-1.5">
                <input
                  value={newTag}
                  onChange={(event) => setNewTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newTag.trim()) {
                      event.preventDefault();
                      onTagDraftChange(
                        Array.from(
                          new Set([...visibleTags, newTag.trim()]),
                        ).join(", "),
                      );
                      setNewTag("");
                    }
                  }}
                  className="h-8 min-w-0 flex-1 bg-transparent text-micro text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Add a tag"
                />
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-control text-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    if (!newTag.trim()) return;
                    onTagDraftChange(
                      Array.from(new Set([...visibleTags, newTag.trim()])).join(
                        ", ",
                      ),
                    );
                    setNewTag("");
                  }}
                  aria-label="Add tag"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </SideCard>
          <SideCard
            title={
              artifact.blueprintKey === "flashcard_deck"
                ? "Metadata"
                : "Activity"
            }
          >
            <div className="space-y-2 text-micro text-[var(--text-secondary)]">
              <div className="flex items-center justify-between">
                <span>Last edited</span>
                <strong className="font-medium text-[var(--text-primary)]">
                  {formatRelativeTime(artifact.updatedAt)}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Created</span>
                <strong className="font-medium text-[var(--text-primary)]">
                  {formatShortDate(artifact.createdAt)}
                </strong>
              </div>
            </div>
          </SideCard>
          {artifact.blueprintKey === "flashcard_deck" ||
          artifact.blueprintKey === "quiz" ? (
            <SideCard title="Quick actions">
              <div className="space-y-0.5">
                {artifact.blueprintKey === "flashcard_deck" ? (
                  <button
                    type="button"
                    className="spectra-inspector-action"
                    onClick={() =>
                      void spectraBus.command("deck.study", {
                        workId: artifact._id,
                      })
                    }
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Study this deck
                  </button>
                ) : (
                  <button
                    type="button"
                    className="spectra-inspector-action"
                    onClick={() =>
                      void spectraBus.command("quiz.preview", {
                        workId: artifact._id,
                      })
                    }
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview quiz
                  </button>
                )}
                <button
                  type="button"
                  className="spectra-inspector-action"
                  disabled={duplicating}
                  onClick={() => void duplicateCurrentArtifact()}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {duplicating
                    ? "Duplicating…"
                    : `Duplicate ${artifact.blueprintKey === "quiz" ? "quiz" : "deck"}`}
                </button>
                <button
                  type="button"
                  className="spectra-inspector-action"
                  onClick={() => window.print()}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Export / print
                </button>
                {onArchive ? (
                  <button
                    type="button"
                    className="spectra-inspector-action"
                    onClick={() => void onArchive()}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive {artifact.blueprintKey === "quiz" ? "quiz" : "deck"}
                  </button>
                ) : null}
              </div>
            </SideCard>
          ) : null}
        </div>
      ) : (
        <div className="p-3">
          <SideCard title="History">
            <div className="space-y-2">
              {historyVersions.filter(version => version.artifactId === artifact._id).map((version, index) => (
                <div
                  key={version._id}
                  className="rounded-control bg-[var(--bg-primary)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 text-micro font-semibold text-[var(--text-primary)]">
                    <History className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                    {index === 0
                      ? "Current saved version"
                      : version.summary || "Saved version"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-micro text-[var(--text-tertiary)]">
                    <span>
                      {historyKind(version)}
                    </span>
                    <span>{formatRelativeTime(version.createdAt)}</span>
                  </div>
                </div>
              ))}
              {historyError ? (
                <div role="alert" className="text-micro text-[var(--text-secondary)]">
                  <p>{historyError}</p>
                  <button type="button" onClick={() => void loadHistoryPage(historyCursor ?? undefined)} disabled={historyLoading} className="mt-2 h-8 rounded-control border border-[var(--border-default)] px-3">Retry history</button>
                </div>
              ) : null}
              {historyLoading ? <p role="status" className="text-micro text-[var(--text-secondary)]">Loading history…</p> : historyCursor && !historyError ? (
                <button type="button" onClick={() => void loadHistoryPage(historyCursor)} className="h-8 rounded-control border border-[var(--border-default)] px-3 text-micro">Load older versions</button>
              ) : null}
              {historyVersions.length === 0 && !historyLoading && !historyError ? (
                <p className="text-micro leading-5 text-[var(--text-secondary)]">
                  No saved versions yet.
                </p>
              ) : null}
            </div>
          </SideCard>
        </div>
      )}
    </aside>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      data-spectra-card="side"
      data-side-card-title={title.toLowerCase().replaceAll(" ", "-")}
      className="p-4"
    >
      <h3 className="mb-3 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

const AI_FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "button"]);

export function Field({
  label,
  children,
  aiActive = false,
  path,
}: {
  label: string;
  children: ReactNode;
  aiActive?: boolean;
  /**
   * Canonical content pointer for this field. Annotating the *control* rather
   * than the wrapping label is what lets a peer's caret land on real text
   * instead of the label's padding box.
   */
  path?: string;
}) {
  let markedControl = false;
  let control: ReactNode = children;

  const decorate = (element: ReactElement): ReactElement => {
    markedControl = true;
    return cloneElement(element as ReactElement<Record<string, unknown>>, {
      ...(aiActive ? { "data-ai-region": true } : {}),
      ...(path ? targetAttrs(path) : {}),
    });
  };

  if ((aiActive || path) && isValidElement(children)) {
    const type = children.type;
    if (typeof type === "string" && AI_FORM_CONTROL_TAGS.has(type)) {
      control = decorate(children);
    } else if (
      Children.count(children) === 1 &&
      isValidElement(Children.only(children))
    ) {
      const only = Children.only(children) as ReactElement;
      if (
        typeof only.type === "string" &&
        AI_FORM_CONTROL_TAGS.has(only.type)
      ) {
        control = decorate(only);
      }
    }
  }
  return (
    <label
      className="block rounded-control"
      data-ai-region={aiRegionAttr(aiActive && !markedControl)}
      // Fall back to the label only when the control itself could not be
      // annotated, so a target always resolves to something honest.
      {...(path && !markedControl ? targetAttrs(path) : {})}
    >
      <span className="mb-1.5 block text-caption font-semibold text-[var(--text-secondary)]">
        {label}
      </span>
      {control}
    </label>
  );
}

export function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  reason,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  /** Why it cannot be used here: the button is off and says so. */
  reason?: string;
  onClick?: () => void;
}) {
  const contract = useOptionalStudioContract();
  const reasonId = useId();
  const execute = () => {
    if (!onClick) return;
    if (!contract) return onClick();
    dispatchFormatChrome({
      type: contract.type,
      label,
      run: onClick,
      can: contract.can,
      role: contract.role,
      compatibilityProfile: contract.compatibilityProfile,
      fidelity: contract.fidelity,
    });
  };
  return (
    <Tooltip label={reason ? `${label}. ${reason}` : label}>
      <button
        type="button"
        className={toolbarClass()}
        data-active={active || undefined}
        onClick={execute}
        disabled={disabled || Boolean(reason)}
        aria-label={label}
        aria-describedby={reason ? reasonId : undefined}
      >
        <Icon className="h-4 w-4" />
        {reason ? <span id={reasonId} className="sr-only">{reason}</span> : null}
      </button>
    </Tooltip>
  );
}

export function ToolbarTextButton({
  label,
  active,
  reason,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  /** Why it cannot be used here: the button is off and says so. */
  reason?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const contract = useOptionalStudioContract();
  const reasonId = useId();
  const execute = () => {
    if (!onClick) return;
    if (!contract) return onClick();
    dispatchFormatChrome({
      type: contract.type,
      label,
      run: onClick,
      can: contract.can,
      role: contract.role,
      compatibilityProfile: contract.compatibilityProfile,
      fidelity: contract.fidelity,
    });
  };
  return (
    <Tooltip label={reason ? `${label}. ${reason}` : label}>
      <button
        type="button"
        className={toolbarClass()}
        data-active={active || undefined}
        onClick={execute}
        disabled={Boolean(reason)}
        aria-label={label}
        aria-describedby={reason ? reasonId : undefined}
      >
        {children}
        {reason ? <span id={reasonId} className="sr-only">{reason}</span> : null}
      </button>
    </Tooltip>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={iconButtonClass()}
        onClick={onClick}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

export function Divider() {
  return <span className="mx-1 h-5 w-px bg-[var(--border-default)]" />;
}

export function inputClass() {
  return "h-10 w-full rounded-control border border-[var(--border-default)] bg-transparent px-3 text-ui text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))]";
}

export function textareaClass(extra = "") {
  return `w-full resize-none rounded-control border border-[var(--border-default)] bg-transparent px-3 py-2 text-ui leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-primary)_55%,var(--border-default))] ${extra}`;
}

export function iconButtonClass() {
  return "flex h-9 w-9 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

export function smallActionClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-control bg-transparent px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function toolbarClass() {
  return "flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-caption font-medium text-[var(--text-secondary)] transition disabled:opacity-40";
}
