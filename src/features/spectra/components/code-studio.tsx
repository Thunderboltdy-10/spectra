"use client";

import CodeMirror from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { linter, type Diagnostic } from "@codemirror/lint";
import { openSearchPanel } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  CircleStop,
  CloudUpload,
  Copy,
  Download,
  Eraser,
  Eye,
  FileArchive,
  FileImage,
  FilePlus2,
  FileText,
  Flag,
  FlaskConical,
  FolderOpen,
  Import,
  Loader2,
  Maximize2,
  PanelBottom,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { readSpectraSandboxTheme } from "../embed/theme-tokens";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField } from "@/components/ui/select";
import {
  codeRuntimeVersion,
  codeContentKey,
  codeParameterSnapshot,
  createCodeImportRecoveryAsset,
  exportCodeArchive,
  importCodeFiles,
  languageForPath,
  normalizeCodeContent,
  normalizeCodePath,
  preferredEntry,
  reconcileLineIds,
  type CodeContent,
  type CodeFile,
  type CodeImportReport,
  type CodeParameter,
  type CodeRuntime,
  type CodeTest,
} from "../code/model";
import {
  runtimeSourceHash,
  type PublishedCodeBuildProjection,
} from "../code/published-build";
import {
  inspectCodeNetworkOrigin,
  MAX_CODE_NETWORK_ORIGINS,
  normalizeCodeNetworkOrigins,
} from "../code/network-policy";
import {
  runPythonInIsolatedWorker,
  type PythonRuntimeEvent,
} from "../code/python-runtime";
import { pythonChartToHtml } from "../code/python-chart";
import { loadCodeRuntimeAssets } from "../code/runtime-assets-client";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactImports,
  getArtifactAssets,
  getPublishedCodeBuild,
  postSpectra,
  publishCodeBuild,
  revokeArtifactAsset,
  unpublishCodeBuild,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
  type SpectraArtifactImport,
  type SpectraArtifactAsset,
} from "../data/api";
import { sheetCellEntries } from "../../../../shared/sheet-cells";
import {
  buildSpectraSandboxDocument,
  type SpectraSandboxAsset,
  type SpectraSandboxFrameMessage,
} from "../embed/sandbox-protocol";
import {
  SandboxedArtifactRuntime,
  type SpectraRuntimeStatus,
} from "./sandboxed-artifact-runtime";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { spectraBus } from "../events";
import {
  ArtifactWorkbar,
  WorkbarItemSelector,
  type CommandBinding,
  type WorkbarModeSpec,
} from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import { useStudioContract } from "./artifact-studio-shell";
import { StudioItemRail } from "./studio-item-rail";
import { targetAttrs } from "../collaboration/target-attributes";
import { codeFileText } from "../work/models/yjs/code-adapter";
import { replaceYText } from "../work/models/yjs/shared";
import {
  artifactBlobSha256,
  downloadDocumentBlob,
} from "./artifact-studio-file-utils";
import { requestSpectra } from "../data/request";

type CodeProblem = {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

type ConsoleEntry = {
  id: string;
  level: "log" | "info" | "warn" | "error" | "system";
  text: string;
  createdAt: number;
};

type RunState =
  | "idle"
  | "building"
  | "loading"
  | "running"
  | "ready"
  | "error"
  | "limited"
  | "cancelled";

type TestResult = {
  id: string;
  name: string;
  status: "running" | "passed" | "failed";
  message?: string;
};

type CodeSurface = "preview" | "code" | "split";

/**
 * The registry owns which views exist and who may enter them, so the studio
 * translates its own surface names to the registry's mode ids rather than
 * declaring a second, parallel list of tabs.
 */
const SURFACE_BY_MODE_ID: Record<string, CodeSurface> = {
  code: "code",
  visualisation: "preview",
  both: "split",
};
const MODE_ID_BY_SURFACE: Record<CodeSurface, string> = {
  code: "code",
  preview: "visualisation",
  split: "both",
};

const MAX_CONSOLE_ENTRIES = 180;
const CURATED_CODE_DEPENDENCIES = [
  {
    key: "recharts",
    label: "Recharts",
    version: "2.15.4",
    detail: "Accessible React charts",
  },
  {
    key: "d3",
    label: "D3",
    version: "7.9.0",
    detail: "Custom data visualisation",
  },
  {
    key: "lucide-react",
    label: "Lucide",
    version: "0.563.0",
    detail: "Consistent interface icons",
  },
  {
    key: "date-fns",
    label: "date-fns",
    version: "4.1.0",
    detail: "Date and time utilities",
  },
] as const;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

const fileCollaboration = new WeakMap<
  Y.Text,
  { awareness: Awareness; extension: Extension[] }
>();

/**
 * The collaboration binding for one file's editor, with undo scoped to this
 * person. CodeMirror's own history records every transaction, including the
 * ones y-codemirror dispatches for a collaborator's typing, so its Ctrl+Z
 * reverted peers. yCollab's Y.UndoManager tracks only local-origin edits; its
 * keymap takes Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z while the file is shared.
 *
 * One binding, and so one undo history, per file. A fresh one per render gave
 * the undo command an empty manager after the first re-render, and the editor
 * is remounted on every file switch, which discarded that file's history.
 */
export function codeEditorCollaboration(
  sharedText: Y.Text,
  awareness: Awareness,
) {
  const cached = fileCollaboration.get(sharedText);
  if (cached?.awareness === awareness) return cached.extension;
  const extension = [
    yCollab(sharedText, awareness, {
      undoManager: new Y.UndoManager(sharedText),
    }),
    Prec.high(keymap.of(yUndoManagerKeymap)),
  ];
  fileCollaboration.set(sharedText, { awareness, extension });
  return extension;
}

/** basicSetup for the source editor: CodeMirror history only when not shared. */
export function codeEditorBasicSetup(collaborating: boolean) {
  return {
    lineNumbers: true,
    highlightActiveLine: true,
    highlightActiveLineGutter: true,
    foldGutter: true,
    autocompletion: true,
    closeBrackets: true,
    bracketMatching: true,
    searchKeymap: true,
    history: !collaborating,
    historyKeymap: !collaborating,
  };
}

function languageExtension(file: CodeFile) {
  const language = file.language.toLowerCase();
  if (language.includes("typescript") || /\.tsx?$/i.test(file.path))
    return javascript({ typescript: true, jsx: /\.tsx$/i.test(file.path) });
  if (language.includes("javascript") || /\.jsx?$/i.test(file.path))
    return javascript({ jsx: /\.jsx$/i.test(file.path) });
  if (language === "html" || /\.html?$/i.test(file.path)) return html();
  if (language === "css" || /\.css$/i.test(file.path)) return css();
  if (language === "python" || /\.py$/i.test(file.path)) return python();
  if (language === "json" || /\.json5?$/i.test(file.path)) return json();
  if (language === "markdown" || /\.mdx?$/i.test(file.path)) return markdown();
  return [];
}

function formatBytes(value: number) {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function downloadBlob(blob: Blob, filename: string) {
  downloadDocumentBlob(filename, blob);
}

function safeFilename(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "spectra-code"
  );
}

function parserFor(file: CodeFile) {
  const extension = file.path.toLowerCase().split(".").pop();
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (
    extension === "js" ||
    extension === "jsx" ||
    extension === "mjs" ||
    extension === "cjs"
  )
    return "babel";
  if (extension === "json" || extension === "json5") return "json";
  if (extension === "css" || extension === "scss") return "css";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "md" || extension === "mdx") return "markdown";
  return null;
}

function runtimeLabel(runtime: CodeRuntime) {
  if (runtime === "react") return "React + TypeScript";
  if (runtime === "browser") return "HTML / CSS / JavaScript";
  if (runtime === "python") return "Python (isolated)";
  return "Source only";
}

/** Internal run states are not readable words, so the readout says what happened. */
function runStateLabel(state: RunState) {
  if (state === "building") return "Building";
  if (state === "loading") return "Starting";
  if (state === "running") return "Running";
  if (state === "ready") return "Running in a sandbox";
  if (state === "error") return "Stopped on an error";
  if (state === "limited") return "Stopped at a safety limit";
  if (state === "cancelled") return "Stopped";
  return "Not running";
}

function cellCoordinates(address: string) {
  const match = address
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let column = 0;
  for (const character of match[1]!)
    column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function codeResourceSnapshot(
  content: CodeContent,
  artifacts: readonly SpectraArtifact[],
) {
  const snapshot: Record<string, unknown> = {};
  for (const binding of (content.resourceBindings ?? []).slice(0, 30)) {
    const artifact = artifacts.find(
      (candidate) => candidate._id === binding.artifactId,
    );
    if (!artifact || artifact.status === "deleted") continue;
    if (binding.kind !== "sheets_range") {
      snapshot[binding.id] = {
        artifactId: artifact._id,
        title: artifact.title,
        blueprintKey: artifact.blueprintKey,
        content: artifact.content,
      };
      continue;
    }
    const workbook =
      artifact.content &&
      typeof artifact.content === "object" &&
      !Array.isArray(artifact.content)
        ? (artifact.content as Record<string, unknown>)
        : {};
    const sheets = Array.isArray(workbook.sheets)
      ? workbook.sheets.filter((value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object" && !Array.isArray(value)),
        )
      : [];
    const [sheetName, rangeText] = (binding.range || "A1:J30").includes("!")
      ? (binding.range || "").split("!", 2)
      : [undefined, binding.range || "A1:J30"];
    const sheet =
      sheets.find((candidate) => String(candidate.name ?? "") === sheetName) ??
      sheets.find(
        (candidate) => String(candidate.id ?? "") === workbook.activeSheetId,
      ) ??
      sheets[0];
    const bounds = rangeText.split(":", 2);
    const startText = bounds[0] || "A1";
    const endText = bounds[1] || startText;
    const start = cellCoordinates(startText);
    const end = cellCoordinates(endText);
    const selected: Record<string, unknown> = {};
    if (start && end) {
      for (const [address, cell] of sheetCellEntries(sheet?.cells)) {
        const point = cellCoordinates(address);
        if (
          !point ||
          point.row < Math.min(start.row, end.row) ||
          point.row > Math.max(start.row, end.row) ||
          point.column < Math.min(start.column, end.column) ||
          point.column > Math.max(start.column, end.column)
        )
          continue;
        selected[address] = cell;
        if (Object.keys(selected).length >= 2_000) break;
      }
    }
    snapshot[binding.id] = {
      artifactId: artifact._id,
      title: artifact.title,
      blueprintKey: "sheets",
      sheetId: sheet?.id,
      sheetName: sheet?.name,
      range: binding.range || "A1:J30",
      cells: selected,
    };
  }
  return snapshot;
}

function pythonTestSource(tests: NonNullable<CodeContent["tests"]>) {
  return tests
    .filter((test) => test.enabled !== false)
    .map(
      (test) =>
        `\n# Spectra test: ${test.name.replaceAll("\n", " ")}\ntry:\n    exec(compile(${JSON.stringify(test.source)}, ${JSON.stringify(`<test:${test.name}>`)}, "exec"), globals(), globals())\n    print(${JSON.stringify(`[spectra-test:pass] ${test.id} ${test.name}`)})\nexcept Exception as _spectra_test_error:\n    print(${JSON.stringify(`[spectra-test:fail] ${test.id} ${test.name} `)} + str(_spectra_test_error))`,
    )
    .join("\n");
}

export function CodeStudio({
  artifactId,
  artifacts,
  title,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly: readOnlyProp,
  collaborationDocument,
  synchronizationReady,
  onActiveRegionChange,
}: {
  artifactId: string;
  artifacts: SpectraArtifact[];
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly: boolean;
  collaborationDocument?: Y.Doc;
  synchronizationReady: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  // The work registry is the single authority on what this viewer may do.
  // Running is not editing: a read-only reviewer may still execute the project,
  // so the two gates are separate and neither is derived from a width or a mode.
  const contract = useStudioContract();
  const canExecute = contract.can("execute");
  const readOnly = readOnlyProp || contract.readOnly;
  const incoming = useMemo(() => normalizeCodeContent(content), [content]);
  const collaborationAwareness = useMemo(
    () => (collaborationDocument ? new Awareness(collaborationDocument) : null),
    [collaborationDocument],
  );
  useEffect(
    () => () => collaborationAwareness?.destroy(),
    [collaborationAwareness],
  );
  const incomingRef = useRef(incoming);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);
  const [workbook, setWorkbook] = useState<CodeContent>(incoming);
  const lastEmittedKeyRef = useRef<string | null>(null);
  const [activeFileId, setActiveFileId] = useState(incoming.entryFileId);
  const [surface, setSurface] = useState<CodeSurface>(
    incoming.visualisation.openMode === "preview"
      ? "preview"
      : incoming.visualisation.openMode === "split"
        ? "split"
        : "code",
  );
  const [sourceMode, setSourceMode] = useState<"code" | "parameters">("code");
  const [fileQuery, setFileQuery] = useState("");
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    fileId: string;
    line: number;
    column: number;
  } | null>(null);
  const [fileRailPreference, setFileRailPreference] = useState<
    "auto" | "open" | "closed"
  >("auto");
  const fileRailOpen =
    contract.surface === "full" &&
    (fileRailPreference === "auto"
      ? contract.density !== "tight"
      : fileRailPreference === "open");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"console" | "problems" | "tests" | null>(
    null,
  );
  const [runState, setRunState] = useState<RunState>("idle");
  const [runMessage, setRunMessage] = useState("");
  const [previewFiles, setPreviewFiles] = useState<CodeFile[] | null>(null);
  const [previewTests, setPreviewTests] = useState<CodeTest[]>([]);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [problems, setProblems] = useState<CodeProblem[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [a11y, setA11y] = useState<{
    title: boolean;
    headingCount: number;
    landmarkCount: number;
    focusableCount: number;
    imagesWithoutAlt: number;
    unnamedControls: number;
    duplicateIds: number;
    headingOrderIssues: number;
    unlabelledGraphics: number;
    language: string;
  } | null>(null);
  const [runtimeAssets, setRuntimeAssets] = useState<SpectraSandboxAsset[]>([]);
  const [assetDiagnostics, setAssetDiagnostics] = useState<string[]>([]);
  const [importReport, setImportReport] = useState<CodeImportReport | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [splitPercent, setSplitPercent] = useState(43);
  const [fullPreview, setFullPreview] = useState(false);
  const [publishedBuild, setPublishedBuild] =
    useState<PublishedCodeBuildProjection | null>(null);
  const [publishedContentKey, setPublishedContentKey] = useState<string | null>(
    null,
  );
  const [publishState, setPublishState] = useState<
    "loading" | "idle" | "publishing" | "unpublishing"
  >("loading");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<{
    id: string;
    target: "svg" | "png" | "pdf" | "webm";
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingImportVersion, setPendingImportVersion] = useState<{
    jobId: string;
    attempt: number;
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const folderImportRef = useRef<HTMLInputElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const pythonRunRef = useRef<{ cancel: () => void } | null>(null);
  const runSequenceRef = useRef(0);
  const draggingRef = useRef(false);
  const importReconciliationStartedRef = useRef(false);

  const finishRunningTests = useCallback((message: string) => {
    setTestResults((current) =>
      current.map((result) =>
        result.status === "running"
          ? { ...result, status: "failed", message }
          : result,
      ),
    );
  }, []);

  const activeFile =
    workbook.files.find((file) => file.id === activeFileId) ??
    workbook.files[0]!;
  const activeSharedText = useMemo(
    () =>
      collaborationDocument
        ? codeFileText(collaborationDocument, activeFile.id)
        : null,
    [activeFile.id, collaborationDocument],
  );
  const filteredFiles = workbook.files.filter((file) =>
    file.path.toLowerCase().includes(fileQuery.trim().toLowerCase()),
  );
  const activeIndex = workbook.files.findIndex(
    (file) => file.id === activeFile.id,
  );
  const activeAiEffect = pathTouches(aiChangedPaths, `/files/${activeIndex}`);
  const activeAiLineIndexes = useMemo(() => {
    const prefix = `/files/${activeIndex}/source/`;
    return [
      ...new Set(
        aiChangedPaths.flatMap((path) => {
          if (!path.startsWith(prefix)) return [];
          const lineIndex = Number(path.slice(prefix.length).split("/")[0]);
          return Number.isInteger(lineIndex) && lineIndex >= 0
            ? [lineIndex]
            : [];
        }),
      ),
    ].sort((left, right) => left - right);
  }, [activeIndex, aiChangedPaths]);
  const runtimeResources = useMemo(
    () => codeResourceSnapshot(workbook, artifacts),
    [artifacts, workbook],
  );
  const runtimeParameters = useMemo(
    () => codeParameterSnapshot(workbook),
    [workbook],
  );
  const assetReferenceKey = JSON.stringify(
    (workbook.assets ?? []).map((asset) => [
      asset.assetId,
      asset.sha256,
      asset.path,
    ]),
  );
  const currentContentKey = codeContentKey(workbook);
  const publishedStale = Boolean(
    publishedBuild && publishedContentKey !== currentContentKey,
  );

  useEffect(() => {
    if (!pendingSearchTarget || pendingSearchTarget.fileId !== activeFile.id)
      return;
    const frame = window.requestAnimationFrame(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const lineNumber = Math.min(
        pendingSearchTarget.line,
        view.state.doc.lines,
      );
      const line = view.state.doc.line(Math.max(1, lineNumber));
      const anchor = Math.min(
        line.to,
        line.from + Math.max(0, pendingSearchTarget.column),
      );
      view.dispatch({
        selection: { anchor },
        scrollIntoView: true,
      });
      view.focus();
      setPendingSearchTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFile.id, pendingSearchTarget]);

  useEffect(() => {
    const references = workbook.assets ?? [];
    if (!references.length) {
      setRuntimeAssets([]);
      setAssetDiagnostics([]);
      return;
    }
    let active = true;
    setRuntimeAssets([]);
    setAssetDiagnostics([]);
    void loadCodeRuntimeAssets(artifactId, references)
      .then(({ assets: prepared, diagnostics }) => {
        if (!active) return;
        setRuntimeAssets(prepared);
        setAssetDiagnostics(diagnostics);
      })
      .catch(() => {
        if (!active) return;
        setRuntimeAssets([]);
        setAssetDiagnostics([
          "Permission-bound assets are temporarily unavailable. Source remains intact.",
        ]);
      });
    return () => {
      active = false;
    };
    // assetReferenceKey deliberately makes immutable reference changes the reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, assetReferenceKey]);

  useEffect(() => {
    if (!pendingImportVersion || !synchronizationReady) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        void postSpectra<{ versionId: string }>({
          action: "createArtifactImportVersion",
          artifactId,
          importJobId: pendingImportVersion.jobId,
        })
          .then(() => {
            if (active) setPendingImportVersion(null);
          })
          .catch(() => {
            if (!active) return;
            if (pendingImportVersion.attempt < 2) {
              setPendingImportVersion({
                jobId: pendingImportVersion.jobId,
                attempt: pendingImportVersion.attempt + 1,
              });
            } else {
              setPendingImportVersion(null);
              setImportReport((current) =>
                current
                  ? {
                      ...current,
                      warnings: [
                        ...current.warnings,
                        "The imported state is live, but its dedicated import history entry is still pending.",
                      ],
                    }
                  : current,
              );
            }
          });
      },
      1_200 * (pendingImportVersion.attempt + 1),
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [artifactId, pendingImportVersion, synchronizationReady]);

  useEffect(() => {
    if (
      readOnly ||
      !synchronizationReady ||
      importReconciliationStartedRef.current
    )
      return;
    importReconciliationStartedRef.current = true;
    let active = true;
    const timers: number[] = [];
    const reconcile = (attempt: number) => {
      const timer = window.setTimeout(
        () => {
          void postSpectra<{ reconciled: number }>({
            action: "reconcileArtifactImportVersions",
            artifactId,
          }).catch(() => {
            if (active && attempt < 2) reconcile(attempt + 1);
          });
        },
        attempt === 0 ? 800 : 1_500 * (attempt + 1),
      );
      timers.push(timer);
    };
    reconcile(0);
    return () => {
      active = false;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [artifactId, readOnly, synchronizationReady]);

  useEffect(() => {
    const incomingKey = codeContentKey(incoming);
    const currentKey = codeContentKey(workbook);
    if (incomingKey === currentKey) {
      if (incomingKey === lastEmittedKeyRef.current)
        lastEmittedKeyRef.current = null;
      return;
    }
    // React may commit our local draft before the parent has echoed the new
    // artifact value. Do not let that one-render lag restore stale source.
    if (lastEmittedKeyRef.current && currentKey === lastEmittedKeyRef.current)
      return;
    if (incomingKey === lastEmittedKeyRef.current) {
      lastEmittedKeyRef.current = null;
    }
    setWorkbook(incoming);
    setActiveFileId((current) =>
      incoming.files.some((file) => file.id === current)
        ? current
        : incoming.entryFileId,
    );
    setPreviewFiles(null);
    setRunState("idle");
  }, [incoming, workbook]);

  useEffect(() => () => pythonRunRef.current?.cancel(), []);

  // Follow AI: a reveal request names a file path; open that file so the
  // scroll-reveal that follows lands on the exact line.
  useEffect(() => {
    function onReveal(detail: { workId: string; path?: string }) {
      if (detail.workId !== artifactId || !detail.path) return;
      const match = /^\/files\/(\d+)/.exec(detail.path);
      if (!match) return;
      const file = workbook.files[Number(match[1])];
      if (file && file.id !== activeFileId) setActiveFileId(file.id);
    }
    return spectraBus.handle("work.reveal", onReveal);
  }, [artifactId, activeFileId, workbook.files]);

  // Spectra can publish or take down the build too; show what it did.
  const [publishedRevision, setPublishedRevision] = useState(0);
  useEffect(
    () =>
      spectraBus.on("code.publishedChanged", (detail) => {
        if (detail.artifactId === artifactId) setPublishedRevision((value) => value + 1);
      }),
    [artifactId],
  );

  useEffect(() => {
    let current = true;
    setPublishState("loading");
    setPublishError(null);
    void getPublishedCodeBuild(artifactId)
      .then((result) => {
        if (!current) return;
        setPublishedBuild(result.build);
        setPublishedContentKey(
          result.build && result.sourceMatchesCurrent
            ? codeContentKey(incomingRef.current)
            : null,
        );
      })
      .catch((error) => {
        if (!current) return;
        setPublishError(
          error instanceof Error
            ? error.message
            : "Published runtime state is unavailable.",
        );
      })
      .finally(() => {
        if (current) setPublishState("idle");
      });
    return () => {
      current = false;
    };
  }, [artifactId, publishedRevision]);

  // The workbook as it is now. An asset upload or import finishes after an
  // await, when the render that started it holds a stale workbook; building
  // on that would silently revert every edit made meanwhile.
  const workbookRef = useRef(workbook);
  workbookRef.current = workbook;

  const emit = useCallback(
    (next: CodeContent) => {
      workbookRef.current = next;
      setWorkbook(next);
      lastEmittedKeyRef.current = codeContentKey(next);
      onChange(next);
    },
    [onChange],
  );

  const mutate = useCallback(
    (recipe: (draft: CodeContent) => void) => {
      if (readOnly) return;
      const draft = structuredClone(workbookRef.current);
      recipe(draft);
      emit(draft);
    },
    [emit, readOnly],
  );

  const appendConsole = useCallback(
    (level: ConsoleEntry["level"], text: string) => {
      setConsoleEntries((current) =>
        [
          ...current,
          { id: uid("console"), level, text, createdAt: Date.now() },
        ].slice(-MAX_CONSOLE_ENTRIES),
      );
    },
    [],
  );

  const recordTestOutput = useCallback((text: string) => {
    const match = /^\[spectra-test:(pass|fail)\]\s+(\S+)(?:\s+(.*))?$/.exec(
      text.trim(),
    );
    if (!match) return false;
    const [, outcome, testId, remainder = ""] = match;
    setTestResults((current) =>
      current.map((result) =>
        result.id === testId
          ? {
              ...result,
              status: outcome === "pass" ? "passed" : "failed",
              ...(outcome === "fail" && remainder
                ? { message: remainder }
                : {}),
            }
          : result,
      ),
    );
    return true;
  }, []);

  function updateActiveSource(source: string) {
    if (activeSharedText) {
      // yCollab already wrote a typed edit to the file's Y.Text. Keep only the
      // local runtime/preview projection current; emitting the whole project
      // through onChange would overwrite concurrent files on every keystroke.
      // A change made outside the editor (Format) is not in the Y.Text yet,
      // and a metadata save never replays file text, so write it here.
      if (activeSharedText.toString() !== source)
        activeSharedText.doc?.transact(() =>
          replaceYText(activeSharedText, source),
        );
      setWorkbook((current) => {
        const next = structuredClone(current);
        const file = next.files.find(
          (candidate) => candidate.id === activeFile.id,
        );
        if (!file) return current;
        file.lineIds = reconcileLineIds(file.source, file.lineIds, source);
        file.source = source;
        return next;
      });
      return;
    }
    mutate((draft) => {
      const file = draft.files.find(
        (candidate) => candidate.id === activeFile.id,
      );
      if (!file) return;
      file.lineIds = reconcileLineIds(file.source, file.lineIds, source);
      file.source = source;
    });
  }

  function createFile() {
    if (!newFilePath.trim()) return;
    try {
      const path = normalizeCodePath(newFilePath);
      if (
        workbook.files.some(
          (file) => file.path.toLowerCase() === path.toLowerCase(),
        )
      )
        throw new Error("A file with this path already exists.");
      const id = uid("file");
      mutate((draft) =>
        draft.files.push({
          id,
          path,
          language: languageForPath(path),
          source: "",
          lineIds: [`${id}:line:1`],
        }),
      );
      setActiveFileId(id);
      setNewFilePath("");
      setNewFileOpen(false);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "This file could not be created.",
      );
    }
  }

  function renameFile() {
    const id = renamingFileId;
    if (!id) return;
    try {
      const path = normalizeCodePath(renameDraft);
      if (
        workbook.files.some(
          (file) =>
            file.id !== id && file.path.toLowerCase() === path.toLowerCase(),
        )
      )
        throw new Error("A file with this path already exists.");
      mutate((draft) => {
        const file = draft.files.find((candidate) => candidate.id === id);
        if (!file) return;
        file.path = path;
        file.language = languageForPath(path);
      });
      setRenamingFileId(null);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "This file could not be renamed.",
      );
    }
  }

  function deleteFile() {
    if (!deleteFileId || workbook.files.length === 1) return;
    const nextFiles = workbook.files.filter((file) => file.id !== deleteFileId);
    const nextEntry =
      workbook.entryFileId === deleteFileId
        ? preferredEntry(nextFiles, workbook.runtime).id
        : workbook.entryFileId;
    mutate((draft) => {
      draft.files = draft.files.filter((file) => file.id !== deleteFileId);
      draft.entryFileId = nextEntry;
    });
    if (activeFileId === deleteFileId) setActiveFileId(nextEntry);
    setDeleteFileId(null);
  }

  function duplicateFile(id: string) {
    const source = workbook.files.find((file) => file.id === id);
    if (!source || readOnly) return;
    const dot = source.path.lastIndexOf(".");
    const stem = dot > 0 ? source.path.slice(0, dot) : source.path;
    const extension = dot > 0 ? source.path.slice(dot) : "";
    let path = `${stem}-copy${extension}`;
    let attempt = 2;
    while (
      workbook.files.some(
        (file) => file.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      path = `${stem}-copy-${attempt}${extension}`;
      attempt += 1;
    }
    const nextId = uid("file");
    mutate((draft) =>
      draft.files.push({
        id: nextId,
        path,
        language: languageForPath(path),
        source: source.source,
        lineIds: reconcileLineIds("", undefined, source.source),
        ...(source.mediaType ? { mediaType: source.mediaType } : {}),
      }),
    );
    setActiveFileId(nextId);
  }

  function setEntryFile(id: string) {
    if (readOnly || workbook.entryFileId === id) return;
    mutate((draft) => {
      draft.entryFileId = id;
    });
  }

  function openNewFile() {
    if (readOnly) return;
    setFileRailPreference("open");
    setRenamingFileId(null);
    setNewFilePath("");
    setNewFileOpen(true);
  }

  function startRenameFile(file: CodeFile) {
    if (readOnly) return;
    setFileRailPreference("open");
    setNewFileOpen(false);
    setRenameDraft(file.path);
    setRenamingFileId(file.id);
  }

  function submitFilePathForm() {
    if (renamingFileId) renameFile();
    else createFile();
  }

  function closeFilePathForm() {
    setNewFileOpen(false);
    setRenamingFileId(null);
  }

  async function formatActiveFile() {
    const parser = parserFor(activeFile);
    if (!parser || readOnly) return;
    setFormatting(true);
    setImportError(null);
    try {
      const [
        { format },
        babel,
        estree,
        typescript,
        htmlPlugin,
        postcss,
        markdownPlugin,
      ] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
        import("prettier/plugins/typescript"),
        import("prettier/plugins/html"),
        import("prettier/plugins/postcss"),
        import("prettier/plugins/markdown"),
      ]);
      const source = await format(activeFile.source, {
        parser,
        plugins: [
          babel,
          estree,
          typescript,
          htmlPlugin,
          postcss,
          markdownPlugin,
        ],
        tabWidth: 2,
        semi: true,
        singleQuote: false,
      });
      updateActiveSource(source.trimEnd() + "\n");
      appendConsole("system", `Formatted ${activeFile.path}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Formatting failed.";
      setProblems([
        {
          id: uid("problem"),
          severity: "error",
          message,
          file: activeFile.path,
        },
      ]);
      setPanel("problems");
    } finally {
      setFormatting(false);
    }
  }

  function setRuntime(runtime: CodeRuntime) {
    mutate((draft) => {
      draft.runtime = runtime;
      if (runtime === "python" || runtime === "none") {
        draft.networkPolicy = { mode: "none" };
      }
      if (runtime !== "react") draft.dependencies = {};
      draft.entryFileId = preferredEntry(draft.files, runtime).id;
      draft.preview = {
        ...draft.preview,
        autoRun:
          runtime === "python" ? false : draft.preview?.autoRun !== false,
      };
    });
    setActiveFileId(preferredEntry(workbook.files, runtime).id);
    stopRun("Runtime changed. Run the new profile when ready.");
  }

  const stopRun = useCallback(
    (message = "Run cancelled. The source was not changed.") => {
      runSequenceRef.current += 1;
      pythonRunRef.current?.cancel();
      pythonRunRef.current = null;
      finishRunningTests(message);
      setRunState("cancelled");
      setRunMessage(message);
    },
    [finishRunningTests],
  );

  const handlePythonEvent = useCallback(
    (event: PythonRuntimeEvent, sequence: number) => {
      if (sequence !== runSequenceRef.current) return;
      if (event.type === "status") {
        setRunState(event.status);
        setRunMessage(
          event.status === "loading"
            ? "Loading the local isolated Python runtime…"
            : "Running Python without network access…",
        );
      } else if (event.type === "stdout" || event.type === "stderr") {
        if (event.type === "stdout") recordTestOutput(event.text);
        appendConsole(event.type === "stderr" ? "error" : "log", event.text);
      } else if (event.type === "render") {
        setPreviewFiles([
          {
            id: uid("preview"),
            path: "index.html",
            language: "html",
            source: event.html,
          },
        ]);
        setPreviewNonce((value) => value + 1);
      } else if (event.type === "chart") {
        try {
          setPreviewFiles([
            {
              id: uid("preview"),
              path: "index.html",
              language: "html",
              source: pythonChartToHtml(event.spec),
            },
          ]);
          setPreviewNonce((value) => value + 1);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "The chart is invalid.";
          setProblems((current) => [
            ...current,
            { id: uid("problem"), severity: "error", message },
          ]);
          appendConsole("error", message);
        }
      } else if (event.type === "complete") {
        if (event.result) appendConsole("info", event.result);
        setRunState("ready");
        setRunMessage("Python run completed in the isolated worker.");
        pythonRunRef.current = null;
      } else if (event.type === "limit") {
        finishRunningTests(event.message);
        setRunState("limited");
        setRunMessage(event.message);
        setProblems((current) => [
          ...current,
          { id: uid("problem"), severity: "error", message: event.message },
        ]);
        setPanel("problems");
        pythonRunRef.current = null;
      } else if (event.type === "error") {
        finishRunningTests(event.message);
        setRunState("error");
        setRunMessage(event.message);
        appendConsole("error", event.traceback || event.message);
        setProblems((current) => [
          ...current,
          {
            id: uid("problem"),
            severity: "error",
            message: event.message,
            file: activeFile.path,
          },
        ]);
        setPanel("problems");
        pythonRunRef.current = null;
      }
    },
    [activeFile.path, appendConsole, finishRunningTests, recordTestOutput],
  );

  const run = useCallback(
    async (includeTests = false) => {
      const enabledTests = (workbook.tests ?? []).filter(
        (test) => test.enabled !== false,
      );
      if (includeTests && enabledTests.length === 0) {
        setPanel("tests");
        setTestResults([]);
        return;
      }
      if (workbook.runtime === "none") {
        setRunState("idle");
        setRunMessage(
          "This code has no runtime yet. Choose a supported runtime to run it.",
        );
        return;
      }
      const sequence = runSequenceRef.current + 1;
      runSequenceRef.current = sequence;
      pythonRunRef.current?.cancel();
      pythonRunRef.current = null;
      setProblems(
        assetDiagnostics.map((message, index) => ({
          id: `asset:${index}`,
          severity: "error" as const,
          message,
        })),
      );
      setConsoleEntries([]);
      setTestResults(
        includeTests
          ? enabledTests.map((test) => ({
              id: test.id,
              name: test.name,
              status: "running",
            }))
          : [],
      );
      if (includeTests) setPanel("tests");
      setA11y(null);
      setPreviewFiles(null);
      setPreviewTests([]);
      setRunState("building");
      setRunMessage(
        workbook.runtime === "react"
          ? "Bundling the React preview…"
          : workbook.runtime === "python"
            ? "Preparing the isolated Python worker…"
            : "Preparing the browser sandbox…",
      );
      if (workbook.runtime === "browser") {
        try {
          const response = await requestSpectra("/api/spectra/runtime/build", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runtime: "browser",
              entryFileId: workbook.entryFileId,
              files: workbook.files,
            }),
          });
          const payload = (await response.json().catch(() => null)) as {
            build?: {
              files: CodeFile[];
              sourceBytes: number;
              outputBytes: number;
            };
            errors?: Array<{
              message: string;
              file?: string;
              line?: number;
              column?: number;
            }>;
            error?: { message?: string } | string;
          } | null;
          if (sequence !== runSequenceRef.current) return;
          if (!response.ok || !payload?.build) {
            const issues = payload?.errors?.length
              ? payload.errors
              : [
                  {
                    message:
                      typeof payload?.error === "string"
                        ? payload.error
                        : payload?.error?.message ||
                          "The browser source could not be prepared safely.",
                  },
                ];
            setProblems([
              ...assetDiagnostics.map((message, index) => ({
                id: `asset:${index}`,
                severity: "error" as const,
                message,
              })),
              ...issues.map((issue) => ({
                id: uid("problem"),
                severity: "error" as const,
                ...issue,
              })),
            ]);
            finishRunningTests(issues[0]!.message);
            setRunState("error");
            setRunMessage(issues[0]!.message);
            setPanel("problems");
            return;
          }
          setPreviewTests(includeTests ? enabledTests : []);
          setPreviewFiles(payload.build.files);
          appendConsole(
            "system",
            `Prepared ${formatBytes(payload.build.sourceBytes)} of browser source with synchronous-loop guards.`,
          );
          setPreviewNonce((value) => value + 1);
          setRunState("loading");
        } catch (error) {
          if (sequence !== runSequenceRef.current) return;
          const message =
            error instanceof Error
              ? error.message
              : "The browser build service could not be reached.";
          setProblems([
            ...assetDiagnostics.map((diagnostic, index) => ({
              id: `asset:${index}`,
              severity: "error" as const,
              message: diagnostic,
            })),
            { id: uid("problem"), severity: "error", message },
          ]);
          finishRunningTests(message);
          setRunState("error");
          setRunMessage(message);
          setPanel("problems");
        }
        return;
      }
      if (workbook.runtime === "python") {
        try {
          pythonRunRef.current = runPythonInIsolatedWorker({
            files: workbook.files,
            entryFileId: workbook.entryFileId,
            resources: runtimeResources,
            parameters: runtimeParameters,
            assets: runtimeAssets,
            additionalSource: includeTests
              ? pythonTestSource(enabledTests)
              : "",
            onEvent: (event) => handlePythonEvent(event, sequence),
          });
        } catch (error) {
          handlePythonEvent(
            {
              type: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Python could not start.",
            },
            sequence,
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
            entryFileId: workbook.entryFileId,
            files: workbook.files,
            dependencies: workbook.dependencies ?? {},
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          build?: {
            js: string;
            css: string;
            sourceBytes: number;
            outputBytes: number;
          };
          warnings?: Array<{
            message: string;
            file?: string;
            line?: number;
            column?: number;
          }>;
          errors?: Array<{
            message: string;
            file?: string;
            line?: number;
            column?: number;
          }>;
          error?: { message?: string } | string;
        };
        if (sequence !== runSequenceRef.current) return;
        if (!response.ok || !payload.build) {
          const issues = payload.errors?.length
            ? payload.errors
            : [
                {
                  message:
                    typeof payload.error === "string"
                      ? payload.error
                      : payload.error?.message || "The React build failed.",
                },
              ];
          setProblems([
            ...assetDiagnostics.map((message, index) => ({
              id: `asset:${index}`,
              severity: "error" as const,
              message,
            })),
            ...issues.map((issue) => ({
              id: uid("problem"),
              severity: "error" as const,
              ...issue,
            })),
          ]);
          finishRunningTests(issues[0]?.message ?? "The React build failed.");
          setRunState("error");
          setRunMessage(issues[0]?.message ?? "The React build failed.");
          setPanel("problems");
          return;
        }
        const warningRows = (payload.warnings ?? []).map((issue) => ({
          id: uid("problem"),
          severity: "warning" as const,
          ...issue,
        }));
        setProblems([
          ...assetDiagnostics.map((message, index) => ({
            id: `asset:${index}`,
            severity: "error" as const,
            message,
          })),
          ...warningRows,
        ]);
        setPreviewTests(includeTests ? enabledTests : []);
        setPreviewFiles([
          {
            id: uid("preview"),
            path: "index.html",
            language: "html",
            source: '<main id="root"></main>',
          },
          {
            id: uid("preview"),
            path: "spectra-build.css",
            language: "css",
            source: payload.build.css,
          },
          {
            id: uid("preview"),
            path: "spectra-build.js",
            language: "javascript",
            source: payload.build.js,
          },
        ]);
        appendConsole(
          "system",
          `Built ${formatBytes(payload.build.sourceBytes)} of source into a ${formatBytes(payload.build.outputBytes)} isolated browser bundle.`,
        );
        setPreviewNonce((value) => value + 1);
        setRunState("loading");
        setRunMessage("Starting the isolated React preview…");
      } catch (error) {
        if (sequence !== runSequenceRef.current) return;
        const message =
          error instanceof Error
            ? error.message
            : "The React build could not be reached.";
        setProblems([
          ...assetDiagnostics.map((diagnostic, index) => ({
            id: `asset:${index}`,
            severity: "error" as const,
            message: diagnostic,
          })),
          { id: uid("problem"), severity: "error", message },
        ]);
        finishRunningTests(message);
        setRunState("error");
        setRunMessage(message);
        setPanel("problems");
      }
    },
    [
      appendConsole,
      assetDiagnostics,
      finishRunningTests,
      handlePythonEvent,
      runtimeParameters,
      runtimeResources,
      runtimeAssets,
      workbook,
    ],
  );

  useEffect(() => {
    if (
      !canExecute ||
      workbook.preview?.autoRun === false ||
      workbook.runtime === "python" ||
      workbook.runtime === "none"
    )
      return;
    const timer = window.setTimeout(() => void run(), 850);
    return () => window.clearTimeout(timer);
  }, [canExecute, run, workbook.preview?.autoRun, workbook.runtime]);

  async function handleSandboxEvent(event: SpectraSandboxFrameMessage) {
    if (event.type === "spectra:console") {
      const text = event.values.join(" ");
      recordTestOutput(text);
      appendConsole(event.level, text);
    } else if (event.type === "spectra:test") {
      setTestResults((current) =>
        current.map((result) =>
          result.id === event.testId
            ? {
                ...result,
                status: event.status,
                ...(event.message ? { message: event.message } : {}),
              }
            : result,
        ),
      );
      appendConsole(
        event.status === "passed" ? "info" : "error",
        `${event.status === "passed" ? "Passed" : "Failed"} ${event.name} · ${event.durationMs} ms${event.message ? ` · ${event.message}` : ""}`,
      );
    } else if (event.type === "spectra:error") {
      finishRunningTests(event.message);
      if (exportJob) {
        setExportError(event.message);
        setExportJob(null);
      }
      // The sandbox reports the line it threw on, but that line only maps back
      // to a source file when there is exactly one script to have thrown it.
      // Guessing otherwise would send someone to the wrong file, so with more
      // than one script the problem is recorded without a file.
      const scripts = workbook.files.filter(
        (file) => file.language === "javascript",
      );
      const attributed =
        event.code === "runtime_error" && event.line && scripts.length === 1
          ? scripts[0]
          : null;
      setProblems((current) => [
        ...current,
        {
          id: uid("problem"),
          severity: "error",
          message: event.message,
          ...(attributed ? { file: attributed.path } : {}),
          ...(event.line ? { line: event.line } : {}),
        },
      ]);
      appendConsole("error", event.message);
    } else if (event.type === "spectra:limit") {
      finishRunningTests(event.message);
      if (exportJob) {
        setExportError(event.message);
        setExportJob(null);
      }
      setProblems((current) => [
        ...current,
        { id: uid("problem"), severity: "error", message: event.message },
      ]);
    } else if (event.type === "spectra:interaction")
      appendConsole("info", `Interaction · ${event.name}`);
    else if (event.type === "spectra:a11y") {
      setA11y(event);
      setProblems((current) => [
        ...current.filter((problem) => !problem.id.startsWith("a11y:")),
        ...(!event.title
          ? [
              {
                id: "a11y:title",
                severity: "warning" as const,
                message:
                  "The rendered experience needs a descriptive document title.",
              },
            ]
          : []),
        ...(event.headingCount === 0
          ? [
              {
                id: "a11y:heading",
                severity: "warning" as const,
                message:
                  "The rendered experience needs a clear heading hierarchy.",
              },
            ]
          : []),
        ...(event.landmarkCount === 0
          ? [
              {
                id: "a11y:landmark",
                severity: "warning" as const,
                message:
                  "Wrap the primary experience in a semantic main landmark.",
              },
            ]
          : []),
        ...(event.imagesWithoutAlt > 0
          ? [
              {
                id: "a11y:image-alt",
                severity: "warning" as const,
                message: `${event.imagesWithoutAlt} rendered image${event.imagesWithoutAlt === 1 ? " is" : "s are"} missing an alt attribute. Use empty alt text for decorative images.`,
              },
            ]
          : []),
        ...(event.unnamedControls > 0
          ? [
              {
                id: "a11y:control-name",
                severity: "warning" as const,
                message: `${event.unnamedControls} interactive control${event.unnamedControls === 1 ? " has" : "s have"} no accessible name.`,
              },
            ]
          : []),
        ...(event.unlabelledGraphics > 0
          ? [
              {
                id: "a11y:graphic-name",
                severity: "warning" as const,
                message: `${event.unlabelledGraphics} chart or canvas surface${event.unlabelledGraphics === 1 ? " needs" : "s need"} an accessible name or text alternative.`,
              },
            ]
          : []),
        ...(event.headingOrderIssues > 0
          ? [
              {
                id: "a11y:heading-order",
                severity: "warning" as const,
                message: `${event.headingOrderIssues} heading level jump${event.headingOrderIssues === 1 ? " interrupts" : "s interrupt"} the rendered outline.`,
              },
            ]
          : []),
        ...(event.duplicateIds > 0
          ? [
              {
                id: "a11y:duplicate-id",
                severity: "warning" as const,
                message: `${event.duplicateIds} duplicate element ID${event.duplicateIds === 1 ? " can" : "s can"} break labels and keyboard targeting.`,
              },
            ]
          : []),
      ]);
    } else if (
      event.type === "spectra:export" &&
      exportJob &&
      event.requestId === exportJob.id
    ) {
      if (event.error || !event.data) {
        setExportError(
          event.error ?? "The rendered graphic could not be exported safely.",
        );
        setExportJob(null);
        return;
      }
      try {
        const name = safeFilename(title);
        if (exportJob.target === "svg") {
          downloadBlob(
            new Blob([event.data], { type: "image/svg+xml;charset=utf-8" }),
            `${name}.svg`,
          );
        } else if (exportJob.target === "png") {
          const blob = await fetch(event.data).then((response) =>
            response.blob(),
          );
          downloadBlob(blob, `${name}.png`);
        } else if (exportJob.target === "pdf") {
          const { jsPDF } = await import("jspdf");
          const width = Math.max(1, event.width ?? 1600);
          const height = Math.max(1, event.height ?? 900);
          const pdf = new jsPDF({
            orientation: width >= height ? "landscape" : "portrait",
            unit: "px",
            format: [width, height],
            hotfixes: ["px_scaling"],
          });
          pdf.addImage(
            event.data,
            "PNG",
            0,
            0,
            width,
            height,
            undefined,
            "FAST",
          );
          downloadBlob(pdf.output("blob"), `${name}.pdf`);
        } else {
          const blob = await fetch(event.data).then((response) =>
            response.blob(),
          );
          downloadBlob(blob, `${name}.webm`);
        }
      } catch (error) {
        setExportError(
          error instanceof Error ? error.message : "The visual export failed.",
        );
      } finally {
        setExportJob(null);
      }
    }
  }

  function requestVisualExport(target: "svg" | "png" | "pdf" | "webm") {
    if (!previewFiles || runState !== "ready") {
      setExportError(
        "Run a valid preview before exporting its rendered graphic.",
      );
      return;
    }
    setExportError(null);
    setExportJob({ id: uid("export"), target });
  }

  function handleRuntimeStatus(
    status: SpectraRuntimeStatus,
    message: string | null,
    diagnostics: string[],
  ) {
    if (diagnostics.length)
      setProblems((current) => [
        ...current.filter((problem) => problem.severity === "error"),
        ...diagnostics.map((diagnostic) => ({
          id: uid("problem"),
          severity: "warning" as const,
          message: diagnostic,
        })),
      ]);
    if (status === "ready") {
      setRunState("ready");
      setRunMessage("Preview is running in an isolated Spectra sandbox.");
    } else if (status === "error" || status === "limited") {
      finishRunningTests(
        message ?? "The preview stopped before all checks completed.",
      );
      setRunState(status);
      setRunMessage(
        message ?? "The preview stopped safely. Source remains unchanged.",
      );
      // A failure the reader cannot see is a failure the reader cannot fix, so
      // the panel that holds the detail opens itself.
      setPanel("problems");
    }
  }

  async function handleImport(files: FileList | null) {
    if (!files?.length || readOnly || importing) return;
    setImportError(null);
    setImporting(true);
    const selected = [...files];
    let importJobId: string | null = null;
    let originalRetained = false;
    try {
      const recovery = await createCodeImportRecoveryAsset(selected);
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "code",
        format: recovery.format,
        name: recovery.name,
        mimeType: recovery.mimeType,
        bytes: recovery.blob.size,
        sha256: await artifactBlobSha256(recovery.blob),
      });
      importJobId = beginning.jobId;
      try {
        await uploadArtifactImportOriginal(importJobId, recovery.blob);
        originalRetained = true;
      } catch (error) {
        await abortArtifactImportUpload(
          importJobId,
          error instanceof Error ? error.message : "Original upload failed.",
        ).catch(() => undefined);
        throw error;
      }
      const result = await importCodeFiles(selected);
      const importedAssetReferences: NonNullable<CodeContent["assets"]> = [];
      for (const asset of result.assets) {
        try {
          const blob = new Blob([asset.bytes.slice().buffer], {
            type: asset.mediaType,
          });
          const sha256 = await artifactBlobSha256(blob);
          const uploaded = await uploadArtifactAsset({
            artifactId,
            path: asset.path,
            name: asset.name,
            mediaType: asset.mediaType,
            sha256,
            blob,
          });
          importedAssetReferences.push({
            id: uid("asset-ref"),
            assetId: uploaded.assetId,
            path: asset.path,
            name: asset.name,
            mediaType: asset.mediaType,
            bytes: asset.bytes.byteLength,
            sha256,
          });
        } catch (error) {
          result.report.warnings.push(
            `${asset.path}: immutable asset staging failed (${error instanceof Error ? error.message : "upload unavailable"}); the exact original remains recoverable.`,
          );
        }
      }
      const entry =
        (result.entryPath &&
          result.files.find((file) => file.path === result.entryPath)) ||
        preferredEntry(result.files, result.report.runtime);
      const importedContent = normalizeCodeContent({
        ...workbook,
        runtime: result.report.runtime,
        entryFileId: entry.id,
        files: result.files,
        dependencies: result.dependencies,
        parameters: result.parameters,
        assets: importedAssetReferences,
        visualisation: result.visualisation ?? workbook.visualisation,
        networkPolicy: { mode: "none" },
        preview: {
          ...workbook.preview,
          autoRun:
            result.report.runtime !== "python" &&
            result.report.runtime !== "none",
        },
      });
      emit(importedContent);
      setActiveFileId(entry.id);
      const report = {
        ...result.report,
        warnings: [
          ...result.report.warnings,
          "The exact original import is retained privately for recovery.",
        ],
      };
      setPreviewFiles(null);
      setRunState("idle");
      const reportRecorded = await completeArtifactImport({
        jobId: importJobId,
        typeKey: "code",
        status: "imported",
        fidelityReport: [
          {
            scope: "Source tree",
            level: result.report.skipped.length
              ? "unsupported"
              : result.report.warnings.length
                ? "adapted"
                : "exact",
            message: `${result.report.imported} source file${result.report.imported === 1 ? "" : "s"} entered the live work.`,
          },
          ...(result.assets.length
            ? [
                {
                  scope: "Runtime assets",
                  level:
                    importedAssetReferences.length === result.assets.length
                      ? ("exact" as const)
                      : ("adapted" as const),
                  message: `${importedAssetReferences.length} of ${result.assets.length} supported media asset${result.assets.length === 1 ? "" : "s"} entered immutable storage.`,
                },
              ]
            : []),
          ...result.report.warnings.map((message) => ({
            scope: "Import adaptation",
            level: "adapted" as const,
            message,
          })),
          ...result.report.skipped.map((message) => ({
            scope: "Quarantined source",
            level: "unsupported" as const,
            message,
          })),
        ],
        unsupportedFeatures: result.report.skipped,
        importedContent,
      })
        .then(() => true)
        .catch(() => false);
      if (reportRecorded)
        setPendingImportVersion({ jobId: importJobId, attempt: 0 });
      setImportReport(
        reportRecorded
          ? report
          : {
              ...report,
              warnings: [
                ...report.warnings,
                "The source was imported, but its fidelity report is still pending. The retained original remains available.",
              ],
            },
      );
    } catch (error) {
      if (importJobId && originalRetained) {
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "code",
          status: "quarantined",
          fidelityReport: [
            {
              scope: "Import parser",
              level: "unsupported",
              message:
                error instanceof Error
                  ? error.message
                  : "The source could not be parsed.",
            },
          ],
          unsupportedFeatures: [],
          quarantineReason:
            error instanceof Error
              ? error.message
              : "The source could not be parsed.",
        }).catch(() => undefined);
      }
      setImportError(
        error instanceof Error
          ? error.message
          : "The source could not be imported.",
      );
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
      if (folderImportRef.current) folderImportRef.current.value = "";
    }
  }

  function pointerResize(event: React.PointerEvent<HTMLButtonElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function exportStandalonePreview() {
    if (!previewFiles) return;
    const output = buildSpectraSandboxDocument({
      files: previewFiles,
      channel: "spectra-standalone-export",
      initialTheme: readSpectraSandboxTheme(workbook.accessibility?.reducedMotion),
      title: workbook.visualisation.title || title,
      networkAllowlist:
        workbook.networkPolicy?.mode === "allowlist"
          ? workbook.networkPolicy.allowlist
          : undefined,
      initialParameters: runtimeParameters,
      assets: runtimeAssets,
    });
    if (!output.srcDoc) {
      setExportError(
        output.diagnostics[0] ??
          "The current preview cannot be exported safely.",
      );
      return;
    }
    downloadBlob(
      new Blob([output.srcDoc], { type: "text/html;charset=utf-8" }),
      `${safeFilename(title)}.html`,
    );
  }

  function exportSourceArchive() {
    const loadedIds = new Set(runtimeAssets.map((asset) => asset.id));
    const unavailable = (workbook.assets ?? []).filter(
      (reference) => !loadedIds.has(reference.id),
    );
    if (unavailable.length || assetDiagnostics.length) {
      const names = unavailable
        .slice(0, 3)
        .map((reference) => reference.path)
        .join(", ");
      setExportError(
        `The source archive was not created because ${unavailable.length || assetDiagnostics.length} referenced asset${unavailable.length === 1 ? " is" : "s are"} unavailable${names ? `: ${names}` : ""}. Reattach or remove the reference so the export remains complete.`,
      );
      return;
    }
    try {
      setExportError(null);
      downloadBlob(
        exportCodeArchive(workbook, title, runtimeAssets),
        `${safeFilename(title)}.zip`,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "The complete source archive could not be created.",
      );
    }
  }

  async function publishRuntime() {
    if (readOnly || publishState !== "idle") return;
    if (!synchronizationReady) {
      setPublishError(
        "Wait for your latest edits to finish saving before publishing.",
      );
      return;
    }
    if (workbook.runtime === "none") {
      setPublishError(
        "Choose a runtime that can run this code before publishing it.",
      );
      return;
    }
    if (workbook.visualisation.enabled) {
      if (runState !== "ready" || !previewFiles) {
        setPublishError(
          "Run the current visualisation successfully before publishing it.",
        );
        return;
      }
      if (
        !workbook.accessibility?.title?.trim() ||
        !workbook.accessibility?.description?.trim()
      ) {
        setPublishError(
          "Add an accessible title and text alternative in Settings before publishing this visualisation.",
        );
        return;
      }
      if (
        !a11y ||
        a11y.headingCount === 0 ||
        a11y.landmarkCount === 0 ||
        a11y.imagesWithoutAlt > 0 ||
        a11y.unnamedControls > 0 ||
        a11y.unlabelledGraphics > 0 ||
        a11y.headingOrderIssues > 0 ||
        a11y.duplicateIds > 0
      ) {
        setPublishError(
          "Resolve the rendered accessibility problems in the Problems panel before publishing.",
        );
        return;
      }
    }
    setPublishState("publishing");
    setPublishError(null);
    try {
      const expectedSourceHash = await runtimeSourceHash(workbook);
      const result = await publishCodeBuild(artifactId, expectedSourceHash);
      setPublishedBuild(result.build);
      setPublishedContentKey(codeContentKey(workbook));
      appendConsole(
        "system",
        result.reused
          ? "The current reproducible runtime build is already published."
          : "Published a build of this exact version.",
      );
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? error.message
          : "The runtime build could not be published.",
      );
    } finally {
      setPublishState("idle");
    }
  }

  async function unpublishRuntime() {
    if (readOnly || !publishedBuild || publishState !== "idle") return;
    setPublishState("unpublishing");
    setPublishError(null);
    try {
      await unpublishCodeBuild(artifactId);
      setPublishedBuild(null);
      setPublishedContentKey(null);
      appendConsole(
        "system",
        "Removed the live published build. Existing pinned embeds retain their checkpointed build.",
      );
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? error.message
          : "The runtime build could not be unpublished.",
      );
    } finally {
      setPublishState("idle");
    }
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || workbook.preview?.orientation === "vertical")
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setSplitPercent(
      Math.max(
        30,
        Math.min(70, ((event.clientX - bounds.left) / bounds.width) * 100),
      ),
    );
  }

  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "12px",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
          lineHeight: "1.7",
          overflow: "auto",
        },
        ".cm-content": { padding: "14px 0 30px" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "0",
          color: "color-mix(in oklab, var(--text-tertiary) 70%, transparent)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor:
            "color-mix(in oklab, var(--accent-cyan) 5%, transparent)",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor:
            "color-mix(in oklab, var(--accent-cyan) 18%, transparent)",
        },
        ".cm-cursor": { borderLeftColor: "var(--accent-cyan)" },
        ".cm-search": {
          backgroundColor: "var(--bg-elevated)",
          border: "0",
          borderBottom: "1px solid var(--border-default)",
          color: "var(--text-primary)",
        },
        // A failing line is marked where it fails, in the same tones the output
        // panel uses for the same severity.
        ".cm-lintRange-error": {
          backgroundImage: "none",
          borderBottom: "2px solid var(--danger)",
        },
        ".cm-lintRange-warning": {
          backgroundImage: "none",
          borderBottom: "2px solid var(--warning)",
        },
        ".cm-lintRange-info": {
          backgroundImage: "none",
          borderBottom: "2px solid var(--accent-cyan)",
        },
        ".cm-diagnostic": {
          borderLeft: "3px solid transparent",
          padding: "5px 8px",
          fontFamily: "inherit",
          whiteSpace: "pre-wrap",
        },
        ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
        ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
        ".cm-diagnostic-info": { borderLeftColor: "var(--accent-cyan)" },
      }),
    [],
  );
  /**
   * Tab indents, Shift-Tab outdents, and Escape hands the next Tab back to the
   * page so the editor cannot trap a keyboard user.
   */
  const keyboardExtension = useMemo(
    () =>
      keymap.of([
        indentWithTab,
        {
          key: "Escape",
          run: (view) => {
            view.setTabFocusMode(2000);
            return false;
          },
        },
      ]),
    [],
  );
  const activeProblems = useMemo(
    () =>
      problems.filter(
        (problem) =>
          problem.file === activeFile.path &&
          typeof problem.line === "number" &&
          problem.line > 0,
      ),
    [problems, activeFile.path],
  );
  /**
   * Problems that name a line are drawn on that line. The build service and the
   * sandbox are the only sources — nothing here invents a diagnostic of its own.
   */
  const diagnosticsExtension = useMemo(
    () =>
      linter(
        (view) =>
          activeProblems.map<Diagnostic>((problem) => {
            const line = view.state.doc.line(
              Math.max(1, Math.min(problem.line!, view.state.doc.lines)),
            );
            return {
              from:
                problem.column === undefined
                  ? line.from
                  : Math.min(line.to, line.from + Math.max(0, problem.column)),
              to: line.to,
              severity:
                problem.severity === "warning"
                  ? "warning"
                  : problem.severity === "info"
                    ? "info"
                    : "error",
              message: problem.message,
            };
          }),
        { delay: 60 },
      ),
    [activeProblems],
  );
  const presenceExtension = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.focusChanged) return;
        const lineNumber = update.state.doc.lineAt(
          update.state.selection.main.head,
        ).number;
        const regionId = activeFile.lineIds?.[lineNumber - 1] ?? activeFile.id;
        onActiveRegionChange?.(regionId);
      }),
    [activeFile.id, activeFile.lineIds, onActiveRegionChange],
  );
  const aiLineExtension = useMemo(() => {
    if (!activeAiLineIndexes.length) return [];
    const ranges = activeAiLineIndexes.flatMap((lineIndex) => {
      const lineNumber = lineIndex + 1;
      const lines = activeFile.source.split(/\r?\n/);
      if (lineNumber > lines.length) return [];
      let from = 0;
      for (let index = 0; index < lineIndex; index += 1)
        from += lines[index]!.length + 1;
      return [
        Decoration.line({
          attributes: {
            "data-ai-region": "true",
            "data-ai-code-line": String(lineNumber),
          },
          class: "cm-aiLine",
        }).range(from),
      ];
    });
    return EditorView.decorations.of(Decoration.set(ranges));
  }, [activeAiLineIndexes, activeFile.source]);

  const preview = (
    <div className="code-preview-surface relative flex min-h-0 flex-1 flex-col bg-transparent">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3">
        {/* When the run failed, the status line is the way into the detail:
            without it, the Visualisation view can report a failure it gives you
            no route to read. */}
        {runState === "error" || runState === "limited" ? (
          <button
            type="button"
            onClick={() => {
              setFullPreview(false);
              if (surface !== "split" && surface !== "code")
                setSurface("split");
              setPanel("problems");
            }}
            className="flex min-w-0 items-center gap-2 rounded-chip px-1 text-left hover:bg-[var(--bg-hover)]"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]" />
            <span className="truncate text-micro font-medium text-[var(--text-primary)]">
              {runMessage}
            </span>
            <span className="shrink-0 text-micro text-[var(--text-secondary)] underline">
              Show problems
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${runState === "ready" ? "bg-[var(--success)]" : runState === "loading" || runState === "running" || runState === "building" ? "animate-pulse bg-[var(--accent-cyan)] motion-reduce:animate-none" : "bg-[var(--text-tertiary)]"}`}
            />
            <span className="truncate text-micro font-medium text-[var(--text-primary)]">
              {runMessage}
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {canExecute ? (
            runState === "building" ||
            runState === "loading" ||
            runState === "running" ? (
              <button
                type="button"
                onClick={() => stopRun()}
                className="code-icon-action"
                aria-label="Stop run"
                title="Stop run"
              >
                <CircleStop className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void run()}
                className="code-icon-action"
                aria-label="Run preview again"
                title="Run preview again"
                disabled={workbook.runtime === "none"}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={() => setFullPreview(true)}
            className="code-icon-action"
            aria-label="Open full preview"
            title="Open full preview"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="relative min-h-[360px] flex-1 overflow-auto p-2 sm:min-h-[520px]">
        {previewFiles ? (
          <SandboxedArtifactRuntime
            key={previewNonce}
            title={
              workbook.accessibility?.title ||
              workbook.visualisation.title ||
              title
            }
            description={
              workbook.accessibility?.description ||
              workbook.visualisation.description
            }
            files={previewFiles}
            tests={previewTests}
            assets={runtimeAssets}
            resources={runtimeResources}
            parameters={runtimeParameters}
            exportRequest={
              exportJob
                ? {
                    id: exportJob.id,
                    format:
                      exportJob.target === "webm"
                        ? "webm"
                        : exportJob.target === "svg"
                          ? "svg"
                          : "png",
                  }
                : null
            }
            forceReducedMotion={workbook.accessibility?.reducedMotion === true}
            networkAllowlist={
              workbook.networkPolicy?.mode === "allowlist"
                ? workbook.networkPolicy.allowlist
                : undefined
            }
            compact={false}
            toolbar={false}
            viewportHeight={workbook.preview?.height ?? 580}
            className="min-h-full border-0 shadow-none"
            onEvent={handleSandboxEvent}
            onStatusChange={handleRuntimeStatus}
          />
        ) : runState === "building" ||
          runState === "loading" ||
          runState === "running" ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)] motion-reduce:animate-none" />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-primary)] disabled:opacity-45"
              onClick={() => void run()}
              disabled={!canExecute || workbook.runtime === "none"}
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </button>
          </div>
        )}
      </div>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] px-3 py-2 text-micro text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
          {workbook.runtime === "python" ||
          workbook.networkPolicy?.mode !== "allowlist"
            ? "Network off"
            : `${normalizeCodeNetworkOrigins(workbook.networkPolicy.allowlist).length} HTTPS ${normalizeCodeNetworkOrigins(workbook.networkPolicy.allowlist).length === 1 ? "origin" : "origins"}`}
        </span>
        {a11y ? (
          <>
            <span className="inline-flex items-center gap-1">
              {a11y.imagesWithoutAlt +
                a11y.unnamedControls +
                a11y.unlabelledGraphics +
                a11y.headingOrderIssues +
                a11y.duplicateIds ===
              0 ? (
                <CheckCircle2 className="h-3 w-3 text-[var(--success)]" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-[var(--warning)]" />
              )}
              {a11y.imagesWithoutAlt +
                a11y.unnamedControls +
                a11y.unlabelledGraphics +
                a11y.headingOrderIssues +
                a11y.duplicateIds ===
              0
                ? "Accessibility checks passed"
                : `${
                    a11y.imagesWithoutAlt +
                    a11y.unnamedControls +
                    a11y.unlabelledGraphics +
                    a11y.headingOrderIssues +
                    a11y.duplicateIds
                  } accessibility ${
                    a11y.imagesWithoutAlt +
                      a11y.unnamedControls +
                      a11y.unlabelledGraphics +
                      a11y.headingOrderIssues +
                      a11y.duplicateIds ===
                    1
                      ? "issue"
                      : "issues"
                  }`}
            </span>
            <span>{a11y.focusableCount} interactive controls</span>
            <span>{a11y.language || "No language declared"}</span>
          </>
        ) : null}
      </div>
    </div>
  );

  // The New file / Rename path form. The full surface shows it in the Files
  // rail; a side panel has no rail, so it opens above the editor instead.
  const filePathForm =
    newFileOpen || renamingFileId ? (
      <div className="mt-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] p-2">
        <label className="block text-micro font-semibold text-[var(--text-secondary)]">
          {renamingFileId ? "Rename path" : "New path"}
          <input
            autoFocus
            value={renamingFileId ? renameDraft : newFilePath}
            onChange={(event) =>
              renamingFileId
                ? setRenameDraft(event.target.value)
                : setNewFilePath(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") submitFilePathForm();
              if (event.key === "Escape")
                closeFilePathForm();
            }}
            placeholder="src/chart.tsx"
            className="mt-1 h-7 w-full rounded-control border border-[var(--border-default)] bg-transparent px-2 text-micro font-normal text-[var(--text-primary)] outline-none focus:border-[var(--accent-cyan)]"
          />
        </label>
        <div className="mt-1.5 flex justify-end gap-1">
          <button
            type="button"
            className="code-small-action"
            onClick={closeFilePathForm}
          >
            Cancel
          </button>
          <button
            type="button"
            className="code-small-action bg-[var(--text-primary)] text-[var(--bg-primary)]"
            onClick={submitFilePathForm}
          >
            {renamingFileId ? "Rename" : "Create"}
          </button>
        </div>
      </div>
    ) : null;
  const sourcePaneVisible = surface === "code" || surface === "split";
  const isFullscreen = contract.surface === "full";
  // Side-by-side Both is a fullscreen orientation. In the panel it must not
  // mount the visualisation at all — not beside the source, and not stacked
  // under it — or the preview's min-content blows the panel across the library.
  const splitPreviewOpen = surface === "split" && isFullscreen;
  const selectSurface = (next: CodeSurface) => {
    setSurface(next);
    setSettingsOpen(false);
    mutate((draft) => {
      draft.visualisation.openMode =
        next === "code" ? "source" : next === "preview" ? "preview" : "split";
    });
  };
  const panelModes: WorkbarModeSpec[] = [
    {
      id: "code",
      label: "Code",
      active: surface !== "preview",
      onSelect: () => {
        if (surface === "preview") selectSurface("code");
      },
    },
    {
      id: "visualisation",
      label: "Visualisation",
      active: surface === "preview",
      onSelect: () => selectSurface("preview"),
    },
  ];
  const editingSource = sourcePaneVisible && sourceMode === "code";
  const running =
    runState === "building" || runState === "loading" || runState === "running";
  const exportReady = Boolean(previewFiles) && runState === "ready";
  /**
   * Control grammar: modes lead, the active file is the context chip, tools sit
   * in the trail, the primary verb is last before `⋯`. Priorities are what the
   * bar sheds under pressure — an icon tool drops its label, the primary verb
   * keeps its own, and nothing is deleted from the surface at any width.
   */
  const workbarActions: CommandBinding[] = projectBindingsFromIr("code", [
    ...(sourcePaneVisible
      ? [
          {
            id: "controls",
            label: sourceMode === "parameters" ? "Source" : "Controls",
            icon: SlidersHorizontal,
            priority: "secondary" as const,
            active: sourceMode === "parameters",
            hint: "Edit the parameters a reader can change",
            onSelect: () =>
              setSourceMode(sourceMode === "code" ? "parameters" : "code"),
          },
        ]
      : []),
    ...(editingSource
      ? [
          ...(contract.surface === "full"
            ? [
                {
                  id: "files",
                  label: fileRailOpen ? "Hide files" : "Show files",
                  icon: FolderOpen,
                  priority: "essential" as const,
                  active: fileRailOpen,
                  onSelect: () =>
                    setFileRailPreference(fileRailOpen ? "closed" : "open"),
                },
              ]
            : []),
          {
            id: "find",
            label: "Find",
            icon: Search,
            priority: "essential" as const,
            onSelect: () => {
              const view = editorViewRef.current;
              if (!view) return;
              openSearchPanel(view);
              view.focus();
            },
          },
          ...(!readOnly
            ? [
                {
                  id: "file-new",
                  label: "New file",
                  icon: FilePlus2,
                  priority: "advanced" as const,
                  requires: "edit" as const,
                  onSelect: openNewFile,
                },
                {
                  id: "file-rename",
                  label: "Rename file",
                  icon: Pencil,
                  priority: "advanced" as const,
                  requires: "edit" as const,
                  onSelect: () => startRenameFile(activeFile),
                },
              ]
            : []),
          ...(!readOnly
            ? [
                {
                  id: "file-duplicate",
                  label: "Duplicate file",
                  icon: Copy,
                  priority: "advanced" as const,
                  requires: "edit" as const,
                  onSelect: () => duplicateFile(activeFile.id),
                },
                {
                  id: "file-entry",
                  label: "Set as entry file",
                  icon: Flag,
                  priority: "advanced" as const,
                  requires: "edit" as const,
                  disabled: workbook.entryFileId === activeFile.id,
                  hint:
                    workbook.entryFileId === activeFile.id
                      ? "This file is already the entry"
                      : "Run this file first",
                  onSelect: () => setEntryFile(activeFile.id),
                },
                {
                  id: "file-delete",
                  label: "Delete file",
                  icon: Trash2,
                  priority: "advanced" as const,
                  requires: "edit" as const,
                  disabled: workbook.files.length === 1,
                  hint:
                    workbook.files.length === 1
                      ? "Code needs at least one file"
                      : "Remove this file",
                  onSelect: () => setDeleteFileId(activeFile.id),
                },
              ]
            : []),
          ...(parserFor(activeFile)
            ? [
                {
                  id: "format",
                  label: "Format",
                  icon: formatting ? Loader2 : Sparkles,
                  priority: "secondary" as const,
                  disabled: readOnly || formatting,
                  requires: "edit" as const,
                  onSelect: () => void formatActiveFile(),
                },
              ]
            : []),
        ]
      : []),
    {
      id: "settings",
      label: "Settings",
      icon: Settings2,
      priority: "secondary" as const,
      active: settingsOpen,
      hint: "Runtime, access, and connections",
      onSelect: () => setSettingsOpen((open) => !open),
    },
    {
      id: "publish",
      label:
        publishState === "publishing"
          ? "Publishing"
          : publishedBuild && !publishedStale
            ? "Published"
            : publishedStale
              ? "Publish update"
              : "Publish",
      icon:
        publishState === "publishing"
          ? Loader2
          : publishedBuild && !publishedStale
            ? Check
            : CloudUpload,
      priority: "essential" as const,
      keepLabel: true,
      requires: "edit" as const,
      active: Boolean(publishedBuild && !publishedStale),
      disabled:
        publishState !== "idle" ||
        workbook.runtime === "none" ||
        !synchronizationReady ||
        Boolean(publishedBuild && !publishedStale),
      hint: !synchronizationReady
        ? "Available once live synchronization settles"
        : publishedBuild && !publishedStale
          ? "This source is the current published build"
          : publishedStale
            ? "Publish the latest source as a new retained build"
            : "Publish a retained runtime build",
      onSelect: () => void publishRuntime(),
    },
    {
      id: "import-files",
      label: "Import source or ZIP",
      icon: Import,
      priority: "advanced" as const,
      requires: "edit" as const,
      disabled: importing,
      onSelect: () => importRef.current?.click(),
    },
    {
      id: "import-folder",
      label: "Import source folder",
      icon: FolderOpen,
      priority: "advanced" as const,
      requires: "edit" as const,
      disabled: importing,
      onSelect: () => folderImportRef.current?.click(),
    },
    {
      id: "export-archive",
      label: "Export source archive",
      icon: FileArchive,
      priority: "advanced" as const,
      onSelect: exportSourceArchive,
    },
    {
      id: "export-html",
      label: "Export isolated HTML",
      icon: Eye,
      priority: "advanced" as const,
      disabled: !previewFiles,
      onSelect: exportStandalonePreview,
    },
    {
      id: "export-svg",
      label: "Export rendered SVG",
      icon: FileImage,
      priority: "advanced" as const,
      disabled: !exportReady || Boolean(exportJob),
      onSelect: () => requestVisualExport("svg"),
    },
    {
      id: "export-png",
      label: "Export rendered PNG",
      icon: FileImage,
      priority: "advanced" as const,
      disabled: !exportReady || Boolean(exportJob),
      onSelect: () => requestVisualExport("png"),
    },
    {
      id: "export-pdf",
      label: "Export rendered PDF",
      icon: FileText,
      priority: "advanced" as const,
      disabled: !exportReady || Boolean(exportJob),
      onSelect: () => requestVisualExport("pdf"),
    },
    {
      id: "export-webm",
      label: "Export canvas video",
      icon: Video,
      priority: "advanced" as const,
      disabled: !exportReady || Boolean(exportJob),
      hint: "Records three seconds of a canvas experience",
      onSelect: () => requestVisualExport("webm"),
    },
    {
      id: "download-file",
      label: "Download current file",
      icon: Download,
      priority: "advanced" as const,
      onSelect: () =>
        downloadBlob(
          new Blob([activeFile.source], {
            type: activeFile.mediaType || "text/plain;charset=utf-8",
          }),
          activeFile.path.split("/").pop() || "source.txt",
        ),
    },
    ...(publishedBuild
      ? [
          {
            id: "unpublish",
            label: "Unpublish live build",
            icon: publishState === "unpublishing" ? Loader2 : X,
            priority: "advanced" as const,
            requires: "edit" as const,
            disabled: publishState !== "idle",
            onSelect: () => void unpublishRuntime(),
          },
        ]
      : []),
  ]);

  return (
    <div className="code-studio flex h-full min-h-0 w-full min-w-0 flex-col">
      {/* The legacy `code-workbar` hook is deliberately not passed: it carried
          the transitional `overflow-x: auto` rail, and the shared bar must not
          scroll. */}
      <ArtifactWorkbar
        label="Code actions"
        selectionContext={surface === "preview" ? "Code output" : undefined}
        modes={
          isFullscreen
            ? {
                registry: true,
                value: MODE_ID_BY_SURFACE[surface],
                onChange: (modeId) => {
                  const next = SURFACE_BY_MODE_ID[modeId];
                  if (!next) return;
                  selectSurface(next);
                },
              }
            : panelModes
        }
        context={
          editingSource && workbook.entryFileId === activeFile.id
            ? "Entry file"
            : undefined
        }
        actions={workbarActions}
        selector={
          workbook.files.length ? (
            <WorkbarItemSelector
              ariaLabel="File"
              itemNoun="file"
              value={activeFile.id}
              onChange={setActiveFileId}
              items={workbook.files.map((file) => ({
                value: file.id,
                label: file.path,
              }))}
            />
          ) : undefined
        }
        primary={{
          label: running ? "Stop" : "Run",
          icon: running ? CircleStop : Play,
          requires: "execute",
          disabled: !running && workbook.runtime === "none",
          onSelect: () => (running ? stopRun() : void run()),
        }}
      />
      <input
        ref={importRef}
        type="file"
        multiple
        className="hidden"
        accept=".zip,.tar,.tgz,.tar.gz,.ipynb,.html,.htm,.css,.js,.mjs,.jsx,.ts,.tsx,.py,.json,.md,.txt,.csv,.xml,.yaml,.yml,.sql,.rb,.php,.lua,.r,.sh,.ps1,.java,.kt,.swift,.go,.rs,.c,.h,.cpp,.cc,.hpp,.cs,.png,.jpg,.jpeg,.gif,.webp,.avif,.mp3,.ogg,.wav,.mp4,.webm,.woff,.woff2,.ttf,.otf"
        onChange={(event) => void handleImport(event.target.files)}
      />
      <input
        ref={folderImportRef}
        type="file"
        multiple
        className="hidden"
        {...({
          webkitdirectory: "",
          directory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(event) => void handleImport(event.target.files)}
      />

      <div className="spectra-editor-body relative min-h-0">
        {importing ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] px-4 py-2.5 text-micro text-[var(--text-secondary)]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)] motion-reduce:animate-none" />
            Keeping the exact original, then adding the safe source to your code…
          </div>
        ) : null}
        {importError ? (
          <Notice tone="error" onClose={() => setImportError(null)}>
            {importError}
          </Notice>
        ) : null}
        {publishError ? (
          <Notice tone="error" onClose={() => setPublishError(null)}>
            {publishError} Source and the last valid published build remain
            unchanged.
          </Notice>
        ) : null}
        {exportJob ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-[color-mix(in_oklab,var(--accent-violet)_20%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-violet)_5%,var(--bg-primary))] px-4 py-2.5 text-micro text-[var(--text-secondary)]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-violet)] motion-reduce:animate-none" />
            Preparing a sanitized {exportJob.target.toUpperCase()} from the
            running SVG…
          </div>
        ) : null}
        {exportError ? (
          <Notice tone="error" onClose={() => setExportError(null)}>
            {exportError}
          </Notice>
        ) : null}
        {importReport ? (
          <Notice
            tone={importReport.skipped.length ? "warning" : "success"}
            onClose={() => setImportReport(null)}
          >
            Imported {importReport.imported} source file
            {importReport.imported === 1 ? "" : "s"} from{" "}
            {importReport.sourceLabel}. Runtime:{" "}
            {runtimeLabel(importReport.runtime)}.
            {importReport.skipped.length
              ? ` ${importReport.skipped.length} item(s) were quarantined or skipped.`
              : ""}
            {importReport.warnings[0] ? ` ${importReport.warnings[0]}` : ""}
            {importReport.skipped.length > 0 ||
            importReport.warnings.length > 1 ? (
              <details className="mt-1.5">
                <summary className="cursor-pointer font-semibold text-[var(--text-primary)]">
                  Import fidelity details
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {importReport.skipped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  {importReport.warnings.slice(1).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Notice>
        ) : null}

        {settingsOpen ? (
          <CodeSettings
            overlay
            artifactId={artifactId}
            artifacts={artifacts}
            content={workbook}
            readOnly={readOnly}
            onRuntimeChange={setRuntime}
            onChange={mutate}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
        {surface === "preview" ? (
          <div
            className={`flex min-h-0 flex-1 flex-col p-3 ${
              isFullscreen ? "min-h-[650px]" : ""
            }`}
          >
            {preview}
          </div>
        ) : null}
        {surface === "code" || surface === "split" ? (
          <>
            <div
              className={`code-editor-grid min-w-0 ${
                splitPreviewOpen ? "" : "is-code-only"
              }`}
              data-code-split={splitPreviewOpen ? "true" : "false"}
              style={
                { "--code-split": `${splitPercent}%` } as React.CSSProperties
              }
              onPointerMove={moveResize}
              onPointerUp={() => {
                draggingRef.current = false;
              }}
              onPointerCancel={() => {
                draggingRef.current = false;
              }}
            >
              {/* Both panes are always present and always editable (D4). Below
                the container's split threshold the grid becomes a block and
                stacks them; `data-code-pane-active` is what the container query
                keeps visible, so it now means "this pane is rendered" rather
                than "this pane won a tab switch". There is no second bar. */}
              <section
                data-code-pane="source"
                data-code-pane-active
                className="flex min-h-0 min-w-0 flex-col"
              >
                {sourceMode === "code" ? (
                  <div
                    className={`code-source-body grid min-h-0 flex-1 ${
                      contract.surface === "full" && fileRailOpen
                        ? "is-files-open"
                        : ""
                    }`}
                  >
                    {contract.surface === "full" ? (
                      <StudioItemRail
                        label="Files"
                        count={workbook.files.length}
                        collapsed={!fileRailOpen}
                        onToggleCollapsed={() =>
                          setFileRailPreference(
                            fileRailOpen ? "closed" : "open",
                          )
                        }
                        items={filteredFiles.map((file) => ({
                          id: file.id,
                          title: file.path.split("/").pop() || file.path,
                          subtitle: file.path.includes("/")
                            ? file.path.slice(0, file.path.lastIndexOf("/"))
                            : file.language || undefined,
                          active: file.id === activeFile.id,
                        }))}
                        onSelect={setActiveFileId}
                        onAdd={readOnly ? undefined : openNewFile}
                        addLabel="Add file"
                        canEdit={!readOnly}
                        tools={
                          <>
                          <label className="mt-2 flex h-8 min-w-0 items-center gap-1.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[var(--text-secondary)]">
                            <Search className="size-3.5 shrink-0" />
                            <input
                              value={fileQuery}
                              onChange={(event) =>
                                setFileQuery(event.target.value)
                              }
                              placeholder="Filter files"
                              aria-label="Filter files by path"
                              className="min-w-0 flex-1 bg-transparent text-micro text-[var(--text-primary)] outline-none"
                            />
                          </label>
                          {filePathForm}
                        </>
                        }
                      />
                    ) : null}
                    {contract.surface !== "full" && filePathForm ? (
                      <div className="px-2 pb-2">{filePathForm}</div>
                    ) : null}
                    <div
                      className="relative min-h-[520px] min-w-0 overflow-hidden bg-[var(--bg-primary)]"
                      data-ai-region={aiRegionAttr(activeAiEffect)}
                      {...(activeIndex >= 0
                        ? targetAttrs(`/files/${activeIndex}/source`)
                        : {})}
                    >
                      <CodeMirror
                        key={`${activeFile.id}:${collaborationDocument?.clientID ?? "local"}`}
                        value={activeFile.source}
                        height="100%"
                        editable={!readOnly}
                        extensions={[
                          languageExtension(activeFile),
                          editorTheme,
                          keyboardExtension,
                          diagnosticsExtension,
                          presenceExtension,
                          aiLineExtension,
                          ...(activeSharedText && collaborationAwareness
                            ? codeEditorCollaboration(
                                activeSharedText,
                                collaborationAwareness,
                              )
                            : []),
                          EditorView.lineWrapping,
                        ]}
                        basicSetup={codeEditorBasicSetup(
                          Boolean(activeSharedText && collaborationAwareness),
                        )}
                        onCreateEditor={(view) => {
                          editorViewRef.current = view;
                        }}
                        onChange={updateActiveSource}
                        aria-label={`${activeFile.path} source editor`}
                      />
                    </div>
                  </div>
                ) : (
                  <CodeParameterPanel
                    content={workbook}
                    readOnly={readOnly}
                    aiChangedPaths={aiChangedPaths}
                    onActiveRegionChange={onActiveRegionChange}
                    onChange={mutate}
                  />
                )}
              </section>
              {splitPreviewOpen ? (
                <>
                  <button
                    type="button"
                    className="code-split-handle flex"
                    onPointerDown={pointerResize}
                    aria-label="Resize source and preview panes"
                  >
                    <span />
                  </button>
                  <section
                    data-code-pane="preview"
                    data-code-pane-active
                    className="flex min-h-0 min-w-0"
                  >
                    {preview}
                  </section>
                </>
              ) : null}
            </div>
            <div className="border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
              <div className="flex h-9 items-center gap-1 px-2">
                <button
                  type="button"
                  onClick={() =>
                    setPanel((current) =>
                      current === "problems" ? null : "problems",
                    )
                  }
                  className={`code-panel-tab ${panel === "problems" ? "is-active" : ""}`}
                >
                  <AlertTriangle className="h-3 w-3" />
                  Problems
                  {problems.length ? <span>{problems.length}</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPanel((current) =>
                      current === "console" ? null : "console",
                    )
                  }
                  className={`code-panel-tab ${panel === "console" ? "is-active" : ""}`}
                >
                  <TerminalSquare className="h-3 w-3" />
                  Console
                  {consoleEntries.length ? (
                    <span>{consoleEntries.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    panel === "tests" ? setPanel(null) : void run(true)
                  }
                  className={`code-panel-tab ${panel === "tests" ? "is-active" : ""}`}
                  title={
                    canExecute
                      ? "Run the declared tests"
                      : "Running tests needs the execute capability"
                  }
                  disabled={
                    !canExecute ||
                    runState === "building" ||
                    runState === "loading" ||
                    runState === "running"
                  }
                >
                  <FlaskConical className="h-3 w-3" />
                  Tests
                  {workbook.tests?.length ? (
                    <span>{workbook.tests.length}</span>
                  ) : null}
                </button>
                <span className="ml-auto truncate text-micro text-[var(--text-tertiary)]">
                  {runtimeLabel(workbook.runtime)} · {runStateLabel(runState)}
                </span>
                {panel === "problems" && problems.length ? (
                  <button
                    type="button"
                    onClick={() => setProblems([])}
                    className="code-small-action shrink-0"
                  >
                    <Eraser className="h-3 w-3" />
                    Clear
                  </button>
                ) : null}
                {panel === "console" && consoleEntries.length ? (
                  <button
                    type="button"
                    onClick={() => setConsoleEntries([])}
                    className="code-small-action shrink-0"
                  >
                    <Eraser className="h-3 w-3" />
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="code-icon-action h-6 w-6 shrink-0"
                  aria-label="Close output panel"
                >
                  <PanelBottom className="h-3 w-3" />
                </button>
              </div>
              {panel ? (
                <div className="max-h-44 overflow-auto border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2 font-mono text-micro leading-4">
                  {panel === "problems" ? (
                    problems.length ? (
                      problems.map((problem) => (
                        <button
                          type="button"
                          key={problem.id}
                          className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
                          onClick={() => {
                            const file =
                              problem.file &&
                              workbook.files.find(
                                (candidate) => candidate.path === problem.file,
                              );
                            if (!file) {
                              editorViewRef.current?.focus();
                              return;
                            }
                            // Land on the reported position, not merely in the
                            // right file: a problem you have to hunt for is a
                            // problem the panel only half reported.
                            setSourceMode("code");
                            setActiveFileId(file.id);
                            if (problem.line)
                              setPendingSearchTarget({
                                fileId: file.id,
                                line: problem.line,
                                column: problem.column ?? 0,
                              });
                            else editorViewRef.current?.focus();
                          }}
                        >
                          <span
                            className={
                              problem.severity === "error"
                                ? "text-[var(--danger)]"
                                : problem.severity === "warning"
                                  ? "text-[var(--warning)]"
                                  : "text-[var(--accent-cyan)]"
                            }
                          >
                            {problem.severity === "error"
                              ? "×"
                              : problem.severity === "warning"
                                ? "!"
                                : "i"}
                          </span>
                          <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">
                            {problem.message}
                          </span>
                          <span className="shrink-0 text-[var(--text-tertiary)]">
                            {problem.file}
                            {problem.line
                              ? `:${problem.line}${problem.column !== undefined ? `:${problem.column + 1}` : ""}`
                              : ""}
                          </span>
                        </button>
                      ))
                    ) : (
                      <EmptyOutput text="No current problems." />
                    )
                  ) : panel === "tests" ? (
                    testResults.length ? (
                      testResults.map((result) => (
                        <div
                          key={result.id}
                          className="flex items-start gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5 last:border-0"
                        >
                          {result.status === "running" ? (
                            <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-[var(--accent-cyan)] motion-reduce:animate-none" />
                          ) : result.status === "passed" ? (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--success)]" />
                          ) : (
                            <X className="mt-0.5 h-3 w-3 shrink-0 text-[var(--danger)]" />
                          )}
                          <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
                            <strong className="font-semibold text-[var(--text-primary)]">
                              {result.name}
                            </strong>
                            {result.message ? (
                              <span className="mt-0.5 block whitespace-pre-wrap text-[var(--danger)]">
                                {result.message}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ))
                    ) : (
                      <EmptyOutput text="Add executable tests in Settings, then run them here." />
                    )
                  ) : consoleEntries.length ? (
                    consoleEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex gap-2 border-b border-[var(--border-subtle)] px-2 py-1 last:border-0 ${entry.level === "error" ? "text-[var(--danger)]" : entry.level === "warn" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}
                      >
                        <span className="shrink-0 uppercase text-micro tracking-wide text-[var(--text-tertiary)]">
                          {entry.level}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                          {entry.text}
                        </span>
                      </div>
                    ))
                  ) : (
                    <EmptyOutput text="Run the code to see console output." />
                  )}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {deleteFileId ? (
        <ConfirmDialog
          open
          title={`Delete ${
            workbook.files.find((file) => file.id === deleteFileId)?.path ??
            "this file"
          }?`}
          detail={
            workbook.files.length === 1
              ? "Code needs at least one source file."
              : "The file will be removed from this code. You can recover its previous content from History."
          }
          confirmLabel="Delete file"
          destructive
          confirmDisabled={workbook.files.length === 1}
          onCancel={() => setDeleteFileId(null)}
          onConfirm={deleteFile}
        />
      ) : null}
      {fullPreview
        ? createPortal(
            <div className="fixed inset-0 z-modal flex flex-col bg-[var(--bg-primary)]">
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-default)] px-5">
                <div>
                  <p className="text-micro font-semibold text-[var(--text-primary)]">
                    {workbook.visualisation.title || title}
                  </p>
                  <p className="text-micro text-[var(--text-tertiary)]">
                    Isolated preview · {runtimeLabel(workbook.runtime)}
                  </p>
                </div>
                <button
                  type="button"
                  className="code-icon-action"
                  onClick={() => setFullPreview(false)}
                  aria-label="Close full preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-4">{preview}</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function CodeParameterPanel({
  content,
  readOnly,
  aiChangedPaths,
  onActiveRegionChange,
  onChange,
}: {
  content: CodeContent;
  readOnly: boolean;
  aiChangedPaths: string[];
  onActiveRegionChange?: (regionId: string) => void;
  onChange: (recipe: (draft: CodeContent) => void) => void;
}) {
  const parameters = content.parameters ?? [];
  const changeParameter = (
    index: number,
    recipe: (parameter: CodeParameter) => void,
  ) =>
    onChange((draft) => {
      const parameter = draft.parameters?.[index];
      if (parameter) recipe(parameter);
    });
  return (
    <div className="min-h-[520px] flex-1 overflow-auto bg-[color-mix(in_oklab,var(--bg-secondary)_42%,var(--bg-primary))] p-3">
      <div className="mx-auto max-w-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3.5 shadow-soft">
          <div className="max-w-md">
            <h3 className="text-micro font-semibold text-[var(--text-primary)]">
              Visualisation controls
            </h3>
            <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
              Give viewers understandable controls without exposing source.
              Browser and React code reads values with{" "}
              <code className="rounded bg-[var(--bg-secondary)] px-1 font-mono">
                getParameter(key)
              </code>
              ; Python uses{" "}
              <code className="rounded bg-[var(--bg-secondary)] px-1 font-mono">
                spectra.get_parameter(key)
              </code>
              .
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={readOnly || parameters.length >= 80}
            onClick={() =>
              onChange((draft) => {
                const ordinal = (draft.parameters?.length ?? 0) + 1;
                draft.parameters = [
                  ...(draft.parameters ?? []),
                  {
                    id: uid("parameter"),
                    key: `parameter_${ordinal}`,
                    label: `Parameter ${ordinal}`,
                    type: "number",
                    value: 50,
                    min: 0,
                    max: 100,
                    step: 1,
                  },
                ];
              })
            }
          >
            <FilePlus2 className="h-3.5 w-3.5" /> Add control
          </Button>
        </div>
        <div className="mt-3 space-y-2.5">
          {parameters.map((parameter, index) => {
            const activeEffect = pathTouches(
              aiChangedPaths,
              `/parameters/${index}`,
            );
            return (
              <section
                key={parameter.id}
                data-ai-region={aiRegionAttr(activeEffect)}
                {...targetAttrs(`/parameters/${index}`)}
                className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
                onFocusCapture={() => onActiveRegionChange?.(parameter.id)}
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_32px] sm:items-end">
                  <label className="code-field-label m-0">
                    Label
                    <input
                      className="code-field-control"
                      value={parameter.label}
                      disabled={readOnly}
                      onChange={(event) =>
                        changeParameter(index, (draft) => {
                          draft.label =
                            event.target.value.slice(0, 160) || draft.key;
                        })
                      }
                    />
                  </label>
                  <div className="code-field-label m-0">
                    Control type
                    <SelectField
                      ariaLabel="Control type"
                      size="sm"
                      value={parameter.type}
                      disabled={readOnly}
                      options={[
                        { value: "number", label: "Number / slider" },
                        { value: "text", label: "Text" },
                        { value: "boolean", label: "Toggle" },
                        { value: "select", label: "Choice" },
                      ]}
                      onChange={(next) =>
                        changeParameter(index, (draft) => {
                          const type = next as CodeParameter["type"];
                          draft.type = type;
                          if (type === "number") {
                            draft.value = 0;
                            draft.min = 0;
                            draft.max = 100;
                            draft.step = 1;
                            delete draft.options;
                          } else if (type === "boolean") {
                            draft.value = false;
                            delete draft.min;
                            delete draft.max;
                            delete draft.step;
                            delete draft.options;
                          } else if (type === "select") {
                            draft.options = ["Option A", "Option B"];
                            draft.value = "Option A";
                            delete draft.min;
                            delete draft.max;
                            delete draft.step;
                          } else {
                            draft.value = "";
                            delete draft.min;
                            delete draft.max;
                            delete draft.step;
                            delete draft.options;
                          }
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    disabled={readOnly}
                    className="code-icon-action h-8 w-8"
                    aria-label={`Remove ${parameter.label}`}
                    onClick={() =>
                      onChange((draft) => {
                        draft.parameters = (draft.parameters ?? []).filter(
                          (candidate) => candidate.id !== parameter.id,
                        );
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <label className="code-field-label m-0">
                    SDK key
                    <input
                      className="code-field-control font-mono text-micro"
                      value={parameter.key}
                      disabled={readOnly}
                      onChange={(event) =>
                        changeParameter(index, (draft) => {
                          const value = event.target.value
                            .replace(/[^A-Za-z0-9_]/g, "_")
                            .slice(0, 80);
                          draft.key = /^[A-Za-z_]/.test(value)
                            ? value
                            : `_${value || "parameter"}`;
                        })
                      }
                    />
                  </label>
                  <label className="code-field-label m-0">
                    Description
                    <input
                      className="code-field-control"
                      value={parameter.description ?? ""}
                      disabled={readOnly}
                      placeholder="What changes when this control moves?"
                      onChange={(event) =>
                        changeParameter(index, (draft) => {
                          draft.description = event.target.value.slice(0, 500);
                        })
                      }
                    />
                  </label>
                </div>
                <div className="mt-3 rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                  {parameter.type === "number" ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_76px] sm:items-center">
                      <input
                        type="range"
                        aria-label={`${parameter.label} value`}
                        value={Number(parameter.value)}
                        min={parameter.min ?? 0}
                        max={parameter.max ?? 100}
                        step={parameter.step ?? 1}
                        disabled={readOnly}
                        className="w-full accent-[var(--accent-violet)]"
                        onChange={(event) =>
                          changeParameter(index, (draft) => {
                            draft.value = Number(event.target.value);
                          })
                        }
                      />
                      <input
                        type="number"
                        aria-label={`${parameter.label} numeric value`}
                        className="code-field-control text-right font-mono"
                        value={Number(parameter.value)}
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        disabled={readOnly}
                        onChange={(event) =>
                          changeParameter(index, (draft) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) draft.value = value;
                          })
                        }
                      />
                      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                        <label className="code-field-label m-0">
                          Minimum
                          <input
                            type="number"
                            className="code-field-control"
                            value={parameter.min ?? 0}
                            disabled={readOnly}
                            onChange={(event) =>
                              changeParameter(index, (draft) => {
                                draft.min = Number(event.target.value);
                                if (
                                  typeof draft.max === "number" &&
                                  draft.min > draft.max
                                )
                                  draft.max = draft.min;
                              })
                            }
                          />
                        </label>
                        <label className="code-field-label m-0">
                          Maximum
                          <input
                            type="number"
                            className="code-field-control"
                            value={parameter.max ?? 100}
                            disabled={readOnly}
                            onChange={(event) =>
                              changeParameter(index, (draft) => {
                                draft.max = Number(event.target.value);
                                if (
                                  typeof draft.min === "number" &&
                                  draft.max < draft.min
                                )
                                  draft.min = draft.max;
                              })
                            }
                          />
                        </label>
                        <label className="code-field-label m-0">
                          Step
                          <input
                            type="number"
                            min="0.000001"
                            className="code-field-control"
                            value={parameter.step ?? 1}
                            disabled={readOnly}
                            onChange={(event) =>
                              changeParameter(index, (draft) => {
                                const value = Number(event.target.value);
                                draft.step = value > 0 ? value : 1;
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ) : parameter.type === "boolean" ? (
                    <label className="flex items-center justify-between gap-3 text-micro font-semibold text-[var(--text-primary)]">
                      <span>
                        {parameter.label}
                        <span className="mt-0.5 block text-micro font-normal text-[var(--text-tertiary)]">
                          {parameter.value ? "On" : "Off"}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={parameter.value === true}
                        disabled={readOnly}
                        onChange={(event) =>
                          changeParameter(index, (draft) => {
                            draft.value = event.target.checked;
                          })
                        }
                      />
                    </label>
                  ) : parameter.type === "select" ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <div className="code-field-label m-0">
                        Current choice
                        <SelectField
                          ariaLabel="Current choice"
                          size="sm"
                          value={String(parameter.value)}
                          disabled={readOnly}
                          options={(parameter.options ?? []).map((option) => ({
                            value: option,
                            label: option,
                          }))}
                          onChange={(next) =>
                            changeParameter(index, (draft) => {
                              draft.value = next;
                            })
                          }
                        />
                      </div>
                      <label className="code-field-label m-0">
                        Options, separated by commas
                        <input
                          className="code-field-control"
                          value={(parameter.options ?? []).join(", ")}
                          disabled={readOnly}
                          onChange={(event) =>
                            changeParameter(index, (draft) => {
                              const options = [
                                ...new Set(
                                  event.target.value
                                    .split(",")
                                    .map((option) => option.trim())
                                    .filter(Boolean),
                                ),
                              ].slice(0, 40);
                              draft.options = options.length
                                ? options
                                : ["Option"];
                              if (!draft.options.includes(String(draft.value)))
                                draft.value = draft.options[0]!;
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="code-field-label m-0">
                      Current value
                      <input
                        className="code-field-control"
                        value={String(parameter.value)}
                        disabled={readOnly}
                        onChange={(event) =>
                          changeParameter(index, (draft) => {
                            draft.value = event.target.value.slice(0, 2_000);
                          })
                        }
                      />
                    </label>
                  )}
                </div>
              </section>
            );
          })}
          {parameters.length === 0 ? (
            <div className="rounded-card border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-12 text-center">
              <SlidersHorizontal className="mx-auto h-5 w-5 text-[var(--text-tertiary)]" />
              <p className="mt-2 text-micro font-semibold text-[var(--text-primary)]">
                No viewer controls yet
              </p>
              <p className="mx-auto mt-1 max-w-sm text-micro leading-4 text-[var(--text-tertiary)]">
                Add only the few controls that make the idea explorable.
                Advanced configuration stays in source and Settings.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CodeSettings({
  artifactId,
  artifacts,
  content,
  readOnly,
  overlay = false,
  onRuntimeChange,
  onChange,
  onClose,
}: {
  artifactId: string;
  artifacts: SpectraArtifact[];
  content: CodeContent;
  readOnly: boolean;
  overlay?: boolean;
  onRuntimeChange: (runtime: CodeRuntime) => void;
  onChange: (recipe: (draft: CodeContent) => void) => void;
  onClose: () => void;
}) {
  const [settingsSection, setSettingsSection] = useState<
    "experience" | "access" | "connections" | "quality"
  >("experience");
  const [bindingArtifactId, setBindingArtifactId] = useState("");
  const [bindingRange, setBindingRange] = useState("A1:J30");
  const [networkOriginDraft, setNetworkOriginDraft] = useState("");
  const [networkOriginError, setNetworkOriginError] = useState<string | null>(
    null,
  );
  const [importHistory, setImportHistory] = useState<SpectraArtifactImport[]>(
    [],
  );
  const [importHistoryState, setImportHistoryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [assetLibrary, setAssetLibrary] = useState<SpectraArtifactAsset[]>([]);
  const [assetLibraryState, setAssetLibraryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [assetUploadError, setAssetUploadError] = useState<string | null>(null);
  const [assetUploading, setAssetUploading] = useState(false);
  const [pendingAssetRevocation, setPendingAssetRevocation] = useState<{
    assetId: string;
    label: string;
  } | null>(null);
  const [revokingAssetId, setRevokingAssetId] = useState<string | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const refreshAssets = useCallback(async () => {
    setAssetLibraryState("loading");
    try {
      const result = await getArtifactAssets(artifactId);
      setAssetLibrary(result.assets);
      setAssetLibraryState("ready");
    } catch {
      setAssetLibraryState("error");
    }
  }, [artifactId]);
  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);
  useEffect(() => {
    if (readOnly) {
      setImportHistory([]);
      setImportHistoryState("ready");
      return;
    }
    let active = true;
    setImportHistoryState("loading");
    void getArtifactImports(artifactId)
      .then((result) => {
        if (!active) return;
        setImportHistory(result.imports);
        setImportHistoryState("ready");
      })
      .catch(() => {
        if (active) setImportHistoryState("error");
      });
    return () => {
      active = false;
    };
  }, [artifactId, readOnly]);

  async function addAsset(file: File) {
    if (readOnly || !file.size) return;
    setAssetUploadError(null);
    setAssetUploading(true);
    try {
      const extension = file.name.toLowerCase().split(".").pop() ?? "";
      const fallbackTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        mp3: "audio/mpeg",
        ogg: "audio/ogg",
        wav: "audio/wav",
        mp4: "video/mp4",
        webm: "video/webm",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        otf: "font/otf",
      };
      const mediaType =
        file.type === "audio/x-wav"
          ? "audio/wav"
          : file.type || fallbackTypes[extension] || "";
      if (!mediaType) throw new Error("This asset format is not supported.");
      if (file.size > 8_000_000)
        throw new Error("A live Code asset cannot exceed 8 MB.");
      const path = normalizeCodePath(`assets/${file.name}`);
      const sha256 = await artifactBlobSha256(file);
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path,
        name: file.name,
        mediaType,
        sha256,
        blob: file,
      });
      onChange((draft) => {
        const withoutPath = (draft.assets ?? []).filter(
          (reference) => reference.path.toLowerCase() !== path.toLowerCase(),
        );
        const retainedBytes = withoutPath.reduce(
          (total, reference) => total + reference.bytes,
          0,
        );
        if (retainedBytes + file.size > 8_000_000)
          throw new Error(
            "Current preview assets cannot exceed 8 MB. Remove an asset first.",
          );
        draft.assets = [
          ...withoutPath,
          {
            id: uid("asset-ref"),
            assetId: uploaded.assetId,
            path,
            name: file.name,
            mediaType,
            bytes: file.size,
            sha256,
          },
        ];
      });
      await refreshAssets();
    } catch (error) {
      setAssetUploadError(
        error instanceof Error
          ? error.message
          : "The asset could not be added.",
      );
    } finally {
      setAssetUploading(false);
      if (assetInputRef.current) assetInputRef.current.value = "";
    }
  }

  async function revokeAsset(assetId: string) {
    if (readOnly) return;
    setAssetUploadError(null);
    setRevokingAssetId(assetId);
    try {
      await revokeArtifactAsset(assetId);
      onChange((draft) => {
        draft.assets = (draft.assets ?? []).filter(
          (reference) => reference.assetId !== assetId,
        );
      });
      await refreshAssets();
      setPendingAssetRevocation(null);
    } catch (error) {
      setAssetUploadError(
        error instanceof Error
          ? error.message
          : "The asset could not be revoked.",
      );
    } finally {
      setRevokingAssetId(null);
    }
  }
  const approvedNetworkOrigins = normalizeCodeNetworkOrigins(
    content.networkPolicy?.allowlist,
  );
  const assetById = new Map(
    assetLibrary.map((asset) => [asset.assetId, asset] as const),
  );
  const referencedAssetIds = new Set(
    (content.assets ?? []).map((reference) => reference.assetId),
  );
  const retainedUnlinkedAssets = assetLibrary.filter(
    (asset) =>
      asset.status === "active" && !referencedAssetIds.has(asset.assetId),
  );
  const availableArtifacts = artifacts.filter(
    (artifact) =>
      artifact._id !== artifactId &&
      artifact.status === "active" &&
      artifact.blueprintKey !== "thread_reference",
  );
  const selectedBindingArtifact = availableArtifacts.find(
    (artifact) => artifact._id === bindingArtifactId,
  );
  const runtimeOptions: Array<{
    value: CodeRuntime;
    label: string;
    detail: string;
  }> = [
    {
      value: "browser",
      label: "Browser",
      detail: "HTML, CSS, and JavaScript in an opaque-origin iframe",
    },
    {
      value: "react",
      label: "React + TypeScript",
      detail:
        "Allowlisted bundle compiled without executing source on the server",
    },
    {
      value: "python",
      label: "Python",
      detail: "Disposable Pyodide worker, no network, 12-second limit",
    },
    {
      value: "none",
      label: "Source only",
      detail: "Store and collaborate without execution",
    },
  ];
  const settingsSections = [
    {
      id: "experience" as const,
      label: "Experience",
      detail: "Runtime, preview, and identity",
      icon: Settings2,
    },
    {
      id: "access" as const,
      label: "Runtime access",
      detail: "Network and dependency policy",
      icon: ShieldCheck,
    },
    {
      id: "connections" as const,
      label: "Assets & data",
      detail: `${(content.assets ?? []).length} assets · ${(content.resourceBindings ?? []).length} bindings`,
      icon: FileImage,
    },
    {
      id: "quality" as const,
      label: "Quality",
      detail: `${(content.tests ?? []).length} executable checks`,
      icon: FlaskConical,
    },
  ];
  return (
    <div className="code-settings-shell" data-overlay={overlay || undefined}>
      <nav className="code-settings-nav" aria-label="Code settings sections">
        <div className="code-settings-nav-heading">
          <span>Configuration</span>
          <strong>Code work</strong>
          <button
            type="button"
            className="code-settings-close"
            aria-label="Hide settings"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        {settingsSections.map((section) => {
          const Icon = section.icon;
          const active = settingsSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              aria-pressed={active}
              className="code-settings-nav-item"
              data-active={active ? "true" : "false"}
              onClick={() => setSettingsSection(section.id)}
            >
              <Icon className="h-4 w-4" />
              <span>
                <strong>{section.label}</strong>
                <small>{section.detail}</small>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="code-settings-grid">
        <section
          hidden={settingsSection !== "experience"}
          className="code-settings-card"
        >
          <h3>Runtime profile</h3>
          <p>
            Choose only a runtime Spectra can actually isolate.
            Compiled-language execution is intentionally absent.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {runtimeOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                disabled={readOnly}
                onClick={() => onRuntimeChange(option.value)}
                className={`rounded-none border-0 px-0 py-2.5 text-left ${content.runtime === option.value ? "bg-[color-mix(in_oklab,var(--text-primary)_5%,transparent)]" : "bg-transparent hover:bg-[var(--bg-hover)]"}`}
              >
                <span className="flex items-center gap-2 text-micro font-semibold text-[var(--text-primary)]">
                  {content.runtime === option.value ? (
                    <Check className="h-3.5 w-3.5 text-[var(--text-primary)]" />
                  ) : (
                    <Box className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  )}
                  {option.label}
                </span>
                <span className="mt-1 block text-micro leading-4 text-[var(--text-secondary)]">
                  {option.detail}
                </span>
              </button>
            ))}
          </div>
        </section>
        <section
          hidden={settingsSection !== "experience"}
          className="code-settings-card"
        >
          <h3>Entry and preview</h3>
          <p>
            These settings affect this code and how it looks when embedded.
          </p>
          <div className="code-field-label">
            Entry file
            <SelectField
              ariaLabel="Entry file"
              size="sm"
              value={content.entryFileId}
              disabled={readOnly}
              options={content.files.map((file) => ({
                value: file.id,
                label: file.path,
              }))}
              onChange={(next) =>
                onChange((draft) => {
                  draft.entryFileId = next;
                })
              }
            />
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 text-micro text-[var(--text-primary)]">
            <span>
              <strong className="block font-semibold">
                Auto-run safe browser changes
              </strong>
              <span className="text-micro text-[var(--text-tertiary)]">
                Python always requires an explicit run.
              </span>
            </span>
            <input
              type="checkbox"
              checked={
                content.runtime !== "python" &&
                content.preview?.autoRun !== false
              }
              disabled={
                readOnly ||
                content.runtime === "python" ||
                content.runtime === "none"
              }
              onChange={(event) =>
                onChange((draft) => {
                  draft.preview = {
                    ...draft.preview,
                    autoRun: event.target.checked,
                  };
                })
              }
            />
          </label>
          <label className="code-field-label">
            Preview height
            <input
              type="range"
              min={360}
              max={1000}
              step={20}
              value={content.preview?.height ?? 580}
              disabled={readOnly}
              onChange={(event) =>
                onChange((draft) => {
                  draft.preview = {
                    ...draft.preview,
                    height: Number(event.target.value),
                  };
                })
              }
            />
            <span>{content.preview?.height ?? 580}px</span>
          </label>
        </section>
        <section
          hidden={settingsSection !== "experience"}
          className="code-settings-card"
        >
          <h3>Visualisation identity</h3>
          <p>Non-programmers see this framing in previews and embeds.</p>
          <label className="mt-3 flex items-center justify-between gap-3 text-micro text-[var(--text-primary)]">
            <span>
              <strong className="block font-semibold">
                Rendered experience
              </strong>
              <span className="text-micro text-[var(--text-tertiary)]">
                Show the running output first when this code opens.
              </span>
            </span>
            <input
              type="checkbox"
              checked={content.visualisation.enabled}
              disabled={readOnly || content.runtime === "none"}
              onChange={(event) =>
                onChange((draft) => {
                  draft.visualisation.enabled = event.target.checked;
                })
              }
            />
          </label>
          <label className="code-field-label">
            Preview title
            <input
              value={content.visualisation.title ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                onChange((draft) => {
                  draft.visualisation.title = event.target.value;
                })
              }
              placeholder="Interactive visualisation"
              className="code-field-control"
            />
          </label>
          <label className="code-field-label">
            Description
            <textarea
              value={content.visualisation.description ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                onChange((draft) => {
                  draft.visualisation.description = event.target.value;
                })
              }
              rows={3}
              placeholder="What can someone explore here?"
              className="code-field-control resize-none py-2"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="code-field-label">
              Opens in
              <SelectField
                ariaLabel="Opens in"
                size="sm"
                value={content.visualisation.openMode ?? "source"}
                disabled={readOnly}
                options={[
                  { value: "source", label: "Code" },
                  { value: "preview", label: "Visualisation" },
                  { value: "split", label: "Both" },
                ]}
                onChange={(next) =>
                  onChange((draft) => {
                    draft.visualisation.openMode = next as
                      "source" | "preview" | "split";
                  })
                }
              />
            </div>
            <div className="code-field-label">
              Preferred aspect
              <SelectField
                ariaLabel="Preferred aspect"
                size="sm"
                value={String(content.visualisation.aspectRatio ?? 1.7778)}
                disabled={readOnly}
                options={[
                  { value: "1.7778", label: "16:9 landscape" },
                  { value: "1.3333", label: "4:3 standard" },
                  { value: "1", label: "Square" },
                  { value: "0.75", label: "Portrait" },
                ]}
                onChange={(next) =>
                  onChange((draft) => {
                    draft.visualisation.aspectRatio = Number(next);
                  })
                }
              />
            </div>
          </div>
        </section>
        <section
          hidden={settingsSection !== "access"}
          className="code-settings-card"
        >
          <h3>Security boundary</h3>
          <p>
            Secrets are never part of your code, preview messages, or environment records visible in the browser.
          </p>
          <div className="mt-3 space-y-2">
            <SecurityRow
              label="Network"
              value={
                content.runtime === "python"
                  ? "Disabled for Python"
                  : content.networkPolicy?.mode === "allowlist"
                    ? `${approvedNetworkOrigins.length} approved HTTPS ${approvedNetworkOrigins.length === 1 ? "origin" : "origins"}`
                    : "Disabled"
              }
            />
            <SecurityRow label="Ambient credentials" value="Unavailable" />
            <SecurityRow label="Browser origin" value="Opaque sandbox" />
            <SecurityRow
              label="Pinned runtime"
              value={codeRuntimeVersion(content.runtime)}
            />
            <SecurityRow
              label="Resource limit"
              value="900 KB source · 2.5 MB bundle"
            />
          </div>
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-micro font-semibold text-[var(--text-primary)]">
                  Read-only network access
                </h4>
                <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                  Browser and React runs may fetch GET or HEAD responses only
                  from exact approved HTTPS origins. Credentials, referrers,
                  redirects, sockets, and private-network targets remain
                  blocked.
                </p>
              </div>
              <label className="inline-flex shrink-0 items-center gap-2 text-micro font-semibold text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={content.networkPolicy?.mode === "allowlist"}
                  disabled={
                    readOnly ||
                    content.runtime === "python" ||
                    content.runtime === "none"
                  }
                  onChange={(event) =>
                    onChange((draft) => {
                      draft.networkPolicy = event.target.checked
                        ? {
                            mode: "allowlist",
                            allowlist: normalizeCodeNetworkOrigins(
                              draft.networkPolicy?.allowlist,
                            ),
                          }
                        : { mode: "none" };
                    })
                  }
                />
                Enabled
              </label>
            </div>
            {content.runtime === "python" ? (
              <div className="mt-3 rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-micro leading-4 text-[var(--text-secondary)]">
                Python workers remain fully network-isolated. Connect a resource you have access to for data needed by Python.
              </div>
            ) : content.networkPolicy?.mode === "allowlist" ? (
              <>
                <div className="mt-3 flex gap-2">
                  <input
                    value={networkOriginDraft}
                    disabled={
                      readOnly ||
                      approvedNetworkOrigins.length >= MAX_CODE_NETWORK_ORIGINS
                    }
                    className="code-field-control min-w-0 flex-1 font-mono text-micro"
                    placeholder="https://api.example.org"
                    aria-label="HTTPS origin to approve"
                    aria-invalid={Boolean(networkOriginError)}
                    onChange={(event) => {
                      setNetworkOriginDraft(event.target.value);
                      setNetworkOriginError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      const inspected =
                        inspectCodeNetworkOrigin(networkOriginDraft);
                      if (!inspected.ok) {
                        setNetworkOriginError(inspected.error);
                        return;
                      }
                      if (approvedNetworkOrigins.includes(inspected.origin)) {
                        setNetworkOriginError(
                          "That origin is already approved.",
                        );
                        return;
                      }
                      onChange((draft) => {
                        draft.networkPolicy = {
                          mode: "allowlist",
                          allowlist: normalizeCodeNetworkOrigins([
                            ...(draft.networkPolicy?.allowlist ?? []),
                            inspected.origin,
                          ]),
                        };
                      });
                      setNetworkOriginDraft("");
                      setNetworkOriginError(null);
                    }}
                  />
                  <button
                    type="button"
                    disabled={
                      readOnly ||
                      approvedNetworkOrigins.length >= MAX_CODE_NETWORK_ORIGINS
                    }
                    className="code-small-action border border-[var(--border-default)]"
                    onClick={() => {
                      const inspected =
                        inspectCodeNetworkOrigin(networkOriginDraft);
                      if (!inspected.ok) {
                        setNetworkOriginError(inspected.error);
                        return;
                      }
                      if (approvedNetworkOrigins.includes(inspected.origin)) {
                        setNetworkOriginError(
                          "That origin is already approved.",
                        );
                        return;
                      }
                      onChange((draft) => {
                        draft.networkPolicy = {
                          mode: "allowlist",
                          allowlist: normalizeCodeNetworkOrigins([
                            ...(draft.networkPolicy?.allowlist ?? []),
                            inspected.origin,
                          ]),
                        };
                      });
                      setNetworkOriginDraft("");
                      setNetworkOriginError(null);
                    }}
                  >
                    Add origin
                  </button>
                </div>
                {networkOriginError ? (
                  <p
                    className="mt-1.5 text-micro text-[var(--danger)]"
                    role="alert"
                  >
                    {networkOriginError}
                  </p>
                ) : null}
                <div className="mt-2 space-y-1.5">
                  {approvedNetworkOrigins.map((origin) => (
                    <div
                      key={origin}
                      className="flex items-center justify-between gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2"
                    >
                      <span className="min-w-0 truncate font-mono text-micro text-[var(--text-secondary)]">
                        {origin}
                      </span>
                      <button
                        type="button"
                        disabled={readOnly}
                        className="code-icon-action h-6 w-6"
                        aria-label={`Remove ${origin}`}
                        onClick={() =>
                          onChange((draft) => {
                            draft.networkPolicy = {
                              mode: "allowlist",
                              allowlist: normalizeCodeNetworkOrigins(
                                (draft.networkPolicy?.allowlist ?? []).filter(
                                  (candidate) => candidate !== origin,
                                ),
                              ),
                            };
                          })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {approvedNetworkOrigins.length === 0 ? (
                    <div className="rounded-control border border-dashed border-[var(--border-default)] px-3 py-3 text-center text-micro text-[var(--text-tertiary)]">
                      No origins approved. Network requests remain blocked.
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </section>
        <section
          hidden={settingsSection !== "access"}
          className={`code-settings-card lg:col-span-2 ${content.runtime !== "react" ? "opacity-70" : ""}`}
        >
          <h3>Allowlisted dependencies</h3>
          <p>
            {content.runtime === "react"
              ? "React and the Spectra SDK are built into this profile. Optional packages must be declared here before source may import them."
              : "Optional packages apply only to the React + TypeScript profile. Switch runtime to manage its pinned dependency set."}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5">
              <span className="text-micro font-semibold text-[var(--text-primary)]">
                React runtime
                <span className="mt-0.5 block text-micro font-normal text-[var(--text-tertiary)]">
                  React 19 · locked by Spectra
                </span>
              </span>
              <span className="rounded-full bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-2 py-1 text-micro font-semibold text-[var(--success)]">
                Included
              </span>
            </div>
            {CURATED_CODE_DEPENDENCIES.map((dependency) => {
              const allowed = Boolean(content.dependencies?.[dependency.key]);
              return (
                <div
                  key={dependency.key}
                  className="flex items-center justify-between gap-3 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5"
                >
                  <span className="min-w-0 text-micro font-semibold text-[var(--text-primary)]">
                    {dependency.label}
                    <span className="mt-0.5 block truncate text-micro font-normal text-[var(--text-tertiary)]">
                      {dependency.detail} · {dependency.version} · pinned
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={readOnly || content.runtime !== "react"}
                    className={`rounded-chip px-2 py-1 text-micro font-semibold ${allowed ? "bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]" : "border border-[var(--border-default)] text-[var(--text-secondary)]"}`}
                    onClick={() =>
                      onChange((draft) => {
                        const dependencies = { ...(draft.dependencies ?? {}) };
                        if (dependencies[dependency.key])
                          delete dependencies[dependency.key];
                        else dependencies[dependency.key] = dependency.version;
                        draft.dependencies = dependencies;
                      })
                    }
                  >
                    {allowed ? "Allowed" : "Allow"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section
          hidden={settingsSection !== "quality"}
          className="code-settings-card lg:col-span-2"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3>Accessibility contract</h3>
                  <p>
                    Describe the rendered experience independently of its visual
                    styling.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-micro font-semibold text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={content.accessibility?.reducedMotion === true}
                    disabled={readOnly}
                    onChange={(event) =>
                      onChange((draft) => {
                        draft.accessibility = {
                          ...(draft.accessibility ?? {}),
                          reducedMotion: event.target.checked,
                        };
                      })
                    }
                  />
                  Prefer reduced motion
                </label>
              </div>
              <label className="code-field-label">
                Accessible title
                <input
                  value={content.accessibility?.title ?? ""}
                  disabled={readOnly}
                  className="code-field-control"
                  placeholder="What is this experience?"
                  onChange={(event) =>
                    onChange((draft) => {
                      draft.accessibility = {
                        ...(draft.accessibility ?? {}),
                        title: event.target.value,
                      };
                    })
                  }
                />
              </label>
              <label className="code-field-label">
                Text alternative
                <textarea
                  value={content.accessibility?.description ?? ""}
                  disabled={readOnly}
                  rows={3}
                  className="code-field-control resize-none py-2"
                  placeholder="Explain the relationship or interaction without relying on colour or motion."
                  onChange={(event) =>
                    onChange((draft) => {
                      draft.accessibility = {
                        ...(draft.accessibility ?? {}),
                        description: event.target.value,
                      };
                    })
                  }
                />
              </label>
            </div>
            <div className="border-t border-[var(--border-subtle)] pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3>Environment declarations</h3>
                  <p>
                    Names and descriptions only. Values and secrets never enter your code.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={readOnly}
                  className="code-small-action border border-[var(--border-default)]"
                  onClick={() =>
                    onChange((draft) => {
                      draft.environmentSchema = [
                        ...(draft.environmentSchema ?? []),
                        {
                          key: `SETTING_${(draft.environmentSchema?.length ?? 0) + 1}`,
                          description: "",
                          required: false,
                        },
                      ];
                    })
                  }
                >
                  <FilePlus2 className="h-3 w-3" />
                  Add
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {(content.environmentSchema ?? []).map((variable, index) => (
                  <div
                    key={`${variable.key}:${index}`}
                    className="grid gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 sm:grid-cols-[150px_minmax(0,1fr)_70px_28px] sm:items-center"
                  >
                    <input
                      value={variable.key}
                      disabled={readOnly}
                      className="code-field-control font-mono text-micro uppercase"
                      aria-label="Environment setting name"
                      onChange={(event) =>
                        onChange((draft) => {
                          if (draft.environmentSchema?.[index]) {
                            const key = event.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9_]/g, "");
                            draft.environmentSchema[index]!.key =
                              key || "SETTING";
                          }
                        })
                      }
                    />
                    <input
                      value={variable.description ?? ""}
                      disabled={readOnly}
                      className="code-field-control"
                      aria-label={`${variable.key} description`}
                      placeholder="Purpose, never the value"
                      onChange={(event) =>
                        onChange((draft) => {
                          if (draft.environmentSchema?.[index])
                            draft.environmentSchema[index]!.description =
                              event.target.value;
                        })
                      }
                    />
                    <label className="inline-flex items-center gap-1.5 text-micro text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={variable.required === true}
                        disabled={readOnly}
                        onChange={(event) =>
                          onChange((draft) => {
                            if (draft.environmentSchema?.[index])
                              draft.environmentSchema[index]!.required =
                                event.target.checked;
                          })
                        }
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      disabled={readOnly}
                      className="code-icon-action h-7 w-7"
                      aria-label={`Remove ${variable.key}`}
                      onClick={() =>
                        onChange((draft) => {
                          draft.environmentSchema = (
                            draft.environmentSchema ?? []
                          ).filter(
                            (_, candidateIndex) => candidateIndex !== index,
                          );
                        })
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {(content.environmentSchema ?? []).length === 0 ? (
                  <div className="rounded-control border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-micro text-[var(--text-tertiary)]">
                    No environment settings declared.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
        <section
          hidden={settingsSection !== "connections"}
          className="code-settings-card lg:col-span-2"
        >
          <input
            ref={assetInputRef}
            type="file"
            className="sr-only"
            accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.mp3,.ogg,.wav,.mp4,.webm,.woff,.woff2,.ttf,.otf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addAsset(file);
            }}
          />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3>Immutable runtime assets</h3>
              <p>
                Images, audio, video, and fonts stay outside the CRDT source
                tree. Each version keeps an exact content-addressed reference.
              </p>
            </div>
            <button
              type="button"
              className="code-small-action border border-[var(--border-default)]"
              disabled={readOnly || assetUploading}
              onClick={() => assetInputRef.current?.click()}
            >
              {assetUploading ? (
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              ) : (
                <FileImage className="h-3 w-3" />
              )}
              Add asset
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {(content.assets ?? []).map((reference) => {
              const stored = assetById.get(reference.assetId);
              const available = stored?.status === "active";
              return (
                <div
                  key={reference.id}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5"
                >
                  <FileImage className="h-4 w-4 shrink-0 text-[var(--accent-violet)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-micro font-semibold text-[var(--text-primary)]">
                      {reference.path}
                    </div>
                    <div className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                      {reference.mediaType} · {formatBytes(reference.bytes)} ·{" "}
                      {available ? "available" : (stored?.status ?? "missing")}
                    </div>
                  </div>
                  {stored?.downloadUrl ? (
                    <a
                      href={stored.downloadUrl}
                      download={reference.name}
                      className="code-icon-action"
                      aria-label={`Download ${reference.name}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    disabled={readOnly}
                    className="code-small-action border border-[var(--border-default)]"
                    onClick={() =>
                      onChange((draft) => {
                        draft.assets = (draft.assets ?? []).filter(
                          (candidate) => candidate.id !== reference.id,
                        );
                      })
                    }
                  >
                    Remove from version
                  </button>
                  {available ? (
                    <button
                      type="button"
                      disabled={readOnly}
                      className="code-small-action border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] text-[var(--danger)]"
                      onClick={() =>
                        setPendingAssetRevocation({
                          assetId: reference.assetId,
                          label: reference.path,
                        })
                      }
                    >
                      Revoke everywhere
                    </button>
                  ) : null}
                </div>
              );
            })}
            {retainedUnlinkedAssets.length ? (
              <details className="rounded-card border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
                <summary className="cursor-pointer text-micro font-semibold text-[var(--text-primary)]">
                  {retainedUnlinkedAssets.length} retained asset
                  {retainedUnlinkedAssets.length === 1 ? "" : "s"} from earlier
                  versions
                </summary>
                <div className="mt-2 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
                  {retainedUnlinkedAssets.map((asset) => (
                    <div
                      key={asset.assetId}
                      className="flex flex-wrap items-center gap-2 rounded-control bg-[var(--bg-elevated)] px-2.5 py-2 text-micro"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)]">
                        {asset.path || asset.name} ·{" "}
                        {formatBytes(asset.bytes ?? 0)}
                      </span>
                      <button
                        type="button"
                        disabled={
                          readOnly ||
                          !asset.path ||
                          !asset.name ||
                          !asset.mediaType ||
                          !asset.bytes ||
                          !asset.sha256
                        }
                        className="code-small-action border border-[var(--border-default)]"
                        onClick={() => {
                          const currentBytes = (content.assets ?? [])
                            .filter(
                              (reference) =>
                                reference.path.toLowerCase() !==
                                asset.path!.toLowerCase(),
                            )
                            .reduce(
                              (sum, reference) => sum + reference.bytes,
                              0,
                            );
                          if (
                            !asset.bytes ||
                            currentBytes + asset.bytes > 8_000_000
                          ) {
                            setAssetUploadError(
                              "Remove another current asset before attaching this retained version.",
                            );
                            return;
                          }
                          setAssetUploadError(null);
                          onChange((draft) => {
                            if (
                              !asset.path ||
                              !asset.name ||
                              !asset.mediaType ||
                              !asset.bytes ||
                              !asset.sha256
                            )
                              return;
                            const remaining = (draft.assets ?? []).filter(
                              (reference) =>
                                reference.path.toLowerCase() !==
                                asset.path!.toLowerCase(),
                            );
                            draft.assets = [
                              ...remaining,
                              {
                                id: uid("asset-ref"),
                                assetId: asset.assetId,
                                path: asset.path,
                                name: asset.name,
                                mediaType: asset.mediaType,
                                bytes: asset.bytes,
                                sha256: asset.sha256,
                              },
                            ];
                          });
                        }}
                      >
                        Use in current version
                      </button>
                      <button
                        type="button"
                        disabled={readOnly}
                        className="code-small-action text-[var(--danger)]"
                        onClick={() =>
                          setPendingAssetRevocation({
                            assetId: asset.assetId,
                            label: asset.path || asset.name || "this asset",
                          })
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
            {assetLibraryState === "loading" ? (
              <div className="flex items-center justify-center gap-2 rounded-control border border-dashed border-[var(--border-default)] py-5 text-micro text-[var(--text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                Checking permission-bound assets…
              </div>
            ) : null}
            {assetLibraryState === "error" ? (
              <div className="rounded-control border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] px-3 py-3 text-micro text-[var(--danger)]">
                Asset availability could not be checked. Source and references
                are unchanged.
              </div>
            ) : null}
            {assetLibraryState === "ready" && !(content.assets ?? []).length ? (
              <div className="rounded-control border border-dashed border-[var(--border-default)] px-4 py-5 text-center text-micro text-[var(--text-tertiary)]">
                No runtime assets. Add only media the rendered experience
                actually uses.
              </div>
            ) : null}
            {assetUploadError ? (
              <div className="rounded-control border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] px-3 py-3 text-micro text-[var(--danger)]">
                {assetUploadError}
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
            Use a path such as <code>assets/diagram.png</code> in HTML or CSS,
            or call <code>SpectraEmbed.getAsset(referenceId)</code>. Revocation
            is a security action and intentionally disables historical playback
            too.
          </p>
        </section>
        <section
          hidden={settingsSection !== "connections"}
          className="code-settings-card lg:col-span-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3>Permissioned resources</h3>
              <p>
                Connect work or Sheets ranges you have access to. Preview
                code reads them through the Spectra SDK; secrets and details of unrelated work are never included.
              </p>
            </div>
            <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-micro font-semibold text-[var(--text-tertiary)]">
              {(content.resourceBindings ?? []).length} bound
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {(content.resourceBindings ?? []).map((binding, index) => {
              const artifact = artifacts.find(
                (candidate) => candidate._id === binding.artifactId,
              );
              return (
                <div
                  key={binding.id}
                  className="grid gap-2 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,.35fr)_32px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-micro font-semibold text-[var(--text-primary)]">
                      {binding.label ||
                        artifact?.title ||
                        "Unavailable resource"}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-micro text-[var(--text-tertiary)]">
                      {binding.id} ·{" "}
                      {artifact?.blueprintKey?.replaceAll("_", " ") ??
                        "access removed"}
                    </div>
                  </div>
                  {binding.kind === "sheets_range" ? (
                    <input
                      value={binding.range ?? ""}
                      disabled={readOnly}
                      aria-label={`Range for ${binding.label || artifact?.title || "resource"}`}
                      className="code-field-control font-mono text-micro"
                      placeholder="Sheet 1!A1:J30"
                      onChange={(event) =>
                        onChange((draft) => {
                          if (draft.resourceBindings?.[index])
                            draft.resourceBindings[index]!.range =
                              event.target.value;
                        })
                      }
                    />
                  ) : (
                    <span className="text-micro text-[var(--text-tertiary)]">
                      Read-only snapshot
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={readOnly}
                    className="code-icon-action h-8 w-8"
                    aria-label={`Remove ${binding.label || artifact?.title || "resource"}`}
                    onClick={() =>
                      onChange((draft) => {
                        draft.resourceBindings = (
                          draft.resourceBindings ?? []
                        ).filter((candidate) => candidate.id !== binding.id);
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {(content.resourceBindings ?? []).length === 0 ? (
              <div className="rounded-control border border-dashed border-[var(--border-default)] px-4 py-5 text-center text-micro leading-4 text-[var(--text-tertiary)]">
                No resources are exposed to this runtime. Importing work in the editor never gives code access to it automatically.
              </div>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 rounded-card bg-[var(--bg-secondary)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,.35fr)_auto]">
            <SelectField
              ariaLabel="Work to connect"
              size="sm"
              placeholder="Choose accessible work"
              value={bindingArtifactId}
              disabled={readOnly}
              options={availableArtifacts.map((artifact) => ({
                value: artifact._id,
                label: `${artifact.title} · ${artifact.blueprintKey.replaceAll("_", " ")}`,
              }))}
              onChange={setBindingArtifactId}
            />
            {selectedBindingArtifact?.blueprintKey === "sheets" ? (
              <input
                value={bindingRange}
                disabled={readOnly}
                className="code-field-control font-mono text-micro"
                aria-label="Sheets range to bind"
                placeholder="Sheet 1!A1:J30"
                onChange={(event) => setBindingRange(event.target.value)}
              />
            ) : (
              <div className="hidden sm:block" />
            )}
            <button
              type="button"
              disabled={readOnly || !selectedBindingArtifact}
              className="code-small-action justify-center bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:opacity-40"
              onClick={() => {
                if (!selectedBindingArtifact) return;
                onChange((draft) => {
                  draft.resourceBindings = [
                    ...(draft.resourceBindings ?? []),
                    {
                      id: uid("resource"),
                      artifactId: selectedBindingArtifact._id,
                      kind:
                        selectedBindingArtifact.blueprintKey === "sheets"
                          ? "sheets_range"
                          : "artifact",
                      ...(selectedBindingArtifact.blueprintKey === "sheets"
                        ? { range: bindingRange.trim() || "A1:J30" }
                        : {}),
                      label: selectedBindingArtifact.title,
                    },
                  ];
                });
                setBindingArtifactId("");
              }}
            >
              <FilePlus2 className="h-3 w-3" /> Bind resource
            </button>
          </div>
          <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
            Browser code uses <code>@spectra/sdk</code>{" "}
            getResource/listResources. Python uses{" "}
            <code>spectra.get_resource</code> and parses the returned JSON.
            Public builds do not inherit private resource data.
          </p>
        </section>
        <section
          hidden={settingsSection !== "connections"}
          className="code-settings-card lg:col-span-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3>Import recovery</h3>
              <p>
                Every imported source package is retained privately and
                independently of the adapted live file tree.
              </p>
            </div>
            <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-micro font-semibold text-[var(--text-tertiary)]">
              {importHistory.length} retained
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {importHistory.map((item) => (
              <div
                key={item.jobId}
                className="flex flex-wrap items-center gap-3 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5"
              >
                <FileArchive className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-micro font-semibold text-[var(--text-primary)]">
                    {item.name || `Original ${item.format}`}
                  </div>
                  <div className="mt-0.5 text-micro text-[var(--text-tertiary)]">
                    {item.bytes ? formatBytes(item.bytes) : "Size unavailable"}{" "}
                    · {item.status.replaceAll("_", " ")}
                    {item.status === "imported"
                      ? item.artifactVersionId
                        ? " · history linked"
                        : " · history reconciliation pending"
                      : ""}
                    {item.unsupportedFeatures.length
                      ? ` · ${item.unsupportedFeatures.length} quarantined item${item.unsupportedFeatures.length === 1 ? "" : "s"}`
                      : ""}
                  </div>
                </div>
                {item.downloadUrl ? (
                  <a
                    href={item.downloadUrl}
                    className="code-small-action border border-[var(--border-default)]"
                    download={item.name || true}
                  >
                    <Download className="h-3 w-3" />
                    Recover original
                  </a>
                ) : (
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Upload unavailable
                  </span>
                )}
                {item.fidelityReport?.length ? (
                  <details className="w-full border-t border-[var(--border-subtle)] pt-2 text-micro text-[var(--text-secondary)]">
                    <summary className="cursor-pointer font-semibold text-[var(--text-primary)]">
                      Fidelity report
                    </summary>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">
                      {item.fidelityReport.map((entry, index) => (
                        <li key={`${entry.scope}:${index}`}>
                          <strong>{entry.scope}:</strong> {entry.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ))}
            {importHistoryState === "loading" ? (
              <div className="flex items-center justify-center gap-2 rounded-control border border-dashed border-[var(--border-default)] py-5 text-micro text-[var(--text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                Loading retained originals…
              </div>
            ) : null}
            {importHistoryState === "error" ? (
              <div className="rounded-control border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] px-3 py-3 text-micro text-[var(--danger)]">
                Retained originals could not be listed. The live source is
                unaffected.
              </div>
            ) : null}
            {importHistoryState === "ready" && importHistory.length === 0 ? (
              <div className="rounded-control border border-dashed border-[var(--border-default)] px-3 py-5 text-center text-micro text-[var(--text-tertiary)]">
                No source has been imported into this code.
              </div>
            ) : null}
          </div>
        </section>
        <section
          hidden={settingsSection !== "quality"}
          className="code-settings-card lg:col-span-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3>Executable checks</h3>
              <p>
                Each enabled check runs inside the same isolated profile and
                passes only when it completes without throwing.
              </p>
            </div>
            <button
              type="button"
              disabled={readOnly}
              className="code-small-action border border-[var(--border-default)]"
              onClick={() =>
                onChange((draft) => {
                  draft.tests = [
                    ...(draft.tests ?? []),
                    {
                      id: uid("test"),
                      name: `Check ${(draft.tests?.length ?? 0) + 1}`,
                      source:
                        draft.runtime === "python"
                          ? "assert True"
                          : "expect(document.body).toBeTruthy();",
                      enabled: true,
                    },
                  ];
                })
              }
            >
              <FilePlus2 className="h-3 w-3" /> Add check
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {(content.tests ?? []).map((test, index) => (
              <div
                key={test.id}
                className="grid gap-2 rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 md:grid-cols-[24px_minmax(150px,.35fr)_minmax(0,1fr)_28px]"
              >
                <input
                  type="checkbox"
                  checked={test.enabled !== false}
                  disabled={readOnly}
                  aria-label={`Enable ${test.name}`}
                  onChange={(event) =>
                    onChange((draft) => {
                      if (draft.tests?.[index])
                        draft.tests[index]!.enabled = event.target.checked;
                    })
                  }
                />
                <input
                  value={test.name}
                  disabled={readOnly}
                  aria-label="Check name"
                  className="code-field-control"
                  onChange={(event) =>
                    onChange((draft) => {
                      if (draft.tests?.[index])
                        draft.tests[index]!.name = event.target.value;
                    })
                  }
                />
                <textarea
                  value={test.source}
                  disabled={readOnly}
                  aria-label={`${test.name} source`}
                  rows={2}
                  spellCheck={false}
                  className="code-field-control resize-y py-2 font-mono text-micro"
                  onChange={(event) =>
                    onChange((draft) => {
                      if (draft.tests?.[index])
                        draft.tests[index]!.source = event.target.value;
                    })
                  }
                />
                <button
                  type="button"
                  disabled={readOnly}
                  className="code-icon-action h-7 w-7"
                  aria-label={`Delete ${test.name}`}
                  onClick={() =>
                    onChange((draft) => {
                      draft.tests = (draft.tests ?? []).filter(
                        (candidate) => candidate.id !== test.id,
                      );
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {content.tests?.length ? null : (
              <div className="rounded-control border border-dashed border-[var(--border-default)] px-4 py-5 text-center text-micro text-[var(--text-tertiary)]">
                No checks yet. Add focused checks for the behavior that must
                stay correct.
              </div>
            )}
          </div>
        </section>
      </div>
      {pendingAssetRevocation ? (
        <ConfirmDialog
          open
          title="Revoke this asset everywhere?"
          detail={`${pendingAssetRevocation.label} will stop loading in the current work, retained history, and every published or embedded build. This security action cannot be undone.`}
          confirmLabel={
            revokingAssetId === pendingAssetRevocation.assetId
              ? "Revoking..."
              : "Revoke everywhere"
          }
          destructive
          pending={Boolean(revokingAssetId)}
          onCancel={() => {
            if (!revokingAssetId) setPendingAssetRevocation(null);
          }}
          onConfirm={() => void revokeAsset(pendingAssetRevocation.assetId)}
        />
      ) : null}
    </div>
  );
}

function SecurityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-control bg-[var(--bg-secondary)] px-3 py-2 text-micro">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-primary)]">
        <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
        {value}
      </span>
    </div>
  );
}

function EmptyOutput({ text }: { text: string }) {
  return (
    <div className="flex h-20 items-center justify-center text-[var(--text-tertiary)]">
      {text}
    </div>
  );
}

function Notice({
  tone,
  onClose,
  children,
}: {
  tone: "error" | "warning" | "success";
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 border-b px-4 py-2.5 text-micro leading-4 ${tone === "error" ? "border-[color-mix(in_oklab,var(--danger)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] text-[var(--danger)]" : tone === "warning" ? "border-[color-mix(in_oklab,var(--warning)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_6%,var(--bg-primary))] text-[var(--text-secondary)]" : "border-[color-mix(in_oklab,var(--success)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,var(--bg-primary))] text-[var(--text-secondary)]"}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
