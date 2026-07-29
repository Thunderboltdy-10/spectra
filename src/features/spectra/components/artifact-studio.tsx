"use client";

import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BookOpen,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Eye,
  FileDown,
  FileText,
  Focus,
  Grid3X3,
  GripVertical,
  History,
  ImageIcon,
  Import,
  Italic,
  Link2,
  List,
  ListOrdered,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Radio,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Share2,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  Printer,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TiptapLink from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Image } from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { currentTimeMs, shuffleInPlace, uniqueToken } from "@/lib/unique-token";
import { SlashCommand } from "../editor/slash-command-extension";
import { createSlashCommandRenderer } from "../editor/slash-command-renderer";
import {
  spectraObjectKey,
  useSpectraContextStore,
} from "@/stores/spectra-context-store";
import { Callout } from "../editor/callout-node";
import { DragHandle } from "../editor/drag-handle";
import { StableBlockId } from "../editor/stable-block-id";
import {
  AiRegionDecoration,
  aiRegionDecorationKey,
  type AiRegionDecorationTarget,
} from "../editor/ai-region-decoration";
import { Equation, InlineEquation } from "../editor/equation-node";
import {
  aiRegionAttr,
  contentDerivedHighlightPaths,
  creationHighlightFallbackPaths,
  materializeAiChangedPaths,
  pathTouches,
  preferStreamingContentSource,
  resolveAiHighlightPaths,
  updatingHighlightFallbackPaths,
} from "./ai-region-path";
import { blueprintMeta } from "./artifact-card";
import {
  artifactPlacements,
  formatRelativeTime,
  formatShortDate,
  linkedArtifacts,
} from "./spectra-view-model";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getArtifactAssets,
  getSpectraFlashcardStudy,
  getSpectraQuizPracticeAttempts,
  getSpectraArtifactLinks,
  getSpectraArtifactVersions,
  postSpectra,
  reviewSpectraFlashcard,
  saveSpectraQuizPracticeResponse,
  revokeArtifactAsset,
  searchSpectraSchoolMembers,
  startSpectraQuizPractice,
  submitSpectraQuizPractice,
  uploadArtifactAsset,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
  type SpectraArtifactAsset,
  type SpectraArtifactLink,
  type SpectraArtifactVersion,
  type SpectraFlashcardRating,
  type SpectraFlashcardStudyState,
  type SpectraQuizPracticeAttempt,
  type SpectraSchoolMember,
} from "../data/api";
import { ThreadConversation } from "./conversation-surface";
import { Tooltip } from "@/components/ui/tooltip";
import { useArtifactLiveModel } from "../collaboration/use-artifact-live-model";
import { publishArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { resolvePresenceAnchorFromPoint } from "../collaboration/presence-anchor";
import type { CollaborationPresence } from "../collaboration/types";
import {
  ArtifactCommentsPanel,
  type ArtifactCommentRegion,
} from "./artifact-comments-panel";
import { ArtifactEmbedsPanel } from "./artifact-embeds-panel";
import {
  CollaborationCursorLayer,
  CollaborationPresenceIndicator,
} from "./collaboration-presence";
import { InteractionLayer } from "./presence/interaction-layer";
import { useInteractionPresence } from "../collaboration/use-interaction-presence";
import { targetAttrs } from "../collaboration/target-attributes";
import {
  actorLabel,
  describeAct,
  describeState,
  pathSegments,
  stateIsVisible,
  type ActorIdentity,
  type InteractionState,
} from "../collaboration/interaction-model";
import {
  clearAiLocation,
  disengageFollowAi,
  noteAiLocation,
  useFollowAi,
} from "../collaboration/follow-ai";
import { revealTarget } from "../collaboration/interaction-geometry";
import { useJoinLateArrival } from "../collaboration/presentation-lane";
import {
  HELD_DECLINED_EVENT,
  useHeldControlGuard,
  type HeldDeclinedDetail,
} from "../collaboration/held-controls";
import type { ArtifactTypeKey } from "../artifacts/types";
import { changedArtifactRegionIds } from "../collaboration/artifact-yjs-model";
import { isArtifactTypeKey } from "../artifacts/registry";
import { SheetsStudio } from "./sheets-studio";
import { CodeStudio } from "./code-studio";
import { PresentationStudio } from "./presentation-studio";
import { WhiteboardStudio } from "./whiteboard-studio";
import { TimetableStudio } from "./timetable-studio";
import { AgentStudio } from "./agent-studio";
import { SandboxedArtifactRuntime } from "./sandboxed-artifact-runtime";
import {
  codeParameterSnapshot,
  normalizeCodeContent,
  type CodeFile,
} from "../code/model";
import {
  runPythonInIsolatedWorker,
  type PythonRuntimeEvent,
} from "../code/python-runtime";
import { pythonChartToHtml } from "../code/python-chart";
import { loadCodeRuntimeAssets } from "../code/runtime-assets-client";
import type { SpectraSandboxAsset } from "../embed/sandbox-protocol";
import {
  normalizePresentationContent,
  presentationObjectText,
  type PresentationObject,
} from "../presentation/model";
import {
  normalizeSheetsContent,
  parseAddress,
  parseDelimited,
} from "../sheets/model";
import { sharedTimetableContent } from "../timetable/model";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import {
  parseQuizImport,
  validateQuizForPublishing,
  type PortableQuizQuestion,
} from "../quiz/interchange";

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

function studioSyncMessage(syncLabel: string) {
  if (
    syncLabel === "Synchronized" ||
    syncLabel === "Saved" ||
    syncLabel === "Live"
  ) {
    return "Auto-saved";
  }
  return syncLabel;
}

function isSyncReady(syncLabel: string) {
  return (
    syncLabel === "Synchronized" ||
    syncLabel === "Saved" ||
    syncLabel === "Live"
  );
}

type StudioMode = "closed" | "split" | "tab";
type StudioTab = { artifactId: string; openedAt: number };

type DeckCard = {
  id: string;
  variant?: "basic" | "cloze" | "image_occlusion";
  front: string;
  back: string;
  hint?: string;
  explanation?: string;
  acceptedAlternatives?: string[];
  section?: string;
  confidence?: "unknown" | "weak" | "medium" | "strong";
  difficulty?: "easy" | "medium" | "hard";
  learningObjective?: string;
  language?: string;
  bidirectional?: boolean;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
    placement?: "front" | "back";
  };
  occlusions?: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }>;
  sourceRefs?: string[];
  tags?: string[];
  review?: {
    state?: "new" | "learning" | "review" | "mastered";
    correctStreak?: number;
    lastReviewedAt?: number | null;
    nextReviewAt?: number | null;
  };
};

type DeckStudyDirection = "forward" | "reverse";
type DeckStudyItem = {
  cardId: string;
  direction: DeckStudyDirection;
};

function deckStudyKey(cardId: string, direction: DeckStudyDirection) {
  return `${cardId}:${direction}`;
}

function clozeParts(value: string) {
  return [...value.matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi)].map(
    (match) => ({
      index: Number(match[1]),
      answer: match[2] ?? "",
      hint: match[3] ?? "",
      source: match[0],
    }),
  );
}

function clozePrompt(value: string) {
  return value.replace(
    /\{\{c\d+::([\s\S]*?)(?:::(.*?))?\}\}/gi,
    (_source, _answer: string, hint: string | undefined) =>
      hint?.trim() ? `[${hint.trim()}]` : "[…]",
  );
}

function clozeAnswer(value: string) {
  return value.replace(
    /\{\{c\d+::([\s\S]*?)(?:::(.*?))?\}\}/gi,
    (_source, answer: string) => answer,
  );
}

type QuizQuestion = {
  id: string;
  prompt: string;
  type:
    | "multiple_choice"
    | "short_answer"
    | "true_false"
    | "select_all"
    | "ordering"
    | "numeric"
    | "fill_blank"
    | "long_response"
    | "matching";
  options: string[];
  optionIds: string[];
  correctAnswer?: string;
  correctAnswers?: string[];
  numericTolerance?: number;
  rubric?: string;
  matchingPairs?: Array<{ id: string; left: string; right?: string }>;
  matchingChoices?: string[];
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  feedback?: string;
  bloomLevel?:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  standards?: string[];
  tags?: string[];
  poolId?: string;
  poolDrawCount?: number;
  section?: string;
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
  };
};

type QuizSettings = {
  instructions: string;
  showAnswersImmediately: boolean;
  feedbackRelease: "after_submission" | "on_each_response";
  timed: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  targetScore: number;
  maxAttempts?: number;
  allowResume: boolean;
  defaultTimeMultiplier: number;
};

function quizSettingsFromContent(content: unknown): QuizSettings {
  const settings = record(record(content).settings);
  const feedbackRelease =
    settings.feedbackRelease === "on_each_response"
      ? "on_each_response"
      : settings.feedbackRelease === "after_submission"
        ? "after_submission"
        : settings.showAnswersImmediately === true
          ? "on_each_response"
          : "after_submission";
  return {
    instructions:
      typeof settings.instructions === "string" ? settings.instructions : "",
    showAnswersImmediately:
      feedbackRelease === "on_each_response" ||
      settings.showAnswersImmediately === true,
    feedbackRelease,
    timed: settings.timed === true,
    shuffleQuestions: settings.shuffleQuestions === true,
    shuffleOptions: settings.shuffleOptions === true,
    targetScore:
      typeof settings.targetScore === "number"
        ? settings.targetScore
        : typeof settings.passingScore === "number"
          ? settings.passingScore
          : 70,
    maxAttempts:
      typeof settings.maxAttempts === "number"
        ? Math.max(1, Math.min(100, Math.floor(settings.maxAttempts)))
        : undefined,
    allowResume: settings.allowResume !== false,
    defaultTimeMultiplier:
      typeof settings.defaultTimeMultiplier === "number"
        ? Math.max(1, Math.min(3, settings.defaultTimeMultiplier))
        : 1,
  };
}

type PlannerSubtask = { id: string; title: string; done: boolean };
type PlannerAttachment = {
  id: string;
  name: string;
  meta?: string;
  assetId: string;
  mediaType: string;
  bytes: number;
};

type PlannerReminder = {
  id: string;
  minutesBefore: number;
  enabled: boolean;
};

type PlannerRecurrence = {
  frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays: number[];
  untilAt?: number;
  exceptions: number[];
};

type PlannerSource = {
  provider: "managebac" | "import" | "spectra";
  externalId: string;
  version?: string;
  hash?: string;
  status: "active" | "changed" | "removed" | "detached";
  lockedFields: string[];
};

type PlannerPerson = {
  accountId: string;
  name: string;
  email: string;
};

type PlannerTask = {
  taskTitle?: string;
  description?: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "medium" | "high";
  dueAt?: number;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  subtasks: PlannerSubtask[];
  attachments: PlannerAttachment[];
  linkedArtifactIds: string[];
  linkedThreadIds: string[];
  reminders: PlannerReminder[];
  estimateMinutes?: number;
  progressNote?: string;
  sourceRefs: string[];
  timezone: string;
  recurrence: PlannerRecurrence;
  assignees: PlannerPerson[];
  watchers: PlannerPerson[];
  source?: PlannerSource;
  personalOverlay?: {
    targetDueAt?: number;
    note?: string;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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

function setAtPointer(target: unknown, path: string, value: unknown) {
  const segments = pointerSegments(path);
  if (segments.length === 0) return structuredClone(value);
  const root =
    target && typeof target === "object" ? structuredClone(target) : {};
  let current = root as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const nextSegment = segments[index + 1]!;
    const existing = current[segment];
    current[segment] =
      existing && typeof existing === "object"
        ? existing
        : /^\d+$/.test(nextSegment)
          ? []
          : {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = structuredClone(value);
  return root;
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
  return changedPaths.reduce(
    (next, path) => setAtPointer(next, path, valueAtPointer(preview, path)),
    local,
  );
}

function semanticPathToPointer(path: readonly (string | number)[]) {
  return `/${path
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .join("/")}`;
}

function _aiPreviewSections(artifact: SpectraArtifact) {
  const content = record(artifact.aiPreview?.content);
  const rows = Array.isArray(content.blocks)
    ? content.blocks
    : Array.isArray(content.cards)
      ? content.cards
      : Array.isArray(content.questions)
        ? content.questions
        : [];
  return rows.slice(0, 4).flatMap((row): string[] => {
    const item = record(row);
    const label = [
      item.title,
      item.heading,
      item.front,
      item.prompt,
      item.text,
    ].find((value) => typeof value === "string" && value.trim());
    return typeof label === "string" ? [label.trim().slice(0, 90)] : [];
  });
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
}

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function dateInputValue(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeInputValue(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateTimeValue(date: string, time: string) {
  if (!date) return undefined;
  const normalizedTime = time || "09:00";
  return new Date(`${date}T${normalizedTime}:00`).getTime();
}

function formatScheduleDateTime(value?: number) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function tagsFromDraft(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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
        const response = await fetch("/api/spectra/runtime/build", {
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
      const response = await fetch("/api/spectra/runtime/build", {
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
    <section className="mt-6 overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
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
                className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[9px] ${file.id === activeFile.id ? "bg-[var(--bg-elevated)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
              >
                <FileText className="h-3 w-3" />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </aside>
          <div className="min-w-0 bg-[#151713] text-[#e8eadf]">
            <div className="border-b border-white/10 px-3 py-2 text-[8px] text-white/55">
              {activeFile.path} · {activeFile.language}
            </div>
            <pre className="max-h-[520px] overflow-auto p-4 font-mono text-[9px] leading-4">
              {activeFile.source}
            </pre>
          </div>
        </div>
      ) : (
        <div className="p-2">
          <p
            className={`mb-2 rounded-[6px] px-2 py-1.5 text-[8px] ${state === "error" ? "bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-primary))] text-[var(--danger)]" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}
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
            <pre className="max-h-[360px] overflow-auto rounded-[8px] bg-[#151713] p-4 font-mono text-[9px] leading-4 text-[#e8eadf]">
              {consoleLines.join("\n")}
            </pre>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center text-center text-[9px] text-[var(--text-tertiary)]">
              Choose Rebuild safely to render this inert checkpoint.
            </div>
          )}
        </div>
      )}
    </section>
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
  const body = record(snapshot.content);
  const cards =
    blueprintKey === "flashcard_deck" ? deckCards(snapshot.content) : [];
  const questions =
    blueprintKey === "quiz" ? quizQuestions(snapshot.content) : [];
  const blocks = blueprintKey === "document" ? arrayOfRecords(body.blocks) : [];
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
      <h3 className="font-display text-[24px] font-semibold leading-tight">
        {snapshot.title}
      </h3>
      {snapshot.summary ? (
        <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
          {snapshot.summary}
        </p>
      ) : null}
      {blueprintKey === "document" ? (
        <div className="mt-7 space-y-4 text-[13px] leading-6">
          {blocks.map((block, index) => {
            const text = typeof block.text === "string" ? block.text : "";
            const type =
              typeof block.type === "string" ? block.type : "paragraph";
            if (type === "heading")
              return (
                <h4
                  key={String(block.id ?? index)}
                  className="pt-3 font-display text-[20px] font-semibold"
                >
                  {text}
                </h4>
              );
            if (type === "callout")
              return (
                <aside
                  key={String(block.id ?? index)}
                  className="rounded-[9px] border border-[color-mix(in_oklab,var(--accent-mint)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-mint)_6%,var(--bg-primary))] px-4 py-3"
                >
                  {text}
                </aside>
              );
            return (
              <p
                key={String(block.id ?? index)}
                className="whitespace-pre-wrap"
              >
                {text}
              </p>
            );
          })}
        </div>
      ) : null}
      {blueprintKey === "flashcard_deck" ? (
        <div className="mt-6 grid gap-3">
          {cards.map((card, index) => (
            <section
              key={card.id}
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#7560e8]">
                Card {index + 1} · {card.section}
              </div>
              <div className="mt-2 font-display text-[17px] font-semibold">
                {card.front}
              </div>
              <div className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">
                {card.back}
              </div>
              {card.hint ? (
                <div className="mt-3 rounded-[7px] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
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
              className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
            >
              <div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--accent-mint)]">
                Question {index + 1}
              </div>
              <div className="mt-2 font-display text-[17px] font-semibold">
                {question.prompt}
              </div>
              {question.options?.length ? (
                <ol className="mt-3 space-y-1.5 text-[12px] text-[var(--text-secondary)]">
                  {question.options.map((option, optionIndex) => (
                    <li
                      key={`${question.id}:${optionIndex}`}
                      className="rounded-[7px] border border-[var(--border-subtle)] px-3 py-2"
                    >
                      {String.fromCharCode(65 + optionIndex)}. {option}
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
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="grid grid-cols-2 gap-4 text-[11px]">
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
              className="flex items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[12px]"
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
              className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
            >
              <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
                <span className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
                  Slide {index + 1}
                </span>
                <h4 className="mt-1 font-display text-[15px] font-semibold leading-tight">
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
                      className="rounded-[7px] border border-[var(--border-subtle)] px-2.5 py-2"
                    >
                      <span className="block text-[7px] font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                        {humanizeKey(String(object.type ?? "object"))}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap text-[9px] leading-4 text-[var(--text-secondary)]">
                        {historyPresentationObjectSummary(object)}
                      </p>
                    </div>
                  ))}
                {arrayOfRecords(slide.objects).length === 0 ? (
                  <p className="py-3 text-[9px] text-[var(--text-tertiary)]">
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
                className="overflow-hidden rounded-[9px] border border-[var(--border-default)]"
              >
                <header className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-semibold">
                  {String(sheet.name ?? `Sheet ${index + 1}`)}
                </header>
                <div className="grid grid-cols-4 gap-px bg-[var(--border-subtle)]">
                  {visibleCells.map(([address, value]) => (
                    <div
                      key={address}
                      className="min-h-10 bg-[var(--bg-elevated)] px-2 py-1"
                    >
                      <span className="block text-[7px] text-[var(--text-tertiary)]">
                        {address}
                      </span>
                      <span className="block truncate text-[9px]">
                        {humanValue(
                          record(value).value ?? record(value).formula ?? value,
                        )}
                      </span>
                    </div>
                  ))}
                  {visibleCells.length === 0 ? (
                    <div className="col-span-4 p-8 text-center text-[10px] text-[var(--text-tertiary)]">
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
        <div className="relative mt-6 min-h-[430px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[radial-gradient(circle_at_1px_1px,var(--border-subtle)_1px,transparent_0)] bg-[size:20px_20px]">
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
              className="absolute max-w-[150px] rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[9px] shadow-sm"
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
            <div className="flex min-h-[430px] items-center justify-center text-[10px] text-[var(--text-tertiary)]">
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
              className="flex items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3"
            >
              <CalendarCheck2 className="h-4 w-4 text-[var(--accent-cyan)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold">
                  {String(event.title ?? "Untitled event")}
                </div>
                <div className="mt-0.5 text-[8px] text-[var(--text-tertiary)]">
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
            <p className="text-[10px] text-[var(--text-tertiary)]">
              No calendar events.
            </p>
          ) : null}
        </div>
      ) : null}
      {blueprintKey === "agent" ? (
        <div className="mt-6 grid gap-4">
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
            <div className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)]">
              Instructions
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-[var(--text-primary)]">
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
    <section className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
      <div className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 text-[18px] font-semibold text-[var(--text-primary)]">
        {values.length}
      </div>
      <p className="mt-1 line-clamp-3 text-[9px] leading-4 text-[var(--text-secondary)]">
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
  readOnly,
  onSelect,
  onSelectedRegionsChange,
  onRestore,
  onCreateCheckpoint,
  onClose,
}: {
  artifact: SpectraArtifact;
  current: ArtifactSnapshot;
  versions: SpectraArtifactVersion[];
  selected: SpectraArtifactVersion | null;
  changes: HumanChange[];
  selectedRegions: Set<string>;
  busyVersionId: string | null;
  readOnly: boolean;
  onSelect: (version: SpectraArtifactVersion) => void;
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
      className="absolute inset-0 z-[180] flex min-h-0 flex-col bg-[var(--bg-primary)] pb-[88px]"
      aria-label="Version history comparison"
    >
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <History className="h-4 w-4 text-[var(--text-secondary)]" />
          <span className="text-[13px] font-medium text-[var(--text-secondary)]">
            Comparing versions
          </span>
          {selected ? (
            <span className="truncate rounded-[6px] bg-[color-mix(in_oklab,#8b6ff0_8%,var(--bg-secondary))] px-2 py-1 text-[12px] font-medium text-[#6f59cf]">
              Previewing v{selected.versionNumber ?? "—"} from{" "}
              {new Date(selected.createdAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
        >
          <X className="h-3.5 w-3.5" />
          Close comparison
        </button>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="flex min-h-0 flex-col border-r border-[var(--border-default)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
            <div className="min-w-0">
              <h2 className="truncate font-display text-[16px] font-semibold text-[var(--text-primary)]">
                {artifact.title}
              </h2>
              <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
                Historical state is inert; the current artifact remains live and
                editable after comparison closes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowChanges((value) => !value)}
              className={`h-8 rounded-[7px] border px-3 text-[10px] font-medium ${showChanges ? "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-primary))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
            >
              {showChanges
                ? "Show artifact comparison"
                : `${changes.length} changed ${changes.length === 1 ? "field" : "fields"}`}
            </button>
          </div>
          {selected?.after ? (
            showChanges ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
                {changes.map((change, index) => (
                  <article
                    key={`${index}:${change.label}`}
                    className="overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]"
                  >
                    <header className="border-b border-[var(--border-subtle)] px-3 py-2">
                      <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-[var(--text-primary)]">
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
                        <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--danger)]">
                          Selected version
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-[10px] leading-4 text-[var(--text-secondary)]">
                          {change.before}
                        </pre>
                      </div>
                      <div className="bg-[color-mix(in_oklab,var(--accent-cyan)_3%,var(--bg-primary))] p-3">
                        <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--accent-cyan)]">
                          Current live
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-[10px] leading-4 text-[var(--text-primary)]">
                          {change.after}
                        </pre>
                      </div>
                    </div>
                  </article>
                ))}
                {changes.length === 0 ? (
                  <div className="flex min-h-[260px] items-center justify-center text-[11px] text-[var(--text-secondary)]">
                    This version matches the current artifact.
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
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 py-2 backdrop-blur">
                    <span className="text-[9px] font-semibold text-[var(--text-primary)]">
                      Version v{selected.versionNumber ?? "—"}
                    </span>
                    <span className="rounded-[5px] bg-[color-mix(in_oklab,#8b6ff0_8%,var(--bg-secondary))] px-1.5 py-0.5 text-[8px] font-medium text-[#6f59cf]">
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
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 py-2 backdrop-blur">
                    <span className="text-[9px] font-semibold text-[var(--text-primary)]">
                      Current live version
                    </span>
                    <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--success)_8%,var(--bg-secondary))] px-1.5 py-0.5 text-[8px] font-medium text-[var(--success)]">
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
          ) : selected ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-[380px]">
                <AlertCircle className="mx-auto h-5 w-5 text-[var(--warning)]" />
                <h4 className="mt-3 text-[11px] font-semibold text-[var(--text-primary)]">
                  This version cannot be rendered
                </h4>
                <p className="mt-1 text-[9px] leading-4 text-[var(--text-secondary)]">
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
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-[11px] text-[var(--text-secondary)]">
              Select a version from the timeline.
            </div>
          )}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
            <div>
              <div className="text-[10px] font-semibold text-[var(--text-primary)]">
                Restore creates a new version
              </div>
              <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
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
                className="h-8 rounded-[7px] border border-[var(--border-default)] px-3 text-[9px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-35"
              >
                Restore {selectedRegions.size} selected
              </button>
              <button
                type="button"
                disabled={
                  !selected?.after || readOnly || Boolean(busyVersionId)
                }
                onClick={() => selected?.after && onRestore(selected)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#7658ed] px-3 text-[9px] font-semibold text-white disabled:opacity-35"
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
              <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
                Version history
              </h3>
              <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
                {versions.length} meaningful versions
              </p>
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => {
                  setCheckpointOpen((value) => !value);
                  setCheckpointError(null);
                }}
                className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Plus className="h-3 w-3" />
                Checkpoint
              </button>
            ) : null}
          </header>
          {checkpointOpen ? (
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
              <label
                className="text-[8px] font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]"
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
                  className="h-8 min-w-0 flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[9px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  disabled={!checkpointName.trim() || checkpointBusy}
                  onClick={() => void createCheckpoint()}
                  className="h-8 rounded-[7px] bg-[var(--text-primary)] px-2.5 text-[9px] font-semibold text-[var(--bg-primary)] disabled:opacity-35"
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
                  className="mt-2 text-[9px] leading-4 text-[var(--danger)]"
                >
                  {checkpointError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="relative mb-1 flex gap-3 rounded-[8px] px-3 py-2.5">
              <span className="relative z-10 mt-1.5 h-2 w-2 rounded-full bg-[var(--success)]" />
              <div className="absolute bottom-[-8px] left-[18px] top-5 w-px bg-[var(--border-default)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-[var(--text-primary)]">
                    Live
                  </span>
                  <span className="text-[8px] text-[var(--text-tertiary)]">
                    Now
                  </span>
                </div>
                <p className="mt-0.5 text-[8px] text-[var(--text-tertiary)]">
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
                  className={`relative flex w-full gap-3 rounded-[8px] border px-3 py-2.5 text-left ${selectedVersion ? "border-[color-mix(in_oklab,#7658ed_50%,var(--border-default))] bg-[color-mix(in_oklab,#7658ed_5%,var(--bg-primary))]" : "border-transparent hover:bg-[var(--bg-hover)]"}`}
                >
                  <span
                    className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full ${version.source === "ai" ? "bg-[#7658ed]" : version.source === "restore" || version.source === "revert" ? "bg-[#278bd8]" : version.source === "checkpoint" ? "bg-[#8b6ff0]" : "bg-[var(--text-secondary)]"}`}
                  />
                  {index < versions.length - 1 ? (
                    <span className="absolute bottom-[-8px] left-[18px] top-5 w-px bg-[var(--border-default)]" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] font-semibold text-[var(--text-primary)]">
                        v{version.versionNumber ?? versions.length - index}
                      </span>
                      <span className="shrink-0 text-[8px] text-[var(--text-tertiary)]">
                        {new Date(version.createdAt).toLocaleString([], {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-[4px] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[7px] font-medium text-[var(--text-secondary)]">
                        {historyKind(version)}
                      </span>
                      <span className="truncate text-[8px] text-[var(--text-tertiary)]">
                        {creator}
                      </span>
                    </span>
                    {version.summary ? (
                      <span className="mt-1 block line-clamp-2 text-[8px] leading-3.5 text-[var(--text-tertiary)]">
                        {version.summary}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {versions.length === 0 ? (
              <div className="px-4 py-10 text-center text-[10px] leading-5 text-[var(--text-tertiary)]">
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
  return clean.map(humanizeKey).join(" · ") || "Artifact";
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

function contentTextFromJson(node?: JSONContent): string {
  if (!node) return "";
  const own = typeof node.text === "string" ? node.text : "";
  const childText = Array.isArray(node.content)
    ? node.content.map(contentTextFromJson).join(" ")
    : "";
  return `${own} ${childText}`.trim();
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

function documentJsonFromContent(content: unknown, title: string): JSONContent {
  const source = record(content);
  const tiptap = source.tiptap;
  if (tiptap && typeof tiptap === "object" && record(tiptap).type === "doc")
    return normalizeDocumentInlineMarkup(tiptap as JSONContent);
  const blocks = arrayOfRecords(source.blocks);
  const contentNodes =
    blocks.length > 0
      ? blocks.map((block) => {
          const text = typeof block.text === "string" ? block.text : "";
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
          if (type === "heading")
            return {
              type: "heading",
              attrs: {
                level: [1, 2, 3].includes(Number(record(block.attrs).level))
                  ? Number(record(block.attrs).level)
                  : 2,
                ...(typeof block.id === "string" && block.id
                  ? { blockId: block.id }
                  : {}),
              },
              content: inlineMathContent(text),
            };
          if (type === "bulletList") {
            const items = text
              .split(/\r?\n/)
              .map((line) =>
                line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim(),
              )
              .filter(Boolean);
            return {
              type: "bulletList",
              attrs:
                typeof block.id === "string" && block.id
                  ? { blockId: block.id }
                  : undefined,
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
              attrs:
                typeof block.id === "string" && block.id
                  ? { blockId: block.id }
                  : undefined,
              content: [
                {
                  type: "paragraph",
                  content: inlineMathContent(text),
                },
              ],
            };
          return {
            type: "paragraph",
            attrs:
              typeof block.id === "string" && block.id
                ? { blockId: block.id }
                : undefined,
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

function blocksFromJson(json: JSONContent) {
  const nodes = Array.isArray(json.content) ? json.content : [];
  const seenIds = new Set<string>();
  return nodes
    .map((node, index) => {
      let stableId =
        typeof node.attrs?.blockId === "string" && node.attrs.blockId
          ? node.attrs.blockId
          : `block-${index + 1}`;
      if (seenIds.has(stableId)) {
        const base = stableId;
        let n = 2;
        while (seenIds.has(`${base}~${n}`)) n += 1;
        stableId = `${base}~${n}`;
      }
      seenIds.add(stableId);
      if (node.type === "equation")
        return {
          id: stableId,
          type: "equation",
          text: typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          latex: typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
          attrs: {
            display: node.attrs?.display ?? "block",
            alignment: node.attrs?.alignment ?? "center",
          },
        };
      if (node.type === "callout")
        return {
          id: stableId,
          type: "callout",
          text: contentTextFromJson(node),
          attrs: { tone: node.attrs?.tone ?? "info" },
        };
      if (node.type === "table") {
        const rows = (node.content ?? [])
          .map((row) =>
            (row.content ?? [])
              .map((cell) => contentTextFromJson(cell).trim())
              .join(" | "),
          )
          .filter(Boolean);
        return {
          id: stableId,
          type: "table",
          text: rows.join("\n"),
        };
      }
      const text =
        node.type === "bulletList" || node.type === "orderedList"
          ? (node.content ?? [])
              .map((item) => contentTextFromJson(item))
              .filter(Boolean)
              .join("\n")
          : contentTextFromJson(node);
      const type =
        node.type === "heading"
          ? "heading"
          : node.type === "blockquote"
            ? "quote"
            : node.type === "bulletList" || node.type === "orderedList"
              ? "list"
              : "paragraph";
      return {
        id: stableId,
        type,
        text,
        ...(node.type === "heading"
          ? { attrs: { level: Number(node.attrs?.level) || 2 } }
          : {}),
      };
    })
    .filter((block) => block.text.length > 0);
}

function documentContentFromJson(json: JSONContent, previous: unknown) {
  const previousRecord = record(previous);
  const blocks = blocksFromJson(json);
  return {
    ...previousRecord,
    tiptap: json,
    blocks:
      blocks.length > 0
        ? blocks
        : [{ id: "intro", type: "paragraph", text: "" }],
    outline: blocks
      .filter((block) => block.type === "heading")
      .map((block, index) => ({
        id: block.id,
        title: block.text || `Section ${index + 1}`,
        level: 1,
      })),
  };
}

function deckCards(content: unknown): DeckCard[] {
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

function quizQuestions(content: unknown): QuizQuestion[] {
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

function plannerTask(content: unknown): PlannerTask {
  const task = record(content);
  const recurrence = record(task.recurrence);
  const source = record(task.source);
  const personalOverlay = record(task.personalOverlay);
  const fallbackTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezone =
    typeof task.timezone === "string" && task.timezone.trim()
      ? task.timezone.trim()
      : fallbackTimezone;
  const recurrenceFrequency =
    recurrence.frequency === "daily" ||
    recurrence.frequency === "weekly" ||
    recurrence.frequency === "monthly" ||
    recurrence.frequency === "yearly"
      ? recurrence.frequency
      : "none";
  return {
    taskTitle: typeof task.taskTitle === "string" ? task.taskTitle : "",
    description: typeof task.description === "string" ? task.description : "",
    status:
      task.status === "doing" || task.status === "done" ? task.status : "todo",
    priority:
      task.priority === "low" || task.priority === "high"
        ? task.priority
        : "medium",
    dueAt: typeof task.dueAt === "number" ? task.dueAt : undefined,
    startAt: typeof task.startAt === "number" ? task.startAt : undefined,
    endAt: typeof task.endAt === "number" ? task.endAt : undefined,
    allDay: task.allDay === true,
    subtasks: arrayOfRecords(task.subtasks).map((subtask, index) => ({
      id: typeof subtask.id === "string" ? subtask.id : `subtask-${index + 1}`,
      title: typeof subtask.title === "string" ? subtask.title : "",
      done: subtask.done === true,
    })),
    attachments: arrayOfRecords(task.attachments).map((attachment, index) => ({
      id:
        typeof attachment.id === "string"
          ? attachment.id
          : `attachment-${index + 1}`,
      name: typeof attachment.name === "string" ? attachment.name : "",
      meta: typeof attachment.meta === "string" ? attachment.meta : "",
      assetId: typeof attachment.assetId === "string" ? attachment.assetId : "",
      mediaType:
        typeof attachment.mediaType === "string"
          ? attachment.mediaType
          : "application/octet-stream",
      bytes:
        typeof attachment.bytes === "number" &&
        Number.isFinite(attachment.bytes)
          ? Math.max(0, attachment.bytes)
          : 0,
    })),
    linkedArtifactIds: Array.isArray(task.linkedArtifactIds)
      ? task.linkedArtifactIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    linkedThreadIds: Array.isArray(task.linkedThreadIds)
      ? task.linkedThreadIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    reminders: Array.isArray(task.reminders)
      ? task.reminders.flatMap((candidate, index): PlannerReminder[] => {
          if (typeof candidate === "string") {
            const number = Number(candidate.match(/\d+/)?.[0] ?? 30);
            return [
              {
                id: `reminder-${index + 1}`,
                minutesBefore: Math.max(0, Math.min(525_600, number)),
                enabled: true,
              },
            ];
          }
          const reminder = record(candidate);
          if (!Number.isFinite(reminder.minutesBefore)) return [];
          return [
            {
              id:
                typeof reminder.id === "string"
                  ? reminder.id
                  : `reminder-${index + 1}`,
              minutesBefore: Math.max(
                0,
                Math.min(525_600, Number(reminder.minutesBefore)),
              ),
              enabled: reminder.enabled !== false,
            },
          ];
        })
      : [],
    estimateMinutes:
      typeof task.estimateMinutes === "number"
        ? task.estimateMinutes
        : undefined,
    progressNote:
      typeof task.progressNote === "string" ? task.progressNote : "",
    sourceRefs: Array.isArray(task.sourceRefs)
      ? task.sourceRefs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    timezone,
    recurrence: {
      frequency: recurrenceFrequency,
      interval:
        typeof recurrence.interval === "number"
          ? Math.max(1, Math.min(365, Math.round(recurrence.interval)))
          : 1,
      weekdays: Array.isArray(recurrence.weekdays)
        ? recurrence.weekdays
            .filter(
              (item): item is number =>
                typeof item === "number" && item >= 0 && item <= 6,
            )
            .slice(0, 7)
        : [],
      untilAt:
        typeof recurrence.untilAt === "number" ? recurrence.untilAt : undefined,
      exceptions: Array.isArray(recurrence.exceptions)
        ? recurrence.exceptions
            .filter((item): item is number => typeof item === "number")
            .slice(0, 500)
        : [],
    },
    assignees: (arrayOfRecords(task.assignees).length
      ? arrayOfRecords(task.assignees)
      : Array.isArray(task.assigneeIds)
        ? task.assigneeIds.map((accountId) => ({ accountId }))
        : []
    ).map((person, index) => {
      const profile = record(person);
      return {
        accountId:
          typeof profile.accountId === "string"
            ? profile.accountId
            : Array.isArray(task.assigneeIds) &&
                typeof task.assigneeIds[index] === "string"
              ? task.assigneeIds[index]
              : `legacy-assignee-${index + 1}`,
        name: typeof profile.name === "string" ? profile.name : "School member",
        email: typeof profile.email === "string" ? profile.email : "",
      };
    }),
    watchers: (arrayOfRecords(task.watchers).length
      ? arrayOfRecords(task.watchers)
      : Array.isArray(task.watcherIds)
        ? task.watcherIds.map((accountId) => ({ accountId }))
        : []
    ).map((person, index) => {
      const profile = record(person);
      return {
        accountId:
          typeof profile.accountId === "string"
            ? profile.accountId
            : Array.isArray(task.watcherIds) &&
                typeof task.watcherIds[index] === "string"
              ? task.watcherIds[index]
              : `legacy-watcher-${index + 1}`,
        name: typeof profile.name === "string" ? profile.name : "School member",
        email: typeof profile.email === "string" ? profile.email : "",
      };
    }),
    ...(typeof source.externalId === "string" && source.externalId
      ? {
          source: {
            provider:
              source.provider === "managebac" || source.provider === "import"
                ? source.provider
                : ("spectra" as const),
            externalId: source.externalId,
            ...(typeof source.version === "string"
              ? { version: source.version }
              : {}),
            ...(typeof source.hash === "string" ? { hash: source.hash } : {}),
            status:
              source.status === "changed" ||
              source.status === "removed" ||
              source.status === "detached"
                ? source.status
                : "active",
            lockedFields: Array.isArray(source.lockedFields)
              ? source.lockedFields.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
          },
        }
      : {}),
    ...(Object.keys(personalOverlay).length
      ? {
          personalOverlay: {
            ...(typeof personalOverlay.targetDueAt === "number"
              ? { targetDueAt: personalOverlay.targetDueAt }
              : {}),
            ...(typeof personalOverlay.note === "string"
              ? { note: personalOverlay.note }
              : {}),
          },
        }
      : {}),
  };
}

function artifactEditorSnapshot(artifact: SpectraArtifact) {
  return {
    title: artifact.title,
    summary: artifact.summary ?? "",
    tagDraft: (artifact.tags ?? []).join(", "),
    content: artifact.content,
  };
}

function snapshotKey(snapshot: {
  title: string;
  summary: string;
  tagDraft: string;
  content: unknown;
}) {
  return JSON.stringify(snapshot);
}

type ArtifactEditorSnapshot = ReturnType<typeof artifactEditorSnapshot>;

function valuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Rebase an unsaved local draft over a newer collaborative snapshot.
 * Yjs normally makes both views converge before this boundary, but persisted
 * artifact refreshes can race a keystroke. Preserve the local side only where
 * it actually diverged from its baseline, accept remote-only edits, and report
 * the rare same-leaf collision instead of treating every refresh as a conflict.
 */
function rebaseCollaborativeValue(
  baseline: unknown,
  local: unknown,
  incoming: unknown,
  path = "",
): { value: unknown; conflicts: string[] } {
  if (valuesEqual(local, baseline)) return { value: incoming, conflicts: [] };
  if (valuesEqual(incoming, baseline) || valuesEqual(local, incoming))
    return { value: local, conflicts: [] };

  const localRecord =
    local && typeof local === "object" && !Array.isArray(local)
      ? (local as Record<string, unknown>)
      : null;
  const incomingRecord =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : null;
  const baselineRecord =
    baseline && typeof baseline === "object" && !Array.isArray(baseline)
      ? (baseline as Record<string, unknown>)
      : null;

  if (localRecord && incomingRecord && baselineRecord) {
    const value: Record<string, unknown> = {};
    const conflicts: string[] = [];
    const keys = new Set([
      ...Object.keys(baselineRecord),
      ...Object.keys(localRecord),
      ...Object.keys(incomingRecord),
    ]);
    for (const key of keys) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      const merged = rebaseCollaborativeValue(
        baselineRecord[key],
        localRecord[key],
        incomingRecord[key],
        `${path}/${escaped}`,
      );
      if (merged.value !== undefined) value[key] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }

  if (
    Array.isArray(local) &&
    Array.isArray(incoming) &&
    Array.isArray(baseline) &&
    local.length === incoming.length &&
    local.length === baseline.length
  ) {
    const value: unknown[] = [];
    const conflicts: string[] = [];
    for (let index = 0; index < local.length; index += 1) {
      const merged = rebaseCollaborativeValue(
        baseline[index],
        local[index],
        incoming[index],
        `${path}/${index}`,
      );
      value.push(merged.value);
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }

  // Arrays are indivisible only when their shape changed
  // (insert/reorder/delete). Region claims prevent normal same-list
  // contention; retaining local here is safer than duplicating entries.
  return { value: local, conflicts: [path || "/"] };
}

function rebaseCollaborativeSnapshot(
  baseline: ArtifactEditorSnapshot,
  local: ArtifactEditorSnapshot,
  incoming: ArtifactEditorSnapshot,
) {
  const merged = rebaseCollaborativeValue(baseline, local, incoming);
  return {
    snapshot: merged.value as ArtifactEditorSnapshot,
    conflicts: merged.conflicts,
  };
}

function collaborationFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("COLLABORATION_SYNC_TIMEOUT") ||
    message.includes("COLLABORATION_NOT_SYNCHRONIZED")
  )
    return "This edit is still safely held on this device. Spectra will synchronize it when the live connection catches up.";
  if (
    message.includes("COLLABORATION_ACCESS_LOST") ||
    message.includes("COLLABORATION_READ_ONLY")
  )
    return "Your editing access changed before this edit could synchronize.";
  if (
    message.includes("AI_ARTIFACT_SCHEMA_INVALID") ||
    message.includes('"code"') ||
    message.includes("expected array") ||
    message.includes("Invalid input")
  )
    return "This draft contains an unfinished control that cannot synchronize yet. Your local work is preserved.";
  return "This edit has not synchronized yet. Your local work is preserved while Spectra retries.";
}

export function useArtifactStudioState(
  _storageKey: string,
  artifacts: SpectraArtifact[],
) {
  const [synchronizedSnapshots, setSynchronizedSnapshots] = useState(
    () =>
      new Map<
        string,
        {
          syncedAt: number;
          title: string;
          summary: string;
          tagDraft: string;
          content: unknown;
        }
      >(),
  );
  useEffect(() => {
    const receiveSynchronizedArtifact = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            artifactId?: unknown;
            snapshot?: {
              title?: unknown;
              summary?: unknown;
              tagDraft?: unknown;
              content?: unknown;
            };
          }
        | undefined;
      if (
        typeof detail?.artifactId !== "string" ||
        typeof detail.snapshot?.title !== "string" ||
        typeof detail.snapshot.summary !== "string" ||
        typeof detail.snapshot.tagDraft !== "string"
      )
        return;
      setSynchronizedSnapshots((current) => {
        const next = new Map(current);
        next.set(detail.artifactId as string, {
          syncedAt: Date.now(),
          title: detail.snapshot!.title as string,
          summary: detail.snapshot!.summary as string,
          tagDraft: detail.snapshot!.tagDraft as string,
          content: detail.snapshot!.content,
        });
        return next;
      });
    };
    window.addEventListener(
      "spectra:artifact-synchronized",
      receiveSynchronizedArtifact,
    );
    return () =>
      window.removeEventListener(
        "spectra:artifact-synchronized",
        receiveSynchronizedArtifact,
      );
  }, []);
  const openObjects = useSpectraContextStore((state) => state.openObjects);
  const activeOpenObjectKey = useSpectraContextStore(
    (state) => state.activeOpenObjectKey,
  );
  const dirtyArtifactIds = useSpectraContextStore(
    (state) => state.dirtyArtifactIds,
  );
  const openObject = useSpectraContextStore((state) => state.openObject);
  const focusObject = useSpectraContextStore((state) => state.focusObject);
  const deactivateObject = useSpectraContextStore(
    (state) => state.deactivateObject,
  );
  const closeObject = useSpectraContextStore((state) => state.closeObject);
  const setArtifactDirty = useSpectraContextStore(
    (state) => state.setArtifactDirty,
  );
  const artifactById = useMemo(
    () =>
      new Map(
        artifacts.map((artifact) => {
          const synchronized = synchronizedSnapshots.get(artifact._id);
          if (!synchronized || artifact.updatedAt >= synchronized.syncedAt)
            return [artifact._id, artifact] as const;
          return [
            artifact._id,
            {
              ...artifact,
              title: synchronized.title,
              summary: synchronized.summary || undefined,
              tags: tagsFromDraft(synchronized.tagDraft),
              content: synchronized.content,
              updatedAt: synchronized.syncedAt,
            },
          ] as const;
        }),
      ),
    [artifacts, synchronizedSnapshots],
  );
  const studioObjects = useMemo(
    () =>
      openObjects.filter(
        (object) =>
          object.type === "artifact" &&
          (object.presentation === "split" || object.presentation === "tab") &&
          artifactById.has(object.id),
      ),
    [artifactById, openObjects],
  );
  const activeObject =
    studioObjects.find(
      (object) => spectraObjectKey(object) === activeOpenObjectKey,
    ) ?? null;
  const mode: StudioMode =
    activeObject?.presentation === "split" ||
    activeObject?.presentation === "tab"
      ? activeObject.presentation
      : "closed";
  const activeArtifactId = activeObject?.id ?? null;
  const activeArtifact = activeArtifactId
    ? (artifactById.get(activeArtifactId) ?? null)
    : null;
  const tabs = useMemo<StudioTab[]>(
    () =>
      studioObjects
        .filter((object) => object.presentation === "tab")
        .map((object, index) => ({ artifactId: object.id, openedAt: index })),
    [studioObjects],
  );
  const dirtyIds = useMemo(
    () => new Set(dirtyArtifactIds.filter((id) => artifactById.has(id))),
    [artifactById, dirtyArtifactIds],
  );

  const openSplit = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation: "split",
      });
    },
    [openObject],
  );

  const openTab = useCallback(
    (artifact: SpectraArtifact) => {
      openObject({
        type: "artifact",
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
        presentation:
          artifact.blueprintKey === "thread_reference" ? "split" : "tab",
      });
    },
    [openObject],
  );

  const activateTab = useCallback(
    (artifactId: string) => {
      if (focusObject("artifact", artifactId)) return;
      const artifact = artifactById.get(artifactId);
      if (artifact) openTab(artifact);
    },
    [artifactById, focusObject, openTab],
  );

  const closeTab = useCallback(
    (artifactId: string) => {
      closeObject("artifact", artifactId);
    },
    [closeObject],
  );

  const closeStudio = useCallback(() => {
    if (activeArtifactId && mode === "split")
      closeObject("artifact", activeArtifactId);
    else deactivateObject();
  }, [activeArtifactId, closeObject, deactivateObject, mode]);

  const setDirty = useCallback(
    (artifactId: string, dirty: boolean) => {
      setArtifactDirty(artifactId, dirty);
    },
    [setArtifactDirty],
  );

  return {
    mode,
    activeArtifact,
    activeArtifactId,
    tabs,
    dirtyIds,
    isOpen: mode !== "closed" && Boolean(activeArtifact),
    openSplit,
    openTab,
    activateTab,
    closeTab,
    closeStudio,
    setDirty,
  };
}

export function ArtifactStudio({
  mode,
  artifact,
  artifacts,
  busy = false,
  panelWidth,
  sourceLabel,
  onPanelWidthChange,
  onClose,
  onCloseTab,
  onExpand,
  onArchive,
  onShare,
  onDirtyChange,
  onContinueThread,
  continuedThreadId,
  compact = false,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  dirtyIds: Set<string>;
  busy?: boolean;
  panelWidth?: number;
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
  continuedThreadId?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const width =
    panelWidth ??
    Math.round(typeof window === "undefined" ? 720 : window.innerWidth * 0.5);
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

  const threadId =
    artifact.blueprintKey === "thread_reference" &&
    typeof record(artifact.content).threadId === "string"
      ? String(record(artifact.content).threadId).trim()
      : "";
  const body =
    artifact.blueprintKey === "thread_reference" ? (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex min-h-[78px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] text-[#8b6ff0]">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-[20px] font-semibold text-[var(--text-primary)]">
                {artifact.title}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
                Conversation · {sourceLabel}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {threadId && onContinueThread ? (
              <button
                type="button"
                onClick={() => onContinueThread(threadId, artifact.title)}
                className={`flex h-8 w-8 items-center justify-center rounded-[7px] transition ${continuedThreadId === threadId ? "bg-[color-mix(in_oklab,#8b6ff0_14%,var(--bg-hover))] text-[#7256dc]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
                aria-label={
                  continuedThreadId === threadId
                    ? "Stop continuing this chat"
                    : "Continue chat"
                }
                title={
                  continuedThreadId === threadId
                    ? "Stop continuing chat"
                    : "Continue chat"
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
            <IconButton label="Close" onClick={handleClose} icon={X} />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {threadId ? (
            <ThreadConversation
              threadId={threadId}
              compact
              showComposer={false}
            />
          ) : (
            <ThreadReferenceStudio content={artifact.content} />
          )}
        </div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
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
          compact={compact}
        />
      </div>
    );

  if (mode === "tab") {
    return (
      <section className="min-w-0 flex-1 border-l border-[var(--border-default)]">
        {body}
      </section>
    );
  }

  return (
    <StudioSplitShell
      width={width}
      onWidthChange={onPanelWidthChange}
      ariaLabel="Artifact Studio"
      cssWidthVariable="--spectra-studio-width"
      minWidth={560}
    >
      {body}
    </StudioSplitShell>
  );
}

export function StudioSplitShell({
  width,
  onWidthChange,
  ariaLabel,
  cssWidthVariable,
  minWidth = 360,
  contentReserve = 420,
  children,
}: {
  width: number;
  onWidthChange?: (width: number) => void;
  ariaLabel: string;
  cssWidthVariable?: string;
  minWidth?: number;
  /** Minimum main-canvas width kept when fitting this panel. */
  contentReserve?: number;
  children: ReactNode;
}) {
  const resizingRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const host =
      panelRef.current?.closest<HTMLElement>(".spectra-wave-y") ??
      panelRef.current?.parentElement;
    if (cssWidthVariable)
      host?.style.setProperty(cssWidthVariable, `${width}px`);
    return () => {
      if (cssWidthVariable) host?.style.removeProperty(cssWidthVariable);
    };
  }, [cssWidthVariable, width]);
  useEffect(() => {
    if (!onWidthChange) return;
    const updateWidth = onWidthChange;
    function fitPanel() {
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      if (!host) return;
      const peers = Array.from(
        host.querySelectorAll<HTMLElement>("[data-studio-panel]"),
      );
      const siblingWidth = peers
        .filter((candidate) => candidate !== panel)
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const siblingCount = peers.length - 1;
      const reserve =
        siblingCount > 0
          ? Math.max(
              320,
              Math.min(contentReserve, Math.floor(host.clientWidth * 0.28)),
            )
          : contentReserve;
      const floor = siblingCount > 0 ? Math.min(minWidth, 480) : minWidth;
      const hostWidth = host.clientWidth;
      const maximum = Math.max(
        floor,
        Math.min(880, hostWidth - siblingWidth - reserve),
      );
      // Fair share when multiple panels compete: never let one lane take more
      // than ~46% of the host while another panel is open.
      const fairCap =
        siblingCount > 0
          ? Math.max(floor, Math.floor(hostWidth * 0.46))
          : maximum;
      const next = Math.max(floor, Math.min(width, maximum, fairCap));
      if (Math.abs(next - width) >= 8) updateWidth(next);
      else if (width > maximum || width > fairCap)
        updateWidth(Math.min(maximum, fairCap));
      else if (width < floor) updateWidth(floor);
    }
    const frame = window.requestAnimationFrame(fitPanel);
    const host =
      panelRef.current?.closest<HTMLElement>(".spectra-wave-y") ??
      panelRef.current?.parentElement;
    const observer = host ? new ResizeObserver(fitPanel) : null;
    if (host) observer?.observe(host);
    window.addEventListener("resize", fitPanel);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", fitPanel);
    };
  }, [contentReserve, minWidth, onWidthChange, width]);
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!resizingRef.current || !onWidthChange) return;
      const panel = panelRef.current;
      if (!panel) return;
      const host =
        panel.closest<HTMLElement>(".spectra-wave-y") ?? panel.parentElement;
      const panelLeft = panel.getBoundingClientRect().left;
      const peers = host
        ? Array.from(host.querySelectorAll<HTMLElement>("[data-studio-panel]"))
        : [];
      const siblings = peers.filter((candidate) => candidate !== panel);
      const rightSiblingWidth = siblings
        .filter(
          (candidate) => candidate.getBoundingClientRect().left > panelLeft,
        )
        .reduce(
          (total, candidate) => total + candidate.getBoundingClientRect().width,
          0,
        );
      const allSiblingWidth = siblings.reduce(
        (total, candidate) => total + candidate.getBoundingClientRect().width,
        0,
      );
      const hostRight =
        host?.getBoundingClientRect().right ?? window.innerWidth;
      const floor = siblings.length > 0 ? Math.min(minWidth, 300) : minWidth;
      const reserve =
        siblings.length > 0 ? Math.min(contentReserve, 240) : contentReserve;
      const hostWidth = host?.clientWidth ?? window.innerWidth;
      const available = Math.max(floor, hostWidth - allSiblingWidth - reserve);
      const fairCap =
        siblings.length > 0
          ? Math.max(floor, Math.floor(hostWidth * 0.52))
          : available;
      onWidthChange(
        Math.max(
          floor,
          Math.min(
            Math.round(hostRight - event.clientX - rightSiblingWidth),
            Math.min(960, available, fairCap),
          ),
        ),
      );
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [contentReserve, minWidth, onWidthChange]);
  return (
    <aside
      ref={panelRef}
      data-studio-panel
      className="fixed inset-y-0 right-0 z-[90] flex h-full min-w-[280px] max-w-[94vw] shrink-0 border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-[-18px_0_40px_rgba(27,20,12,0.10)] min-[1920px]:relative min-[1920px]:inset-auto min-[1920px]:z-40 min-[1920px]:min-w-[300px]"
      style={{ width, containerType: "inline-size" }}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="absolute -left-1 top-0 z-20 h-full w-2 cursor-ew-resize bg-transparent transition-colors hover:bg-[color-mix(in_oklab,var(--text-tertiary)_18%,transparent)]"
        aria-label={`Resize ${ariaLabel}`}
        onPointerDown={(event) => {
          event.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </aside>
  );
}

export function StudioTabRail({
  hubTabs,
  activeHubTabId,
  artifacts,
  tabs,
  activeArtifactId = null,
  dirtyIds,
  onActivateHub,
  onCloseHub,
  onAddHub,
  onActivateTab,
  onCloseTab,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}: {
  hubTabs: Array<{ id: string; label: string }>;
  activeHubTabId: string | null;
  artifacts: SpectraArtifact[];
  tabs: StudioTab[];
  activeArtifactId?: string | null;
  dirtyIds: Set<string>;
  onActivateHub: (hubTabId: string) => void;
  onCloseHub: (hubTabId: string) => void;
  onAddHub: () => void;
  onActivateTab: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}) {
  const [shellSlot, setShellSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setShellSlot(document.getElementById("spectra-shell-tab-slot"));
  }, []);

  const tabClass = (active: boolean) =>
    `group flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-[12px] font-medium transition ${
      active
        ? "border-[color-mix(in_oklab,var(--brand-primary)_36%,var(--border-default))] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_0_2px_var(--brand-primary),0_1px_6px_rgba(27,20,12,0.06)]"
        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    }`;

  const rail = (
    <div
      className={`flex min-h-0 min-w-0 flex-1 items-center overflow-hidden ${shellSlot ? "h-full bg-transparent px-0" : "h-12 shrink-0 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,var(--bg-primary))] px-3.5"}`}
    >
      <div className="mr-1.5 flex shrink-0 items-center gap-0.5 border-r border-[var(--border-subtle)] pr-1.5">
        <button
          type="button"
          aria-label="Go back"
          title="Go back"
          disabled={!canGoBack || !onGoBack}
          onClick={onGoBack}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Go forward"
          title="Go forward"
          disabled={!canGoForward || !onGoForward}
          onClick={onGoForward}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="spectra-studio-tab-scroller inline-flex w-max max-w-full items-center gap-1.5 overflow-x-auto pr-1">
        {hubTabs.map((hubTab) => {
          const active = activeHubTabId === hubTab.id;
          return (
            <button
              key={hubTab.id}
              type="button"
              className={tabClass(active)}
              onClick={() => onActivateHub(hubTab.id)}
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-left">
                {hubTab.label}
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${hubTab.label}`}
                className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseHub(hubTab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseHub(hubTab.id);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
        {tabs.map((tab) => {
          const artifact = artifacts.find(
            (item) => item._id === tab.artifactId,
          );
          if (!artifact) return null;
          const meta = blueprintMeta[artifact.blueprintKey];
          const Icon = meta.icon;
          const active = activeArtifactId === artifact._id;
          return (
            <button
              key={tab.artifactId}
              type="button"
              className={tabClass(active)}
              onClick={() => onActivateTab(artifact._id)}
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: meta.color }}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {artifact.title}
              </span>
              {dirtyIds.has(artifact._id) ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-gold)]"
                  title="Unsaved changes"
                />
              ) : null}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${artifact.title}`}
                className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={(event) => {
                  event.stopPropagation();
                  if (dirtyIds.has(artifact._id)) {
                    onActivateTab(artifact._id);
                    requestAnimationFrame(() =>
                      window.dispatchEvent(
                        new CustomEvent("spectra:request-artifact-close", {
                          detail: { artifactId: artifact._id },
                        }),
                      ),
                    );
                  } else onCloseTab(artifact._id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (dirtyIds.has(artifact._id)) {
                      onActivateTab(artifact._id);
                      requestAnimationFrame(() =>
                        window.dispatchEvent(
                          new CustomEvent("spectra:request-artifact-close", {
                            detail: { artifactId: artifact._id },
                          }),
                        ),
                      );
                    } else onCloseTab(artifact._id);
                  }
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={onAddHub}
          aria-label="Open a new home view"
          title="Open a new home view"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  if (shellSlot) return createPortal(rail, shellSlot);
  return rail;
}

function ArtifactStudioEditor({
  mode,
  artifact,
  artifacts,
  busy,
  sourceLabel,
  onClose,
  onExpand,
  onOpenArtifact,
  onArchive,
  onShare,
  onDirtyChange,
  compact,
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
  compact: boolean;
}) {
  const permissionReadOnly = artifact.accessLevel === "read";
  // The live room is the editing substrate, not a feature unlocked by sharing.
  // Owners need the identical interaction fabric for private AI work; access
  // policy still decides who else may authenticate into that room.
  const isCollaborativeArtifact = true;
  const accessExplanation =
    artifact.ownership === "shared"
      ? artifact.accessReason === "workspace_inheritance"
        ? `Access through ${artifact.placements?.map((placement) => placement.workspaceTitle).join(", ") || "a workspace"}`
        : "Shared directly with you"
      : null;
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
      : null,
  );
  const livePermissionLost =
    isCollaborativeArtifact && live.state === "permission_lost";
  const readOnly =
    permissionReadOnly ||
    livePermissionLost ||
    (isCollaborativeArtifact && live.supported && live.level === "read");
  const [title, setTitle] = useState(artifact.title);
  const [summary, setSummary] = useState(artifact.summary ?? "");
  const [tagDraft, setTagDraft] = useState((artifact.tags ?? []).join(", "));
  const [content, setContent] = useState<unknown>(artifact.content);
  const [baseline, setBaseline] = useState(() =>
    artifactEditorSnapshot(artifact),
  );
  const [dirty, setDirty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeCommentRegionId, setActiveCommentRegionId] = useState<string>();
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const detailsEligible =
    artifact.blueprintKey !== "planner_task" &&
    artifact.blueprintKey !== "thread_reference";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsPinnedRef = useRef(false);
  const [aiHighlightDismissed, setAiHighlightDismissed] = useState(false);
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] =
    useState<SpectraArtifactVersion | null>(null);
  const [selectedRestoreRegions, setSelectedRestoreRegions] = useState<
    Set<string>
  >(() => new Set());
  const [remoteConflict, setRemoteConflict] = useState<ReturnType<
    typeof artifactEditorSnapshot
  > | null>(null);
  const [dismissedRemoteKey, setDismissedRemoteKey] = useState<string | null>(
    null,
  );
  const [previewClock, setPreviewClock] = useState(() => Date.now());
  const [syncBusy, setSyncBusy] = useState(false);
  const [liveConflict, setLiveConflict] = useState<{
    message: string;
    claimId?: string;
    regionId?: string;
    queuePosition?: number;
  } | null>(null);
  const meta = blueprintMeta[artifact.blueprintKey];
  const Icon = meta.icon;
  const dirtyRef = useRef(dirty);
  // A snapshot difference is not, by itself, evidence of a local edit. Rich
  // editors normalize their document during hydration and streamed AI updates
  // reconcile several fields across separate React commits. Track user intent
  // explicitly so a freshly opened or AI-updated artifact never advertises
  // unsaved work that the student did not create.
  const userHasEditedRef = useRef(false);

  useEffect(() => {
    detailsPinnedRef.current = false;
    setDetailsOpen(false);
  }, [artifact._id, detailsEligible]);

  useEffect(() => {
    if (mode !== "tab") return;
    window.dispatchEvent(
      new CustomEvent("spectra:page-context", {
        detail: {
          source: sourceLabel,
          kind: meta.label,
          title: artifact.title,
        },
      }),
    );
    const shareFromShell = () => onShare?.();
    window.addEventListener("spectra:page-share", shareFromShell);
    return () => {
      window.removeEventListener("spectra:page-share", shareFromShell);
      window.dispatchEvent(new Event("spectra:clear-page-context"));
    };
  }, [artifact._id, artifact.title, meta.label, mode, onShare, sourceLabel]);
  // Updating the four editor fields and their baseline is intentionally a
  // single logical reconciliation, but React commits those state updates
  // independently. Without this guard the intermediate render (new baseline,
  // old fields) marks the editor dirty and the next streamed AI patch is then
  // mistaken for a user/remote conflict. The visible editor consequently stays
  // stale until it is closed and reopened.
  const reconcilingRemoteRef = useRef(false);
  const activeArtifactIdRef = useRef(artifact._id);
  const currentSnapshotRef = useRef(artifactEditorSnapshot(artifact));
  const aiMergeRef = useRef<{
    paths: string[];
    title: boolean;
    summary: boolean;
    tags: boolean;
  } | null>(null);
  const localSyncKeysRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const reconciliationFrameRef = useRef<number | null>(null);
  const incomingSnapshot = useMemo(
    () => ({
      title: live.liveValue.title,
      summary: live.liveValue.summary ?? "",
      tagDraft: live.liveValue.tags.join(", "),
      content: live.liveValue.content,
    }),
    [live.liveValue],
  );
  const currentSnapshot = useMemo(
    () => ({ title, summary, tagDraft, content }),
    [content, summary, tagDraft, title],
  );
  const synchronizeDraft = useCallback(
    async (snapshot = currentSnapshotRef.current) => {
      if (
        artifact.blueprintKey === "thread_reference" ||
        permissionReadOnly ||
        syncingRef.current ||
        !snapshot.title.trim()
      )
        return false;
      const key = snapshotKey(snapshot);
      syncingRef.current = true;
      localSyncKeysRef.current.add(key);
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
            // The user may continue editing while the transport retry is in
            // flight (spreadsheet paste/data entry makes this easy to hit).
            // Only clear local intent when the synchronized snapshot is still
            // the current one; otherwise an older acknowledgement can make a
            // subsequent remote snapshot erase newer cells.
            if (
              snapshotKey(currentSnapshotRef.current) === snapshotKey(snapshot)
            )
              userHasEditedRef.current = false;
            return true;
          }
        }
        const result = await live.synchronize({
          title: snapshot.title.trim(),
          ...(snapshot.summary.trim()
            ? { summary: snapshot.summary.trim() }
            : {}),
          content: snapshot.content,
          tags: tagsFromDraft(snapshot.tagDraft),
        });
        if (result && "applied" in result && result.applied === false) {
          localSyncKeysRef.current.delete(key);
          const claim = "claim" in result ? result.claim : undefined;
          setLiveConflict({
            message:
              "This region is being edited by another collaborator. Your draft is preserved and queued without overwriting their work.",
            claimId: claim?.claimId,
            regionId: claim?.conflict?.regionId,
            queuePosition: claim?.conflict?.queuePosition,
          });
          return false;
        }
        const acknowledgedValue = live.model?.getSnapshot().value;
        if (acknowledgedValue) {
          const acknowledged = {
            title: acknowledgedValue.title,
            summary: acknowledgedValue.summary ?? "",
            tagDraft: acknowledgedValue.tags.join(", "),
            content: acknowledgedValue.content,
          };
          localSyncKeysRef.current.add(snapshotKey(acknowledged));
          // Region decomposition may normalize IDs/defaults while applying an
          // otherwise identical draft (notably code line IDs). Reconcile to
          // the locally acknowledged Yjs value so byte-level normalization
          // cannot leave the editor in an endless save loop. Never replace
          // keystrokes made while the network request was in flight.
          if (
            snapshotKey(currentSnapshotRef.current) === snapshotKey(snapshot)
          ) {
            reconcilingRemoteRef.current = true;
            userHasEditedRef.current = false;
            setTitle(acknowledged.title);
            setSummary(acknowledged.summary);
            setTagDraft(acknowledged.tagDraft);
            setContent(acknowledged.content);
            setBaseline(acknowledged);
            setDirty(false);
          } else {
            setBaseline(acknowledged);
          }
          window.dispatchEvent(
            new CustomEvent("spectra:artifact-synchronized", {
              detail: { artifactId: artifact._id, snapshot: acknowledged },
            }),
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("spectra:artifact-synchronized", {
              detail: { artifactId: artifact._id, snapshot },
            }),
          );
        }
        return true;
      } catch (error) {
        localSyncKeysRef.current.delete(key);
        if (isCollaborativeArtifact) {
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
      artifact._id,
      artifact.blueprintKey,
      isCollaborativeArtifact,
      live,
      permissionReadOnly,
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
        .map((regionId) => live.model?.descriptor(regionId))
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
    live.model,
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
  const activeAiCollaborator = useMemo(() => {
    const aiCollaborators = live.presence.filter(
      (person) =>
        person.actorKind === "ai" ||
        person.interactionState?.actor.kind === "ai",
    );
    // Protocol v2 is authoritative: one actor frame owns presence, native
    // choreography, provisional content, contention and lifecycle. The v1
    // preview fields remain only as a bounded compatibility fallback.
    return (
      aiCollaborators.find(
        (person) =>
          person.interactionState && stateIsVisible(person.interactionState),
      ) ??
      aiCollaborators.find((person) => person.previewPhase === "streaming") ??
      aiCollaborators.find(
        (person) => (person.previewPatches?.length ?? 0) > 0,
      ) ??
      null
    );
  }, [live.presence]);
  const activeAiPreviewPatches = useMemo(
    () =>
      activeAiCollaborator?.interactionState?.speculation?.patches?.length
        ? activeAiCollaborator.interactionState.speculation.patches
        : (activeAiCollaborator?.previewPatches ?? []),
    [activeAiCollaborator],
  );
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
    let next: {
      title: string;
      summary: string;
      tags: string[];
      content: unknown;
    } = {
      title,
      summary,
      tags: tagsFromDraft(tagDraft),
      content,
    };
    const paths: string[] = [];
    for (const patch of activeAiPreviewPatches) {
      const outerPointer = livePreviewOuterPointer(patch.path);
      next = setAtPointer(next, outerPointer, patch.value) as typeof next;
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
                const descriptor = live.model?.descriptor(regionId);
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
      live.model,
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
              const descriptor = live.model?.descriptor(
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
      live.model,
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
  const displayPresence = live.presence;
  /** Peers that have not adopted the semantic protocol yet. */
  const legacyPresence = useMemo(
    () => displayPresence.filter((person) => !person.interactionState),
    [displayPresence],
  );
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

  const presenceRegionForPath = useCallback(
    (path: string) => {
      const segments = pathSegments(path);
      if (segments[0] === "title") return "metadata:title";
      if (segments[0] === "summary") return "metadata:summary";
      if (segments[0] === "tags") return "metadata:tags";
      return live.modelSnapshot.regionIds
        .map((regionId) => live.model?.descriptor(regionId))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .filter((entry) =>
          entry.path.every(
            (segment, index) => String(segments[index]) === String(segment),
          ),
        )
        .sort((left, right) => right.path.length - left.path.length)[0]
        ?.regionId;
    },
    [live.model, live.modelSnapshot.regionIds],
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
    window.dispatchEvent(
      new CustomEvent("spectra:reveal-target", {
        detail: { artifactId: artifact._id, path: target.path },
      }),
    );
    const timer = window.setTimeout(() => {
      const surface = presenceSurfaceRef.current;
      if (surface) revealTarget(surface, target);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [followAi.following, aiInteractionState, artifact._id]);

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
    let next: unknown = durableEditorContent;
    let documentBlocksAreSpeculative = false;
    for (const [pointer, value] of remoteSpeculation) {
      const contentPointer = livePreviewContentPointer(pointer);
      if (!contentPointer) continue;
      if (/^\/blocks(?:\/|$)/.test(contentPointer))
        documentBlocksAreSpeculative = true;
      next =
        contentPointer === "/"
          ? (value ?? next)
          : setAtPointer(next, contentPointer, value);
    }
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

  const setActivePresence = useCallback(
    (
      regionId: string,
      options?: { mode?: "typing" | "focus" | "selecting" },
    ) => {
      try {
        const mode = options?.mode ?? "focus";
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
  const lastStudioInteractionAtRef = useRef(0);
  const noteStudioInteraction = useCallback(() => {
    lastStudioInteractionAtRef.current = Date.now();
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
      live.transport?.setPresence({
        actorKind: "human",
        selection: {
          kind: "text",
          collapsed,
          ...(typeof detail.text === "string"
            ? { text: detail.text.slice(0, 280) }
            : {}),
          ranges: Array.isArray(detail.ranges) ? detail.ranges : [],
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
    const snapshotsDiffer =
      snapshotKey(currentSnapshot) !== snapshotKey(baseline);
    const nextDirty = userHasEditedRef.current && snapshotsDiffer;
    if (reconcilingRemoteRef.current) {
      if (!nextDirty) reconcilingRemoteRef.current = false;
      dirtyRef.current = false;
      setDirty(false);
      return;
    }
    if (!snapshotsDiffer) userHasEditedRef.current = false;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
  }, [baseline, currentSnapshot]);

  useEffect(() => {
    const switchedArtifacts = activeArtifactIdRef.current !== artifact._id;
    if (!switchedArtifacts && dirtyRef.current) {
      const incomingKey = snapshotKey(incomingSnapshot);
      if (
        incomingKey !== snapshotKey(baseline) &&
        incomingKey !== dismissedRemoteKey
      ) {
        if (localSyncKeysRef.current.delete(incomingKey)) {
          setBaseline(incomingSnapshot);
          setLiveConflict(null);
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
        } else if (isCollaborativeArtifact) {
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
          dirtyRef.current = true;
          setDirty(true);
          window.requestAnimationFrame(() => {
            reconcilingRemoteRef.current = false;
          });
        } else setRemoteConflict(incomingSnapshot);
      }
      return;
    }
    activeArtifactIdRef.current = artifact._id;
    reconcilingRemoteRef.current = true;
    userHasEditedRef.current = false;
    dirtyRef.current = false;
    setDirty(false);
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
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
  ]);

  useEffect(
    () => () => {
      if (reconciliationFrameRef.current !== null)
        window.cancelAnimationFrame(reconciliationFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    function requestClose(event: Event) {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      if (artifactId === artifact._id) void closeAfterSynchronization();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
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
      void closeAfterSynchronization();
    }
    window.addEventListener("spectra:request-artifact-close", requestClose);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(
        "spectra:request-artifact-close",
        requestClose,
      );
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", onKeyDown);
    };
    // closeAfterSynchronization is declared later; dirty/panel flags already retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close handler closes over latest studio state
  }, [artifact._id, commentsOpen, dirty, embedsOpen, historyOpen]);

  useEffect(() => {
    if (
      !dirty ||
      readOnly ||
      busy ||
      // Speculative AI previews must never freeze human region sync. Peers
      // render AI frames via awareness; durable Yjs writes remain region-
      // scoped and only claim the blocks the human actually changed.
      liveConflict?.claimId ||
      syncBusy
    )
      return;
    const timer = window.setTimeout(
      () => void synchronizeDraft(currentSnapshotRef.current),
      liveConflict ? 420 : 140,
    );
    return () => window.clearTimeout(timer);
  }, [busy, dirty, liveConflict, readOnly, syncBusy, synchronizeDraft]);

  useEffect(() => {
    if (!liveConflict?.claimId || !live.transport) return;
    const renew = () =>
      void postSpectra({
        action: "renewRegionClaim",
        claimId: liveConflict.claimId,
        clientId: live.transport!.clientId,
      }).catch(() => undefined);
    const timer = window.setInterval(renew, 9_000);
    return () => window.clearInterval(timer);
  }, [live.transport, liveConflict?.claimId]);

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
    dirtyRef.current = true;
    setDirty(true);
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

  function changeContent(next: unknown) {
    if (readOnly) return;
    userHasEditedRef.current = true;
    reconcilingRemoteRef.current = false;
    dirtyRef.current = true;
    setDirty(true);
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
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return false;
    if (artifact.blueprintKey === "thread_reference") return false;
    const snapshot = {
      title: trimmedTitle,
      summary: summary.trim(),
      tagDraft: tagsFromDraft(tagDraft).join(", "),
      content,
    };
    return synchronizeDraft(snapshot);
  }

  async function closeAfterSynchronization() {
    if (!dirty) {
      onClose();
      return;
    }
    const synchronized = await save();
    if (synchronized) onClose();
  }

  async function discardQueuedDraft() {
    if (liveConflict?.claimId && live.transport) {
      await postSpectra({
        action: "releaseRegionClaim",
        claimId: liveConflict.claimId,
        clientId: live.transport.clientId,
        resolution: "keep_current",
      }).catch(() => undefined);
    }
    // Destroy the rejected Y.Doc before rebuilding from the authoritative
    // server log. Reusing incomingSnapshot here would preserve the rejected
    // local update because that snapshot is derived from the same Y.Doc.
    live.recoverAuthoritative();
    const authoritative = artifactEditorSnapshot(artifact);
    reconcilingRemoteRef.current = true;
    setTitle(authoritative.title);
    setSummary(authoritative.summary);
    setTagDraft(authoritative.tagDraft);
    setContent(authoritative.content);
    setBaseline(authoritative);
    setDirty(false);
    userHasEditedRef.current = false;
    setLiveConflict(null);
    window.requestAnimationFrame(() => {
      reconcilingRemoteRef.current = false;
    });
  }

  async function restoreVersion(
    version: SpectraArtifactVersion,
    regionIds?: readonly string[],
  ) {
    if (readOnly) return;
    if (!version.after) {
      setLiveConflict({
        message:
          "This historical snapshot is unavailable and cannot be restored until it is repaired.",
      });
      return;
    }
    setHistoryBusy(version._id);
    try {
      // History actions commonly follow the last auto-save by only a few
      // milliseconds. Treat that save as part of the same ordered session
      // instead of silently dropping the restore while `syncingRef` is held.
      const syncDeadline = Date.now() + 12_000;
      while (syncingRef.current && Date.now() < syncDeadline)
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
      if (!live.supported) throw new Error("ARTIFACT_LIVE_MODEL_UNAVAILABLE");
      // A restore is its own semantic operation. Close any preceding human
      // session first so ordinary edits cannot be mislabeled as a restore.
      await postSpectra({
        action: "commitArtifactCurrentSession",
        artifactId: artifact._id,
        clientId: live.transport?.clientId,
        summary: "Edited before restore",
      });
      const snapshot = version.after;
      const target = {
        title: snapshot.title,
        ...(snapshot.summary ? { summary: snapshot.summary } : {}),
        content: snapshot.content,
        tags: snapshot.tags,
      };
      const incoming = {
        title: target.title,
        summary: target.summary ?? "",
        tagDraft: target.tags.join(", "),
        content: target.content,
      };
      if (!regionIds?.length)
        localSyncKeysRef.current.add(snapshotKey(incoming));
      const result = regionIds?.length
        ? await live.restoreRegions(target, regionIds)
        : await live.synchronize(target);
      if (result && "applied" in result && result.applied === false) {
        const claim = "claim" in result ? result.claim : undefined;
        setLiveConflict({
          message:
            "A collaborator is editing a region included in this restore. Nothing was overwritten; the restore remains queued for review.",
          claimId: claim?.claimId,
          regionId: claim?.conflict?.regionId,
          queuePosition: claim?.conflict?.queuePosition,
        });
        return;
      }
      await postSpectra({
        action: "commitArtifactRestore",
        artifactId: artifact._id,
        sourceVersionId: version._id,
        clientId: live.transport?.clientId,
      });
      setHistoryOpen(false);
    } catch (error) {
      setLiveConflict({
        message:
          error instanceof Error
            ? error.message
            : "This restore could not be applied safely.",
      });
    } finally {
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
    const result = await getSpectraArtifactVersions(artifact._id, 100);
    setVersions(result.versions);
    setPreviewVersion(result.versions[0] ?? null);
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
    setDirty(false);
    userHasEditedRef.current = false;
    setRemoteConflict(null);
    setDismissedRemoteKey(null);
  }

  // Planner tasks already provide the purpose-built schedule/links sidebar
  // shown in their source-of-truth layout. Nesting the generic artifact
  // details rail beside it creates an unusable three-column editor.
  const showDetails =
    detailsOpen && !compact && artifact.blueprintKey !== "planner_task";
  const contentMode = compact ? ("split" as const) : mode;
  const editorLayoutClass = showDetails
    ? mode === "tab"
      ? "mx-auto grid w-[calc(100%+10px)] max-w-[1690px] gap-3 xl:grid-cols-[minmax(0,1fr)_302px]"
      : "grid gap-3 min-[560px]:grid-cols-[minmax(0,1fr)_min(240px,38%)]"
    : "block";
  const mainClass =
    artifact.blueprintKey === "document"
      ? "min-h-0 flex-1 overflow-y-auto pb-5"
      : "min-h-0 flex-1 overflow-y-auto pb-5 pl-[15px] pr-0 pt-1";
  const liveConflictLabel = liveConflict?.regionId
    ? live.model?.descriptor(liveConflict.regionId)?.label
    : undefined;
  const collaboratorCount = displayPresence.filter(
    (person) => person.clientId !== live.transport?.clientId,
  ).length;
  const currentAccountId = live.accountId;
  const commentRegions = useMemo<ArtifactCommentRegion[]>(() => {
    const semantic = live.modelSnapshot.regionIds.map((regionId) => {
      const descriptor = live.model?.descriptor(regionId);
      return {
        regionId,
        label: descriptor?.label || descriptor?.kind || regionId,
        kind: descriptor?.kind,
      };
    });
    return [
      { regionId: "metadata:title", label: "Artifact title", kind: "metadata" },
      {
        regionId: "metadata:summary",
        label: "Artifact summary",
        kind: "metadata",
      },
      ...semantic,
    ];
  }, [live.model, live.modelSnapshot.regionIds]);
  const handleActiveRegionChange = useCallback(
    (regionId: string) => {
      setActiveCommentRegionId(regionId);
      setActivePresence(regionId, { mode: "typing" });
    },
    [setActivePresence],
  );
  const syncLabel = livePermissionLost
    ? "Access removed"
    : readOnly
      ? "Read-only"
      : isCollaborativeArtifact
        ? live.state === "reconnecting" || live.state === "unsynchronized"
          ? "Reconnecting"
          : live.state === "connecting" || live.state === "synchronizing"
            ? "Synchronizing"
            : syncBusy || live.unsynchronizedChanges > 0 || dirty
              ? "Waiting to sync"
              : live.modelSnapshot.validity === "invalid"
                ? "Needs attention"
                : "Live"
        : syncBusy || dirty
          ? "Saving…"
          : "Saved";
  const visibleIdentityTags = tagDraft
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
  const waveCBlueprint = WAVE_C_BLUEPRINTS.has(artifact.blueprintKey);
  const artifactSyncMessage = studioSyncMessage(syncLabel);
  const identityBlock = (
    <div
      className={`spectra-artifact-identity flex w-full items-start ${compact ? "gap-3 px-5 pb-5" : artifact.blueprintKey === "document" ? "gap-4 px-6 pb-2" : artifact.blueprintKey === "quiz" || waveCBlueprint ? "gap-[10px] px-2 pb-0" : "gap-4 px-1 pb-2"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="rounded-[7px]">
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
            className={`min-h-8 w-full resize-none overflow-hidden bg-transparent font-display font-semibold leading-tight text-[var(--text-primary)] outline-none [field-sizing:content] ${compact ? "text-[28px]" : "text-[32px]"}`}
            placeholder="Untitled artifact"
          />
        </div>
        <div className="mt-0.5 rounded-[7px]">
          <input
            value={presencePreview?.summary ?? summary}
            readOnly={readOnly}
            onFocus={() => {
              setActiveCommentRegionId("metadata:summary");
              setActivePresence("metadata:summary", { mode: "typing" });
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
            className="w-full bg-transparent text-[14px] leading-6 text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-tertiary)]"
            placeholder="Short useful summary"
          />
        </div>
        {artifact.blueprintKey === "quiz" && visibleIdentityTags.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {visibleIdentityTags.map((tag) => (
              <span
                key={tag}
                className="rounded-[6px] bg-[#eaf8f2] px-2 py-1 text-[10px] font-medium text-[#27836a]"
              >
                {tag}
              </span>
            ))}
            <button
              type="button"
              aria-label="Add quiz tag"
              className="grid size-6 place-items-center rounded-[6px] border border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              onClick={() => setDetailsOpen(true)}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        ) : null}
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
      <CollaborationCursorLayer
        presence={legacyPresence}
        currentClientId={live.transport?.clientId}
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
      <header className="spectra-artifact-header flex shrink-0 flex-col bg-transparent">
        <div className="spectra-artifact-header-topline flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[color-mix(in_oklab,currentColor_24%,transparent)] bg-[color-mix(in_oklab,currentColor_9%,var(--bg-elevated))]"
              style={{ color: meta.color }}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="truncate text-[11px] font-semibold uppercase tracking-[.13em] text-[var(--text-tertiary)]">
              {meta.label}
            </span>
          </div>
          <div className="spectra-artifact-header-actions flex shrink-0 items-center gap-2">
            <span
              className="hidden items-center gap-1.5 text-[11px] text-[var(--text-secondary)] sm:inline-flex"
              role="status"
              aria-live="polite"
            >
              {syncLabel === "Saved" || syncLabel === "Live" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
              ) : syncBusy ||
                live.state === "connecting" ||
                live.state === "synchronizing" ||
                live.state === "reconnecting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" />
              ) : (
                <Circle className="h-3 w-3 fill-[#d88922] text-[#d88922]" />
              )}
              {syncLabel}
              {isCollaborativeArtifact && collaboratorCount > 0
                ? ` · ${collaboratorCount} here`
                : ""}
            </span>
            {isCollaborativeArtifact || collaboratorCount > 0 ? (
              <CollaborationPresenceIndicator
                presence={displayPresence}
                currentClientId={live.transport?.clientId}
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
                    studio.querySelector<HTMLElement>(
                      '[data-ai-region="true"]',
                    );
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
                      items[
                        Math.min(lineIndex, Math.max(0, items.length - 1))
                      ] ?? target;
                  }
                  focus.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                    behavior: "smooth",
                  });
                }}
              />
            ) : null}
            {onShare ? (
              <IconButton
                label="Share artifact"
                onClick={onShare}
                icon={Share2}
              />
            ) : null}
            <IconButton
              label="Comments"
              onClick={() => setCommentsOpen(true)}
              icon={MessageSquare}
            />
            <IconButton
              label="Embedded artifacts"
              onClick={() => setEmbedsOpen(true)}
              icon={Link2}
            />
            {artifact.blueprintKey !== "planner_task" ? (
              <IconButton
                label={detailsOpen ? "Close details" : "Open details"}
                onClick={() => {
                  detailsPinnedRef.current = true;
                  setDetailsOpen((open) => !open);
                }}
                icon={PanelRight}
              />
            ) : null}
            {mode === "split" ? (
              <IconButton
                label="Open as tab"
                onClick={onExpand}
                icon={Maximize2}
              />
            ) : null}
            <IconButton
              label="Version history"
              onClick={() => {
                setHistoryOpen(true);
                void getSpectraArtifactVersions(artifact._id, 100).then(
                  (result) => {
                    setVersions(result.versions);
                    setPreviewVersion(
                      result.versions.find((version) => version.after) ??
                        result.versions[0] ??
                        null,
                    );
                  },
                );
              }}
              icon={History}
            />
            <IconButton
              label={dirty ? "Synchronize before closing" : "Close"}
              onClick={() => void closeAfterSynchronization()}
              icon={X}
            />
          </div>
        </div>
        <div className="min-w-0">{identityBlock}</div>
      </header>
      {readOnly && !livePermissionLost ? (
        <div className="shrink-0 border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-2 text-[11px] text-[var(--text-secondary)]">
          Read-only access{accessExplanation ? ` · ${accessExplanation}` : ""} ·
          You can inspect, comment, and place this artifact, but only a
          collaborator with modify access can change it.
        </div>
      ) : accessExplanation ? (
        <div className="shrink-0 border-y border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-2 text-[11px] text-[var(--text-secondary)]">
          {accessExplanation} · You can modify this artifact.
        </div>
      ) : null}
      {livePermissionLost ? (
        <div
          role="alert"
          className="shrink-0 border-y border-[color-mix(in_oklab,var(--danger)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--danger)]"
        >
          Your access changed while this artifact was open. Editing has stopped
          and no further changes will be queued.
        </div>
      ) : null}
      {!permissionReadOnly &&
      isCollaborativeArtifact &&
      (live.state === "reconnecting" || live.state === "unsynchronized") ? (
        <div className="relative z-[60] h-0 shrink-0">
          <div
            role="status"
            className="spectra-collaboration-notice absolute right-3 top-2"
          >
            Connection interrupted. Reconnecting while keeping your draft.
          </div>
        </div>
      ) : null}
      {isCollaborativeArtifact && liveConflict ? (
        <div className="relative z-[61] h-0 shrink-0">
          <div
            role="alert"
            className="spectra-collaboration-notice absolute right-3 top-2 flex items-center gap-2"
          >
            <span className="min-w-0 flex-1">
              {liveConflict.message}
              {liveConflictLabel ? ` · ${liveConflictLabel}` : ""}
              {liveConflict.queuePosition
                ? ` · Waiting ${liveConflict.queuePosition === 1 ? "next" : `at position ${liveConflict.queuePosition}`}`
                : ""}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-medium"
              onClick={() => void synchronizeDraft(currentSnapshotRef.current)}
            >
              Retry
            </button>
            <button
              type="button"
              className="shrink-0 rounded-[6px] px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)]"
              onClick={() => void discardQueuedDraft()}
            >
              Use latest
            </button>
          </div>
        </div>
      ) : null}
      {isCollaborativeArtifact &&
      (live.initializationError ||
        live.modelSnapshot.validity === "invalid") ? (
        <div
          role="alert"
          className="shrink-0 border-y border-[color-mix(in_oklab,var(--danger)_24%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] px-5 py-2 text-[11px] text-[var(--danger)]"
        >
          {live.initializationError ??
            live.modelSnapshot.error ??
            "The live artifact state needs recovery before editing can continue."}
        </div>
      ) : null}
      {remoteConflict ? (
        <div className="shrink-0 border-b border-[color-mix(in_oklab,#d88922_28%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#d88922]" />
            <span className="min-w-0 flex-1">
              A newer saved version arrived while you were editing. Your local
              changes are still untouched.
            </span>
            <button
              type="button"
              onClick={keepLocalEdits}
              className="rounded-[7px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Keep local edits
            </button>
            <button
              type="button"
              onClick={reloadRemoteVersion}
              className="rounded-[7px] bg-[var(--text-primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg-primary)]"
            >
              Reload latest
            </button>
          </div>
        </div>
      ) : null}
      <main
        ref={presenceSurfaceRef}
        className={`spectra-artifact-main ${mainClass}`}
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
        <InteractionLayer
          states={remoteInteractionStates}
          localClientId={live.transport?.clientId}
        />
        <div className={`spectra-editor-layout ${editorLayoutClass}`}>
          <section className="min-w-0">
            {artifact.blueprintKey === "document" ? (
              <DocumentStudio
                key={`${artifact._id}:document`}
                artifactId={artifact._id}
                title={title}
                content={editorContent}
                onChange={editorChange}
                aiChangedPaths={highlightPaths}
                readOnly={readOnly}
                header={null}
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
                synchronizationReady={isSyncReady(syncLabel)}
              />
            ) : null}
            {artifact.blueprintKey === "planner_task" ? (
              <PlannerStudio
                key={`${artifact._id}:planner`}
                mode={contentMode}
                artifact={artifact}
                artifacts={artifacts}
                tagDraft={tagDraft}
                onTagDraftChange={(value) => changeBase({ tagDraft: value })}
                content={editorContent}
                onChange={editorChange}
                aiChangedPaths={highlightPaths}
                onArchive={onArchive}
                onOpenArtifact={onOpenArtifact}
                readOnly={readOnly}
                onActiveRegionChange={handleActiveRegionChange}
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
                synchronizationReady={isSyncReady(syncLabel)}
                syncMessage={artifactSyncMessage}
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
                synchronizationReady={isSyncReady(syncLabel)}
                syncMessage={artifactSyncMessage}
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
                synchronizationReady={isSyncReady(syncLabel)}
                syncMessage={artifactSyncMessage}
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
                synchronizationReady={isSyncReady(syncLabel)}
                syncMessage={artifactSyncMessage}
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
                synchronizationReady={isSyncReady(syncLabel)}
                syncMessage={artifactSyncMessage}
                onActiveRegionChange={handleActiveRegionChange}
              />
            ) : null}
            {artifact.blueprintKey === "agent" ? (
              <AgentStudio
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
                  artifact.capabilities?.includes("publish") ??
                  artifact.ownership === "owned"
                }
                onActiveRegionChange={handleActiveRegionChange}
              />
            ) : null}
            {artifact.blueprintKey === "thread_reference" ? (
              <ThreadReferenceStudio content={content} />
            ) : null}
          </section>
          {showDetails ? (
            <StudioDetails
              artifact={artifact}
              artifacts={artifacts}
              tagDraft={tagDraft}
              onTagDraftChange={(value) => changeBase({ tagDraft: value })}
              onArchive={onArchive}
              onOpenArtifact={onOpenArtifact}
            />
          ) : null}
        </div>
      </main>
      {/* Pinned to the pane, not to the scrolling content: the reason an edit
          was declined must not scroll away from the user who triggered it. */}
      {heldNotice ? (
        <div className="spectra-held-notice" role="status">
          <span className="spectra-held-notice-dot" aria-hidden="true" />
          <span>{heldNotice.message}</span>
        </div>
      ) : null}
      <ArtifactCommentsPanel
        open={commentsOpen}
        artifactId={artifact._id}
        artifactTitle={title || artifact.title}
        regions={commentRegions}
        preferredRegionId={activeCommentRegionId}
        currentAccountId={currentAccountId}
        onClose={() => setCommentsOpen(false)}
      />
      <ArtifactEmbedsPanel
        open={embedsOpen}
        containerId={artifact._id}
        containerTitle={title || artifact.title}
        artifacts={artifacts}
        regions={commentRegions}
        onOpenSource={onOpenArtifact}
        onClose={() => setEmbedsOpen(false)}
      />
      {historyOpen ? (
        <HistoryComparisonOverlay
          artifact={artifact}
          current={{
            title,
            summary: summary || undefined,
            content,
            tags: tagsFromDraft(tagDraft),
          }}
          versions={versions}
          selected={previewVersion}
          changes={previewDiff}
          selectedRegions={selectedRestoreRegions}
          busyVersionId={historyBusy}
          readOnly={readOnly}
          onSelect={setPreviewVersion}
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

function escapeDocumentHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadDocumentText(name: string, type: string, value: string) {
  downloadDocumentBlob(name, new Blob([value], { type }));
}

function downloadDocumentBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function artifactBlobSha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function plannerAssetMediaType(file: File) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      pdf: "application/pdf",
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      json: "application/json",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      odp: "application/vnd.oasis.opendocument.presentation",
    } as Record<string, string>
  )[extension ?? ""];
}

function plannerBytesLabel(bytes: number) {
  if (bytes >= 1_000_000)
    return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function escapePlannerIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function plannerIcsDate(timestamp: number, allDay = false) {
  const value = new Date(timestamp).toISOString();
  return allDay
    ? value.slice(0, 10).replaceAll("-", "")
    : value.replaceAll("-", "").replaceAll(":", "").replace(".000", "");
}

function plannerRecurrenceRrule(recurrence: PlannerRecurrence) {
  if (recurrence.frequency === "none") return undefined;
  const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`,
    recurrence.frequency === "weekly" && recurrence.weekdays.length
      ? `BYDAY=${recurrence.weekdays.map((day) => weekdays[day]).join(",")}`
      : "",
    recurrence.untilAt ? `UNTIL=${plannerIcsDate(recurrence.untilAt)}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function exportPlannerTaskIcs(task: PlannerTask, fallbackTitle: string) {
  const start = task.startAt ?? task.dueAt ?? Date.now();
  const due = task.dueAt ?? task.endAt ?? start;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spectra//Planner//EN",
    "BEGIN:VTODO",
    `UID:${escapePlannerIcs(task.source?.externalId || `spectra-${start}`)}@spectra`,
    `DTSTAMP:${plannerIcsDate(Date.now())}`,
    `SUMMARY:${escapePlannerIcs(task.taskTitle || fallbackTitle)}`,
    `STATUS:${task.status === "done" ? "COMPLETED" : task.status === "doing" ? "IN-PROCESS" : "NEEDS-ACTION"}`,
    `PRIORITY:${task.priority === "high" ? "1" : task.priority === "low" ? "9" : "5"}`,
  ];
  if (task.description)
    lines.push(
      `DESCRIPTION:${escapePlannerIcs(plannerDescriptionText(task.description))}`,
    );
  if (task.startAt)
    lines.push(
      `DTSTART${task.allDay ? ";VALUE=DATE" : ""}:${plannerIcsDate(task.startAt, task.allDay)}`,
    );
  if (task.dueAt)
    lines.push(
      `DUE${task.allDay ? ";VALUE=DATE" : ""}:${plannerIcsDate(due, task.allDay)}`,
    );
  const rrule = plannerRecurrenceRrule(task.recurrence);
  if (rrule) lines.push(`RRULE:${rrule}`);
  task.reminders
    .filter((reminder) => reminder.enabled)
    .forEach((reminder) =>
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:-PT${reminder.minutesBefore}M`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapePlannerIcs(task.taskTitle || fallbackTitle)}`,
        "END:VALARM",
      ),
    );
  lines.push("END:VTODO", "END:VCALENDAR");
  return lines.join("\r\n");
}

function plannerCsvValue(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n\t]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function plannerDelimitedRows(source: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("The delimited file has an unclosed quote.");
  return rows;
}

function parsePlannerIcsDate(value: string) {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean))
    return new Date(
      `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00`,
    ).getTime();
  const match = clean.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/,
  );
  if (!match) return new Date(clean).getTime();
  const [, year, month, day, hour, minute, second, utc] = match;
  return new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${utc || ""}`,
  ).getTime();
}

function parsePlannerRrule(value: string): PlannerRecurrence {
  const pairs = new Map(
    value.split(";").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.toUpperCase() ?? "", rest.join("=")];
    }),
  );
  const frequencyValue = pairs.get("FREQ")?.toLowerCase();
  const frequency =
    frequencyValue === "daily" ||
    frequencyValue === "weekly" ||
    frequencyValue === "monthly" ||
    frequencyValue === "yearly"
      ? frequencyValue
      : "none";
  const weekdayMap: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };
  const interval = Number(pairs.get("INTERVAL") || 1);
  const untilAt = pairs.get("UNTIL")
    ? parsePlannerIcsDate(pairs.get("UNTIL")!)
    : undefined;
  return {
    frequency,
    interval: Number.isFinite(interval)
      ? Math.max(1, Math.min(365, Math.round(interval)))
      : 1,
    weekdays: (pairs.get("BYDAY") ?? "")
      .split(",")
      .map((day) => weekdayMap[day])
      .filter((day): day is number => typeof day === "number"),
    ...(untilAt && Number.isFinite(untilAt) ? { untilAt } : {}),
    exceptions: [],
  };
}

function sanitizeDocumentHtml(source: string) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed
    .querySelectorAll(
      "script,style,iframe,object,embed,form,input,button,meta,link,base",
    )
    .forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        (name === "style" && /url\s*\(|expression\s*\(/i.test(value)) ||
        ((name === "href" || name === "src") &&
          /^(?:javascript|vbscript|data:text\/html)/i.test(value))
      )
        element.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML;
}

function markdownToDocumentHtml(source: string) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };
  const inline = (value: string) =>
    escapeDocumentHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      output.push(
        `<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`,
      );
    } else if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        list = kind;
        output.push(`<${kind}>`);
      }
      output.push(`<li>${inline((bullet ?? ordered)![1]!)}</li>`);
    } else if (line.startsWith("> ")) {
      closeList();
      output.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    } else closeList();
  }
  closeList();
  return output.join("");
}

function documentMarkdown(json: JSONContent) {
  const renderInline = (node: JSONContent): string => {
    if (node.type === "text") {
      let value = node.text ?? "";
      const marks = node.marks ?? [];
      if (marks.some((mark) => mark.type === "code")) value = `\`${value}\``;
      if (marks.some((mark) => mark.type === "bold")) value = `**${value}**`;
      if (marks.some((mark) => mark.type === "italic")) value = `*${value}*`;
      const link = marks.find((mark) => mark.type === "link");
      if (link?.attrs?.href) value = `[${value}](${String(link.attrs.href)})`;
      return value;
    }
    if (node.type === "inlineEquation")
      return `$${String(node.attrs?.latex ?? "")}$`;
    return (node.content ?? []).map(renderInline).join("");
  };
  const render = (node: JSONContent, depth = 0): string => {
    if (node.type === "heading")
      return `${"#".repeat(Number(node.attrs?.level) || 2)} ${renderInline(node)}`;
    if (node.type === "paragraph") return renderInline(node);
    if (node.type === "blockquote")
      return renderInline(node)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    if (node.type === "bulletList" || node.type === "orderedList")
      return (node.content ?? [])
        .map((item, index) => {
          const prefix = node.type === "orderedList" ? `${index + 1}.` : "-";
          return `${"  ".repeat(depth)}${prefix} ${renderInline(item)}`;
        })
        .join("\n");
    if (node.type === "equation")
      return `$$\n${String(node.attrs?.latex ?? "")}\n$$`;
    if (node.type === "codeBlock")
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${renderInline(node)}\n\`\`\``;
    if (node.type === "callout") return `> ${renderInline(node)}`;
    if (node.type === "table")
      return (node.content ?? [])
        .map(
          (row) => `| ${(row.content ?? []).map(renderInline).join(" | ")} |`,
        )
        .join("\n");
    return (node.content ?? [])
      .map((child) => render(child, depth + 1))
      .join("\n\n");
  };
  return render(json).trim();
}

function DocumentStudio({
  artifactId,
  title,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  header,
}: {
  artifactId: string;
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  header: ReactNode;
}) {
  const [initialContent] = useState(() =>
    documentJsonFromContent(content, title),
  );
  const [, refreshToolbar] = useState(0);
  const [importing, setImporting] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("https://");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findDraft, setFindDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [findCursor, setFindCursor] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [pageLayout, setPageLayout] = useState<"page" | "continuous">(
    "continuous",
  );
  const [importReport, setImportReport] = useState<string>();
  const [importError, setImportError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const editorReadyForUserChanges = useRef(false);
  const editorJsonKeyRef = useRef(JSON.stringify(initialContent));

  useEffect(() => {
    if (!focusMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setFocusMode(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusMode]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        underline: false,
      }),
      Underline,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true, lastColumnResizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true, inline: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      Callout,
      Equation,
      InlineEquation,
      DragHandle,
      StableBlockId,
      AiRegionDecoration,
      Placeholder.configure({ placeholder: "Type / for commands" }),
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          render: createSlashCommandRenderer,
        },
      }),
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[620px] px-2 pb-24 pt-2 outline-none font-serif text-[19px] leading-8 text-[var(--text-primary)]",
      },
    },
    onUpdate: ({ editor }) => {
      const nextJson = editor.getJSON();
      editorJsonKeyRef.current = JSON.stringify(nextJson);
      refreshToolbar((value) => value + 1);
      // Extension normalization can emit an update during the editor's mount
      // frame even when the user changed nothing. Treat that frame as editor
      // hydration; genuine input begins immediately afterward.
      if (!editorReadyForUserChanges.current || readOnly) return;
      onChange(documentContentFromJson(nextJson, content));
    },
    onSelectionUpdate: ({ editor }) => {
      refreshToolbar((value) => value + 1);
      const { from, to, empty } = editor.state.selection;
      const ranges: Array<{
        blockId: string;
        startOffset: number;
        endOffset: number;
      }> = [];
      let primaryBlockId: string | undefined;
      let caretOffset = 0;
      editor.state.doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
        if (typeof node.attrs?.blockId !== "string" || !node.attrs.blockId)
          return;
        const blockStart = pos + 1;
        const blockEnd = pos + node.nodeSize - 1;
        const startOffset = Math.max(0, Math.min(from, to) - blockStart);
        const endOffset = Math.max(
          startOffset,
          Math.min(blockEnd, Math.max(from, to)) - blockStart,
        );
        if (!primaryBlockId) {
          primaryBlockId = node.attrs.blockId;
          caretOffset = startOffset;
        }
        ranges.push({
          blockId: node.attrs.blockId,
          startOffset,
          endOffset,
        });
      });
      const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
      editor.view.dom.dispatchEvent(
        new CustomEvent("spectra-presence-selection", {
          bubbles: true,
          detail: {
            kind: "text",
            collapsed: empty,
            ...(text ? { text: text.slice(0, 280) } : {}),
            ranges,
            caretOffset,
            primaryBlockId,
          },
        }),
      );
    },
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const markUserInput = () => {
      editorReadyForUserChanges.current = true;
    };
    const element = editor.view.dom;
    element.addEventListener("pointerdown", markUserInput, { once: true });
    element.addEventListener("keydown", markUserInput, { once: true });
    element.addEventListener("beforeinput", markUserInput, { once: true });
    element.addEventListener("paste", markUserInput, { once: true });
    return () => {
      element.removeEventListener("pointerdown", markUserInput);
      element.removeEventListener("keydown", markUserInput);
      element.removeEventListener("beforeinput", markUserInput);
      element.removeEventListener("paste", markUserInput);
    };
  }, [editor]);

  const incomingEditorJson = useMemo(
    () => documentJsonFromContent(content, title),
    [content, title],
  );
  useEffect(() => {
    if (!editor) return;
    const incomingKey = JSON.stringify(incomingEditorJson);
    const contentChanged = incomingKey !== editorJsonKeyRef.current;
    if (contentChanged) editorJsonKeyRef.current = incomingKey;
    const lineTargets = aiChangedPaths.flatMap<
      NonNullable<AiRegionDecorationTarget["lines"]>[number]
    >((path) => {
      const lineMatch = path.match(
        /^\/(?:content\/)?blocks\/(?:id:|byId\/)?([^/]+)\/lines\/(\d+)/i,
      );
      if (!lineMatch) return [];
      const raw = decodeURIComponent(
        lineMatch[1]!.replaceAll("~1", "/").replaceAll("~0", "~"),
      );
      const line = Number(lineMatch[2]);
      if (!Number.isFinite(line)) return [];
      if (/^\d+$/.test(raw)) return [{ index: Number(raw), line }];
      return [{ blockId: raw, line }];
    });
    // Line-scoped paths must never also paint the whole block / whole doc —
    // that is the mid-stream cyan wash that fails G-01/G-02 Excellent.
    const hasLineScope = lineTargets.length > 0;
    const target: AiRegionDecorationTarget | null = aiChangedPaths.length
      ? {
          all: !hasLineScope && aiChangedPaths.includes("/"),
          indices: hasLineScope
            ? []
            : aiChangedPaths.flatMap((path) => {
                const match = path.match(
                  /^\/(?:content\/)?blocks\/(\d+)(?:\/|$)/,
                );
                return match ? [Number(match[1])] : [];
              }),
          blockIds: hasLineScope
            ? []
            : aiChangedPaths.flatMap((path) => {
                const byId = path.match(
                  /^\/(?:content\/)?blocks\/(?:id:|byId\/)([^/]+)/i,
                );
                if (byId)
                  return [byId[1]!.replaceAll("~1", "/").replaceAll("~0", "~")];
                // TipTap StableBlockId may be referenced without the id: prefix.
                const bare = path.match(
                  /^\/(?:content\/)?blocks\/([^/]+)(?:\/|$)/i,
                );
                if (bare && !/^\d+$/.test(bare[1]!))
                  return [
                    decodeURIComponent(
                      bare[1]!.replaceAll("~1", "/").replaceAll("~0", "~"),
                    ),
                  ];
                return [];
              }),
          lines: lineTargets,
        }
      : null;
    // Effects already run after React's commit. Apply the projection now:
    // requestAnimationFrame is throttled in an unfocused collaborator window,
    // and cancelling the preceding callback for every 112 ms presence beat can
    // starve TipTap indefinitely, leaving a peer on a provisional prefix.
    if (editor.isDestroyed) return;
    if (contentChanged)
      editor.commands.setContent(incomingEditorJson, { emitUpdate: false });
    editor.view.dispatch(
      editor.state.tr.setMeta(aiRegionDecorationKey, target),
    );
  }, [aiChangedPaths, editor, incomingEditorJson]);

  const equationActive = editor?.isActive("equation") ?? false;
  const equationAttrs = equationActive
    ? (editor?.getAttributes("equation") ?? {})
    : {};

  const editorText = editor?.getText({ blockSeparator: "\n" }) ?? "";
  const wordCount = editorText.trim()
    ? editorText.trim().split(/\s+/).length
    : 0;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 220));
  const outlineEntries = (() => {
    const entries: Array<{ title: string; level: number; position: number }> =
      [];
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name === "heading")
        entries.push({
          title: node.textContent || "Untitled section",
          level: Number(node.attrs.level) || 2,
          position: position + 1,
        });
    });
    return entries;
  })();
  const findMatches = (() => {
    const matches: Array<{ from: number; to: number }> = [];
    const query = findDraft.trim().toLocaleLowerCase();
    if (!editor || !query) return matches;
    editor.state.doc.descendants((node, position) => {
      if (!node.isText || !node.text) return;
      const source = node.text.toLocaleLowerCase();
      let cursor = 0;
      while (cursor < source.length) {
        const index = source.indexOf(query, cursor);
        if (index < 0) break;
        matches.push({
          from: position + index,
          to: position + index + query.length,
        });
        cursor = index + Math.max(1, query.length);
      }
    });
    return matches;
  })();

  function selectFindMatch(direction = 1) {
    if (!editor || !findMatches.length) return;
    const next =
      (findCursor + direction + findMatches.length) % findMatches.length;
    const match = findMatches[next]!;
    setFindCursor(next);
    editor.chain().focus().setTextSelection(match).scrollIntoView().run();
  }

  function replaceAllMatches() {
    if (!editor || !findDraft || readOnly) return;
    const expression = new RegExp(
      findDraft.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    const transform = (node: JSONContent): JSONContent => ({
      ...node,
      ...(node.type === "text" && typeof node.text === "string"
        ? { text: node.text.replace(expression, replaceDraft) }
        : {}),
      ...(Array.isArray(node.content)
        ? { content: node.content.map(transform) }
        : {}),
    });
    editorReadyForUserChanges.current = true;
    editor.commands.setContent(transform(editor.getJSON()));
  }

  function applyDocumentTemplate(kind: "notes" | "essay" | "lab") {
    if (!editor || readOnly) return;
    const template =
      kind === "notes"
        ? `<h1>Study notes</h1><div data-callout="true"><p>Key idea</p></div><h2>Core concepts</h2><ul><li>Add the first important concept</li><li>Connect it to prior knowledge</li></ul><h2>Questions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>What still needs clarification?</p></li></ul>`
        : kind === "essay"
          ? `<h1>Essay title</h1><p><em>State the central argument in one precise sentence.</em></p><h2>Introduction</h2><p>Establish context and your thesis.</p><h2>Argument</h2><p>Develop evidence and analysis.</p><h2>Counterargument</h2><p>Address the strongest alternative interpretation.</p><h2>Conclusion</h2><p>Synthesize the argument without repeating it.</p>`
          : `<h1>Lab report</h1><h2>Research question</h2><p>What are you investigating?</p><h2>Hypothesis</h2><p>State a testable prediction.</p><h2>Method</h2><ol><li>Describe the procedure.</li></ol><h2>Results</h2><table><tbody><tr><th><p>Variable</p></th><th><p>Observation</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Conclusion</h2><p>Interpret the evidence and limitations.</p>`;
    editorReadyForUserChanges.current = true;
    editor.commands.setContent(template);
    setToolsOpen(false);
  }

  async function exportDocument(
    format: "docx" | "pdf" | "html" | "md" | "txt",
  ) {
    if (!editor) return;
    const safeTitle = (title.trim() || "Spectra document").replace(
      /[<>:"/\\|?*]/g,
      "-",
    );
    if (format === "html") {
      downloadDocumentText(
        `${safeTitle}.html`,
        "text/html;charset=utf-8",
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeDocumentHtml(title)}</title></head><body>${editor.getHTML()}</body></html>`,
      );
    } else if (format === "md") {
      downloadDocumentText(
        `${safeTitle}.md`,
        "text/markdown;charset=utf-8",
        documentMarkdown(editor.getJSON()),
      );
    } else if (format === "txt") {
      downloadDocumentText(
        `${safeTitle}.txt`,
        "text/plain;charset=utf-8",
        editorText,
      );
    } else if (format === "pdf") {
      const { jsPDF } = await import("jspdf");
      const document = new jsPDF({ unit: "pt", format: "a4" });
      document.setFont("times", "normal");
      document.setFontSize(12);
      const lines = document.splitTextToSize(editorText, 470) as string[];
      let page = 1;
      lines.forEach((line, index) => {
        const y = 62 + (index - (page - 1) * 46) * 15;
        if (y > 780) {
          document.addPage();
          page += 1;
        }
        const pageIndex = index - (page - 1) * 46;
        document.text(line, 62, 62 + pageIndex * 15);
      });
      document.save(`${safeTitle}.pdf`);
    } else {
      const { Document, HeadingLevel, Packer, Paragraph, TextRun } =
        await import("docx");
      const blocks = blocksFromJson(editor.getJSON());
      const document = new Document({
        sections: [
          {
            children: blocks.map((block) =>
              block.type === "heading"
                ? new Paragraph({
                    text: block.text,
                    heading:
                      Number(block.attrs?.level) === 1
                        ? HeadingLevel.HEADING_1
                        : Number(block.attrs?.level) === 3
                          ? HeadingLevel.HEADING_3
                          : HeadingLevel.HEADING_2,
                  })
                : new Paragraph({
                    children: [new TextRun(block.text)],
                    ...(block.type === "quote"
                      ? { style: "IntenseQuote" }
                      : {}),
                  }),
            ),
          },
        ],
      });
      const blob = await Packer.toBlob(document);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeTitle}.docx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    setToolsOpen(false);
  }

  async function importDocument(file: File) {
    if (!editor || readOnly) return;
    if (file.size > 80 * 1024 * 1024) {
      setImportError(
        "This document exceeds the 80 MB technical safety ceiling.",
      );
      return;
    }
    editorReadyForUserChanges.current = true;
    setImporting(true);
    setImportError(undefined);
    setImportReport(undefined);
    let importJobId: string | undefined;
    try {
      const name = file.name.toLowerCase();
      const extension = name.split(".").pop() || "unknown";
      const fidelityReport: Array<{
        scope: string;
        level: "exact" | "adapted" | "unsupported";
        message: string;
      }> = [];
      const unsupportedFeatures: string[] = [];
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "document",
        format: extension,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(importJobId, file);
      if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({
          arrayBuffer: await file.arrayBuffer(),
        });
        editor.commands.setContent(
          sanitizeDocumentHtml(result.value || "<p></p>"),
        );
        setImportReport(
          result.messages.length
            ? `Imported as editable content with ${result.messages.length} fidelity note${result.messages.length === 1 ? "" : "s"}. The original should remain available in import history.`
            : "Imported as editable native content with no reported conversion warnings.",
        );
        fidelityReport.push({
          scope: "editable document structure",
          level: result.messages.length ? "adapted" : "exact",
          message: result.messages.length
            ? `${result.messages.length} converter note${result.messages.length === 1 ? "" : "s"} recorded; text, headings, lists, tables, and supported media were converted where available.`
            : "Supported Word structure converted to editable native content.",
        });
        unsupportedFeatures.push(
          "Word macros",
          "tracked-change authorship not represented by the converter",
          "unsupported floating layout",
        );
      } else if (name.endsWith(".odt")) {
        const { strFromU8, unzipSync } = await import("fflate");
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const contentXml = archive["content.xml"];
        if (!contentXml) throw new Error("ODT content.xml is missing.");
        const xml = strFromU8(contentXml);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml))
          throw new Error(
            "Unsafe XML declarations caused this ODT to be quarantined.",
          );
        const parsed = new DOMParser().parseFromString(xml, "application/xml");
        if (parsed.querySelector("parsererror"))
          throw new Error("ODT XML is invalid.");
        const html = Array.from(
          parsed.querySelectorAll("text\\:h, text\\:p, text\\:list-item"),
        )
          .map((node) => {
            const value = escapeDocumentHtml(node.textContent ?? "");
            if (node.nodeName.endsWith(":h")) {
              const level = Math.max(
                1,
                Math.min(
                  3,
                  Number(node.getAttribute("text:outline-level") ?? 2),
                ),
              );
              return `<h${level}>${value}</h${level}>`;
            }
            if (node.nodeName.endsWith(":list-item"))
              return `<ul><li>${value}</li></ul>`;
            return `<p>${value}</p>`;
          })
          .join("");
        editor.commands.setContent(html || "<p></p>");
        setImportReport(
          "Imported editable ODT text and headings. Complex page styles, comments, and unsupported layout are reported as adapted.",
        );
        fidelityReport.push({
          scope: "ODT text and outline",
          level: "adapted",
          message:
            "Text, headings, and list items were converted; the retained original preserves page styles and unsupported layout.",
        });
        unsupportedFeatures.push(
          "complex ODT page styles",
          "ODT comments",
          "floating objects",
        );
      } else if (name.endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const document = await pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        }).promise;
        const pages: string[] = [];
        for (
          let pageNumber = 1;
          pageNumber <= document.numPages;
          pageNumber += 1
        ) {
          const page = await document.getPage(pageNumber);
          const textContent = await page.getTextContent();
          pages.push(
            textContent.items
              .flatMap((item) => ("str" in item ? [item.str] : []))
              .join(" "),
          );
        }
        editor.commands.setContent(
          pages
            .map(
              (page, index) =>
                `<h2>Page ${index + 1}</h2><p>${escapeDocumentHtml(page)}</p>`,
            )
            .join(""),
        );
        setImportReport(
          "Extracted editable PDF text by page. Original layout, annotations, and media are preserved only in the retained source and reported as adapted.",
        );
        fidelityReport.push({
          scope: "PDF text extraction",
          level: "adapted",
          message: `${pages.length} page${pages.length === 1 ? "" : "s"} extracted as editable text with explicit page headings.`,
        });
        unsupportedFeatures.push(
          "original PDF page geometry",
          "PDF annotations",
          "non-text media",
          "scanned text without an embedded text layer",
        );
      } else {
        const text = await file.text();
        editor.commands.setContent(
          name.endsWith(".html") || name.endsWith(".htm")
            ? sanitizeDocumentHtml(text)
            : name.endsWith(".md") || name.endsWith(".markdown")
              ? markdownToDocumentHtml(text)
              : `<p>${escapeDocumentHtml(text)
                  .replace(/\n{2,}/g, "</p><p>")
                  .replace(/\n/g, "<br>")}</p>`,
        );
        setImportReport(
          name.endsWith(".html") || name.endsWith(".htm")
            ? "Sanitized and imported editable HTML. Active elements and unsafe URL handlers were removed."
            : "Imported as editable native document content.",
        );
        const htmlInput = name.endsWith(".html") || name.endsWith(".htm");
        const markdownInput =
          name.endsWith(".md") || name.endsWith(".markdown");
        fidelityReport.push({
          scope: htmlInput
            ? "sanitized HTML"
            : markdownInput
              ? "Markdown structure"
              : "plain text",
          level: htmlInput ? "adapted" : "exact",
          message: htmlInput
            ? "Safe supported HTML was converted; active and unsafe elements were removed."
            : "The source was converted to editable native document content.",
        });
        if (htmlInput)
          unsupportedFeatures.push(
            "scripts",
            "event handlers",
            "unsafe URLs",
            "unsupported CSS layout",
          );
      }
      const importedContent = documentContentFromJson(
        editor.getJSON(),
        content,
      );
      onChange(importedContent);
      await completeArtifactImport({
        jobId: importJobId!,
        typeKey: "document",
        status: "imported",
        fidelityReport,
        unsupportedFeatures,
        importedContent,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The document could not be validated.";
      if (importJobId) {
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "document",
          status: "quarantined",
          fidelityReport: [
            { scope: "document import", level: "unsupported", message },
          ],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(importJobId!, message).catch(
            () => undefined,
          );
        });
      }
      setImportError(`Import quarantined: ${message}`);
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div
      className="spectra-document-studio bg-[var(--bg-primary)]"
      data-focus={focusMode || undefined}
      data-layout={pageLayout}
    >
      {!focusMode ? header : null}
      <div className="spectra-document-toolbar sticky top-0 z-30 mx-5 flex min-h-11 flex-wrap items-center gap-1 rounded-[8px] border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_96%,transparent)] px-2 py-1.5 shadow-[0_8px_24px_-22px_rgba(27,20,12,.5)] backdrop-blur sm:mx-8">
        <fieldset disabled={readOnly} className="contents">
          <select
            aria-label="Text style"
            value={
              editor?.isActive("heading", { level: 1 })
                ? "h1"
                : editor?.isActive("heading", { level: 2 })
                  ? "h2"
                  : editor?.isActive("heading", { level: 3 })
                    ? "h3"
                    : "paragraph"
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === "paragraph")
                editor?.chain().focus().setParagraph().run();
              else
                editor
                  ?.chain()
                  .focus()
                  .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                  .run();
            }}
            className="h-8 min-w-[126px] bg-transparent px-2 text-[12px] font-medium text-[var(--text-primary)] outline-none"
          >
            <option value="paragraph">Text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <Divider />
          <ToolbarTextButton
            label="Bold"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            active={editor?.isActive("bold")}
          >
            <Bold className="h-4 w-4" />
          </ToolbarTextButton>
          <ToolbarTextButton
            label="Italic"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            active={editor?.isActive("italic")}
          >
            <Italic className="h-4 w-4" />
          </ToolbarTextButton>
          <ToolbarTextButton
            label="Underline"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            active={editor?.isActive("underline")}
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarTextButton>
          <ToolbarTextButton
            label="Strikethrough"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            active={editor?.isActive("strike")}
          >
            <span className="text-[14px] font-semibold line-through">S</span>
          </ToolbarTextButton>
          <ToolbarButton
            label="Inline code"
            onClick={() => editor?.chain().focus().toggleCode().run()}
            active={editor?.isActive("code")}
            icon={Code2}
          />
          <Divider />
          <ToolbarButton
            label="Bullet list"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            active={editor?.isActive("bulletList")}
            icon={List}
          />
          <ToolbarButton
            label="Task list"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            active={editor?.isActive("taskList")}
            icon={CheckCircle2}
          />
          <ToolbarButton
            label="Quote"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            active={editor?.isActive("blockquote")}
            icon={MessageSquare}
          />
          <ToolbarButton
            label="Insert equation"
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertContent({
                  type: "equation",
                  attrs: { latex: "", display: "block", alignment: "center" },
                })
                .run()
            }
            active={equationActive}
            icon={Sigma}
          />
          <ToolbarButton
            label="Link"
            icon={Link2}
            active={linkEditorOpen || editor?.isActive("link")}
            onClick={() => {
              setLinkDraft(
                String(editor?.getAttributes("link").href ?? "https://"),
              );
              setLinkEditorOpen((open) => !open);
            }}
          />
          <ToolbarButton
            label="Insert callout"
            icon={Sparkles}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertContent({
                  type: "callout",
                  attrs: { tone: "info" },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Key idea" }],
                    },
                  ],
                })
                .run()
            }
          />
          <ToolbarButton
            label="Insert table"
            icon={Table2}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          />
          {editor?.isActive("table") ? (
            <>
              <ToolbarButton
                label="Add table row"
                icon={Plus}
                onClick={() => editor.chain().focus().addRowAfter().run()}
              />
              <ToolbarButton
                label="Add table column"
                icon={Plus}
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              />
              <ToolbarButton
                label="Delete table row"
                icon={Minus}
                onClick={() => editor.chain().focus().deleteRow().run()}
              />
              <ToolbarButton
                label="Delete table column"
                icon={X}
                onClick={() => editor.chain().focus().deleteColumn().run()}
              />
              <ToolbarButton
                label="Delete table"
                icon={Trash2}
                onClick={() => editor.chain().focus().deleteTable().run()}
              />
            </>
          ) : null}
        </fieldset>
        <span className="ml-auto" />
        <input
          ref={importRef}
          type="file"
          accept=".docx,.odt,.pdf,.html,.htm,.txt,.md,.markdown"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importDocument(file);
          }}
        />
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          disabled={importing || readOnly}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Import className="h-3.5 w-3.5" />
          )}
          Import
        </button>
        <ToolbarButton
          label="More formatting options"
          icon={SlidersHorizontal}
          active={toolsOpen}
          onClick={() => setToolsOpen((open) => !open)}
        />
      </div>
      {toolsOpen ? (
        <div className="spectra-document-tools-popover">
          <section>
            <strong>Navigate & write</strong>
            <button
              type="button"
              onClick={() => {
                setOutlineOpen(!outlineOpen);
                setToolsOpen(false);
              }}
            >
              <FileText className="h-4 w-4" />
              <span>
                <strong>Document outline</strong>
                <small>{outlineEntries.length} sections</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(!findOpen);
                setToolsOpen(false);
              }}
            >
              <Search className="h-4 w-4" />
              <span>
                <strong>Find & replace</strong>
                <small>Search this document</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusMode(!focusMode);
                setToolsOpen(false);
              }}
            >
              <Focus className="h-4 w-4" />
              <span>
                <strong>{focusMode ? "Exit focus mode" : "Focus mode"}</strong>
                <small>Hide surrounding controls</small>
              </span>
            </button>
          </section>
          <section>
            <strong>Layout & templates</strong>
            <button
              type="button"
              onClick={() => {
                setPageLayout(pageLayout === "page" ? "continuous" : "page");
                setToolsOpen(false);
              }}
            >
              <PanelLeft className="h-4 w-4" />
              <span>
                <strong>
                  {pageLayout === "page" ? "Continuous canvas" : "Page canvas"}
                </strong>
                <small>Change editor representation</small>
              </span>
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => applyDocumentTemplate("notes")}
            >
              <LayoutTemplate className="h-4 w-4" />
              <span>
                <strong>Study notes template</strong>
                <small>Key ideas, concepts, questions</small>
              </span>
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => applyDocumentTemplate("essay")}
            >
              <LayoutTemplate className="h-4 w-4" />
              <span>
                <strong>Essay template</strong>
                <small>Argument-led academic structure</small>
              </span>
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => applyDocumentTemplate("lab")}
            >
              <LayoutTemplate className="h-4 w-4" />
              <span>
                <strong>Lab report template</strong>
                <small>Method, results, conclusion</small>
              </span>
            </button>
          </section>
          <section>
            <strong>Text appearance</strong>
            {(
              [
                ["left", "Align left", AlignLeft],
                ["center", "Align center", AlignCenter],
                ["right", "Align right", AlignRight],
              ] as const
            ).map(([alignment, label, Icon]) => (
              <button
                key={alignment}
                type="button"
                disabled={readOnly}
                data-active={
                  editor?.isActive({ textAlign: alignment }) || undefined
                }
                onClick={() =>
                  editor?.chain().focus().setTextAlign(alignment).run()
                }
              >
                <Icon className="h-4 w-4" />
                <span>
                  <strong>{label}</strong>
                  <small>Apply to the current paragraph or heading</small>
                </span>
              </button>
            ))}
            {(
              [
                ["#dff3ed", "Mint highlight"],
                ["#eee9ff", "Violet highlight"],
                ["#fff0db", "Amber highlight"],
              ] as const
            ).map(([color, label]) => (
              <button
                key={color}
                type="button"
                disabled={readOnly}
                data-active={
                  editor?.isActive("highlight", { color }) || undefined
                }
                onClick={() =>
                  editor?.chain().focus().toggleHighlight({ color }).run()
                }
              >
                <span
                  className="spectra-document-highlight-swatch"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span>
                  <strong>{label}</strong>
                  <small>Toggle a restrained Spectra emphasis</small>
                </span>
              </button>
            ))}
            <button
              type="button"
              disabled={readOnly}
              onClick={() => editor?.chain().focus().unsetHighlight().run()}
            >
              <X className="h-4 w-4" />
              <span>
                <strong>Remove highlight</strong>
                <small>Keep text and clear its background</small>
              </span>
            </button>
          </section>
          <section>
            <strong>Export</strong>
            {(
              [
                ["docx", "Word document"],
                ["pdf", "PDF"],
                ["md", "Markdown"],
                ["html", "HTML"],
                ["txt", "Plain text"],
              ] as const
            ).map(([format, label]) => (
              <button
                key={format}
                type="button"
                onClick={() => void exportDocument(format)}
              >
                <FileDown className="h-4 w-4" />
                <span>
                  <strong>{label}</strong>
                  <small>Download an editable or portable copy</small>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setToolsOpen(false);
                window.print();
              }}
            >
              <Printer className="h-4 w-4" />
              <span>
                <strong>Print</strong>
                <small>Use the page-optimized layout</small>
              </span>
            </button>
          </section>
        </div>
      ) : null}
      {findOpen ? (
        <div className="spectra-document-findbar">
          <Search className="h-4 w-4" />
          <label>
            <span className="sr-only">Find text</span>
            <input
              autoFocus
              value={findDraft}
              onChange={(event) => {
                setFindDraft(event.target.value);
                setFindCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setFindOpen(false);
                if (event.key === "Enter")
                  selectFindMatch(event.shiftKey ? -1 : 1);
              }}
              placeholder="Find in document"
            />
            <small>
              {findMatches.length
                ? `${Math.min(findCursor + 1, findMatches.length)} of ${findMatches.length}`
                : findDraft
                  ? "No matches"
                  : ""}
            </small>
          </label>
          <button
            type="button"
            disabled={!findMatches.length}
            onClick={() => selectFindMatch(-1)}
            aria-label="Previous match"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            disabled={!findMatches.length}
            onClick={() => selectFindMatch(1)}
            aria-label="Next match"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <input
            value={replaceDraft}
            disabled={readOnly}
            onChange={(event) => setReplaceDraft(event.target.value)}
            placeholder="Replace with"
            aria-label="Replacement text"
          />
          <button
            type="button"
            disabled={!findMatches.length || readOnly}
            onClick={replaceAllMatches}
          >
            Replace all
          </button>
          <button
            type="button"
            aria-label="Close find and replace"
            onClick={() => setFindOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {importReport || importError ? (
        <div
          className="spectra-document-import-report"
          data-error={Boolean(importError) || undefined}
          role="status"
        >
          <span>
            <strong>
              {importError ? "Import quarantined" : "Import complete"}
            </strong>
            <small>{importError || importReport}</small>
          </span>
          <button
            type="button"
            onClick={() => {
              setImportError(undefined);
              setImportReport(undefined);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {linkEditorOpen ? (
        <div className="mx-5 mt-2 flex items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_12px_30px_-24px_rgba(27,20,12,.4)]">
          <Link2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <input
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLinkEditorOpen(false);
              if (event.key === "Enter" && linkDraft.trim()) {
                event.preventDefault();
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: linkDraft.trim() })
                  .run();
                setLinkEditorOpen(false);
              }
            }}
            className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-[var(--text-primary)] outline-none"
            aria-label="Link URL"
          />
          <button
            type="button"
            className={smallActionClass()}
            onClick={() => {
              if (!linkDraft.trim()) return;
              editor
                ?.chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: linkDraft.trim() })
                .run();
              setLinkEditorOpen(false);
            }}
          >
            Apply link
          </button>
          {editor?.isActive("link") ? (
            <button
              type="button"
              className={smallActionClass()}
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setLinkEditorOpen(false);
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
      {equationActive && !readOnly ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-elevated))] px-4 py-2"
          data-equation-toolbar="true"
        >
          <Sigma className="h-4 w-4 text-[var(--accent-cyan)]" />
          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
            LaTeX
          </span>
          <input
            value={
              typeof equationAttrs.latex === "string" ? equationAttrs.latex : ""
            }
            onChange={(event) =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { latex: event.target.value })
                .run()
            }
            className="h-8 min-w-[220px] flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 font-mono text-[12px] text-[var(--text-primary)] outline-none"
            placeholder="E = mc^2"
          />
          <ToolbarButton
            label="Align left"
            icon={AlignLeft}
            active={equationAttrs.alignment === "left"}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "left" })
                .run()
            }
          />
          <ToolbarButton
            label="Align center"
            icon={AlignCenter}
            active={
              !equationAttrs.alignment || equationAttrs.alignment === "center"
            }
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "center" })
                .run()
            }
          />
          <ToolbarButton
            label="Align right"
            icon={AlignRight}
            active={equationAttrs.alignment === "right"}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .updateAttributes("equation", { alignment: "right" })
                .run()
            }
          />
        </div>
      ) : null}
      <div className="spectra-document-canvas-shell">
        {outlineOpen ? (
          <aside className="spectra-document-outline">
            <header>
              <strong>Outline</strong>
              <button type="button" onClick={() => setOutlineOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </header>
            {outlineEntries.map((entry, index) => (
              <button
                key={`${entry.position}:${index}`}
                type="button"
                style={{ paddingLeft: 11 + (entry.level - 1) * 12 }}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .setTextSelection(entry.position)
                    .scrollIntoView()
                    .run()
                }
              >
                <span>{index + 1}</span>
                <strong>{entry.title}</strong>
              </button>
            ))}
            {!outlineEntries.length ? (
              <p>Add headings to navigate long documents.</p>
            ) : null}
          </aside>
        ) : null}
        <main>
          {focusMode ? (
            <button
              type="button"
              className="spectra-document-exit-focus"
              onClick={() => setFocusMode(false)}
            >
              <X className="h-3.5 w-3.5" /> Exit focus
            </button>
          ) : null}
          <div className="spectra-document-editor-hint">
            <span>
              Type <kbd>/</kbd> for commands
            </span>
            <span>
              {wordCount.toLocaleString()} words · {readingMinutes} min read
            </span>
          </div>
          <EditorContent
            editor={editor}
            className="tiptap-root mx-auto max-w-[920px] [&_.ProseMirror-focused]:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-default)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:font-display [&_.ProseMirror_h1]:text-[30px] [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h2]:font-display [&_.ProseMirror_h2]:text-[23px] [&_.ProseMirror_h2]:leading-tight [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p]:my-4"
          />
        </main>
      </div>
    </div>
  );
}

function FlashcardStudio({
  artifactId,
  mode,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly: _readOnly = false,
  onActiveRegionChange,
}: {
  artifactId: string;
  mode: "split" | "tab";
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const [cards, setCards] = useState(() => deckCards(content));
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [activeSection, setActiveSection] = useState(
    cards[0]?.section ?? "Section 1",
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [deckSearch, setDeckSearch] = useState("");
  const [deckFilter, setDeckFilter] = useState<
    "all" | "incomplete" | "duplicate" | "easy" | "medium" | "hard"
  >("all");
  const [railView, setRailView] = useState<"list" | "grid">("list");
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [draggedCardId, setDraggedCardId] = useState<string>();
  const [renamingSection, setRenamingSection] = useState<string>();
  const [sectionNameDraft, setSectionNameDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deckTagDraft, setDeckTagDraft] = useState("");
  const [studioView, setStudioView] = useState<"edit" | "view">("edit");
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(mode === "split");
  const [studyOpen, setStudyOpen] = useState(false);
  const [studyRevealed, setStudyRevealed] = useState(false);
  const [studyIndex, setStudyIndex] = useState(0);
  const [studyQueue, setStudyQueue] = useState<DeckStudyItem[]>([]);
  const [studyComplete, setStudyComplete] = useState(false);
  const [studyCardStartedAt, setStudyCardStartedAt] = useState(0);
  const [studyClock, setStudyClock] = useState(() => Date.now());
  const [studyReviewBusy, setStudyReviewBusy] = useState(false);
  const [studyError, setStudyError] = useState<string>();
  const [studyTypedAnswer, setStudyTypedAnswer] = useState("");
  const [studyTypedCorrect, setStudyTypedCorrect] = useState<boolean>();
  const [studyRatings, setStudyRatings] = useState<
    Record<SpectraFlashcardRating, number>
  >({ again: 0, hard: 0, good: 0, easy: 0 });
  const [studyStates, setStudyStates] = useState<
    Map<string, SpectraFlashcardStudyState>
  >(() => new Map());
  const [studyStateLoading, setStudyStateLoading] = useState(true);
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const [deckImportReport, setDeckImportReport] = useState<string>();
  const [deckImportError, setDeckImportError] = useState<string>();
  const [deckActionError, setDeckActionError] = useState<string>();
  const [deckAssets, setDeckAssets] = useState<SpectraArtifactAsset[]>([]);
  const [deckMediaBusy, setDeckMediaBusy] = useState(false);
  const [deckMediaError, setDeckMediaError] = useState<string>();

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (
        event as CustomEvent<{ artifactId?: string; path?: string }>
      ).detail;
      if (detail?.artifactId !== artifactId || !detail.path) return;
      const match = detail.path.match(/^\/cards\/(\d+)(?:\/|$)/);
      if (!match) return;
      const index = Number(match[1]);
      const card = cards[index];
      if (card) setActiveCardId(card.id);
      if (
        /\/(?:variant|difficulty|confidence|section|language|media|explanation|acceptedAlternatives|learningObjective|sourceRefs|bidirectional)(?:\/|$)/.test(
          detail.path,
        )
      )
        setAdvancedOpen(true);
    };
    window.addEventListener("spectra:reveal-target", reveal);
    return () => window.removeEventListener("spectra:reveal-target", reveal);
  }, [artifactId, cards]);
  const [maskDraft, setMaskDraft] = useState<{
    x: number;
    y: number;
    currentX: number;
    currentY: number;
  }>();
  const [cardEditBaseline, setCardEditBaseline] = useState<
    DeckCard | undefined
  >(undefined);
  const [baselineCardId, setBaselineCardId] = useState<string | undefined>(
    undefined,
  );
  const deckMediaInputRef = useRef<HTMLInputElement>(null);
  const sections = useMemo(
    () => Array.from(new Set(cards.map((card) => card.section || "Section 1"))),
    [cards],
  );
  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const activeCardIndex = Math.max(
    0,
    cards.findIndex((card) => card.id === activeCard?.id),
  );
  useEffect(() => {
    setPreviewRevealed(false);
  }, [activeCardId, studioView]);
  const advancedAiPath = aiChangedPaths.find((path) =>
    /^\/cards\/\d+\/(?:variant|difficulty|confidence|section|language|media|explanation|acceptedAlternatives|learningObjective|sourceRefs|bidirectional)(?:\/|$)/.test(
      path,
    ),
  );
  const deckSettings = record(record(content).settings);
  const activeDeckMedia = activeCard?.media
    ? deckAssets.find((asset) => asset.assetId === activeCard.media?.assetId)
    : undefined;
  useEffect(() => {
    if (activeCard && baselineCardId !== activeCard.id) {
      setBaselineCardId(activeCard.id);
      setCardEditBaseline(structuredClone(activeCard));
    }
  }, [activeCard, baselineCardId]);
  const activeCardDirty = Boolean(
    activeCard &&
    cardEditBaseline &&
    JSON.stringify(activeCard) !== JSON.stringify(cardEditBaseline),
  );
  const duplicateKeys = new Set(
    Array.from(
      cards.reduce((counts, card) => {
        const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    )
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
  const filteredCards = cards.filter((card) => {
    const query = deckSearch.trim().toLocaleLowerCase();
    if (
      query &&
      !`${card.front} ${card.back} ${card.hint ?? ""} ${(card.tags ?? []).join(" ")}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    if (deckFilter === "incomplete")
      return !card.front.trim() || !card.back.trim();
    if (deckFilter === "duplicate")
      return duplicateKeys.has(
        `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
      );
    if (
      deckFilter === "easy" ||
      deckFilter === "medium" ||
      deckFilter === "hard"
    )
      return (card.difficulty ?? "medium") === deckFilter;
    return true;
  });
  const studyCards = cards.filter(
    (card) =>
      card.front.trim() &&
      card.back.trim() &&
      (card.variant !== "cloze" || clozeParts(card.front).length > 0) &&
      (card.variant !== "image_occlusion" ||
        (Boolean(card.media) && (card.occlusions?.length ?? 0) > 0)),
  );
  const studyItems = studyCards.flatMap((card): DeckStudyItem[] => [
    { cardId: card.id, direction: "forward" },
    ...(card.bidirectional === true && card.variant === "basic"
      ? [{ cardId: card.id, direction: "reverse" as const }]
      : []),
  ]);
  const dueStudyCount = studyItems.filter((item) => {
    const state = studyStates.get(deckStudyKey(item.cardId, item.direction));
    return !state || state.nextDueAt <= studyClock;
  }).length;
  const personalMastery = studyItems.length
    ? Math.round(
        (studyItems.reduce((total, item) => {
          const state = studyStates.get(
            deckStudyKey(item.cardId, item.direction),
          );
          if (!state) return total;
          return (
            total +
            Math.min(
              1,
              state.stabilityDays >= 21 ? 1 : state.stabilityDays / 21,
            )
          );
        }, 0) /
          studyItems.length) *
          100,
      )
    : 0;
  const activeStudyItem = studyQueue[studyIndex];
  const activeStudyCard = activeStudyItem
    ? studyCards.find((card) => card.id === activeStudyItem.cardId)
    : undefined;
  const deckImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextCards = deckCards(content);
    setCards(nextCards);
    setActiveCardId((current) =>
      nextCards.some((card) => card.id === current)
        ? current
        : (nextCards[0]?.id ?? ""),
    );
    setSelectedCardIds(
      (current) =>
        new Set(
          [...current].filter((id) => nextCards.some((card) => card.id === id)),
        ),
    );
  }, [content]);

  useEffect(() => {
    let active = true;
    setStudyStateLoading(true);
    void getSpectraFlashcardStudy(artifactId)
      .then((result) => {
        if (!active) return;
        setStudyStates(
          new Map(
            result.states.map((state) => [
              deckStudyKey(state.cardId, state.direction),
              state,
            ]),
          ),
        );
        setStudyError(undefined);
      })
      .catch((error) => {
        if (!active) return;
        setStudyError(
          error instanceof Error
            ? error.message
            : "Private study progress could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setStudyStateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const beginStudySession = () => {
    const now = currentTimeMs();
    const due = studyItems.filter((item) => {
      const state = studyStates.get(deckStudyKey(item.cardId, item.direction));
      return !state || state.nextDueAt <= now;
    });
    const dueKeys = new Set(
      due.map((item) => deckStudyKey(item.cardId, item.direction)),
    );
    const future = studyItems
      .filter((item) => !dueKeys.has(deckStudyKey(item.cardId, item.direction)))
      .sort(
        (left, right) =>
          (studyStates.get(deckStudyKey(left.cardId, left.direction))
            ?.nextDueAt ?? Number.MAX_SAFE_INTEGER) -
          (studyStates.get(deckStudyKey(right.cardId, right.direction))
            ?.nextDueAt ?? Number.MAX_SAFE_INTEGER),
      );
    const candidates = due.length ? due : future;
    const shuffle = deckSettings.shuffle !== false;
    const queue = [...candidates];
    if (shuffle) shuffleInPlace(queue);
    setStudyQueue(queue);
    setStudyIndex(0);
    setStudyRevealed(false);
    setStudyTypedAnswer("");
    setStudyTypedCorrect(undefined);
    setStudyComplete(false);
    setStudyRatings({ again: 0, hard: 0, good: 0, easy: 0 });
    setStudyCardStartedAt(now);
    setStudyClock(now);
    setStudyError(undefined);
    setStudyOpen(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const closeStudySession = () => {
    setStudyOpen(false);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  };
  const beginStudySessionRef = useRef(beginStudySession);
  useEffect(() => {
    beginStudySessionRef.current = beginStudySession;
  });

  useEffect(() => {
    function beginFromInspector(event: Event) {
      const requestedId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      if (requestedId === artifactId) beginStudySessionRef.current();
    }
    window.addEventListener("spectra:study-deck", beginFromInspector);
    return () =>
      window.removeEventListener("spectra:study-deck", beginFromInspector);
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setDeckAssets(result.assets);
      })
      .catch((error) => {
        if (!active) return;
        setDeckMediaError(
          error instanceof Error
            ? error.message
            : "Card media could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  function commit(nextCards: DeckCard[]) {
    setCards(nextCards);
    onChange({
      ...record(content),
      cards: nextCards,
      settings: record(content).settings ?? {
        shuffle: true,
        revealMode: "click",
      },
    });
  }

  function updateDeckSettings(
    patch: Partial<{
      shuffle: boolean;
      revealMode: "click" | "type";
      showHints: boolean;
    }>,
  ) {
    onChange({
      ...record(content),
      cards,
      settings: {
        shuffle: deckSettings.shuffle !== false,
        revealMode: deckSettings.revealMode === "type" ? "type" : "click",
        showHints: deckSettings.showHints !== false,
        ...patch,
      },
    });
  }

  function updateCard(cardId: string, patch: Partial<DeckCard>) {
    commit(
      cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  }

  function addActiveCardTag() {
    if (!activeCard) return;
    const tag = deckTagDraft.trim();
    if (!tag) return;
    updateCard(activeCard.id, {
      tags: [...new Set([...(activeCard.tags ?? []), tag])].slice(0, 8),
    });
    setDeckTagDraft("");
  }

  function deckMediaUrl(card: DeckCard) {
    return card.media
      ? deckAssets.find((asset) => asset.assetId === card.media?.assetId)
          ?.downloadUrl
      : undefined;
  }

  async function uploadDeckMedia(file: File) {
    if (!activeCard) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setDeckMediaError("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setDeckMediaError("Card images must be 25 MB or smaller.");
      return;
    }
    setDeckMediaBusy(true);
    setDeckMediaError(undefined);
    try {
      const previousAssetId = activeCard.media?.assetId;
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `flashcards/${activeCard.id}/${Date.now().toString(36)}-${file.name}`,
        name: file.name,
        mediaType: file.type,
        sha256: await artifactBlobSha256(file),
        blob: file,
      });
      updateCard(activeCard.id, {
        ...(activeCard.variant === "image_occlusion"
          ? { bidirectional: false }
          : {}),
        media: {
          assetId: uploaded.assetId,
          name: file.name,
          mediaType: file.type,
          altText: "",
          placement: activeCard.media?.placement ?? "front",
        },
        ...(activeCard.variant === "image_occlusion" ? { occlusions: [] } : {}),
      });
      if (
        previousAssetId &&
        previousAssetId !== uploaded.assetId &&
        !cards.some(
          (card) =>
            card.id !== activeCard.id &&
            card.media?.assetId === previousAssetId,
        )
      )
        await revokeArtifactAsset(previousAssetId).catch(() => undefined);
      const refreshed = await getArtifactAssets(artifactId);
      setDeckAssets(refreshed.assets);
    } catch (error) {
      setDeckMediaError(
        error instanceof Error
          ? error.message
          : "The card image could not be added.",
      );
    } finally {
      setDeckMediaBusy(false);
      if (deckMediaInputRef.current) deckMediaInputRef.current.value = "";
    }
  }

  async function removeDeckMedia() {
    if (!activeCard?.media || deckMediaBusy) return;
    setDeckMediaBusy(true);
    setDeckMediaError(undefined);
    try {
      const removedAssetId = activeCard.media.assetId;
      if (
        !cards.some(
          (card) =>
            card.id !== activeCard.id && card.media?.assetId === removedAssetId,
        )
      )
        await revokeArtifactAsset(removedAssetId);
      updateCard(activeCard.id, {
        media: undefined,
        occlusions: [],
        ...(activeCard.variant === "image_occlusion"
          ? { variant: "basic" as const }
          : {}),
      });
      setDeckAssets((current) =>
        current.filter(
          (asset) =>
            asset.assetId !== removedAssetId ||
            cards.some(
              (card) =>
                card.id !== activeCard.id &&
                card.media?.assetId === removedAssetId,
            ),
        ),
      );
    } catch (error) {
      setDeckMediaError(
        error instanceof Error
          ? error.message
          : "The card image could not be removed.",
      );
    } finally {
      setDeckMediaBusy(false);
    }
  }

  function maskPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)),
      ),
      y: Math.max(
        0,
        Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)),
      ),
    };
  }

  function beginMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeCard?.media || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = maskPoint(event);
    setMaskDraft({ ...point, currentX: point.x, currentY: point.y });
  }

  function moveMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!maskDraft) return;
    const point = maskPoint(event);
    setMaskDraft((current) =>
      current ? { ...current, currentX: point.x, currentY: point.y } : current,
    );
  }

  function finishMask(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeCard || !maskDraft) return;
    const point = maskPoint(event);
    const x = Math.min(maskDraft.x, point.x);
    const y = Math.min(maskDraft.y, point.y);
    const width = Math.abs(point.x - maskDraft.x);
    const height = Math.abs(point.y - maskDraft.y);
    setMaskDraft(undefined);
    if (width < 0.025 || height < 0.025) return;
    updateCard(activeCard.id, {
      occlusions: [
        ...(activeCard.occlusions ?? []),
        { id: id("mask"), x, y, width, height, label: "" },
      ],
    });
  }

  function addCard(section = activeSection) {
    const card = {
      id: id("card"),
      variant: "basic" as const,
      front: "",
      back: "",
      hint: "",
      explanation: "",
      section,
      confidence: "unknown" as const,
      difficulty: "medium" as const,
    };
    commit([...cards, card]);
    setActiveCardId(card.id);
    setActiveSection(section);
  }

  function toggleCardSelection(cardId: string) {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function moveSelectedCards(section: string) {
    if (!selectedCardIds.size) return;
    commit(
      cards.map((card) =>
        selectedCardIds.has(card.id) ? { ...card, section } : card,
      ),
    );
    setActiveSection(section);
    setSelectedCardIds(new Set());
  }

  function releaseUnusedDeckMedia(
    removedCards: DeckCard[],
    remainingCards: DeckCard[],
  ) {
    const retainedAssetIds = new Set(
      remainingCards.flatMap((card) =>
        card.media?.assetId ? [card.media.assetId] : [],
      ),
    );
    const removable = [
      ...new Set(
        removedCards.flatMap((card) =>
          card.media?.assetId && !retainedAssetIds.has(card.media.assetId)
            ? [card.media.assetId]
            : [],
        ),
      ),
    ];
    if (!removable.length) return;
    void Promise.all(
      removable.map((assetId) =>
        revokeArtifactAsset(assetId).catch(() => undefined),
      ),
    ).then(() =>
      setDeckAssets((current) =>
        current.filter((asset) => !removable.includes(asset.assetId)),
      ),
    );
  }

  function deleteSelectedCards() {
    if (!selectedCardIds.size) return;
    const removed = cards.filter((card) => selectedCardIds.has(card.id));
    const remaining = cards.filter((card) => !selectedCardIds.has(card.id));
    const next = remaining.length
      ? remaining
      : [
          {
            id: id("card"),
            front: "",
            back: "",
            hint: "",
            section: activeSection,
            confidence: "unknown" as const,
            difficulty: "medium" as const,
          },
        ];
    commit(next);
    releaseUnusedDeckMedia(removed, next);
    setActiveCardId(next[0]!.id);
    setSelectedCardIds(new Set());
  }

  function setSelectedDifficulty(difficulty: "easy" | "medium" | "hard") {
    if (!selectedCardIds.size) return;
    commit(
      cards.map((card) =>
        selectedCardIds.has(card.id) ? { ...card, difficulty } : card,
      ),
    );
  }

  function reorderCard(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const dragged = cards.find((card) => card.id === draggedId);
    const target = cards.find((card) => card.id === targetId);
    if (!dragged || !target) return;
    const next = cards.filter((card) => card.id !== draggedId);
    const targetIndex = next.findIndex((card) => card.id === targetId);
    next.splice(targetIndex, 0, { ...dragged, section: target.section });
    commit(next);
    setActiveSection(target.section ?? "Section 1");
    setDraggedCardId(undefined);
  }

  function renameSection(section: string, requestedName = sectionNameDraft) {
    const proposed = requestedName.trim();
    if (!proposed || proposed === section) return;
    if (sections.includes(proposed)) {
      setDeckImportError("A section with that name already exists.");
      return;
    }
    commit(
      cards.map((card) =>
        (card.section || "Section 1") === section
          ? { ...card, section: proposed }
          : card,
      ),
    );
    setActiveSection(proposed);
    setRenamingSection(undefined);
    setSectionNameDraft("");
  }

  async function importCards(file: File) {
    setDeckImportError(undefined);
    setDeckImportReport(undefined);
    let importJobId: string | undefined;
    const uploadedPackageAssetIds: string[] = [];
    try {
      if (file.size > 30 * 1024 * 1024)
        throw new Error(
          "This deck exceeds the 30 MB technical safety ceiling.",
        );
      const extension = file.name.split(".").pop()?.toLocaleLowerCase() ?? "";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "flashcard_deck",
        format: extension || "unknown",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      importJobId = beginning.jobId;
      await uploadArtifactImportOriginal(importJobId, file);
      if (extension === "apkg") {
        const [{ default: initSqlJs }, { strFromU8, unzipSync }] =
          await Promise.all([import("sql.js"), import("fflate")]);
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const databaseBytes =
          archive["collection.anki21"] ??
          archive["collection.anki2"] ??
          archive["collection.anki21b"];
        if (!databaseBytes)
          throw new Error(
            "The Anki package does not contain a supported collection database.",
          );
        const SQL = await initSqlJs({
          locateFile: () => "/vendor/sql-wasm.wasm",
        });
        const database = new SQL.Database(databaseBytes);
        try {
          const collectionRows = database.exec(
            "SELECT decks, models FROM col LIMIT 1",
          );
          const collectionValues = collectionRows[0]?.values[0];
          const decks =
            typeof collectionValues?.[0] === "string"
              ? (JSON.parse(collectionValues[0]) as Record<
                  string,
                  { name?: string }
                >)
              : {};
          const models =
            typeof collectionValues?.[1] === "string"
              ? (JSON.parse(collectionValues[1]) as Record<
                  string,
                  {
                    type?: number;
                    flds?: Array<{ name?: string; ord?: number }>;
                  }
                >)
              : {};
          const query = database.exec(
            "SELECT n.id, n.mid, n.flds, n.tags, MIN(c.did) AS did FROM notes n LEFT JOIN cards c ON c.nid = n.id GROUP BY n.id, n.mid, n.flds, n.tags ORDER BY n.id LIMIT 500",
          );
          const values = query[0]?.values ?? [];
          const htmlToStudyText = (source: string) => {
            const document = new DOMParser().parseFromString(
              source
                .replace(/\[sound:([^\]]+)\]/gi, " [Audio: $1] ")
                .replace(
                  /<img\b([^>]*?)\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))([^>]*)>/gi,
                  (_match, _before, double, single, bare) =>
                    ` [Image: ${double || single || bare || "embedded"}] `,
                )
                .replace(/<br\s*\/?>/gi, "\n"),
              "text/html",
            );
            return (document.body.textContent ?? "")
              .replace(/\u00a0/g, " ")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .replace(/[ \t]{2,}/g, " ")
              .trim();
          };
          const imported = values.flatMap((row, index): DeckCard[] => {
            const modelId = String(row[1] ?? "");
            const rawFields =
              typeof row[2] === "string" ? row[2].split("\u001f") : [];
            const model = models[modelId] ?? {};
            const fields = [...(model.flds ?? [])].sort(
              (left, right) => (left.ord ?? 0) - (right.ord ?? 0),
            );
            const names = fields.map((field) =>
              (field.name ?? "").toLocaleLowerCase(),
            );
            const findField = (candidates: RegExp, fallback: number) => {
              const found = names.findIndex((name) => candidates.test(name));
              return found >= 0 ? found : fallback;
            };
            const cloze = model.type === 1;
            const frontIndex = cloze
              ? findField(/^(?:text|cloze|sentence|content)$/, 0)
              : findField(/^(?:front|question|prompt|term|word)$/, 0);
            const backIndex = cloze
              ? findField(/^(?:extra|back|explanation|notes?)$/, 1)
              : findField(/^(?:back|answer|response|definition|meaning)$/, 1);
            const front = htmlToStudyText(rawFields[frontIndex] ?? "");
            const secondary = htmlToStudyText(rawFields[backIndex] ?? "");
            const back = cloze
              ? [clozeAnswer(front), secondary]
                  .filter(Boolean)
                  .filter((value, valueIndex, all) =>
                    valueIndex === 0 ? true : value !== all[0],
                  )
                  .join("\n\n")
              : secondary;
            if (!front || !back) return [];
            const deckId = String(row[4] ?? "");
            const section =
              decks[deckId]?.name?.replaceAll("::", " / ") || "Imported";
            return [
              {
                id: id(`anki-${index + 1}`),
                variant: cloze ? "cloze" : "basic",
                front,
                back,
                hint: "",
                explanation: "",
                acceptedAlternatives: [],
                section,
                tags:
                  typeof row[3] === "string"
                    ? row[3].trim().split(/\s+/).filter(Boolean).slice(0, 8)
                    : [],
                confidence: "unknown",
                difficulty: "medium",
                bidirectional: false,
              },
            ];
          });
          const existingKeys = new Set(
            cards.map(
              (card) =>
                `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
            ),
          );
          const importedKeys = new Set<string>();
          const unique = imported.filter((card) => {
            const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
            if (existingKeys.has(key) || importedKeys.has(key)) return false;
            importedKeys.add(key);
            return true;
          });
          if (!unique.length)
            throw new Error(
              "No new Anki notes contained a usable front and back pair.",
            );
          let packagedMediaCount = 0;
          if (archive.media) {
            try {
              const mediaMap = JSON.parse(strFromU8(archive.media)) as Record<
                string,
                string
              >;
              packagedMediaCount = Object.keys(mediaMap).length;
            } catch {
              packagedMediaCount = 0;
            }
          }
          await completeArtifactImport({
            jobId: importJobId,
            typeKey: "flashcard_deck",
            status: "imported",
            fidelityReport: [
              {
                scope: "note fields, cloze syntax, tags, and deck sections",
                level: "adapted",
                message: `${unique.length} Anki notes were converted into editable Spectra cards.`,
              },
              {
                scope: "scheduler and review history",
                level: "adapted",
                message:
                  "Anki scheduling was intentionally kept separate; the imported deck starts with private Spectra scheduling.",
              },
              ...(packagedMediaCount
                ? [
                    {
                      scope: "Anki media and templates",
                      level: "unsupported" as const,
                      message: `${packagedMediaCount} packaged media files remain in the retained original. Media references are labelled in card text, but custom HTML/CSS templates and executable add-on behavior were not imported.`,
                    },
                  ]
                : []),
            ],
            unsupportedFeatures: [
              "custom Anki HTML/CSS templates",
              "add-on behavior",
              ...(packagedMediaCount
                ? ["packaged audio and image binaries"]
                : []),
            ],
            importedContent: { cards: unique },
          });
          commit([...cards, ...unique]);
          setActiveCardId(unique[0]!.id);
          setActiveSection(unique[0]!.section ?? "Imported");
          setDeckImportReport(
            `${unique.length} Anki cards imported with their original package retained for recovery.`,
          );
          return;
        } finally {
          database.close();
        }
      }
      if (
        extension === "zip" ||
        extension === "spectra-deck" ||
        file.name.toLocaleLowerCase().endsWith(".spectra-deck.zip")
      ) {
        const { strFromU8, unzipSync } = await import("fflate");
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const entries = Object.entries(archive);
        const uncompressedBytes = entries.reduce(
          (total, [, bytes]) => total + bytes.length,
          0,
        );
        if (entries.length > 256 || uncompressedBytes > 120 * 1024 * 1024)
          throw new Error(
            "The deck package expands beyond the safe file or size ceiling and was quarantined.",
          );
        const manifestBytes = archive["manifest.json"];
        if (!manifestBytes)
          throw new Error(
            "This ZIP is not a Spectra flashcard package because manifest.json is missing.",
          );
        const manifest = JSON.parse(strFromU8(manifestBytes)) as Record<
          string,
          unknown
        >;
        if (
          manifest.format !== "spectra-flashcard-deck" ||
          manifest.version !== 1
        )
          throw new Error(
            "This deck package uses an unsupported format or version.",
          );
        const manifestContent = record(manifest.content);
        const rawCards = arrayOfRecords(manifestContent.cards);
        if (!rawCards.length || rawCards.length > 500)
          throw new Error(
            "The package must contain between 1 and 500 flashcards.",
          );
        const mediaTypes: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
        };
        const importedCards: DeckCard[] = [];
        for (const [index, rawCard] of rawCards.entries()) {
          const normalized = deckCards({ cards: [rawCard] })[0]!;
          if (!normalized.front.trim() || !normalized.back.trim())
            throw new Error(
              `Card ${index + 1} is missing its front or back content.`,
            );
          const nextCardId = id(`card-${index + 1}`);
          const rawMedia = record(rawCard.media);
          const packagePath =
            typeof rawMedia.packagePath === "string"
              ? rawMedia.packagePath.replaceAll("\\", "/")
              : "";
          let media: DeckCard["media"];
          if (packagePath) {
            if (
              !/^media\/[a-z0-9._/-]+$/i.test(packagePath) ||
              packagePath.includes("..")
            )
              throw new Error(
                `Card ${index + 1} contains an unsafe media path.`,
              );
            const bytes = archive[packagePath];
            const extension = packagePath.split(".").pop()?.toLocaleLowerCase();
            const mediaType = extension ? mediaTypes[extension] : undefined;
            if (!bytes || !mediaType || bytes.length > 25 * 1024 * 1024)
              throw new Error(
                `Card ${index + 1} has missing, unsupported, or oversized media.`,
              );
            const name =
              typeof rawMedia.name === "string"
                ? rawMedia.name
                : packagePath.split("/").pop() || `card-${index + 1}`;
            const blob = new Blob([bytes as BlobPart], { type: mediaType });
            const uploaded = await uploadArtifactAsset({
              artifactId,
              path: `flashcards/${nextCardId}/${Date.now().toString(36)}-${name}`,
              name,
              mediaType,
              sha256: await artifactBlobSha256(blob),
              blob,
            });
            uploadedPackageAssetIds.push(uploaded.assetId);
            media = {
              assetId: uploaded.assetId,
              name,
              mediaType,
              altText:
                typeof rawMedia.altText === "string" ? rawMedia.altText : "",
            };
          }
          if (normalized.variant === "image_occlusion" && !media)
            throw new Error(
              `Image-occlusion card ${index + 1} is missing its packaged image.`,
            );
          importedCards.push({
            ...normalized,
            id: nextCardId,
            media,
            occlusions: (normalized.occlusions ?? []).map((mask) => ({
              ...mask,
              id: id("mask"),
            })),
            review: undefined,
          });
        }
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "flashcard_deck",
          status: "imported",
          fidelityReport: [
            {
              scope:
                "cards, sections, cloze syntax, reverse scheduling, image media, and occlusion geometry",
              level: "exact",
              message: `${importedCards.length} cards and ${uploadedPackageAssetIds.length} media files were restored as editable Spectra content.`,
            },
            {
              scope: "private study history",
              level: "adapted",
              message:
                "Private scheduling and answer history were intentionally not imported with shared deck content.",
            },
          ],
          unsupportedFeatures: [],
          importedContent: {
            cards: importedCards.map(({ review: _review, ...card }) => card),
            settings: manifestContent.settings,
          },
        });
        commit([...cards, ...importedCards]);
        setActiveCardId(importedCards[0]!.id);
        setActiveSection(importedCards[0]!.section ?? "Imported");
        void getArtifactAssets(artifactId)
          .then((result) => setDeckAssets(result.assets))
          .catch(() => undefined);
        setDeckImportReport(
          `${importedCards.length} cards restored with full deck-content fidelity.`,
        );
        return;
      }
      const text = await file.text();
      if (/\0/.test(text))
        throw new Error(
          "Binary or packaged deck data requires the staged package importer and was quarantined.",
        );
      const structuredText = extension === "csv" || extension === "tsv";
      const rows = structuredText
        ? parseDelimited(text, extension === "tsv" ? "\t" : ",")
        : text
            .replace(/\r\n/g, "\n")
            .split(/\n{2,}/)
            .map((block) => {
              const lines = block
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              const labelled = Object.fromEntries(
                lines
                  .map((line) => {
                    const match = line.match(
                      /^(front|question|q|back|answer|a|hint|section|tags?|type|variant|explanation|alternatives?|difficulty|language|objective|sources?|bidirectional)\s*:\s*(.*)$/i,
                    );
                    return match
                      ? [match[1]!.toLocaleLowerCase(), match[2]!.trim()]
                      : undefined;
                  })
                  .filter((entry): entry is [string, string] => Boolean(entry)),
              );
              if (Object.keys(labelled).length) {
                return [
                  labelled.front || labelled.question || labelled.q || "",
                  labelled.back || labelled.answer || labelled.a || "",
                  labelled.hint || "",
                  labelled.section || "Imported",
                  labelled.tags || labelled.tag || "",
                  labelled.type || labelled.variant || "",
                  labelled.explanation || "",
                  labelled.alternatives || labelled.alternative || "",
                  labelled.difficulty || "",
                  labelled.objective || "",
                  labelled.language || "",
                  labelled.sources || labelled.source || "",
                  labelled.bidirectional || "",
                ];
              }
              const explicitPair = block.split(/\s+(?:::|=>|→)\s+/);
              if (explicitPair.length >= 2)
                return [
                  explicitPair[0]!.trim(),
                  explicitPair.slice(1).join(" ").trim(),
                ];
              if (lines.length >= 2)
                return [lines[0]!, lines.slice(1).join("\n")];
              return [];
            })
            .filter((row) => row.some(Boolean));
      const first = rows[0]?.map((value) => value.toLocaleLowerCase()) ?? [];
      const hasHeader =
        structuredText &&
        first.some((value) =>
          ["front", "question", "back", "answer", "hint", "section"].includes(
            value,
          ),
        );
      const header = hasHeader
        ? rows.shift()!.map((value) => value.toLocaleLowerCase())
        : [];
      const column = (names: string[], fallback: number) =>
        names.map((name) => header.indexOf(name)).find((value) => value >= 0) ??
        fallback;
      const frontIndex = column(["front", "question", "prompt"], 0);
      const backIndex = column(["back", "answer", "response"], 1);
      const hintIndex = column(["hint", "note"], 2);
      const sectionIndex = column(["section", "deck", "category"], 3);
      const tagsIndex = column(["tags", "tag"], -1);
      const typeIndex = column(["type", "variant"], structuredText ? -1 : 5);
      const explanationIndex = column(["explanation"], structuredText ? -1 : 6);
      const alternativesIndex = column(
        ["alternatives", "accepted alternatives"],
        structuredText ? -1 : 7,
      );
      const difficultyIndex = column(["difficulty"], structuredText ? -1 : 8);
      const objectiveIndex = column(
        ["learning objective", "objective"],
        structuredText ? -1 : 9,
      );
      const languageIndex = column(["language"], structuredText ? -1 : 10);
      const sourcesIndex = column(
        ["sources", "source"],
        structuredText ? -1 : 11,
      );
      const bidirectionalIndex = column(
        ["bidirectional", "reverse"],
        structuredText ? -1 : 12,
      );
      const imported = rows
        .filter((row) => row[frontIndex]?.trim() && row[backIndex]?.trim())
        .map((row, index): DeckCard => {
          const requestedType =
            typeIndex >= 0
              ? (row[typeIndex] ?? "").trim().toLocaleLowerCase()
              : "";
          const cloze =
            requestedType === "cloze" ||
            /\{\{c\d+::[\s\S]*?\}\}/i.test(row[frontIndex]!);
          const difficulty =
            difficultyIndex >= 0
              ? (row[difficultyIndex] ?? "").trim().toLocaleLowerCase()
              : "";
          return {
            id: id(`card-${index + 1}`),
            variant: cloze ? "cloze" : "basic",
            front: row[frontIndex]!,
            back: row[backIndex]!,
            hint: row[hintIndex] ?? "",
            explanation:
              explanationIndex >= 0 ? (row[explanationIndex] ?? "") : "",
            acceptedAlternatives:
              alternativesIndex >= 0
                ? (row[alternativesIndex] ?? "")
                    .split(/[;|]/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            section: row[sectionIndex] || "Imported",
            tags:
              tagsIndex >= 0
                ? (row[tagsIndex] ?? "")
                    .split(/[;|]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .slice(0, 8)
                : [],
            confidence: "unknown",
            difficulty:
              difficulty === "easy" || difficulty === "hard"
                ? difficulty
                : "medium",
            learningObjective:
              objectiveIndex >= 0 ? (row[objectiveIndex] ?? "") : "",
            language: languageIndex >= 0 ? (row[languageIndex] ?? "") : "",
            sourceRefs:
              sourcesIndex >= 0
                ? (row[sourcesIndex] ?? "")
                    .split(/[;|]/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            bidirectional:
              !cloze &&
              bidirectionalIndex >= 0 &&
              /^(?:true|yes|1|reverse)$/i.test(
                (row[bidirectionalIndex] ?? "").trim(),
              ),
          };
        });
      const known = new Set(
        cards.map(
          (card) =>
            `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
        ),
      );
      const importedKeys = new Set<string>();
      const unique = imported.filter((card) => {
        const key = `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`;
        if (known.has(key) || importedKeys.has(key)) return false;
        importedKeys.add(key);
        return true;
      });
      if (!unique.length)
        throw new Error(
          imported.length
            ? "Every valid row duplicates an existing card. Nothing was changed."
            : "No rows contained both a front and back value.",
        );
      commit([...cards, ...unique]);
      setActiveCardId(unique[0]!.id);
      setActiveSection(unique[0]!.section ?? "Imported");
      await completeArtifactImport({
        jobId: importJobId!,
        typeKey: "flashcard_deck",
        status: "imported",
        fidelityReport: [
          {
            scope:
              "card type, front, back, hint, explanation, section, tags, difficulty, objectives, language, sources, alternatives, and reverse study",
            level: "exact",
            message: `${unique.length} cards were converted to editable Spectra cards and the original file was retained.`,
          },
          ...(rows.length - unique.length > 0
            ? [
                {
                  scope: "invalid or duplicate records",
                  level: "adapted" as const,
                  message: `${rows.length - unique.length} rows were left unchanged because they were incomplete or duplicated existing content.`,
                },
              ]
            : []),
        ],
        unsupportedFeatures: structuredText
          ? [
              "external scheduling state",
              "image-occlusion media requires a Spectra package",
            ]
          : ["unsupported Markdown styling", "external scheduling state"],
        importedContent: { cards: unique },
      });
      setDeckImportReport(
        `${unique.length} cards imported as editable content · ${rows.length - unique.length} invalid or duplicate rows left unchanged.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The deck import was quarantined.";
      await Promise.all(
        uploadedPackageAssetIds.map((assetId) =>
          revokeArtifactAsset(assetId).catch(() => undefined),
        ),
      );
      if (importJobId) {
        await completeArtifactImport({
          jobId: importJobId,
          typeKey: "flashcard_deck",
          status: "quarantined",
          fidelityReport: [
            { scope: "deck import", level: "unsupported", message },
          ],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(importJobId!, message).catch(
            () => undefined,
          );
        });
      }
      setDeckImportError(message);
    } finally {
      if (deckImportRef.current) deckImportRef.current.value = "";
    }
  }

  function applyDeckTemplate(kind: "language" | "concept" | "formula") {
    const section =
      kind === "language"
        ? "Vocabulary"
        : kind === "formula"
          ? "Formulae"
          : "Concepts";
    const template: DeckCard = {
      id: id("card"),
      variant: kind === "concept" ? "cloze" : "basic",
      front:
        kind === "language"
          ? "Term or phrase"
          : kind === "formula"
            ? "When should this formula be used?"
            : "Complete the core idea: {{c1::key concept::concept}}",
      back:
        kind === "language"
          ? "Meaning, usage, and example"
          : kind === "formula"
            ? "Formula, variables, units, and constraints"
            : "Explain the relationship in your own words.",
      hint: "Add one useful retrieval cue",
      explanation: "Add context that appears after the answer.",
      section,
      tags: [],
      confidence: "unknown",
      difficulty: "medium",
    };
    commit([...cards, template]);
    setActiveCardId(template.id);
    setActiveSection(section);
    setDeckMenuOpen(false);
  }

  function exportDeck(format: "csv" | "tsv") {
    const delimiter = format === "csv" ? "," : "\t";
    const escape = (value: string) => {
      const normalized = value.replaceAll("\0", "");
      return normalized.includes(delimiter) || /["\r\n]/.test(normalized)
        ? `"${normalized.replaceAll('"', '""')}"`
        : normalized;
    };
    const rows = [
      [
        "Type",
        "Front",
        "Back",
        "Hint",
        "Explanation",
        "Accepted alternatives",
        "Section",
        "Tags",
        "Difficulty",
        "Learning objective",
        "Language",
        "Sources",
        "Bidirectional",
        "Media name",
        "Hidden regions",
      ],
      ...cards.map((card) => [
        card.variant ?? "basic",
        card.front,
        card.back,
        card.hint ?? "",
        card.explanation ?? "",
        (card.acceptedAlternatives ?? []).join(";"),
        card.section ?? "",
        (card.tags ?? []).join(";"),
        card.difficulty ?? "medium",
        card.learningObjective ?? "",
        card.language ?? "",
        (card.sourceRefs ?? []).join(";"),
        card.bidirectional ? "true" : "false",
        card.media?.name ?? "",
        (card.occlusions ?? []).length.toString(),
      ]),
    ];
    downloadDocumentText(
      `spectra-flashcards.${format}`,
      format === "csv"
        ? "text/csv;charset=utf-8"
        : "text/tab-separated-values;charset=utf-8",
      `\uFEFF${rows.map((row) => row.map(escape).join(delimiter)).join("\r\n")}`,
    );
    setDeckMenuOpen(false);
  }

  async function exportDeckPackage() {
    setDeckActionError(undefined);
    try {
      const { strToU8, zipSync } = await import("fflate");
      const archive: Record<string, Uint8Array> = {};
      const packagedCards = await Promise.all(
        cards.map(async (card) => {
          const shareableCard = { ...card };
          delete shareableCard.review;
          if (!card.media) return shareableCard;
          const asset = deckAssets.find(
            (candidate) => candidate.assetId === card.media?.assetId,
          );
          if (!asset?.downloadUrl)
            throw new Error(
              `The image for “${card.front || card.media.name}” is unavailable. Restore or replace it before exporting.`,
            );
          const response = await fetch(asset.downloadUrl, {
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(`Could not read ${card.media.name} for export.`);
          const extension =
            card.media.mediaType === "image/png"
              ? "png"
              : card.media.mediaType === "image/webp"
                ? "webp"
                : card.media.mediaType === "image/gif"
                  ? "gif"
                  : "jpg";
          const path = `media/${card.id}.${extension}`;
          archive[path] = new Uint8Array(await response.arrayBuffer());
          return {
            ...shareableCard,
            media: { ...card.media, assetId: "", packagePath: path },
          };
        }),
      );
      archive["manifest.json"] = strToU8(
        JSON.stringify(
          {
            format: "spectra-flashcard-deck",
            version: 1,
            exportedAt: new Date().toISOString(),
            content: {
              cards: packagedCards,
              settings: record(content).settings ?? {
                shuffle: true,
                revealMode: "click",
              },
            },
          },
          null,
          2,
        ),
      );
      downloadDocumentBlob(
        "spectra-flashcards.spectra-deck.zip",
        new Blob([zipSync(archive, { level: 6 }) as BlobPart], {
          type: "application/zip",
        }),
      );
      setDeckMenuOpen(false);
    } catch (error) {
      setDeckActionError(
        error instanceof Error
          ? error.message
          : "The portable deck could not be exported.",
      );
    }
  }

  function revealStudyAnswer() {
    if (!activeStudyCard) return;
    if (
      deckSettings.revealMode === "type" &&
      studyTypedAnswer.trim().length > 0
    ) {
      const normalize = (value: string) =>
        value
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
      const response = normalize(studyTypedAnswer);
      const accepted = [
        activeStudyAnswer,
        ...(activeStudyItem?.direction === "forward"
          ? (activeStudyCard.acceptedAlternatives ?? [])
          : []),
        ...(activeStudyCard.variant === "cloze"
          ? clozeParts(activeStudyCard.front).map((part) => part.answer)
          : []),
      ]
        .map(normalize)
        .filter(Boolean);
      setStudyTypedCorrect(accepted.includes(response));
    } else setStudyTypedCorrect(undefined);
    setStudyRevealed(true);
  }

  async function rateStudyCard(rating: SpectraFlashcardRating) {
    if (!activeStudyCard || !activeStudyItem || studyReviewBusy) return;
    setStudyReviewBusy(true);
    setStudyError(undefined);
    try {
      const now = currentTimeMs();
      const result = await reviewSpectraFlashcard({
        artifactId,
        cardId: activeStudyCard.id,
        direction: activeStudyItem.direction,
        rating,
        clientReviewId: `review-${uniqueToken()}`,
        elapsedMs: Math.max(0, now - studyCardStartedAt),
      });
      setStudyStates((current) => {
        const next = new Map(current);
        next.set(
          deckStudyKey(result.state.cardId, result.state.direction),
          result.state,
        );
        return next;
      });
      setStudyRatings((current) => ({
        ...current,
        [rating]: current[rating] + 1,
      }));
      setStudyClock(now);
      if (studyIndex + 1 >= studyQueue.length) {
        setStudyComplete(true);
      } else {
        setStudyIndex((current) => current + 1);
        setStudyRevealed(false);
        setStudyTypedAnswer("");
        setStudyTypedCorrect(undefined);
        setStudyCardStartedAt(now);
      }
    } catch (error) {
      setStudyError(
        error instanceof Error
          ? error.message
          : "This review could not be synchronized.",
      );
    } finally {
      setStudyReviewBusy(false);
    }
  }

  const activeStudyPreviews =
    activeStudyCard && activeStudyItem
      ? studyStates.get(
          deckStudyKey(activeStudyCard.id, activeStudyItem.direction),
        )?.previews
      : undefined;
  const studyIntervalLabels: Record<SpectraFlashcardRating, string> = {
    again: activeStudyPreviews?.again.label ?? "1 min",
    hard: activeStudyPreviews?.hard.label ?? "6 min",
    good: activeStudyPreviews?.good.label ?? "1 d",
    easy: activeStudyPreviews?.easy.label ?? "4 d",
  };
  const activeStudyPrompt =
    activeStudyCard && activeStudyItem
      ? activeStudyCard.variant === "cloze"
        ? clozePrompt(activeStudyCard.front)
        : activeStudyItem.direction === "reverse"
          ? activeStudyCard.back
          : activeStudyCard.front
      : "";
  const activeStudyAnswer =
    activeStudyCard && activeStudyItem
      ? activeStudyCard.variant === "cloze"
        ? clozeAnswer(activeStudyCard.front)
        : activeStudyItem.direction === "reverse"
          ? activeStudyCard.front
          : activeStudyCard.back
      : "";
  const activeStudyMedia = activeStudyCard?.media
    ? deckAssets.find(
        (asset) => asset.assetId === activeStudyCard.media?.assetId,
      )
    : undefined;
  const activePreviewSource = activeCard
    ? previewRevealed
      ? activeCard.variant === "cloze"
        ? clozeAnswer(activeCard.front)
        : activeCard.back || "No answer yet"
      : activeCard.variant === "cloze"
        ? clozePrompt(activeCard.front)
        : activeCard.front || "Untitled card"
    : "";
  const activePreviewPlainText = plannerDescriptionText(
    plannerDescriptionHtml(activePreviewSource),
  );

  return (
    <div
      className={`spectra-flashcard-studio ml-2.5 grid min-h-[720px] min-w-0 gap-3 ${mode === "tab" ? "lg:grid-cols-[330px_minmax(0,1fr)]" : "grid-cols-1"}`}
      data-studio-view={studioView}
      data-rail-collapsed={railCollapsed || undefined}
    >
      <input
        ref={deckMediaInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDeckMedia(file);
        }}
      />
      <div
        className={`spectra-deck-metrics grid w-[580px] max-w-full min-w-0 grid-cols-2 overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] ${mode === "tab" ? "ml-11 sm:grid-cols-5 lg:col-span-2" : ""}`}
      >
        <div className="px-3 py-2">
          <strong className="block font-display text-[16px] leading-5 text-[var(--text-primary)]">
            {cards.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">Cards</span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-3 py-2">
          <strong className="block font-display text-[16px] leading-5 text-[var(--text-primary)]">
            {sections.length}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Sections
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-3 py-2">
          <strong className="block font-display text-[16px] leading-5 text-[var(--text-primary)]">
            {studyStateLoading ? "—" : `${personalMastery}%`}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Personal mastery
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-3 py-2">
          <strong className="block font-display text-[16px] leading-5 text-[var(--text-primary)]">
            {studyStateLoading ? "—" : dueStudyCount}
          </strong>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Due now
          </span>
        </div>
        <div className="border-l border-[var(--border-subtle)] px-3 py-2">
          <strong className="block rounded-[5px] bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] px-2 py-1 text-center text-[10px] font-semibold text-[var(--success)]">
            Active
          </strong>
          <span className="mt-0.5 block text-center text-[9px] text-[var(--text-tertiary)]">
            Ready
          </span>
        </div>
      </div>
      <div
        className={`spectra-deck-toolbar flex min-w-0 flex-wrap items-center gap-2 ${mode === "tab" ? "lg:col-span-2" : ""}`}
      >
        <button
          type="button"
          onClick={() => addCard()}
          className="spectra-deck-edit-action inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#7560e8] px-3 text-[12px] font-semibold text-white shadow-[0_8px_20px_-14px_#5f49d4]"
        >
          <Plus className="h-4 w-4" />
          Add card
        </button>
        <button
          type="button"
          onClick={() => {
            const section = `Section ${sections.length + 1}`;
            setActiveSection(section);
            addCard(section);
          }}
          className="spectra-deck-edit-action inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
        >
          <Plus className="h-4 w-4" />
          Add section
        </button>
        <input
          ref={deckImportRef}
          type="file"
          accept=".csv,.tsv,.txt,.md,.markdown,.apkg,.zip,.spectra-deck"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importCards(file);
          }}
        />
        <button
          type="button"
          onClick={() => deckImportRef.current?.click()}
          className="spectra-deck-edit-action inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
        >
          <Import className="h-4 w-4" />
          Import
        </button>
        <button
          type="button"
          onClick={() => {
            beginStudySession();
          }}
          disabled={!studyCards.length}
          className="spectra-deck-study-trigger inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] disabled:opacity-40"
          aria-label={
            !studyStateLoading && dueStudyCount
              ? `Present flashcards, ${dueStudyCount} cards due`
              : "Present flashcards"
          }
        >
          <Play className="h-4 w-4" />
          Present
          {!studyStateLoading && dueStudyCount ? ` · ${dueStudyCount}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setDeckMenuOpen(!deckMenuOpen)}
          data-active={deckMenuOpen || undefined}
          className="spectra-deck-edit-action spectra-deck-menu-trigger inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
          aria-label="Deck templates, study settings, and export"
          title="Templates and export"
        >
          <LayoutTemplate className="h-4 w-4" />
          <span className="hidden sm:inline">Templates</span>
        </button>
        {studioView === "edit" ? (
          <button
            type="button"
            className="spectra-deck-rail-toggle"
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
          >
            <PanelLeft className="h-3.5 w-3.5" />
            {railCollapsed ? "Show cards" : "Hide cards"}
          </button>
        ) : null}
        <div
          className="spectra-deck-mode-switch ml-auto"
          role="tablist"
          aria-label="Flashcard views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={studioView === "edit"}
            data-active={studioView === "edit" || undefined}
            onClick={() => setStudioView("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioView === "view"}
            data-active={studioView === "view" || undefined}
            onClick={() => setStudioView("view")}
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </button>
        </div>
        <div
          className={`spectra-deck-pagination ${mode === "split" ? "w-full justify-between border-t border-[var(--border-subtle)] pt-2" : ""} flex min-w-0 items-center gap-1 text-[11px] text-[var(--text-secondary)]`}
        >
          <button
            type="button"
            aria-label="Previous card"
            disabled={
              !activeCard ||
              cards.findIndex((card) => card.id === activeCard.id) === 0
            }
            onClick={() => {
              const index = cards.findIndex(
                (card) => card.id === activeCard?.id,
              );
              if (index > 0) setActiveCardId(cards[index - 1]!.id);
            }}
            className={iconButtonClass()}
          >
            <ChevronDown className="h-4 w-4 rotate-90" />
          </button>
          <select
            aria-label="Current card"
            value={activeCard?.id ?? ""}
            onChange={(event) => setActiveCardId(event.target.value)}
          >
            {cards.map((card, index) => (
              <option key={card.id} value={card.id}>
                {index + 1} ·{" "}
                {plannerDescriptionText(card.front) || "Untitled card"}
              </option>
            ))}
          </select>
          <span className="whitespace-nowrap">
            {activeCardIndex + 1} of {cards.length}
          </span>
          <button
            type="button"
            aria-label="Next card"
            disabled={
              !activeCard ||
              cards.findIndex((card) => card.id === activeCard.id) ===
                cards.length - 1
            }
            onClick={() => {
              const index = cards.findIndex(
                (card) => card.id === activeCard?.id,
              );
              if (index >= 0 && index < cards.length - 1)
                setActiveCardId(cards[index + 1]!.id);
            }}
            className={iconButtonClass()}
          >
            <ChevronDown className="h-4 w-4 -rotate-90" />
          </button>
        </div>
        <div className="spectra-deck-edit-action spectra-deck-view-switch flex items-center rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0.5">
          <button
            type="button"
            data-active={railView === "list" || undefined}
            onClick={() => setRailView("list")}
            aria-label="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-active={railView === "grid" || undefined}
            onClick={() => setRailView("grid")}
            aria-label="Grid view"
          >
            <Grid3X3 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {studioView === "view" && activeCard ? (
        <section
          className="spectra-deck-viewer"
          aria-label={`Flashcard ${activeCardIndex + 1} of ${cards.length}`}
        >
          <div className="spectra-deck-viewer-context">
            <span>{activeCard.section || "Section 1"}</span>
            <strong>
              {activeCardIndex + 1} of {cards.length}
            </strong>
          </div>
          <button
            type="button"
            className="spectra-deck-viewer-card"
            data-revealed={previewRevealed || undefined}
            data-density={
              activePreviewPlainText.length > 260
                ? "dense"
                : activePreviewPlainText.length > 130
                  ? "compact"
                  : undefined
            }
            onClick={() => setPreviewRevealed((revealed) => !revealed)}
          >
            <span>{previewRevealed ? "Answer" : "Prompt"}</span>
            <div
              className="spectra-deck-viewer-copy"
              dangerouslySetInnerHTML={{
                __html: plannerDescriptionHtml(activePreviewSource),
              }}
            />
            {previewRevealed && activeCard.explanation ? (
              <small>{activeCard.explanation}</small>
            ) : !previewRevealed && activeCard.hint ? (
              <small>{activeCard.hint}</small>
            ) : null}
            <em>{previewRevealed ? "Show prompt" : "Reveal answer"}</em>
          </button>
        </section>
      ) : null}
      {deckMenuOpen ? (
        <div className="spectra-deck-menu">
          <strong>Start from a template</strong>
          <button type="button" onClick={() => applyDeckTemplate("concept")}>
            <LayoutTemplate className="h-4 w-4" />
            Concept and cloze cards
          </button>
          <button type="button" onClick={() => applyDeckTemplate("language")}>
            <LayoutTemplate className="h-4 w-4" />
            Vocabulary cards
          </button>
          <button type="button" onClick={() => applyDeckTemplate("formula")}>
            <LayoutTemplate className="h-4 w-4" />
            Formula cards
          </button>
          <strong>Study preferences</strong>
          <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={deckSettings.shuffle !== false}
              onChange={(event) =>
                updateDeckSettings({ shuffle: event.target.checked })
              }
            />
            Shuffle each due queue
          </label>
          <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={deckSettings.showHints !== false}
              onChange={(event) =>
                updateDeckSettings({ showHints: event.target.checked })
              }
            />
            Show hints before reveal
          </label>
          <label className="flex items-center justify-between gap-3 px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            Recall style
            <select
              value={deckSettings.revealMode === "type" ? "type" : "click"}
              onChange={(event) =>
                updateDeckSettings({
                  revealMode: event.target.value as "click" | "type",
                })
              }
              className="h-7 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[10px] text-[var(--text-primary)] outline-none"
            >
              <option value="click">Reveal</option>
              <option value="type">Type answer</option>
            </select>
          </label>
          <strong>Export</strong>
          <button type="button" onClick={() => exportDeck("csv")}>
            <FileDown className="h-4 w-4" /> CSV
          </button>
          <button type="button" onClick={() => exportDeck("tsv")}>
            <FileDown className="h-4 w-4" /> TSV
          </button>
          <button type="button" onClick={() => void exportDeckPackage()}>
            <Archive className="h-4 w-4" /> Portable deck package
          </button>
          <button
            type="button"
            onClick={() => {
              setDeckMenuOpen(false);
              window.print();
            }}
          >
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
        </div>
      ) : null}
      {deckImportReport || deckImportError || deckActionError ? (
        <div
          className="spectra-deck-import-report"
          data-error={Boolean(deckImportError || deckActionError) || undefined}
          role="status"
        >
          <span>
            <strong>
              {deckActionError
                ? "Deck action failed"
                : deckImportError
                  ? "Import quarantined"
                  : "Import complete"}
            </strong>
            <small>
              {deckActionError || deckImportError || deckImportReport}
            </small>
          </span>
          <button
            type="button"
            onClick={() => {
              setDeckImportError(undefined);
              setDeckImportReport(undefined);
              setDeckActionError(undefined);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <aside className="min-w-0 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Cards
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {cards.length} {cards.length === 1 ? "card" : "cards"} across{" "}
              {sections.length} {sections.length === 1 ? "section" : "sections"}
            </p>
          </div>
          <button
            type="button"
            className={smallActionClass()}
            onClick={() => addCard()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <div className="spectra-deck-searchbar">
          <label>
            <Search className="h-3.5 w-3.5" />
            <input
              value={deckSearch}
              onChange={(event) => setDeckSearch(event.target.value)}
              placeholder="Find cards"
            />
          </label>
          <label>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <select
              value={deckFilter}
              onChange={(event) =>
                setDeckFilter(event.target.value as typeof deckFilter)
              }
            >
              <option value="all">All cards</option>
              <option value="incomplete">Incomplete</option>
              <option value="duplicate">Duplicates</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              setSelectedCardIds(new Set(filteredCards.map((card) => card.id)))
            }
            disabled={!filteredCards.length}
            aria-label="Select all filtered cards"
            title="Select all filtered cards"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
        {selectedCardIds.size ? (
          <div
            className="spectra-deck-bulkbar"
            role="toolbar"
            aria-label="Bulk card actions"
          >
            <strong>{selectedCardIds.size} selected</strong>
            <select
              aria-label="Move selected cards to section"
              value=""
              onChange={(event) => {
                if (event.target.value) moveSelectedCards(event.target.value);
              }}
            >
              <option value="">Move to…</option>
              {sections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
            <select
              aria-label="Set selected card difficulty"
              value=""
              onChange={(event) => {
                if (
                  event.target.value === "easy" ||
                  event.target.value === "medium" ||
                  event.target.value === "hard"
                )
                  setSelectedDifficulty(event.target.value);
              }}
            >
              <option value="">Difficulty…</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <button type="button" onClick={deleteSelectedCards}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button type="button" onClick={() => setSelectedCardIds(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        <div
          className="max-h-[650px] overflow-y-auto p-2"
          data-rail-view={railView}
        >
          {sections.map((section) => (
            <section key={section} className="mb-2">
              <div className="spectra-deck-section-header">
                {renamingSection === section ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameSection(section);
                    }}
                  >
                    <input
                      autoFocus
                      value={sectionNameDraft}
                      onChange={(event) =>
                        setSectionNameDraft(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setRenamingSection(undefined);
                          setSectionNameDraft("");
                        }
                      }}
                      aria-label={`Rename ${section}`}
                    />
                    <button type="submit">Save</button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-expanded={!collapsedSections.has(section)}
                      onClick={() => {
                        setActiveSection(section);
                        setCollapsedSections((current) => {
                          const next = new Set(current);
                          if (next.has(section)) next.delete(section);
                          else next.add(section);
                          return next;
                        });
                      }}
                    >
                      <span>
                        {section}
                        <small>
                          {(() => {
                            const count = cards.filter(
                              (card) =>
                                (card.section || "Section 1") === section,
                            ).length;
                            return `${count} ${count === 1 ? "card" : "cards"}`;
                          })()}
                        </small>
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${collapsedSections.has(section) ? "-rotate-90" : ""}`}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${section}`}
                      title="Rename section"
                      onClick={() => {
                        setRenamingSection(section);
                        setSectionNameDraft(section);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              {!collapsedSections.has(section) ? (
                <div className="space-y-1">
                  {cards
                    .filter(
                      (card) =>
                        (card.section || "Section 1") === section &&
                        filteredCards.some(
                          (candidate) => candidate.id === card.id,
                        ),
                    )
                    .map((card, index) => {
                      const canonicalIndex = cards.findIndex(
                        (item) => item.id === card.id,
                      );
                      const aiChanging = pathTouches(
                        aiChangedPaths,
                        `/cards/${canonicalIndex}`,
                      );
                      return (
                        <button
                          key={card.id}
                          type="button"
                          draggable
                          data-bulk-selected={
                            selectedCardIds.has(card.id) || undefined
                          }
                          data-invalid={
                            !card.front.trim() || !card.back.trim() || undefined
                          }
                          data-duplicate={
                            duplicateKeys.has(
                              `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
                            ) || undefined
                          }
                          className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border px-2 py-2 text-left ${
                            card.id === activeCard?.id
                              ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]"
                              : "border-transparent hover:bg-[var(--bg-hover)]"
                          }`}
                          onClick={(event) => {
                            if (event.ctrlKey || event.metaKey) {
                              toggleCardSelection(card.id);
                              return;
                            }
                            if (event.shiftKey && activeCard) {
                              const anchorIndex = cards.findIndex(
                                (item) => item.id === activeCard.id,
                              );
                              const start = Math.min(
                                anchorIndex,
                                canonicalIndex,
                              );
                              const end = Math.max(anchorIndex, canonicalIndex);
                              setSelectedCardIds(
                                new Set(
                                  cards
                                    .slice(start, end + 1)
                                    .map((item) => item.id),
                                ),
                              );
                              return;
                            }
                            setActiveCardId(card.id);
                            setActiveSection(section);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", card.id);
                            setDraggedCardId(card.id);
                          }}
                          onDragOver={(event) => {
                            if (draggedCardId && draggedCardId !== card.id)
                              event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const dragged =
                              draggedCardId ||
                              event.dataTransfer.getData("text/plain");
                            if (dragged) reorderCard(dragged, card.id);
                          }}
                          onDragEnd={() => setDraggedCardId(undefined)}
                          data-ai-region={aiChanging || undefined}
                        >
                          <span className="text-center text-[12px] text-[var(--text-secondary)]">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
                            {plannerDescriptionText(card.front) ||
                              "Untitled card"}
                          </span>
                          {!card.front.trim() || !card.back.trim() ? (
                            <AlertCircle
                              className="h-3.5 w-3.5 text-[var(--danger)]"
                              aria-label="Incomplete card"
                            />
                          ) : duplicateKeys.has(
                              `${card.front.trim().toLocaleLowerCase()}|${card.back.trim().toLocaleLowerCase()}`,
                            ) ? (
                            <Copy
                              className="h-3.5 w-3.5 text-[#d88922]"
                              aria-label="Duplicate card"
                            />
                          ) : (
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${card.confidence === "strong" ? "bg-[var(--success)]" : card.confidence === "weak" ? "bg-[var(--danger)]" : "bg-[#d88922]"}`}
                            />
                          )}
                        </button>
                      );
                    })}
                </div>
              ) : null}
            </section>
          ))}
          {!filteredCards.length ? (
            <div className="spectra-deck-empty-filter">
              <Search className="h-5 w-5" />
              <strong>No matching cards</strong>
              <span>
                Change the search or filter without altering the deck.
              </span>
            </div>
          ) : null}
          <button
            type="button"
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            onClick={() => {
              const section = `Section ${sections.length + 1}`;
              setActiveSection(section);
              addCard(section);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add section
          </button>
        </div>
      </aside>
      <section className="spectra-deck-card-editor min-w-0 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
        {activeCard ? (
          <div>
            <div className="spectra-deck-card-heading mb-4 flex items-center justify-between">
              <div className="text-[12px] text-[var(--text-secondary)]">
                Card {cards.findIndex((card) => card.id === activeCard.id) + 1}{" "}
                of {cards.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={iconButtonClass()}
                  onClick={() => {
                    const copy: DeckCard = {
                      ...activeCard,
                      id: id("card"),
                      front: `${activeCard.front}${activeCard.front ? " (copy)" : ""}`,
                      review: undefined,
                    };
                    const index = cards.findIndex(
                      (card) => card.id === activeCard.id,
                    );
                    const next = [...cards];
                    next.splice(index + 1, 0, copy);
                    commit(next);
                    setActiveCardId(copy.id);
                  }}
                  aria-label="Duplicate card"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={iconButtonClass()}
                  onClick={() => {
                    const next = cards.filter(
                      (card) => card.id !== activeCard.id,
                    );
                    const replacement =
                      next.length > 0
                        ? next
                        : [
                            {
                              id: id("card"),
                              front: "",
                              back: "",
                              hint: "",
                              section: activeSection,
                              confidence: "unknown" as const,
                              difficulty: "medium" as const,
                            },
                          ];
                    commit(replacement);
                    releaseUnusedDeckMedia([activeCard], replacement);
                    setActiveCardId(replacement[0]!.id);
                  }}
                  aria-label="Remove card"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <CardFace
              label="Front"
              value={activeCard.front}
              placeholder="Question or prompt"
              onChange={(value) => updateCard(activeCard.id, { front: value })}
              onFocus={() => onActiveRegionChange?.(`${activeCard.id}:front`)}
              clozeMode={activeCard.variant === "cloze"}
              aiActive={pathTouches(
                aiChangedPaths,
                `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/front`,
              )}
              path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/front`}
            />
            {activeCard.variant !== "image_occlusion" &&
            activeCard.media?.placement !== "back" &&
            activeDeckMedia?.downloadUrl ? (
              <div className="mt-3 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeDeckMedia.downloadUrl}
                  alt={
                    activeCard.media?.altText ||
                    activeCard.media?.name ||
                    "Card image"
                  }
                  className="mx-auto block max-h-[360px] max-w-full rounded-[6px] object-contain"
                />
              </div>
            ) : null}
            {activeCard.variant === "image_occlusion" ? (
              <section className="mt-3 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="block text-[12px] text-[var(--text-primary)]">
                      Image occlusion
                    </strong>
                    <span className="text-[10px] leading-4 text-[var(--text-tertiary)]">
                      Drag over the image to hide a region. Each mask is
                      revealed with the answer.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    disabled={deckMediaBusy}
                    onClick={() => deckMediaInputRef.current?.click()}
                  >
                    {deckMediaBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    {activeCard.media ? "Replace image" : "Add image"}
                  </button>
                  {activeCard.media ? (
                    <button
                      type="button"
                      className={iconButtonClass()}
                      disabled={deckMediaBusy}
                      onClick={() => void removeDeckMedia()}
                      aria-label="Remove image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {activeDeckMedia?.downloadUrl ? (
                  <>
                    <div
                      className="relative mx-auto max-h-[440px] w-fit touch-none select-none overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[#17191d] cursor-crosshair"
                      onPointerDown={beginMask}
                      onPointerMove={moveMask}
                      onPointerUp={finishMask}
                      onPointerCancel={() => setMaskDraft(undefined)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeDeckMedia.downloadUrl}
                        alt={
                          activeCard.media?.altText || activeCard.media?.name
                        }
                        className="pointer-events-none block max-h-[440px] max-w-full object-contain"
                        draggable={false}
                      />
                      {(activeCard.occlusions ?? []).map((mask, index) => (
                        <button
                          key={mask.id}
                          type="button"
                          className="absolute grid place-items-center border border-white/65 bg-[#252a32]/90 text-[10px] font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.24)] hover:bg-[var(--danger)]/90"
                          style={{
                            left: `${mask.x * 100}%`,
                            top: `${mask.y * 100}%`,
                            width: `${mask.width * 100}%`,
                            height: `${mask.height * 100}%`,
                          }}
                          title="Remove this mask"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateCard(activeCard.id, {
                              occlusions: (activeCard.occlusions ?? []).filter(
                                (candidate) => candidate.id !== mask.id,
                              ),
                            });
                          }}
                        >
                          {index + 1}
                        </button>
                      ))}
                      {maskDraft ? (
                        <span
                          className="pointer-events-none absolute border border-white/75 bg-[#4997e8]/75"
                          style={{
                            left: `${Math.min(maskDraft.x, maskDraft.currentX) * 100}%`,
                            top: `${Math.min(maskDraft.y, maskDraft.currentY) * 100}%`,
                            width: `${Math.abs(maskDraft.currentX - maskDraft.x) * 100}%`,
                            height: `${Math.abs(maskDraft.currentY - maskDraft.y) * 100}%`,
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Field label="Image description">
                        <input
                          className={inputClass()}
                          value={activeCard.media?.altText ?? ""}
                          onChange={(event) =>
                            updateCard(activeCard.id, {
                              media: activeCard.media
                                ? {
                                    ...activeCard.media,
                                    altText: event.target.value,
                                  }
                                : undefined,
                            })
                          }
                          placeholder="Describe the image for accessibility"
                        />
                      </Field>
                      <Field label="Hidden regions">
                        <div className="flex h-10 items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[11px] text-[var(--text-secondary)]">
                          {(activeCard.occlusions ?? []).length
                            ? `${activeCard.occlusions!.length} ready to reveal`
                            : "Drag on the image to add the first mask"}
                        </div>
                      </Field>
                    </div>
                    {(activeCard.occlusions ?? []).length ? (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {(activeCard.occlusions ?? []).map((mask, index) => (
                          <div
                            key={mask.id}
                            className="flex items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-1.5"
                          >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-[#252a32] text-[10px] font-bold text-white">
                              {index + 1}
                            </span>
                            <input
                              value={mask.label ?? ""}
                              onChange={(event) =>
                                updateCard(activeCard.id, {
                                  occlusions: (activeCard.occlusions ?? []).map(
                                    (candidate) =>
                                      candidate.id === mask.id
                                        ? {
                                            ...candidate,
                                            label: event.target.value,
                                          }
                                        : candidate,
                                  ),
                                })
                              }
                              className="min-w-0 flex-1 bg-transparent px-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                              placeholder="Optional revealed label"
                              aria-label={`Label for hidden region ${index + 1}`}
                            />
                            <button
                              type="button"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                              onClick={() =>
                                updateCard(activeCard.id, {
                                  occlusions: (
                                    activeCard.occlusions ?? []
                                  ).filter(
                                    (candidate) => candidate.id !== mask.id,
                                  ),
                                })
                              }
                              aria-label={`Remove hidden region ${index + 1}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className="grid min-h-40 w-full place-items-center rounded-[8px] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] text-center"
                    onClick={() => deckMediaInputRef.current?.click()}
                  >
                    <span>
                      <ImageIcon className="mx-auto mb-2 h-5 w-5 text-[var(--text-tertiary)]" />
                      <strong className="block text-[12px] text-[var(--text-primary)]">
                        Add the diagram or image to study
                      </strong>
                      <small className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
                        PNG, JPEG, WebP, or GIF
                      </small>
                    </span>
                  </button>
                )}
                {deckMediaError ? (
                  <div
                    className="mt-2 flex items-center gap-2 rounded-[7px] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-primary))] px-2.5 py-2 text-[10px] text-[var(--danger)]"
                    role="alert"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span className="min-w-0 flex-1">{deckMediaError}</span>
                    <button
                      type="button"
                      onClick={() => setDeckMediaError(undefined)}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            <div className="my-3 flex justify-center">
              <button
                type="button"
                className="spectra-deck-swap"
                onClick={() =>
                  updateCard(activeCard.id, {
                    front: activeCard.back,
                    back: activeCard.front,
                  })
                }
                aria-label="Swap front and back"
                title="Swap front and back"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <CardFace
              label="Back"
              value={activeCard.back}
              placeholder="Answer"
              onChange={(value) => updateCard(activeCard.id, { back: value })}
              onFocus={() => onActiveRegionChange?.(`${activeCard.id}:back`)}
              noteValue={activeCard.hint ?? ""}
              onNoteChange={(value) =>
                updateCard(activeCard.id, { hint: value })
              }
              aiActive={pathTouches(
                aiChangedPaths,
                `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/back`,
              )}
              aiNoteActive={pathTouches(
                aiChangedPaths,
                `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/hint`,
              )}
              path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/back`}
              notePath={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/hint`}
            />
            {activeCard.variant !== "image_occlusion" &&
            activeCard.media?.placement === "back" &&
            activeDeckMedia?.downloadUrl ? (
              <div className="mt-3 overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeDeckMedia.downloadUrl}
                  alt={activeCard.media.altText || activeCard.media.name}
                  className="mx-auto block max-h-[360px] max-w-full rounded-[6px] object-contain"
                />
              </div>
            ) : null}
            <div className="spectra-deck-tag-field mt-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Tags
              </span>
              <div className="mt-2 flex min-h-9 flex-wrap items-center gap-1.5">
                {(activeCard.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[color-mix(in_oklab,#8b6ff0_20%,var(--border-default))] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-elevated))] px-2 text-[10px] text-[var(--text-secondary)]"
                  >
                    {tag}
                    <button
                      type="button"
                      className="grid size-4 place-items-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                      onClick={() =>
                        updateCard(activeCard.id, {
                          tags: (activeCard.tags ?? []).filter(
                            (candidate) => candidate !== tag,
                          ),
                        })
                      }
                      aria-label={`Remove ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={deckTagDraft}
                  onChange={(event) => setDeckTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addActiveCardTag();
                    }
                  }}
                  className="h-7 min-w-24 flex-1 bg-transparent px-1 text-[10px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Add tag"
                  aria-label="Add card tag"
                />
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  onClick={addActiveCardTag}
                >
                  <Plus className="h-3 w-3" /> Add tag
                </button>
              </div>
            </div>
            <button
              type="button"
              className="spectra-deck-advanced-trigger"
              aria-expanded={advancedOpen}
              {...(advancedAiPath ? targetAttrs(advancedAiPath) : {})}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Advanced card settings
              <ChevronDown
                className={`ml-auto h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen ? (
              <div className="spectra-deck-advanced">
                <div>
                  <Field
                    label="Card type"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/variant`,
                    )}
                    path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/variant`}
                  >
                    <select
                      value={activeCard.variant ?? "basic"}
                      onChange={(event) => {
                        const variant = event.target
                          .value as DeckCard["variant"];
                        updateCard(activeCard.id, {
                          variant,
                          ...(variant !== "basic"
                            ? { bidirectional: false }
                            : {}),
                        });
                      }}
                      className={inputClass()}
                    >
                      <option value="basic">Basic front / back</option>
                      <option value="cloze">Cloze deletion</option>
                      <option value="image_occlusion">Image occlusion</option>
                    </select>
                  </Field>
                  <Field
                    label="Difficulty"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/difficulty`,
                    )}
                    path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/difficulty`}
                  >
                    <select
                      value={activeCard.difficulty ?? "medium"}
                      onChange={(event) =>
                        updateCard(activeCard.id, {
                          difficulty: event.target
                            .value as DeckCard["difficulty"],
                        })
                      }
                      className={inputClass()}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </Field>
                  <Field
                    label="Confidence"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/confidence`,
                    )}
                    path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/confidence`}
                  >
                    <select
                      value={activeCard.confidence ?? "unknown"}
                      onChange={(event) =>
                        updateCard(activeCard.id, {
                          confidence: event.target
                            .value as DeckCard["confidence"],
                        })
                      }
                      className={inputClass()}
                    >
                      <option value="unknown">Unknown</option>
                      <option value="weak">Weak</option>
                      <option value="medium">Medium</option>
                      <option value="strong">Strong</option>
                    </select>
                  </Field>
                  <Field
                    label="Section"
                    path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/section`}
                  >
                    <select
                      value={activeCard.section ?? "Section 1"}
                      onChange={(event) =>
                        updateCard(activeCard.id, {
                          section: event.target.value,
                        })
                      }
                      className={inputClass()}
                    >
                      {sections.map((section) => (
                        <option key={section} value={section}>
                          {section}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Language"
                    path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/language`}
                  >
                    <input
                      value={activeCard.language ?? ""}
                      onChange={(event) =>
                        updateCard(activeCard.id, {
                          language: event.target.value,
                        })
                      }
                      className={inputClass()}
                      placeholder="e.g. English, Spanish"
                    />
                  </Field>
                </div>
                {activeCard.variant !== "image_occlusion" ? (
                  <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <strong className="block text-[11px] text-[var(--text-primary)]">
                          Card image
                        </strong>
                        <span className="text-[10px] leading-4 text-[var(--text-tertiary)]">
                          Add a useful visual to the prompt or answer.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        disabled={deckMediaBusy}
                        onClick={() => deckMediaInputRef.current?.click()}
                      >
                        {deckMediaBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5" />
                        )}
                        {activeCard.media ? "Replace" : "Add image"}
                      </button>
                      {activeCard.media ? (
                        <button
                          type="button"
                          className={iconButtonClass()}
                          disabled={deckMediaBusy}
                          onClick={() => void removeDeckMedia()}
                          aria-label="Remove card image"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {activeCard.media ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <Field
                          label="Place image on"
                          path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/media/placement`}
                        >
                          <select
                            value={activeCard.media.placement ?? "front"}
                            onChange={(event) =>
                              updateCard(activeCard.id, {
                                media: activeCard.media
                                  ? {
                                      ...activeCard.media,
                                      placement: event.target.value as
                                        "front" | "back",
                                    }
                                  : undefined,
                              })
                            }
                            className={inputClass()}
                          >
                            <option value="front">Prompt / front</option>
                            <option value="back">Answer / back</option>
                          </select>
                        </Field>
                        <Field
                          label="Image description"
                          path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/media/altText`}
                        >
                          <input
                            value={activeCard.media.altText ?? ""}
                            onChange={(event) =>
                              updateCard(activeCard.id, {
                                media: activeCard.media
                                  ? {
                                      ...activeCard.media,
                                      altText: event.target.value,
                                    }
                                  : undefined,
                              })
                            }
                            className={inputClass()}
                            placeholder="Describe it for accessibility"
                          />
                        </Field>
                      </div>
                    ) : null}
                    {deckMediaError ? (
                      <p className="mt-2 text-[10px] text-[var(--danger)]">
                        {deckMediaError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Field
                  label="Explanation"
                  path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/explanation`}
                >
                  <textarea
                    value={activeCard.explanation ?? ""}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        explanation: event.target.value,
                      })
                    }
                    className={`${inputClass()} min-h-[74px] resize-y py-2`}
                    placeholder="Why this answer is correct or useful"
                  />
                </Field>
                <Field
                  label="Accepted alternatives"
                  path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/acceptedAlternatives`}
                >
                  <input
                    value={(activeCard.acceptedAlternatives ?? []).join("; ")}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        acceptedAlternatives: event.target.value
                          .split(";")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                    className={inputClass()}
                    placeholder="Alternative answer; another accepted form"
                  />
                </Field>
                <Field
                  label="Learning objective"
                  path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/learningObjective`}
                >
                  <input
                    value={activeCard.learningObjective ?? ""}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        learningObjective: event.target.value,
                      })
                    }
                    className={inputClass()}
                    placeholder="What should this card help the learner retrieve?"
                  />
                </Field>
                <Field
                  label="Sources / provenance"
                  path={`/cards/${cards.findIndex((card) => card.id === activeCard.id)}/sourceRefs`}
                >
                  <input
                    value={(activeCard.sourceRefs ?? []).join(", ")}
                    onChange={(event) =>
                      updateCard(activeCard.id, {
                        sourceRefs: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    className={inputClass()}
                    placeholder="Chapter 3, lecture notes"
                  />
                </Field>
                <label className="spectra-deck-check-field">
                  <input
                    type="checkbox"
                    {...targetAttrs(
                      `/cards/${cards.findIndex((card) => card.id === activeCard.id)}/bidirectional`,
                    )}
                    checked={activeCard.bidirectional === true}
                    disabled={activeCard.variant !== "basic"}
                    onChange={() =>
                      updateCard(activeCard.id, {
                        bidirectional: !activeCard.bidirectional,
                      })
                    }
                  />
                  {activeCard.variant === "basic"
                    ? "Generate and schedule the reverse direction separately"
                    : "Reverse study is available for basic front / back cards"}
                </label>
              </div>
            ) : null}
            <div className="spectra-deck-sync-actions">
              <span
                data-invalid={
                  !activeCard.front.trim() ||
                  !activeCard.back.trim() ||
                  (activeCard.variant === "cloze" &&
                    clozeParts(activeCard.front).length === 0) ||
                  (activeCard.variant === "image_occlusion" &&
                    (!activeCard.media ||
                      (activeCard.occlusions?.length ?? 0) === 0)) ||
                  undefined
                }
              >
                {activeCard.variant === "cloze" &&
                clozeParts(activeCard.front).length === 0
                  ? "Select an answer on the front and make it a cloze"
                  : activeCard.variant === "image_occlusion" &&
                      (!activeCard.media ||
                        (activeCard.occlusions?.length ?? 0) === 0)
                    ? "Add an image and at least one hidden region"
                    : !activeCard.front.trim() || !activeCard.back.trim()
                      ? "Add both sides before studying this card"
                      : activeCardDirty
                        ? "Syncing changes…"
                        : "Synchronized"}
              </span>
              {activeCardDirty ? (
                <button
                  type="button"
                  onClick={() => {
                    const baseline = cardEditBaseline;
                    if (!baseline || baseline.id !== activeCard.id) return;
                    commit(
                      cards.map((card) =>
                        card.id === activeCard.id
                          ? structuredClone(baseline)
                          : card,
                      ),
                    );
                  }}
                >
                  Revert card
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      {studyOpen && studyQueue.length && typeof document !== "undefined"
        ? createPortal(
            <div
              className="spectra-deck-study"
              role="dialog"
              aria-modal="true"
              aria-label="Private flashcard study session"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeStudySession();
                  return;
                }
                if (studyComplete) return;
                const typing =
                  event.target instanceof HTMLInputElement ||
                  event.target instanceof HTMLTextAreaElement;
                if (
                  !studyRevealed &&
                  ((!typing && event.key === " ") || event.key === "Enter")
                ) {
                  event.preventDefault();
                  revealStudyAnswer();
                  return;
                }
                if (studyRevealed && ["1", "2", "3", "4"].includes(event.key)) {
                  event.preventDefault();
                  const selected = (["again", "hard", "good", "easy"] as const)[
                    Number(event.key) - 1
                  ];
                  if (selected) void rateStudyCard(selected);
                }
              }}
            >
              <header>
                <span>
                  <BookOpen className="h-4 w-4" />
                  <strong>Private study session</strong>
                  <small>
                    {studyComplete
                      ? `${studyQueue.length} reviewed`
                      : `${studyIndex + 1} of ${studyQueue.length}`}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label="Close study session"
                  onClick={closeStudySession}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              {studyError ? (
                <div className="spectra-deck-study-error" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  <span>{studyError}</span>
                  <button
                    type="button"
                    onClick={() => setStudyError(undefined)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {studyComplete ? (
                <main className="spectra-deck-study-complete">
                  <span className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] text-[var(--success)]">
                    <CheckCircle2 className="h-6 w-6" />
                  </span>
                  <h3>Study queue complete</h3>
                  <p>
                    Every result was synchronized to your private scheduler.
                    Other collaborators cannot see your answers or review
                    history.
                  </p>
                  <div>
                    {(["again", "hard", "good", "easy"] as const).map(
                      (rating) => (
                        <span key={rating}>
                          <strong>{studyRatings[rating]}</strong>
                          <small>{rating}</small>
                        </span>
                      ),
                    )}
                  </div>
                  <button type="button" onClick={beginStudySession}>
                    Review another queue
                  </button>
                </main>
              ) : activeStudyCard ? (
                <main>
                  <section>
                    <span>
                      Prompt
                      {activeStudyItem?.direction === "reverse"
                        ? " · reverse"
                        : ""}
                    </span>
                    <strong>{activeStudyPrompt}</strong>
                    {activeStudyCard.variant !== "image_occlusion" &&
                    activeStudyCard.media?.placement !== "back" &&
                    activeStudyMedia?.downloadUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={activeStudyMedia.downloadUrl}
                        alt={
                          activeStudyCard.media?.altText ||
                          activeStudyCard.media?.name ||
                          "Card image"
                        }
                        className="mx-auto mt-4 block max-h-[42vh] max-w-full rounded-[9px] border border-[var(--border-default)] object-contain"
                      />
                    ) : null}
                    {activeStudyCard.variant === "image_occlusion" &&
                    activeStudyMedia?.downloadUrl ? (
                      <div className="relative mx-auto mt-4 w-fit max-w-full overflow-hidden rounded-[9px] border border-[var(--border-default)] bg-[#17191d]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeStudyMedia.downloadUrl}
                          alt={
                            activeStudyCard.media?.altText ||
                            activeStudyCard.media?.name
                          }
                          className="block max-h-[48vh] max-w-full object-contain"
                        />
                        {(activeStudyCard.occlusions ?? []).map(
                          (mask, index) => (
                            <span
                              key={mask.id}
                              className={`absolute grid place-items-center border text-[11px] font-bold transition-[background-color,border-color,color] ${
                                studyRevealed
                                  ? "border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]"
                                  : "border-white/65 bg-[#252a32] text-white shadow-[0_2px_8px_rgba(0,0,0,0.24)]"
                              }`}
                              style={{
                                left: `${mask.x * 100}%`,
                                top: `${mask.y * 100}%`,
                                width: `${mask.width * 100}%`,
                                height: `${mask.height * 100}%`,
                              }}
                            >
                              {studyRevealed
                                ? mask.label || index + 1
                                : index + 1}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                    {!studyRevealed &&
                    deckSettings.showHints !== false &&
                    activeStudyCard.hint ? (
                      <small>{activeStudyCard.hint}</small>
                    ) : null}
                  </section>
                  {studyRevealed ? (
                    <section data-answer="true">
                      <span>Answer</span>
                      <strong>{activeStudyAnswer}</strong>
                      {activeStudyCard.variant !== "image_occlusion" &&
                      activeStudyCard.media?.placement === "back" &&
                      activeStudyMedia?.downloadUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={activeStudyMedia.downloadUrl}
                          alt={
                            activeStudyCard.media.altText ||
                            activeStudyCard.media.name
                          }
                          className="mx-auto mt-3 block max-h-[36vh] max-w-full rounded-[9px] border border-[var(--border-default)] object-contain"
                        />
                      ) : null}
                      {activeStudyCard.variant === "cloze" &&
                      activeStudyCard.back.trim() ? (
                        <small>{activeStudyCard.back}</small>
                      ) : null}
                      {activeStudyCard.explanation ? (
                        <small>{activeStudyCard.explanation}</small>
                      ) : null}
                      {studyTypedCorrect !== undefined ? (
                        <small
                          className={
                            studyTypedCorrect
                              ? "text-[var(--success)]"
                              : "text-[#d88922]"
                          }
                        >
                          {studyTypedCorrect
                            ? "Your typed answer matched."
                            : `Your answer: ${studyTypedAnswer}`}
                        </small>
                      ) : null}
                    </section>
                  ) : deckSettings.revealMode === "type" ? (
                    <div className="spectra-deck-reveal flex-col !items-stretch gap-2">
                      <label className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        Type your answer
                      </label>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={studyTypedAnswer}
                          onChange={(event) =>
                            setStudyTypedAnswer(event.target.value)
                          }
                          className="h-10 min-w-0 flex-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]"
                          placeholder="Recall before revealing"
                        />
                        <button type="button" onClick={revealStudyAnswer}>
                          Check answer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="spectra-deck-reveal"
                      onClick={revealStudyAnswer}
                    >
                      Reveal answer
                      <kbd>Space</kbd>
                    </button>
                  )}
                </main>
              ) : null}
              {!studyComplete && studyRevealed ? (
                <footer>
                  {(["again", "hard", "good", "easy"] as const).map(
                    (rating, index) => (
                      <button
                        key={rating}
                        type="button"
                        data-rating={rating}
                        disabled={studyReviewBusy}
                        onClick={() => void rateStudyCard(rating)}
                      >
                        {studyReviewBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <kbd>{index + 1}</kbd>
                        )}
                        <strong>
                          {rating[0]!.toUpperCase() + rating.slice(1)}
                        </strong>
                        <small>{studyIntervalLabels[rating]}</small>
                      </button>
                    ),
                  )}
                </footer>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      <section className="spectra-deck-print-sheet" aria-hidden="true">
        <header>
          <strong>Flashcard deck</strong>
          <span>
            {cards.length} cards · {sections.length} sections
          </span>
        </header>
        {sections.map((section) => (
          <div key={section} className="spectra-deck-print-section">
            <h2>{section}</h2>
            <ol>
              {cards
                .filter((card) => (card.section || "Section 1") === section)
                .map((card) => (
                  <li key={card.id}>
                    <div>
                      <small>Front</small>
                      <p>
                        {card.variant === "cloze"
                          ? clozePrompt(card.front)
                          : card.front || "Incomplete card"}
                      </p>
                      {deckMediaUrl(card) &&
                      (card.variant === "image_occlusion" ||
                        card.media?.placement !== "back") ? (
                        <div className="relative mt-2 w-fit max-w-full overflow-hidden border border-black/15">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={deckMediaUrl(card)!}
                            alt={card.media?.altText || card.media?.name}
                            className="block max-h-52 max-w-full object-contain"
                          />
                          {card.variant === "image_occlusion"
                            ? (card.occlusions ?? []).map((mask, index) => (
                                <span
                                  key={mask.id}
                                  className="absolute grid place-items-center border border-black bg-white text-[9px] font-bold text-black"
                                  style={{
                                    left: `${mask.x * 100}%`,
                                    top: `${mask.y * 100}%`,
                                    width: `${mask.width * 100}%`,
                                    height: `${mask.height * 100}%`,
                                  }}
                                >
                                  {index + 1}
                                </span>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <small>Back</small>
                      <p>
                        {card.variant === "cloze"
                          ? clozeAnswer(card.front)
                          : card.back || "Incomplete card"}
                      </p>
                      {card.variant === "cloze" && card.back ? (
                        <em>{card.back}</em>
                      ) : null}
                      {card.variant !== "image_occlusion" &&
                      card.media?.placement === "back" &&
                      deckMediaUrl(card) ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={deckMediaUrl(card)!}
                          alt={card.media.altText || card.media.name}
                          className="mt-2 block max-h-52 max-w-full object-contain"
                        />
                      ) : null}
                      {card.hint ? <em>Hint: {card.hint}</em> : null}
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}

function quizPracticeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("QUIZ_PRACTICE_ATTEMPT_LIMIT_REACHED"))
    return "You have reached this quiz’s configured practice-attempt limit.";
  if (message.includes("QUIZ_PRACTICE_NOT_PUBLISHED"))
    return "This practice version is no longer available. The author may be preparing an updated draft.";
  if (message.includes("QUIZ_ATTEMPT_NOT_EDITABLE"))
    return "This attempt is already submitted or no longer editable.";
  if (message.includes("QUIZ_QUESTION_UNAVAILABLE"))
    return "That question is unavailable in this version-pinned attempt.";
  if (message.includes("Artifact not found") || message.includes("ACCESS"))
    return "Your access changed while this practice was open. Your private responses were not exposed.";
  return message || fallback;
}

function QuizStudio({
  artifactId,
  mode,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly = false,
  synchronizationReady = true,
}: {
  artifactId: string;
  mode: "split" | "tab";
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly?: boolean;
  synchronizationReady?: boolean;
}) {
  const [questions, setQuestions] = useState(() => quizQuestions(content));
  const [activeQuestionId, setActiveQuestionId] = useState(
    questions[0]?.id ?? "",
  );
  const [view, setView] = useState<
    "builder" | "settings" | "preview" | "responses"
  >(readOnly ? "preview" : "builder");
  const [quizSettings, setQuizSettings] = useState<QuizSettings>(() =>
    quizSettingsFromContent(content),
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [practiceAttempt, setPracticeAttempt] =
    useState<SpectraQuizPracticeAttempt>();
  const [practiceAttempts, setPracticeAttempts] = useState<
    SpectraQuizPracticeAttempt[]
  >([]);
  const [practiceLoading, setPracticeLoading] = useState(true);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceSyncing, setPracticeSyncing] = useState<string[]>([]);
  const [practiceError, setPracticeError] = useState<string>();
  const [practiceFeedback, setPracticeFeedback] = useState<
    Record<string, NonNullable<SpectraQuizPracticeAttempt["results"]>[number]>
  >({});
  const [published, setPublished] = useState(
    record(content).published === true,
  );
  const [quizAssets, setQuizAssets] = useState<SpectraArtifactAsset[]>([]);
  const [quizMediaError, setQuizMediaError] = useState<string>();
  const [uploadingQuizMedia, setUploadingQuizMedia] = useState(false);
  const [publishIssues, setPublishIssues] = useState<
    Array<{ questionId?: string; message: string }>
  >([]);
  const [quizImporting, setQuizImporting] = useState(false);
  const [quizImportReport, setQuizImportReport] = useState<string>();
  const [quizImportError, setQuizImportError] = useState<string>();
  const [questionNavigatorOpen, setQuestionNavigatorOpen] = useState(
    mode === "tab",
  );
  const [questionDetailsOpen, setQuestionDetailsOpen] = useState(
    mode === "tab",
  );

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (
        event as CustomEvent<{ artifactId?: string; path?: string }>
      ).detail;
      if (detail?.artifactId !== artifactId || !detail.path) return;
      const match = detail.path.match(/^\/questions\/(\d+)(?:\/|$)/);
      if (match) {
        const question = questions[Number(match[1])];
        if (question) setActiveQuestionId(question.id);
        if (
          /\/(?:difficulty|points|timeLimitSeconds|bloomLevel|standards|section|poolId|poolDrawCount|media)(?:\/|$)/.test(
            detail.path,
          )
        )
          setQuestionDetailsOpen(true);
        setView("builder");
        return;
      }
      if (detail.path.startsWith("/settings")) setView("settings");
    };
    window.addEventListener("spectra:reveal-target", reveal);
    return () => window.removeEventListener("spectra:reveal-target", reveal);
  }, [artifactId, questions]);
  const quizImportRef = useRef<HTMLInputElement>(null);
  const quizWasReadOnly = useRef(readOnly);
  const [practiceClockNow, setPracticeClockNow] = useState(0);
  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) ??
    questions[0];
  const activeQuestionIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === activeQuestion?.id),
  );

  useEffect(() => {
    const nextQuestions = quizQuestions(content);
    setQuestions(nextQuestions);
    setActiveQuestionId((current) =>
      nextQuestions.some((question) => question.id === current)
        ? current
        : (nextQuestions[0]?.id ?? ""),
    );
    setQuizSettings(quizSettingsFromContent(content));
    setPublished(record(content).published === true);
  }, [content]);

  useEffect(() => {
    if (readOnly && (view === "builder" || view === "settings"))
      setView("preview");
    if (quizWasReadOnly.current && !readOnly && !practiceAttempt)
      setView("builder");
    quizWasReadOnly.current = readOnly;
  }, [practiceAttempt, readOnly, view]);

  useEffect(() => {
    const openPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ artifactId?: string }>).detail;
      if (!detail?.artifactId || detail.artifactId === artifactId)
        setView("preview");
    };
    window.addEventListener("spectra:preview-quiz", openPreview);
    return () =>
      window.removeEventListener("spectra:preview-quiz", openPreview);
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((result) => {
        if (active) setQuizAssets(result.assets);
      })
      .catch((error: unknown) => {
        if (active)
          setQuizMediaError(
            error instanceof Error
              ? error.message
              : "Quiz media is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  useEffect(() => {
    if (
      practiceAttempt?.status !== "in_progress" ||
      record(practiceAttempt.settings).timed !== true
    )
      return;
    setPracticeClockNow(Date.now());
    const timer = window.setInterval(
      () => setPracticeClockNow(Date.now()),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [practiceAttempt]);

  useEffect(() => {
    let active = true;
    setPracticeLoading(true);
    void getSpectraQuizPracticeAttempts(artifactId)
      .then((result) => {
        if (active) setPracticeAttempts(result.attempts);
      })
      .catch((error: unknown) => {
        if (active)
          setPracticeError(
            error instanceof Error
              ? error.message
              : "Your practice attempts are unavailable.",
          );
      })
      .finally(() => {
        if (active) setPracticeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const quizAssetMap = new Map(
    quizAssets.map((asset) => [asset.assetId, asset]),
  );

  function commit(next: QuizQuestion[], preservePublished = false) {
    const nextPublished = preservePublished ? published : false;
    setQuestions(next);
    if (!preservePublished) setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions: next,
      settings: quizSettings,
      published: nextPublished,
    });
  }

  function commitSettings(patch: Partial<QuizSettings>) {
    const next = { ...quizSettings, ...patch };
    setQuizSettings(next);
    setPublished(false);
    setPublishIssues([]);
    onChange({
      ...record(content),
      questions,
      settings: next,
      published: false,
    });
  }

  function updateQuestion(questionId: string, patch: Partial<QuizQuestion>) {
    commit(
      questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    );
  }

  function addQuestion() {
    const questionId = id("question");
    const question = {
      id: questionId,
      prompt: "",
      type: "multiple_choice" as const,
      options: ["", "", "", ""],
      optionIds: [0, 1, 2, 3].map(
        (optionIndex) => `${questionId}:option:${optionIndex + 1}`,
      ),
      correctAnswer: "",
      explanation: "",
      difficulty: "medium" as const,
      points: 1,
      timeLimitSeconds: 90,
      bloomLevel: "remember" as const,
      standards: [],
      tags: [],
    };
    commit([...questions, question]);
    setActiveQuestionId(question.id);
  }

  async function uploadQuestionMedia(file: File) {
    if (!activeQuestion) return;
    if (!file.type.startsWith("image/")) {
      setQuizMediaError("Choose an image for this question.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setQuizMediaError(
        "This image exceeds the 100 MB technical safety ceiling.",
      );
      return;
    }
    setUploadingQuizMedia(true);
    setQuizMediaError(undefined);
    try {
      const uploaded = await uploadArtifactAsset({
        artifactId,
        path: `quiz/${activeQuestion.id}/${Date.now().toString(36)}-${file.name}`,
        name: file.name,
        mediaType: file.type,
        sha256: await artifactBlobSha256(file),
        blob: file,
      });
      const previousAssetId = activeQuestion.media?.assetId;
      const nextQuestions = questions.map((question) =>
        question.id === activeQuestion.id
          ? {
              ...question,
              media: {
                assetId: uploaded.assetId,
                name: file.name,
                mediaType: file.type,
                altText: "",
              },
            }
          : question,
      );
      commit(nextQuestions);
      if (
        previousAssetId &&
        !nextQuestions.some(
          (question) => question.media?.assetId === previousAssetId,
        )
      ) {
        try {
          await revokeArtifactAsset(previousAssetId);
        } catch {
          setQuizMediaError(
            "The new image is active, but the replaced asset could not yet be released from storage.",
          );
        }
      }
      const refreshed = await getArtifactAssets(artifactId);
      setQuizAssets(refreshed.assets);
    } catch (error) {
      setQuizMediaError(
        error instanceof Error
          ? error.message
          : "The image could not be added.",
      );
    } finally {
      setUploadingQuizMedia(false);
    }
  }

  async function removeQuestionMedia(questionId: string) {
    const target = questions.find((question) => question.id === questionId);
    if (!target?.media) return;
    const assetId = target.media.assetId;
    const next = questions.map((question) =>
      question.id === questionId ? { ...question, media: undefined } : question,
    );
    commit(next);
    if (!next.some((question) => question.media?.assetId === assetId)) {
      try {
        await revokeArtifactAsset(assetId);
        setQuizAssets((current) =>
          current.filter((asset) => asset.assetId !== assetId),
        );
      } catch (error) {
        setQuizMediaError(
          error instanceof Error
            ? error.message
            : "The image was removed from the question but storage cleanup failed.",
        );
      }
    }
  }

  async function removeQuestion(questionId: string) {
    const target = questions.find((question) => question.id === questionId);
    const next = questions.filter((question) => question.id !== questionId);
    const replacement = next.length > 0 ? next : quizQuestions({});
    commit(replacement);
    setActiveQuestionId(replacement[0]?.id ?? "");
    const assetId = target?.media?.assetId;
    if (
      assetId &&
      !replacement.some((question) => question.media?.assetId === assetId)
    ) {
      try {
        await revokeArtifactAsset(assetId);
        setQuizAssets((current) =>
          current.filter((asset) => asset.assetId !== assetId),
        );
      } catch (error) {
        setQuizMediaError(
          error instanceof Error
            ? error.message
            : "The question was removed but media cleanup failed.",
        );
      }
    }
  }

  function answerArray(questionId: string) {
    try {
      const value = JSON.parse(answers[questionId] ?? "[]");
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  function answerValueArray(value: string) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  const displayedQuestions: QuizQuestion[] = practiceAttempt
    ? practiceAttempt.questions.map((question) => ({
        ...question,
        optionIds: question.options.map(
          (_, optionIndex) =>
            `${question.id}:attempt-option:${optionIndex + 1}`,
        ),
        difficulty:
          question.difficulty === "easy" ||
          question.difficulty === "medium" ||
          question.difficulty === "hard"
            ? question.difficulty
            : undefined,
        media:
          record(question.media).assetId &&
          typeof record(question.media).assetId === "string"
            ? {
                assetId: String(record(question.media).assetId),
                name: String(record(question.media).name ?? "Question media"),
                mediaType: String(
                  record(question.media).mediaType ??
                    "application/octet-stream",
                ),
                altText:
                  typeof record(question.media).altText === "string"
                    ? String(record(question.media).altText)
                    : undefined,
              }
            : undefined,
      }))
    : questions;
  const activeDisplayedQuestionIndex = Math.max(
    0,
    displayedQuestions.findIndex(
      (question) => question.id === activeQuestionId,
    ),
  );
  const practiceResultByQuestion = new Map(
    (practiceAttempt?.results ?? []).map((result) => [
      result.questionId,
      result,
    ]),
  );
  const revealedPracticeResultByQuestion = new Map([
    ...practiceResultByQuestion,
    ...Object.values(practiceFeedback).map(
      (result) => [result.questionId, result] as const,
    ),
  ]);
  const practiceTimeBudgetSeconds = practiceAttempt
    ? Math.max(
        1,
        Math.round(
          practiceAttempt.questions.reduce(
            (total, question) => total + (question.timeLimitSeconds ?? 90),
            0,
          ) *
            Math.max(
              1,
              Number(
                record(practiceAttempt.settings).defaultTimeMultiplier ?? 1,
              ) || 1,
            ),
        ),
      )
    : 0;
  const practiceSecondsRemaining = practiceAttempt
    ? Math.max(
        0,
        Math.ceil(
          (practiceAttempt.startedAt +
            practiceTimeBudgetSeconds * 1_000 -
            practiceClockNow) /
            1_000,
        ),
      )
    : 0;

  function hydratePracticeAttempt(attempt: SpectraQuizPracticeAttempt) {
    setPracticeAttempt(attempt);
    setAnswers(
      Object.fromEntries(
        Object.entries(attempt.responses).map(([questionId, response]) => [
          questionId,
          Array.isArray(response) ? JSON.stringify(response) : response,
        ]),
      ),
    );
    setSubmitted(attempt.status === "submitted");
    setPracticeFeedback(
      Object.fromEntries(
        (attempt.results ?? []).map((result) => [result.questionId, result]),
      ),
    );
    setPracticeError(undefined);
    setView("preview");
  }

  async function beginPractice() {
    if (!published) {
      setPracticeError(
        "Publish this formative quiz before starting a private attempt.",
      );
      setView("preview");
      return;
    }
    if (!synchronizationReady) {
      setPracticeError(
        "The published version is still synchronizing. Practice will be available as soon as the live state is durable.",
      );
      setView("preview");
      return;
    }
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      const attempt = await startSpectraQuizPractice({
        artifactId,
        clientAttemptId: crypto.randomUUID(),
      });
      hydratePracticeAttempt(attempt);
      setPracticeAttempts((current) => [
        attempt,
        ...current.filter((item) => item.attemptId !== attempt.attemptId),
      ]);
    } catch (error) {
      setPracticeError(
        quizPracticeErrorMessage(
          error,
          "The private practice attempt could not be started.",
        ),
      );
    } finally {
      setPracticeBusy(false);
    }
  }

  async function synchronizePracticeAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeSyncing((current) => [...new Set([...current, questionId])]);
    setPracticeError(undefined);
    try {
      const synchronized = await saveSpectraQuizPracticeResponse({
        attemptId: practiceAttempt.attemptId,
        questionId,
        response: value.startsWith("[") ? answerValueArray(value) : value,
        clientMutationId: crypto.randomUUID(),
      });
      if (synchronized.result)
        setPracticeFeedback((current) => ({
          ...current,
          [questionId]: synchronized.result!,
        }));
      setPracticeAttempt((current) =>
        current
          ? {
              ...current,
              responses: {
                ...current.responses,
                [questionId]: value.startsWith("[")
                  ? answerValueArray(value)
                  : value,
              },
            }
          : current,
      );
    } catch (error) {
      setPracticeError(
        `${quizPracticeErrorMessage(
          error,
          "Your latest answer is not synchronized.",
        )} Reconnect before submitting.`,
      );
    } finally {
      setPracticeSyncing((current) =>
        current.filter((id) => id !== questionId),
      );
    }
  }

  async function submitPracticeAttempt() {
    if (!practiceAttempt || practiceAttempt.status !== "in_progress") return;
    setPracticeBusy(true);
    setPracticeError(undefined);
    try {
      for (const [questionId, value] of Object.entries(answers)) {
        await saveSpectraQuizPracticeResponse({
          attemptId: practiceAttempt.attemptId,
          questionId,
          response: value.startsWith("[") ? answerValueArray(value) : value,
          clientMutationId: crypto.randomUUID(),
        });
      }
      const submittedAttempt = await submitSpectraQuizPractice({
        attemptId: practiceAttempt.attemptId,
        clientSubmissionId: crypto.randomUUID(),
      });
      hydratePracticeAttempt(submittedAttempt);
      setPracticeAttempts((current) => [
        submittedAttempt,
        ...current.filter(
          (item) => item.attemptId !== submittedAttempt.attemptId,
        ),
      ]);
    } catch (error) {
      setPracticeError(
        quizPracticeErrorMessage(
          error,
          "The attempt could not be safely submitted.",
        ),
      );
    } finally {
      setPracticeBusy(false);
    }
  }

  function questionCorrect(question: QuizQuestion) {
    if (practiceAttempt?.status === "submitted")
      return (
        revealedPracticeResultByQuestion.get(question.id)?.correct === true
      );
    if (question.type === "select_all") {
      const actual = [...answerArray(question.id)].sort();
      const expected = [...(question.correctAnswers ?? [])].sort();
      return (
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
      );
    }
    if (question.type === "ordering") {
      const actual = answerArray(question.id);
      const expected = question.correctAnswers?.length
        ? question.correctAnswers
        : question.options;
      return (
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
      );
    }
    if (question.type === "matching") {
      const actual = [...answerArray(question.id)].sort();
      const expected = (question.matchingPairs ?? [])
        .map(
          (pair) =>
            `${pair.id}:${(pair.right ?? "").trim().toLocaleLowerCase()}`,
        )
        .sort();
      return (
        actual.length === expected.length &&
        actual.every(
          (value, index) =>
            value.trim().toLocaleLowerCase() === expected[index],
        )
      );
    }
    if (question.type === "numeric") {
      const actual = Number(answers[question.id]);
      const expected = Number(question.correctAnswer);
      return (
        Number.isFinite(actual) &&
        Number.isFinite(expected) &&
        Math.abs(actual - expected) <= (question.numericTolerance ?? 0)
      );
    }
    if (question.type === "fill_blank") {
      const actual = (answers[question.id] ?? "").trim().toLocaleLowerCase();
      return [question.correctAnswer, ...(question.correctAnswers ?? [])]
        .filter(Boolean)
        .some((answer) => answer!.trim().toLocaleLowerCase() === actual);
    }
    if (question.type === "long_response") return false;
    return (
      (answers[question.id] ?? "").trim().toLocaleLowerCase() ===
      (question.correctAnswer ?? "").trim().toLocaleLowerCase()
    );
  }

  function publishQuiz() {
    const issues = validateQuizForPublishing(
      questions as PortableQuizQuestion[],
    );
    if (issues.length) {
      setPublishIssues(issues);
      setView("builder");
      const firstQuestionId = issues.find(
        (issue) => issue.questionId,
      )?.questionId;
      if (
        firstQuestionId &&
        questions.some((question) => question.id === firstQuestionId)
      )
        setActiveQuestionId(firstQuestionId);
      return;
    }
    setPublishIssues([]);
    setPublished(true);
    onChange({
      ...record(content),
      questions,
      settings: quizSettings,
      published: true,
      publishedAt: Date.now(),
    });
  }

  async function importQuiz(file: File) {
    setQuizImporting(true);
    setQuizImportError(undefined);
    setQuizImportReport(undefined);
    let jobId: string | undefined;
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "unknown";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "quiz",
        format: extension,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      jobId = beginning.jobId;
      await uploadArtifactImportOriginal(jobId, file);
      const result = await parseQuizImport(file);
      const imported = result.content.questions.map(
        (question): QuizQuestion => ({
          ...question,
          options: question.options ?? [],
          optionIds: (question.options ?? []).map(
            (_, optionIndex) =>
              `${question.id}:option:${optionIndex + 1}-${crypto.randomUUID()}`,
          ),
          difficulty: question.difficulty ?? "medium",
          points: question.points ?? 1,
          timeLimitSeconds: question.timeLimitSeconds ?? 90,
        }),
      );
      const onlyBlankStarter =
        questions.length === 1 &&
        !questions[0]?.prompt.trim() &&
        questions[0]?.options.every((option) => !option.trim());
      const next = onlyBlankStarter ? imported : [...questions, ...imported];
      commit(next);
      setActiveQuestionId(imported[0]?.id ?? next[0]?.id ?? "");
      await completeArtifactImport({
        jobId,
        typeKey: "quiz",
        status: "imported",
        fidelityReport: result.fidelity,
        unsupportedFeatures: result.unsupportedFeatures,
        importedContent: {
          questions: imported,
          settings: result.content.settings,
        },
      });
      setQuizImportReport(
        `${imported.length} question${imported.length === 1 ? "" : "s"} imported as editable formative content from ${file.name}. The original is retained for recovery.${
          result.unsupportedFeatures.length
            ? ` Fidelity notes: ${result.unsupportedFeatures.slice(0, 4).join("; ")}${result.unsupportedFeatures.length > 4 ? `; and ${result.unsupportedFeatures.length - 4} more in import history.` : "."}`
            : ""
        }`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The quiz import was quarantined.";
      setQuizImportError(message);
      if (jobId) {
        await completeArtifactImport({
          jobId,
          typeKey: "quiz",
          status: "quarantined",
          fidelityReport: [
            { scope: "quiz import", level: "unsupported", message },
          ],
          unsupportedFeatures: [message],
          quarantineReason: message,
        }).catch(() =>
          abortArtifactImportUpload(jobId!, message).catch(() => undefined),
        );
      }
    } finally {
      setQuizImporting(false);
      if (quizImportRef.current) quizImportRef.current.value = "";
    }
  }

  return (
    <div className="spectra-quiz-studio bg-transparent">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-1.5 border-b border-[var(--border-default)] bg-transparent px-2 py-1">
        <div
          className="order-2 flex min-w-0 items-center rounded-[7px] bg-[var(--bg-secondary)] p-0.5 [&>button]:h-6 [&>button]:px-2 [&>button]:text-[10px]"
          role="tablist"
          aria-label="Quiz views"
        >
          {!readOnly ? (
            <button
              type="button"
              role="tab"
              aria-selected={view === "builder" || view === "settings"}
              className={tabButtonClass(
                view === "builder" || view === "settings",
              )}
              onClick={() => setView("builder")}
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={view === "preview"}
            className={tabButtonClass(view === "preview")}
            onClick={() => setView("preview")}
          >
            View
          </button>
        </div>
        <div className="order-1 ml-auto flex shrink-0 items-center gap-1.5">
          {!readOnly ? (
            <>
              <input
                ref={quizImportRef}
                type="file"
                hidden
                accept=".json,.csv,.tsv,.xml,.zip,.qti,application/json,text/csv,text/tab-separated-values,application/xml,text/xml,application/zip"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void importQuiz(file);
                }}
              />
              <details className="order-3 group relative">
                <summary
                  className={`${iconButtonClass()} list-none [&::-webkit-details-marker]:hidden`}
                  aria-label="More quiz options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </summary>
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 grid min-w-44 gap-1 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-xl">
                  <button
                    type="button"
                    className={smallActionClass()}
                    onClick={() => setView("settings")}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Quiz settings
                  </button>
                  <button
                    type="button"
                    className={smallActionClass()}
                    onClick={() => setView("responses")}
                  >
                    <History className="h-3.5 w-3.5" />
                    Practice history
                  </button>
                  <button
                    type="button"
                    className={smallActionClass()}
                    disabled={quizImporting}
                    onClick={() => quizImportRef.current?.click()}
                  >
                    {quizImporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Import className="h-3.5 w-3.5" />
                    )}
                    Import questions
                  </button>
                </div>
              </details>
            </>
          ) : null}
          {!readOnly ? (
            <>
              <button
                type="button"
                className={`order-2 h-7 rounded-[6px] px-2.5 text-[10.5px] font-semibold ${published ? "border border-[var(--success)] text-[var(--success)]" : "bg-[var(--text-primary)] text-[var(--bg-primary)]"}`}
                disabled={practiceBusy || (published && !synchronizationReady)}
                onClick={() => {
                  if (published) {
                    void beginPractice();
                    return;
                  }
                  publishQuiz();
                }}
              >
                {practiceBusy
                  ? "Opening…"
                  : published
                    ? "Open practice"
                    : "Publish"}
              </button>
            </>
          ) : published ? (
            <button
              type="button"
              className="h-8 rounded-[7px] bg-[#7560e8] px-3 text-[12px] font-semibold text-white"
              disabled={practiceBusy || !synchronizationReady}
              onClick={() => void beginPractice()}
            >
              {practiceBusy ? "Opening..." : "Start practice"}
            </button>
          ) : null}
        </div>
      </div>
      {quizImportReport || quizImportError || publishIssues.length ? (
        <div
          className={`border-b px-4 py-3 ${quizImportError || publishIssues.length ? "border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_4%,var(--bg-primary))]" : "border-[color-mix(in_oklab,var(--success)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_4%,var(--bg-primary))]"}`}
          role="status"
        >
          <div className="flex items-start gap-2">
            {quizImportError || publishIssues.length ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
            )}
            <div className="min-w-0 flex-1 text-[11px] leading-5 text-[var(--text-secondary)]">
              <strong className="block text-[var(--text-primary)]">
                {publishIssues.length
                  ? "Resolve these before publishing"
                  : quizImportError
                    ? "Import quarantined"
                    : "Interchange complete"}
              </strong>
              {publishIssues.length ? (
                <ul className="mt-1 list-disc pl-4">
                  {publishIssues.slice(0, 8).map((issue, index) => (
                    <li key={`${issue.questionId ?? "quiz"}-${index}`}>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          if (issue.questionId)
                            setActiveQuestionId(issue.questionId);
                          setView("builder");
                        }}
                      >
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                quizImportError || quizImportReport
              )}
            </div>
            <button
              type="button"
              className={iconButtonClass()}
              onClick={() => {
                setPublishIssues([]);
                setQuizImportError(undefined);
                setQuizImportReport(undefined);
              }}
              aria-label="Dismiss quiz notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      {view === "preview" ? (
        <div className="p-5">
          <div className="mx-auto max-w-[760px] space-y-3">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                  {practiceAttempt ? "Private practice" : "Quiz preview"}
                </h3>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  {practiceAttempt
                    ? practiceAttempt.status === "submitted"
                      ? "Your version-pinned formative result is private to you."
                      : "Answers synchronize as you work. Reconnect before submitting if synchronization is interrupted."
                    : "Author preview stays local and does not create a practice response."}
                </p>
              </div>
              {submitted ? (
                <div className="rounded-[8px] bg-[color-mix(in_oklab,var(--success)_9%,var(--bg-primary))] px-3 py-2 text-[12px] font-semibold text-[var(--success)]">
                  {practiceAttempt?.status === "submitted"
                    ? `${practiceAttempt.score ?? 0}/${practiceAttempt.maxScore ?? 0} points · ${practiceAttempt.percentage ?? 0}%`
                    : `${displayedQuestions.filter((question) => questionCorrect(question)).length}/${displayedQuestions.length} correct`}
                </div>
              ) : practiceAttempt &&
                record(practiceAttempt.settings).timed === true ? (
                <div
                  className={`rounded-[8px] border px-3 py-2 text-right ${
                    practiceSecondsRemaining
                      ? "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                      : "border-[color-mix(in_oklab,var(--warning)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_6%,var(--bg-primary))] text-[var(--warning)]"
                  }`}
                >
                  <strong className="block font-display text-[16px]">
                    {practiceSecondsRemaining
                      ? `${Math.floor(practiceSecondsRemaining / 60)}:${String(practiceSecondsRemaining % 60).padStart(2, "0")}`
                      : "Time reached"}
                  </strong>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    Formative guidance
                  </span>
                </div>
              ) : null}
            </div>
            {practiceAttempt?.instructions || quizSettings.instructions ? (
              <div className="rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                <strong className="mr-1 text-[var(--text-primary)]">
                  Before you begin:
                </strong>
                {practiceAttempt?.instructions || quizSettings.instructions}
              </div>
            ) : null}
            {practiceError ? (
              <div className="flex items-start gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-primary))] p-3 text-[11px] leading-5 text-[var(--danger)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{practiceError}</span>
              </div>
            ) : null}
            {!practiceAttempt && published ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_5%,var(--bg-primary))] p-4">
                <div>
                  <strong className="block text-[12px] text-[var(--text-primary)]">
                    Ready for a real practice run?
                  </strong>
                  <span className="mt-1 block text-[10px] text-[var(--text-secondary)]">
                    Creates a private attempt pinned to this quiz version.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={practiceBusy}
                  onClick={() => void beginPractice()}
                  className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-semibold text-[var(--bg-primary)]"
                >
                  {practiceBusy ? "Starting…" : "Start private practice"}
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-2">
              <button
                type="button"
                className={iconButtonClass()}
                aria-label="Previous preview question"
                disabled={activeDisplayedQuestionIndex === 0}
                onClick={() =>
                  setActiveQuestionId(
                    displayedQuestions[
                      Math.max(0, activeDisplayedQuestionIndex - 1)
                    ]?.id ?? "",
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <label className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
                  Question
                </span>
                <select
                  aria-label="Current preview question"
                  className="h-8 min-w-0 truncate bg-transparent text-[11px] font-medium text-[var(--text-primary)] outline-none"
                  value={
                    displayedQuestions[activeDisplayedQuestionIndex]?.id ?? ""
                  }
                  onChange={(event) => setActiveQuestionId(event.target.value)}
                >
                  {displayedQuestions.map((question, index) => (
                    <option key={question.id} value={question.id}>
                      {index + 1} ·{" "}
                      {plannerDescriptionText(question.prompt) ||
                        "Untitled question"}
                    </option>
                  ))}
                </select>
              </label>
              <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                {activeDisplayedQuestionIndex + 1} of{" "}
                {displayedQuestions.length}
              </span>
              <button
                type="button"
                className={iconButtonClass()}
                aria-label="Next preview question"
                disabled={
                  activeDisplayedQuestionIndex === displayedQuestions.length - 1
                }
                onClick={() =>
                  setActiveQuestionId(
                    displayedQuestions[
                      Math.min(
                        displayedQuestions.length - 1,
                        activeDisplayedQuestionIndex + 1,
                      )
                    ]?.id ?? "",
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {displayedQuestions
              .filter((_, index) => index === activeDisplayedQuestionIndex)
              .map((question) => (
                <div
                  key={question.id}
                  className={`rounded-[8px] border bg-[var(--bg-primary)] p-4 ${submitted || revealedPracticeResultByQuestion.has(question.id) ? ((practiceAttempt ? revealedPracticeResultByQuestion.get(question.id)?.correct === null : question.type === "long_response") ? "border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))]" : questionCorrect(question) ? "border-[color-mix(in_oklab,var(--success)_48%,var(--border-default))]" : "border-[color-mix(in_oklab,var(--danger)_38%,var(--border-default))]") : "border-[var(--border-default)]"}`}
                >
                  <div className="text-[12px] font-semibold text-[var(--text-secondary)]">
                    Question {activeDisplayedQuestionIndex + 1}
                  </div>
                  <div className="mt-2 text-[15px] font-medium text-[var(--text-primary)]">
                    {plannerDescriptionText(question.prompt) ||
                      "Untitled question"}
                  </div>
                  {question.media ? (
                    quizAssetMap.get(question.media.assetId)?.downloadUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          quizAssetMap.get(question.media.assetId)!.downloadUrl!
                        }
                        alt={question.media.altText ?? ""}
                        className="mt-3 max-h-[320px] w-full rounded-[8px] border border-[var(--border-default)] object-contain"
                      />
                    ) : (
                      <div className="mt-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-[10px] text-[var(--text-tertiary)]">
                        Question image unavailable
                      </div>
                    )
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {question.type === "multiple_choice" ||
                    question.type === "true_false" ? (
                      question.options.map((option, optionIndex) => (
                        <button
                          type="button"
                          disabled={submitted}
                          onClick={() =>
                            void synchronizePracticeAnswer(question.id, option)
                          }
                          key={`${question.id}-${optionIndex}`}
                          className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] transition ${answers[question.id] === option ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))] text-[var(--text-primary)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                        >
                          <Radio className="h-3.5 w-3.5" />
                          {option || `Option ${optionIndex + 1}`}
                        </button>
                      ))
                    ) : question.type === "select_all" ? (
                      question.options.map((option, optionIndex) => {
                        const selected = answerArray(question.id).includes(
                          option,
                        );
                        return (
                          <button
                            type="button"
                            disabled={submitted}
                            onClick={() => {
                              const current = answerArray(question.id);
                              void synchronizePracticeAnswer(
                                question.id,
                                JSON.stringify(
                                  selected
                                    ? current.filter(
                                        (value) => value !== option,
                                      )
                                    : [...current, option],
                                ),
                              );
                            }}
                            key={`${question.id}-${optionIndex}`}
                            className={`flex w-full items-center gap-2 rounded-[7px] border px-3 py-2 text-left text-[13px] ${selected ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_7%,var(--bg-elevated))]" : "border-[var(--border-default)]"}`}
                          >
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${selected ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)] text-white" : "border-[var(--border-default)]"}`}
                            >
                              {selected ? <Check className="h-3 w-3" /> : null}
                            </span>
                            {option || `Option ${optionIndex + 1}`}
                          </button>
                        );
                      })
                    ) : question.type === "ordering" ? (
                      <div className="space-y-2">
                        {(answerArray(question.id).length
                          ? answerArray(question.id)
                          : question.options
                        ).map((option, optionIndex, order) => (
                          <div
                            key={`${question.id}-${option}-${optionIndex}`}
                            className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-[var(--border-default)] px-3 py-2 text-[13px]"
                          >
                            <strong>{optionIndex + 1}</strong>
                            <span>{option || `Option ${optionIndex + 1}`}</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={submitted || optionIndex === 0}
                                onClick={() => {
                                  const next = [...order];
                                  [next[optionIndex - 1], next[optionIndex]] = [
                                    next[optionIndex]!,
                                    next[optionIndex - 1]!,
                                  ];
                                  void synchronizePracticeAnswer(
                                    question.id,
                                    JSON.stringify(next),
                                  );
                                }}
                                aria-label={`Move ${option} earlier`}
                              >
                                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                              </button>
                              <button
                                type="button"
                                disabled={
                                  submitted || optionIndex === order.length - 1
                                }
                                onClick={() => {
                                  const next = [...order];
                                  [next[optionIndex], next[optionIndex + 1]] = [
                                    next[optionIndex + 1]!,
                                    next[optionIndex]!,
                                  ];
                                  void synchronizePracticeAnswer(
                                    question.id,
                                    JSON.stringify(next),
                                  );
                                }}
                                aria-label={`Move ${option} later`}
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : question.type === "matching" ? (
                      <div className="space-y-2">
                        {(question.matchingPairs ?? []).map((pair) => {
                          const current = answerArray(question.id);
                          const selected = current
                            .find((value) => value.startsWith(`${pair.id}:`))
                            ?.slice(pair.id.length + 1);
                          const choices =
                            question.matchingChoices ??
                            (question.matchingPairs ?? []).map(
                              (candidate) => candidate.right ?? "",
                            );
                          return (
                            <label
                              key={pair.id}
                              className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2 rounded-[7px] border border-[var(--border-default)] px-3 py-2"
                            >
                              <span className="text-[12px] font-medium text-[var(--text-primary)]">
                                {pair.left || "Untitled prompt"}
                              </span>
                              <span className="text-center text-[var(--text-tertiary)]">
                                →
                              </span>
                              <select
                                disabled={submitted}
                                value={selected ?? ""}
                                onChange={(event) => {
                                  const next = current.filter(
                                    (value) => !value.startsWith(`${pair.id}:`),
                                  );
                                  if (event.target.value)
                                    next.push(
                                      `${pair.id}:${event.target.value}`,
                                    );
                                  void synchronizePracticeAnswer(
                                    question.id,
                                    JSON.stringify(next),
                                  );
                                }}
                                className={inputClass()}
                              >
                                <option value="">Choose a match</option>
                                {choices.map((choice, choiceIndex) => (
                                  <option
                                    key={`${pair.id}-${choice}-${choiceIndex}`}
                                    value={choice}
                                  >
                                    {choice}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    ) : question.type === "long_response" ? (
                      <textarea
                        disabled={submitted}
                        value={answers[question.id] ?? ""}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) =>
                          void synchronizePracticeAnswer(
                            question.id,
                            event.currentTarget.value,
                          )
                        }
                        className={textareaClass("min-h-[150px]")}
                        placeholder="Develop your response"
                      />
                    ) : (
                      <input
                        type={question.type === "numeric" ? "number" : "text"}
                        disabled={submitted}
                        value={answers[question.id] ?? ""}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) =>
                          void synchronizePracticeAnswer(
                            question.id,
                            event.currentTarget.value,
                          )
                        }
                        className={inputClass()}
                        placeholder="Type your answer"
                      />
                    )}
                  </div>
                  {revealedPracticeResultByQuestion.has(question.id) ||
                  (submitted && !readOnly && !practiceAttempt) ? (
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                      <div>
                        <strong className="text-[var(--text-primary)]">
                          Answer:
                        </strong>{" "}
                        {practiceAttempt
                          ? Array.isArray(
                              revealedPracticeResultByQuestion.get(question.id)
                                ?.expected,
                            )
                            ? (
                                revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.expected as string[]
                              ).join(" · ")
                            : String(
                                revealedPracticeResultByQuestion.get(
                                  question.id,
                                )?.expected ?? "Not available",
                              )
                          : question.type === "matching"
                            ? (question.matchingPairs ?? [])
                                .map(
                                  (pair) =>
                                    `${pair.left} → ${pair.right ?? ""}`,
                                )
                                .join(" · ")
                            : question.type === "long_response"
                              ? "Advisory review — no single auto-scored answer"
                              : question.type === "select_all" ||
                                  question.type === "ordering"
                                ? (
                                    question.correctAnswers ?? question.options
                                  ).join(" · ")
                                : question.correctAnswer}
                      </div>
                      {(
                        practiceAttempt
                          ? revealedPracticeResultByQuestion.get(question.id)
                              ?.explanation
                          : question.explanation
                      ) ? (
                        <div className="mt-1">
                          {practiceAttempt
                            ? revealedPracticeResultByQuestion.get(question.id)
                                ?.explanation
                            : question.explanation}
                        </div>
                      ) : null}
                      {practiceAttempt &&
                      revealedPracticeResultByQuestion.get(question.id)
                        ?.advisoryFeedback ? (
                        <div className="mt-1 rounded-[6px] bg-[var(--bg-secondary)] px-2 py-1.5 text-[var(--text-secondary)]">
                          {
                            revealedPracticeResultByQuestion.get(question.id)
                              ?.advisoryFeedback
                          }
                        </div>
                      ) : null}
                      {question.sourceRefs?.length ? (
                        <div className="mt-1 text-[var(--text-tertiary)]">
                          Sources: {question.sourceRefs.join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            <div className="flex justify-end gap-2 pt-3">
              {practiceSyncing.length ? (
                <span className="mr-auto inline-flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Synchronizing {practiceSyncing.length} answer
                  {practiceSyncing.length === 1 ? "" : "s"}
                </span>
              ) : practiceAttempt?.status === "in_progress" ? (
                <span className="mr-auto inline-flex items-center gap-2 text-[10px] text-[var(--success)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Current answers synchronized
                </span>
              ) : null}
              {submitted ? (
                <button
                  type="button"
                  className={smallActionClass()}
                  onClick={() => {
                    setPracticeAttempt(undefined);
                    setSubmitted(false);
                    setAnswers({});
                    setPracticeFeedback({});
                  }}
                >
                  {practiceAttempt ? "Return to preview" : "Try again"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={practiceBusy || practiceSyncing.length > 0}
                  className="h-9 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-medium text-[var(--bg-primary)]"
                  onClick={() =>
                    practiceAttempt
                      ? void submitPracticeAttempt()
                      : setSubmitted(true)
                  }
                >
                  {practiceBusy ? "Submitting safely…" : "Submit answers"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : view === "settings" ? (
        <div className="mx-auto grid max-w-[900px] gap-4 p-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Learner instructions">
              <textarea
                value={quizSettings.instructions}
                onChange={(event) =>
                  commitSettings({ instructions: event.target.value })
                }
                className={textareaClass("min-h-[104px]")}
                placeholder="Explain the goal, useful materials, and what learners should do after reviewing feedback."
              />
            </Field>
          </div>
          <Field label="Feedback release">
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <select
                value={quizSettings.feedbackRelease}
                onChange={(event) => {
                  const feedbackRelease = event.target.value as
                    "after_submission" | "on_each_response";
                  commitSettings({
                    feedbackRelease,
                    showAnswersImmediately:
                      feedbackRelease === "on_each_response",
                  });
                }}
                className={inputClass()}
              >
                <option value="after_submission">After submission</option>
                <option value="on_each_response">After each response</option>
              </select>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
                Answer keys and explanations remain hidden until the selected
                formative feedback moment.
              </p>
            </div>
          </Field>
          <button
            type="button"
            onClick={() => commitSettings({ timed: !quizSettings.timed })}
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Timed guidance
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Show an adjusted practice countdown without punitive
                auto-submit.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.timed ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <button
            type="button"
            onClick={() =>
              commitSettings({
                shuffleQuestions: !quizSettings.shuffleQuestions,
              })
            }
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Shuffle questions
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Present a different order on each attempt.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.shuffleQuestions ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <button
            type="button"
            onClick={() =>
              commitSettings({
                shuffleOptions: !quizSettings.shuffleOptions,
              })
            }
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Shuffle answer options
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Preserve ordering questions while varying choice positions.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.shuffleOptions ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <button
            type="button"
            onClick={() =>
              commitSettings({ allowResume: !quizSettings.allowResume })
            }
            className="flex items-center justify-between rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left"
          >
            <span>
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                Resume interrupted practice
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                Keep synchronized in-progress attempts available after
                navigation or reconnect.
              </span>
            </span>
            <CheckCircle2
              className={`h-5 w-5 ${quizSettings.allowResume ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}
            />
          </button>
          <Field label="Attempt policy">
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <label className="text-[10px] font-semibold text-[var(--text-secondary)]">
                Maximum private attempts
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={quizSettings.maxAttempts ?? ""}
                  onChange={(event) =>
                    commitSettings({
                      maxAttempts: event.target.value
                        ? Math.max(
                            1,
                            Math.min(100, Number(event.target.value) || 1),
                          )
                        : undefined,
                    })
                  }
                  className={`${inputClass()} mt-2`}
                  placeholder="No limit"
                />
              </label>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
                Leave blank for unlimited formative practice. Limits are never
                treated as grades or punitive assessment.
              </p>
            </div>
          </Field>
          <Field label="Timing accommodation">
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <select
                value={quizSettings.defaultTimeMultiplier}
                onChange={(event) =>
                  commitSettings({
                    defaultTimeMultiplier: Number(event.target.value),
                  })
                }
                className={inputClass()}
              >
                <option value={1}>Standard guidance</option>
                <option value={1.25}>25% extra time</option>
                <option value={1.5}>50% extra time</option>
                <option value={2}>Double time</option>
              </select>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
                Timing remains guidance for practice. Learner reduced-motion and
                text-size preferences are always respected independently.
              </p>
            </div>
          </Field>
          <Field label="Personal practice target">
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <input
                type="range"
                min={0}
                max={100}
                value={quizSettings.targetScore}
                onChange={(event) =>
                  commitSettings({ targetScore: Number(event.target.value) })
                }
                className="w-full accent-[var(--accent-cyan)]"
              />
              <div className="mt-2 text-right font-display text-[20px] font-semibold text-[var(--text-primary)]">
                {quizSettings.targetScore}%
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-tertiary)]">
                Guidance for formative practice only. It is not a grade or
                pass/fail threshold.
              </p>
            </div>
          </Field>
        </div>
      ) : view === "responses" ? (
        <div className="mx-auto max-w-[760px] p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-[24px] font-semibold text-[var(--text-primary)]">
                Your practice history
              </h3>
              <p className="mt-1 max-w-[520px] text-[11px] leading-5 text-[var(--text-secondary)]">
                Only your own private formative attempts appear here. Authors
                and collaborators do not receive peer answers or private
                response content through this view.
              </p>
            </div>
            <button
              type="button"
              disabled={!published || practiceBusy}
              onClick={() => void beginPractice()}
              className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
            >
              New private attempt
            </button>
          </div>
          {practiceError ? (
            <div className="mb-3 flex items-start gap-2 rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] p-3 text-[11px] text-[var(--danger)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {practiceError}
            </div>
          ) : null}
          {practiceLoading ? (
            <div className="flex min-h-[180px] items-center justify-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your attempts
            </div>
          ) : practiceAttempts.length ? (
            <div className="space-y-2">
              {practiceAttempts.map((attempt, index) => (
                <button
                  key={attempt.attemptId}
                  type="button"
                  onClick={() => hydratePracticeAttempt(attempt)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-left transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] hover:bg-[var(--bg-hover)]"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <strong className="text-[12px] text-[var(--text-primary)]">
                        Practice {practiceAttempts.length - index}
                      </strong>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${attempt.status === "submitted" ? "bg-[color-mix(in_oklab,var(--success)_10%,var(--bg-primary))] text-[var(--success)]" : "bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-primary))] text-[var(--warning)]"}`}
                      >
                        {attempt.status === "submitted"
                          ? "Reviewed"
                          : "In progress"}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--text-tertiary)]">
                      Started {formatShortDate(attempt.startedAt)} · pinned
                      content {attempt.contentHash}
                    </span>
                  </span>
                  <span className="text-right">
                    <strong className="block font-display text-[18px] text-[var(--text-primary)]">
                      {attempt.status === "submitted"
                        ? `${attempt.percentage ?? 0}%`
                        : `${Object.keys(attempt.responses).length}/${attempt.questions.length}`}
                    </strong>
                    <span className="text-[9px] text-[var(--text-tertiary)]">
                      {attempt.status === "submitted"
                        ? `${Math.max(1, Math.round((attempt.elapsedMs ?? 0) / 60_000))} min · Review`
                        : "Resume safely"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div data-spectra-card="result" className="p-6 text-center">
              <CheckCircle2 className="mx-auto h-7 w-7 text-[var(--success)]" />
              <h3 className="mt-3 font-display text-[22px] font-semibold text-[var(--text-primary)]">
                No private attempts yet
              </h3>
              <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-[var(--text-secondary)]">
                Preview lets authors inspect the experience. A private practice
                run creates your own version-pinned learning record.
              </p>
              <button
                type="button"
                onClick={() => setView("preview")}
                className="mt-4 rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-medium text-[var(--bg-primary)]"
              >
                Open preview
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className={`grid ${mode === "tab" ? `pr-[10px] ${questionNavigatorOpen ? "lg:grid-cols-[292px_minmax(0,1fr)_210px]" : "lg:grid-cols-[62px_minmax(0,1fr)_210px]"}` : "grid-cols-1"}`}
        >
          <aside
            data-quiz-panel="questions"
            className={`${mode === "tab" ? "border-r p-3" : "border-b px-4 py-2.5"} border-[var(--border-default)]`}
          >
            <div className="flex items-center justify-between gap-2">
              {mode !== "tab" && !questionNavigatorOpen ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <button
                    type="button"
                    className={iconButtonClass()}
                    aria-label="Previous question"
                    disabled={activeQuestionIndex === 0}
                    onClick={() =>
                      setActiveQuestionId(
                        questions[Math.max(0, activeQuestionIndex - 1)]?.id ??
                          "",
                      )
                    }
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <label className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
                      Question
                    </span>
                    <select
                      aria-label="Current question"
                      className="h-8 min-w-0 truncate bg-transparent text-[11px] font-medium text-[var(--text-primary)] outline-none"
                      value={activeQuestion?.id ?? ""}
                      onChange={(event) =>
                        setActiveQuestionId(event.target.value)
                      }
                    >
                      {questions.map((question, index) => (
                        <option key={question.id} value={question.id}>
                          {index + 1} ·{" "}
                          {plannerDescriptionText(question.prompt) ||
                            "Untitled question"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                    {activeQuestionIndex + 1} of {questions.length}
                  </span>
                  <button
                    type="button"
                    className={iconButtonClass()}
                    aria-label="Next question"
                    disabled={activeQuestionIndex === questions.length - 1}
                    onClick={() =>
                      setActiveQuestionId(
                        questions[
                          Math.min(
                            questions.length - 1,
                            activeQuestionIndex + 1,
                          )
                        ]?.id ?? "",
                      )
                    }
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass()}
                    onClick={() => setQuestionNavigatorOpen(true)}
                    aria-label="Browse all questions"
                  >
                    <PanelLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`flex min-w-0 items-center gap-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] ${mode === "tab" && !questionNavigatorOpen ? "w-full justify-center" : ""}`}
                  onClick={() => setQuestionNavigatorOpen((open) => !open)}
                  aria-expanded={questionNavigatorOpen}
                  aria-label={
                    questionNavigatorOpen
                      ? "Collapse question navigator"
                      : "Browse questions"
                  }
                >
                  <PanelLeft className="h-3.5 w-3.5 shrink-0" />
                  {mode === "tab" && !questionNavigatorOpen ? null : (
                    <span className="truncate">
                      Question {activeQuestionIndex + 1} of {questions.length}
                    </span>
                  )}
                </button>
              )}
              {!readOnly && questionNavigatorOpen ? (
                <button
                  type="button"
                  className={smallActionClass()}
                  onClick={addQuestion}
                >
                  <Plus className="h-3.5 w-3.5" /> Add question
                </button>
              ) : null}
            </div>
            {questionNavigatorOpen ? (
              <div className="mt-2 max-h-[min(46vh,440px)] space-y-1.5 overflow-y-auto pr-0.5">
                {questions.map((question, index) => (
                  <button
                    key={question.id}
                    type="button"
                    className={`grid min-h-11 w-full grid-cols-[28px_auto_minmax(0,1fr)_16px] items-center gap-2 rounded-[8px] border px-2 py-1.5 text-left ${
                      activeQuestion?.id === question.id
                        ? "border-[#8b6ff0] bg-[color-mix(in_oklab,#8b6ff0_6%,var(--bg-primary))]"
                        : "border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                    }`}
                    onClick={() => setActiveQuestionId(question.id)}
                    data-ai-region={aiRegionAttr(
                      pathTouches(aiChangedPaths, `/questions/${index}`),
                    )}
                    {...targetAttrs(`/questions/${index}`)}
                  >
                    <span className="rounded-[6px] border border-[var(--border-default)] py-1 text-center text-[12px] text-[var(--text-secondary)]">
                      {index + 1}
                    </span>
                    <span className="rounded-[5px] bg-[color-mix(in_oklab,#8b6ff0_8%,var(--bg-primary))] px-1.5 py-1 text-[9px] font-medium text-[#7560e8]">
                      {
                        {
                          multiple_choice: "MCQ",
                          short_answer: "Short answer",
                          true_false: "True / False",
                          select_all: "Select all",
                          ordering: "Ordering",
                          numeric: "Numeric",
                          fill_blank: "Fill blank",
                          long_response: "Long response",
                          matching: "Matching",
                        }[question.type]
                      }
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-medium text-[var(--text-primary)]">
                        {plannerDescriptionText(question.prompt) ||
                          "Untitled question"}
                      </span>
                    </span>
                    <GripVertical className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  </button>
                ))}
              </div>
            ) : mode === "tab" ? (
              <div className="mt-2 grid gap-1">
                {questions.map((question, index) => (
                  <button
                    key={question.id}
                    type="button"
                    aria-label={`Open question ${index + 1}`}
                    title={
                      plannerDescriptionText(question.prompt) ||
                      `Question ${index + 1}`
                    }
                    onClick={() => setActiveQuestionId(question.id)}
                    className={`h-8 rounded-[7px] text-[10px] font-semibold transition ${
                      activeQuestion?.id === question.id
                        ? "bg-[var(--text-primary)] text-[var(--bg-primary)]"
                        : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            ) : null}
            {!readOnly && questionNavigatorOpen ? (
              <button
                type="button"
                className={`${smallActionClass()} mt-2`}
                onClick={addQuestion}
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </button>
            ) : null}
          </aside>
          <section
            data-quiz-panel="editor"
            className={`min-w-0 ${mode === "tab" ? "border-r" : "border-b"} border-[var(--border-default)] p-4`}
          >
            {activeQuestion ? (
              <QuestionEditor
                question={activeQuestion}
                questionNumber={
                  questions.findIndex(
                    (question) => question.id === activeQuestion.id,
                  ) + 1
                }
                questionCount={questions.length}
                questionIndex={questions.findIndex(
                  (question) => question.id === activeQuestion.id,
                )}
                aiChangedPaths={aiChangedPaths}
                onChange={(patch) => updateQuestion(activeQuestion.id, patch)}
                onRemove={() => void removeQuestion(activeQuestion.id)}
                onDuplicate={() => {
                  const questionId = id("question");
                  const duplicate: QuizQuestion = {
                    ...structuredClone(activeQuestion),
                    id: questionId,
                    optionIds: activeQuestion.options.map(
                      (_, optionIndex) =>
                        `${questionId}:option:${optionIndex + 1}`,
                    ),
                  };
                  commit([...questions, duplicate]);
                  setActiveQuestionId(questionId);
                }}
              />
            ) : null}
          </section>
          <aside data-quiz-panel="settings" className="p-3">
            {mode === "split" ? (
              <button
                type="button"
                className="mb-2 flex w-full items-center justify-between rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[11px] font-semibold text-[var(--text-primary)]"
                onClick={() => setQuestionDetailsOpen((open) => !open)}
                aria-expanded={questionDetailsOpen}
              >
                Question details
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${questionDetailsOpen ? "rotate-180" : ""}`}
                />
              </button>
            ) : null}
            {mode === "tab" || questionDetailsOpen ? (
              activeQuestion ? (
                <div className="grid gap-3">
                  <Field
                    label="Difficulty"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/difficulty`,
                    )}
                    path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/difficulty`}
                  >
                    <select
                      value={activeQuestion.difficulty ?? "medium"}
                      onChange={(event) =>
                        updateQuestion(activeQuestion.id, {
                          difficulty: event.target
                            .value as QuizQuestion["difficulty"],
                        })
                      }
                      className={inputClass()}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </Field>
                  <Field
                    label="Points"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/points`,
                    )}
                    path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/points`}
                  >
                    <input
                      type="number"
                      value={activeQuestion.points ?? 1}
                      min={1}
                      onChange={(event) =>
                        updateQuestion(activeQuestion.id, {
                          points: Number(event.target.value),
                        })
                      }
                      className={inputClass()}
                    />
                  </Field>
                  <Field
                    label="Time"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/timeLimitSeconds`,
                    )}
                    path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/timeLimitSeconds`}
                  >
                    <input
                      type="number"
                      value={activeQuestion.timeLimitSeconds ?? 90}
                      min={0}
                      onChange={(event) =>
                        updateQuestion(activeQuestion.id, {
                          timeLimitSeconds: Number(event.target.value),
                        })
                      }
                      className={inputClass()}
                    />
                  </Field>
                  <Field
                    label="Bloom's taxonomy"
                    aiActive={pathTouches(
                      aiChangedPaths,
                      `/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/bloomLevel`,
                    )}
                    path={`/questions/${questions.findIndex((question) => question.id === activeQuestion.id)}/bloomLevel`}
                  >
                    <select
                      value={activeQuestion.bloomLevel ?? "remember"}
                      onChange={(event) =>
                        updateQuestion(activeQuestion.id, {
                          bloomLevel: event.target.value as NonNullable<
                            QuizQuestion["bloomLevel"]
                          >,
                        })
                      }
                      className={inputClass()}
                    >
                      <option value="remember">Remember</option>
                      <option value="understand">Understand</option>
                      <option value="apply">Apply</option>
                      <option value="analyze">Analyze</option>
                      <option value="evaluate">Evaluate</option>
                      <option value="create">Create</option>
                    </select>
                  </Field>
                  <Field label="Standards (optional)">
                    <div className="spectra-quiz-standard-editor">
                      {(activeQuestion.standards ?? []).map((standard) => (
                        <span key={standard}>
                          {standard}
                          <button
                            type="button"
                            aria-label={`Remove ${standard}`}
                            onClick={() =>
                              updateQuestion(activeQuestion.id, {
                                standards: (
                                  activeQuestion.standards ?? []
                                ).filter((item) => item !== standard),
                              })
                            }
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        aria-label="Add standard"
                        placeholder="+ Add standard"
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== ",")
                            return;
                          event.preventDefault();
                          const value = event.currentTarget.value
                            .trim()
                            .replace(/,$/, "");
                          if (!value) return;
                          updateQuestion(activeQuestion.id, {
                            standards: Array.from(
                              new Set([
                                ...(activeQuestion.standards ?? []),
                                value,
                              ]),
                            ),
                          });
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                  </Field>
                  <details className="spectra-quiz-advanced">
                    <summary>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Advanced placement
                      <ChevronDown className="ml-auto h-3.5 w-3.5" />
                    </summary>
                    <div>
                      <Field label="Section">
                        <input
                          value={activeQuestion.section ?? ""}
                          onChange={(event) =>
                            updateQuestion(activeQuestion.id, {
                              section: event.target.value || undefined,
                            })
                          }
                          className={inputClass()}
                          placeholder="e.g. Foundations"
                        />
                      </Field>
                      <Field label="Random pool">
                        <input
                          value={activeQuestion.poolId ?? ""}
                          onChange={(event) =>
                            updateQuestion(activeQuestion.id, {
                              poolId: event.target.value || undefined,
                              poolDrawCount: event.target.value
                                ? (activeQuestion.poolDrawCount ?? 1)
                                : undefined,
                            })
                          }
                          className={inputClass()}
                          placeholder="e.g. glycolysis-core"
                        />
                      </Field>
                      {activeQuestion.poolId ? (
                        <Field label="Questions drawn from pool">
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={activeQuestion.poolDrawCount ?? 1}
                            onChange={(event) =>
                              updateQuestion(activeQuestion.id, {
                                poolDrawCount: Math.max(
                                  1,
                                  Math.min(
                                    100,
                                    Number(event.target.value) || 1,
                                  ),
                                ),
                              })
                            }
                            className={inputClass()}
                          />
                        </Field>
                      ) : null}
                      <p>
                        Questions with the same pool name share one draw count.
                        Ungrouped questions always appear.
                      </p>
                    </div>
                  </details>
                  <div className="spectra-quiz-media">
                    {activeQuestion.media ? (
                      <>
                        {quizAssetMap.get(activeQuestion.media.assetId)
                          ?.downloadUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={
                              quizAssetMap.get(activeQuestion.media.assetId)!
                                .downloadUrl!
                            }
                            alt={activeQuestion.media.altText ?? ""}
                          />
                        ) : (
                          <div data-missing="true">
                            <ImageIcon className="h-4 w-4" /> Media unavailable
                          </div>
                        )}
                        <Field label="Image description">
                          <input
                            value={activeQuestion.media.altText ?? ""}
                            onChange={(event) =>
                              updateQuestion(activeQuestion.id, {
                                media: {
                                  ...activeQuestion.media!,
                                  altText: event.target.value,
                                },
                              })
                            }
                            className={inputClass()}
                            placeholder="Describe the image for learners who cannot see it"
                          />
                        </Field>
                        <button
                          type="button"
                          onClick={() =>
                            void removeQuestionMedia(activeQuestion.id)
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove image
                        </button>
                      </>
                    ) : (
                      <label
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const file = event.dataTransfer.files?.[0];
                          if (file?.type.startsWith("image/"))
                            void uploadQuestionMedia(file);
                        }}
                      >
                        {uploadingQuizMedia ? (
                          <>
                            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                            Uploading image…
                          </>
                        ) : (
                          <>
                            <span>Drag and drop image</span>
                            <span>or</span>
                            <strong>Browse</strong>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={uploadingQuizMedia}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void uploadQuestionMedia(file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                    {quizMediaError ? (
                      <p role="status">{quizMediaError}</p>
                    ) : null}
                  </div>
                </div>
              ) : null
            ) : null}
          </aside>
        </div>
      )}
      <section className="spectra-quiz-print-sheet" aria-hidden="true">
        <header>
          <span>Formative practice</span>
          <h1>Quiz</h1>
          {quizSettings.instructions ? (
            <p>{quizSettings.instructions}</p>
          ) : null}
          <dl>
            <div>
              <dt>Questions</dt>
              <dd>{questions.length}</dd>
            </div>
            <div>
              <dt>Estimated time</dt>
              <dd>
                {Math.max(
                  1,
                  Math.ceil(
                    (questions.reduce(
                      (total, question) =>
                        total + (question.timeLimitSeconds ?? 90),
                      0,
                    ) /
                      60) *
                      quizSettings.defaultTimeMultiplier,
                  ),
                )}{" "}
                min
              </dd>
            </div>
          </dl>
        </header>
        <ol>
          {questions.map((question) => (
            <li key={question.id}>
              <h2>
                {plannerDescriptionText(question.prompt) || "Untitled question"}
              </h2>
              {question.options.length ? (
                <ul>
                  {question.options.map((option, index) => (
                    <li key={`${question.id}-print-${index}`}>
                      {String.fromCharCode(65 + index)}. {option || "—"}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="spectra-quiz-print-response-lines" />
              )}
              {!readOnly ? (
                <aside>
                  <strong>Answer / review guidance:</strong>{" "}
                  {question.type === "matching"
                    ? (question.matchingPairs ?? [])
                        .map((pair) => `${pair.left} → ${pair.right ?? ""}`)
                        .join(" · ")
                    : question.type === "select_all" ||
                        question.type === "ordering"
                      ? (question.correctAnswers ?? question.options).join(
                          " · ",
                        )
                      : question.type === "long_response"
                        ? question.rubric || "Advisory review"
                        : question.correctAnswer}
                  {question.explanation ? <p>{question.explanation}</p> : null}
                </aside>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function plannerDescriptionHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "<p></p>";
  return /^<(?:p|h[1-6]|ul|ol|blockquote|pre)\b/i.test(trimmed)
    ? sanitizeDocumentHtml(trimmed)
    : markdownToDocumentHtml(value);
}

function plannerDescriptionText(value: string) {
  if (!value.trim()) return "";
  if (typeof window !== "undefined") {
    const parsed = new DOMParser().parseFromString(value, "text/html");
    return (parsed.body.textContent ?? "").replace(/\s+\n/g, "\n").trim();
  }
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/li>|<\/blockquote>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function ArtifactRichTextEditor({
  value,
  disabled,
  onChange,
  onFocus,
  path,
  placeholder = "Write something…",
  variant = "compact",
  collapsible = false,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  path?: string;
  placeholder?: string;
  variant?: "planner" | "compact" | "card";
  collapsible?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  const contentKeyRef = useRef(plannerDescriptionHtml(value));
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("https://");
  const [initialContent] = useState(() => plannerDescriptionHtml(value));
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Equation,
      InlineEquation,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          variant === "card"
            ? "min-h-[180px] px-6 py-8 text-center font-serif text-[24px] leading-snug text-[var(--text-primary)] outline-none"
            : variant === "planner"
              ? "min-h-[136px] px-4 py-3 text-[13px] leading-6 text-[var(--text-primary)] outline-none"
              : "min-h-[62px] px-3 py-2 text-[12px] leading-5 text-[var(--text-primary)] outline-none",
      },
    },
    onFocus: () => onFocus?.(),
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      contentKeyRef.current = html;
      onChangeRef.current(html === "<p></p>" ? "" : html);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const incoming = plannerDescriptionHtml(value);
    if (incoming === contentKeyRef.current) return;
    contentKeyRef.current = incoming;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, value]);

  function applyLink() {
    const href = linkDraft.trim();
    if (!editor || !href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  return (
    <div
      className="spectra-planner-description spectra-rich-text-editor"
      data-disabled={disabled || undefined}
      data-rich-text-variant={variant}
      data-rich-text-collapsible={collapsible || undefined}
      data-spectra-hidden-target={collapsible ? "true" : undefined}
      {...(path ? targetAttrs(path) : {})}
    >
      <div role="toolbar" aria-label="Text formatting">
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
        <ToolbarTextButton
          label="Strikethrough"
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          active={editor?.isActive("strike")}
        >
          <span className="text-[12px] font-semibold line-through">S</span>
        </ToolbarTextButton>
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
          label="Quote"
          icon={MessageSquare}
          active={editor?.isActive("blockquote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Inline code"
          icon={Code2}
          active={editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        />
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
        <ToolbarButton
          label="Inline equation"
          icon={Sigma}
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
          <span className="text-[9px] font-semibold">fx</span>
        </ToolbarTextButton>
        <span>Format</span>
      </div>
      {linkOpen ? (
        <form
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
            aria-label="Description link URL"
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
      <EditorContent editor={editor} />
    </div>
  );
}

function PlannerStudio({
  mode,
  artifact,
  artifacts,
  tagDraft,
  onTagDraftChange,
  content,
  onChange,
  aiChangedPaths = [],
  onArchive,
  onOpenArtifact,
  readOnly,
  onActiveRegionChange,
}: {
  mode: "split" | "tab";
  artifact: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  onArchive?: () => Promise<void> | void;
  onOpenArtifact: (artifactId: string) => void;
  readOnly: boolean;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const [task, setTask] = useState(() => plannerTask(content));
  const [dueDate, setDueDate] = useState(dateInputValue(task.dueAt));
  const [dueTime, setDueTime] = useState(timeInputValue(task.dueAt));
  const [startDate, setStartDate] = useState(dateInputValue(task.startAt));
  const [startTime, setStartTime] = useState(timeInputValue(task.startAt));
  const [endDate, setEndDate] = useState(dateInputValue(task.endAt));
  const [endTime, setEndTime] = useState(timeInputValue(task.endAt));
  const scheduleDraftRef = useRef({
    dueDate,
    dueTime,
    startDate,
    startTime,
    endDate,
    endTime,
  });
  const plannerImportRef = useRef<HTMLInputElement>(null);
  const [newPlannerTag, setNewPlannerTag] = useState("");
  const [newSourceRef, setNewSourceRef] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [importingTask, setImportingTask] = useState(false);
  const [taskToolReport, setTaskToolReport] = useState<string>();

  useEffect(() => {
    const nextTask = plannerTask(content);
    const nextDates = {
      dueDate: dateInputValue(nextTask.dueAt),
      dueTime: timeInputValue(nextTask.dueAt),
      startDate: dateInputValue(nextTask.startAt),
      startTime: timeInputValue(nextTask.startAt),
      endDate: dateInputValue(nextTask.endAt),
      endTime: timeInputValue(nextTask.endAt),
    };
    setTask(nextTask);
    setDueDate(nextDates.dueDate);
    setDueTime(nextDates.dueTime);
    setStartDate(nextDates.startDate);
    setStartTime(nextDates.startTime);
    setEndDate(nextDates.endDate);
    setEndTime(nextDates.endTime);
    scheduleDraftRef.current = nextDates;
  }, [content]);

  function commit(
    next: PlannerTask,
    nextDates = { dueDate, dueTime, startDate, startTime, endDate, endTime },
  ) {
    if (readOnly) return;
    const dueAt = nextDates.dueDate
      ? dateTimeValue(nextDates.dueDate, nextDates.dueTime || "12:00")
      : undefined;
    const startAt = dateTimeValue(nextDates.startDate, nextDates.startTime);
    const endAt = dateTimeValue(nextDates.endDate, nextDates.endTime);
    const full = { ...next, dueAt, startAt, endAt };
    setTask(full);
    onChange({ ...record(content), ...full });
  }

  function updateSchedule(patch: Partial<typeof scheduleDraftRef.current>) {
    if (readOnly) return;
    const nextDates = { ...scheduleDraftRef.current, ...patch };
    scheduleDraftRef.current = nextDates;
    setDueDate(nextDates.dueDate);
    setDueTime(nextDates.dueTime);
    setStartDate(nextDates.startDate);
    setStartTime(nextDates.startTime);
    setEndDate(nextDates.endDate);
    setEndTime(nextDates.endTime);
    commit(task, nextDates);
  }

  function exportTask(format: "json" | "csv" | "ics") {
    const safeName = (task.taskTitle || artifact.title || "task")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    if (format === "json") {
      downloadDocumentText(
        `${safeName || "task"}.json`,
        "application/json",
        JSON.stringify(
          {
            format: "spectra.planner-task",
            version: 1,
            exportedAt: new Date().toISOString(),
            task,
          },
          null,
          2,
        ),
      );
      setTaskToolReport("Exported a portable Spectra task with full fidelity.");
      return;
    }
    if (format === "ics") {
      downloadDocumentText(
        `${safeName || "task"}.ics`,
        "text/calendar",
        exportPlannerTaskIcs(task, artifact.title),
      );
      setTaskToolReport(
        "Exported ICS VTODO. Spectra-only links, provenance overlays, and attachments remain in Spectra.",
      );
      return;
    }
    const headers = [
      "TYPE",
      "CONTENT",
      "DESCRIPTION",
      "PRIORITY",
      "STATUS",
      "DATE",
      "TIME",
      "TIMEZONE",
      "DURATION",
      "TAGS",
    ];
    const due = task.dueAt ? new Date(task.dueAt) : undefined;
    const row = [
      "task",
      task.taskTitle || artifact.title,
      plannerDescriptionText(task.description || ""),
      task.priority === "high" ? 1 : task.priority === "low" ? 4 : 2,
      task.status,
      due?.toISOString().slice(0, 10) ?? "",
      due?.toISOString().slice(11, 16) ?? "",
      task.timezone,
      task.estimateMinutes ?? "",
      tagsFromDraft(tagDraft).join(","),
    ];
    downloadDocumentText(
      `${safeName || "task"}.csv`,
      "text/csv",
      `${headers.join(",")}\r\n${row.map(plannerCsvValue).join(",")}\r\n`,
    );
    setTaskToolReport(
      "Exported Todoist-friendly CSV. Recurrence exceptions, attachments, and source overlays are not represented by that format.",
    );
  }

  async function importTaskFile(file: File) {
    if (readOnly) return;
    if (file.size > 20 * 1024 * 1024) {
      setTaskToolReport(
        "Import quarantined: the file exceeds the 20 MB parsing safety ceiling.",
      );
      return;
    }
    setImportingTask(true);
    setTaskToolReport(undefined);
    let jobId: string | undefined;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    try {
      const beginning = await beginArtifactImportOriginal({
        artifactId: artifact._id,
        typeKey: "planner_task",
        format: extension || "unknown",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await artifactBlobSha256(file),
      });
      jobId = beginning.jobId;
      await uploadArtifactImportOriginal(jobId, file);
      const source = await file.text();
      const importedTasks: PlannerTask[] = [];
      const warnings: string[] = [];

      if (extension === "json") {
        const parsed = JSON.parse(source) as unknown;
        const payload = record(parsed).task ?? parsed;
        importedTasks.push(plannerTask(payload));
      } else if (extension === "ics" || source.includes("BEGIN:VCALENDAR")) {
        if (/BEGIN:VEVENT/i.test(source))
          throw new Error(
            "This is an event calendar, not a task list. Import it into Timetable instead.",
          );
        const blocks = source
          .replace(/\r?\n[ \t]/g, "")
          .match(/BEGIN:VTODO[\s\S]*?END:VTODO/gi);
        if (!blocks?.length) throw new Error("No ICS VTODO tasks were found.");
        blocks.slice(0, 200).forEach((block, index) => {
          const properties = new Map<string, string>();
          block.split(/\r?\n/).forEach((line) => {
            const separator = line.indexOf(":");
            if (separator < 0) return;
            properties.set(
              line.slice(0, separator).toUpperCase(),
              line.slice(separator + 1),
            );
          });
          const entry = (prefix: string) =>
            [...properties.entries()].find(([key]) => key.startsWith(prefix));
          const title = properties.get("SUMMARY")?.trim();
          if (!title) {
            warnings.push(`Task ${index + 1} had no title and was skipped.`);
            return;
          }
          const dueEntry = entry("DUE");
          const startEntry = entry("DTSTART");
          const dueAt = dueEntry ? parsePlannerIcsDate(dueEntry[1]) : undefined;
          const startAt = startEntry
            ? parsePlannerIcsDate(startEntry[1])
            : undefined;
          const status = properties.get("STATUS")?.toUpperCase();
          const priority = Number(properties.get("PRIORITY") || 5);
          importedTasks.push(
            plannerTask({
              taskTitle: title.replaceAll("\\,", ",").replaceAll("\\n", "\n"),
              description: (properties.get("DESCRIPTION") || "")
                .replaceAll("\\n", "\n")
                .replaceAll("\\,", ","),
              dueAt: dueAt && Number.isFinite(dueAt) ? dueAt : undefined,
              startAt:
                startAt && Number.isFinite(startAt) ? startAt : undefined,
              allDay: Boolean(dueEntry?.[0].includes("VALUE=DATE")),
              status:
                status === "COMPLETED"
                  ? "done"
                  : status === "IN-PROCESS"
                    ? "doing"
                    : "todo",
              priority:
                priority <= 3 ? "high" : priority >= 7 ? "low" : "medium",
              timezone: task.timezone,
              recurrence: properties.get("RRULE")
                ? parsePlannerRrule(properties.get("RRULE")!)
                : undefined,
              source: {
                provider: "import",
                externalId:
                  properties.get("UID") || `${file.name}-${index + 1}`,
                status: "active",
                lockedFields: [],
              },
            }),
          );
        });
        if (blocks.length > 200)
          warnings.push(
            `${blocks.length - 200} tasks exceeded the 200-record safety batch and remain recoverable from the retained original.`,
          );
      } else if (extension === "csv" || extension === "tsv") {
        const delimiter = extension === "tsv" ? "\t" : ",";
        const rows = plannerDelimitedRows(source, delimiter);
        const header = (rows.shift() ?? []).map((value) =>
          value.trim().toLowerCase(),
        );
        const indexOf = (...names: string[]) =>
          names
            .map((name) => header.indexOf(name))
            .find((index) => index >= 0) ?? -1;
        const titleIndex = indexOf("content", "title", "task", "name");
        if (titleIndex < 0)
          throw new Error(
            "CSV/TSV needs a Content, Title, Task, or Name column.",
          );
        const descriptionIndex = indexOf("description", "notes");
        const dueIndex = indexOf("date", "due", "due date", "deadline");
        const timeIndex = indexOf("time", "due time");
        const priorityIndex = indexOf("priority");
        const statusIndex = indexOf("status");
        const durationIndex = indexOf(
          "duration",
          "estimate",
          "estimate minutes",
        );
        const timezoneIndex = indexOf("timezone", "time zone");
        rows.slice(0, 200).forEach((row, index) => {
          const title = row[titleIndex]?.trim();
          if (!title) {
            warnings.push(`Row ${index + 2} had no title and was skipped.`);
            return;
          }
          const dateText = dueIndex >= 0 ? row[dueIndex]?.trim() : "";
          const timeText = timeIndex >= 0 ? row[timeIndex]?.trim() : "";
          const dueAt = dateText
            ? new Date(
                `${dateText}${timeText ? `T${timeText}` : "T12:00"}`,
              ).getTime()
            : undefined;
          const priorityText =
            priorityIndex >= 0 ? row[priorityIndex]?.trim().toLowerCase() : "";
          const statusText =
            statusIndex >= 0 ? row[statusIndex]?.trim().toLowerCase() : "";
          const estimate = Number(
            durationIndex >= 0 ? row[durationIndex]?.trim() : "",
          );
          importedTasks.push(
            plannerTask({
              taskTitle: title,
              description:
                descriptionIndex >= 0 ? row[descriptionIndex] || "" : "",
              dueAt: dueAt && Number.isFinite(dueAt) ? dueAt : undefined,
              status:
                statusText === "done" || statusText === "completed"
                  ? "done"
                  : statusText === "doing" || statusText === "in progress"
                    ? "doing"
                    : "todo",
              priority:
                priorityText === "1" || priorityText === "high"
                  ? "high"
                  : priorityText === "4" || priorityText === "low"
                    ? "low"
                    : "medium",
              estimateMinutes:
                Number.isFinite(estimate) && estimate > 0
                  ? estimate
                  : undefined,
              timezone:
                timezoneIndex >= 0 && row[timezoneIndex]?.trim()
                  ? row[timezoneIndex].trim()
                  : task.timezone,
              source: {
                provider: "import",
                externalId: `${file.name}:${index + 2}`,
                status: "active",
                lockedFields: [],
              },
            }),
          );
        });
        if (rows.length > 200)
          warnings.push(
            `${rows.length - 200} rows exceeded the 200-record safety batch and remain recoverable from the retained original.`,
          );
      } else {
        throw new Error("Choose JSON, CSV, TSV, or ICS VTODO.");
      }

      if (!importedTasks.length)
        throw new Error("No valid tasks were found; nothing was changed.");
      const [first, ...additional] = importedTasks;
      commit(first!);
      const workspaceId = artifact.placements?.[0]?.workspaceId;
      let created = 0;
      for (const imported of additional) {
        await postSpectra({
          action: "createArtifact",
          blueprintKey: "planner_task",
          title: imported.taskTitle || "Imported task",
          summary: plannerDescriptionText(imported.description || "").slice(
            0,
            240,
          ),
          content: imported,
          tags: [],
          ...(workspaceId ? { workspaceId } : {}),
          source: "manual",
        });
        created += 1;
      }
      await completeArtifactImport({
        jobId,
        typeKey: "planner_task",
        status: "imported",
        fidelityReport: [
          {
            scope: "task fields",
            level: "exact",
            message: `${importedTasks.length} task${importedTasks.length === 1 ? "" : "s"} imported with the original retained.`,
          },
          ...(warnings.length
            ? [
                {
                  scope: "unsupported or invalid records",
                  level: "adapted" as const,
                  message: warnings.join(" "),
                },
              ]
            : []),
        ],
        unsupportedFeatures:
          extension === "ics"
            ? ["external alarm delivery mechanisms", "calendar-server ACLs"]
            : [],
        importedContent: first,
      });
      setTaskToolReport(
        `${importedTasks.length} task${importedTasks.length === 1 ? "" : "s"} imported; ${created} additional artifact${created === 1 ? "" : "s"} created${warnings.length ? `. ${warnings.join(" ")}` : "."}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      if (jobId) {
        await completeArtifactImport({
          jobId,
          typeKey: "planner_task",
          status: "quarantined",
          fidelityReport: [{ scope: "import", level: "unsupported", message }],
          unsupportedFeatures: [],
          quarantineReason: message,
        }).catch(async () => {
          await abortArtifactImportUpload(jobId!, message).catch(
            () => undefined,
          );
        });
      }
      setTaskToolReport(`Import quarantined: ${message}`);
    } finally {
      setImportingTask(false);
    }
  }

  const linked = task.linkedArtifactIds
    .map((artifactId) => artifacts.find((item) => item._id === artifactId))
    .filter((item): item is SpectraArtifact => Boolean(item));
  const sourceLocked = (field: string) =>
    task.source?.status !== "detached" &&
    task.source?.lockedFields.includes(field) === true;
  let timezoneValid = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: task.timezone }).format();
  } catch {
    timezoneValid = false;
  }
  const scheduleError =
    task.startAt && task.endAt && task.endAt <= task.startAt
      ? "End must be after start."
      : task.startAt && task.dueAt && task.dueAt < task.startAt
        ? "Due time cannot be before the task starts."
        : undefined;
  const inspectorAiPath = aiChangedPaths.find((path) =>
    ["/startAt", "/endAt", "/allDay", "/linkedArtifactIds", "/reminders"].some(
      (prefix) => pathTouches([path], prefix),
    ),
  );

  return (
    <div
      data-inspector-open={inspectorOpen || undefined}
      className={`spectra-planner-studio grid gap-2 ${
        mode === "tab" && inspectorOpen
          ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]"
          : "grid-cols-1"
      }`}
    >
      <fieldset className="contents" disabled={readOnly}>
        <section className="min-w-0 px-1 py-2 sm:px-2">
          {mode === "tab" ? (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setInspectorOpen((value) => !value)}
                aria-expanded={inspectorOpen}
                {...targetAttrs(inspectorAiPath ?? "/view/taskDetails")}
              >
                <PanelRight className="h-3.5 w-3.5" />
                {inspectorOpen ? "Hide task details" : "Task details"}
              </button>
            </div>
          ) : null}
          <Field
            label="Description"
            aiActive={pathTouches(aiChangedPaths, "/description")}
            path="/description"
          >
            <ArtifactRichTextEditor
              value={task.description ?? ""}
              disabled={readOnly || sourceLocked("description")}
              onChange={(description) => commit({ ...task, description })}
              placeholder="What needs to happen?"
              variant="planner"
              collapsible
            />
          </Field>
          <div
            className={`mt-4 grid gap-3 ${mode === "tab" ? "md:grid-cols-4" : "grid-cols-1"}`}
          >
            <Field
              label="Status"
              aiActive={pathTouches(aiChangedPaths, "/status")}

              path="/status"
            >
              <select
                value={task.status}
                onFocus={() => onActiveRegionChange?.("task:status")}
                onMouseDown={() => onActiveRegionChange?.("task:status")}
                onChange={(event) =>
                  commit({
                    ...task,
                    status: event.target.value as PlannerTask["status"],
                  })
                }
                className={inputClass()}
              >
                <option value="todo">Todo</option>
                <option value="doing">In progress</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field
              label="Priority"
              aiActive={pathTouches(aiChangedPaths, "/priority")}

              path="/priority"
            >
              <select
                value={task.priority}
                onFocus={() => onActiveRegionChange?.("task:priority")}
                onMouseDown={() => onActiveRegionChange?.("task:priority")}
                onChange={(event) =>
                  commit({
                    ...task,
                    priority: event.target.value as PlannerTask["priority"],
                  })
                }
                className={inputClass()}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field
              label="Due date"
              aiActive={pathTouches(aiChangedPaths, "/dueAt")}

              path="/dueAt"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-1.5">
                <input
                  type="date"
                  value={dueDate}
                  disabled={sourceLocked("dueAt")}
                  onInput={(event) =>
                    updateSchedule({ dueDate: event.currentTarget.value })
                  }
                  className={inputClass()}
                />
                <input
                  type="time"
                  value={dueTime}
                  disabled={task.allDay || sourceLocked("dueAt")}
                  onInput={(event) =>
                    updateSchedule({ dueTime: event.currentTarget.value })
                  }
                  className={inputClass()}
                  aria-label="Due time"
                />
              </div>
            </Field>
            <Field
              label="Time estimate"
              aiActive={pathTouches(aiChangedPaths, "/estimateMinutes")}

              path="/estimateMinutes"
            >
              <select
                value={task.estimateMinutes ?? ""}
                onChange={(event) =>
                  commit({
                    ...task,
                    estimateMinutes: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
                className={inputClass()}
              >
                <option value="">No estimate</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">1 hour</option>
                <option value="90">1h 30m</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
              </select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Tags" path="/tags">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
                {tagsFromDraft(tagDraft).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      onTagDraftChange(
                        tagsFromDraft(tagDraft)
                          .filter((item) => item !== tag)
                          .join(", "),
                      )
                    }
                    className="rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                    title={`Remove ${tag}`}
                  >
                    {tag} <span aria-hidden="true">×</span>
                  </button>
                ))}
                <input
                  value={newPlannerTag}
                  onChange={(event) => setNewPlannerTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !newPlannerTag.trim()) return;
                    event.preventDefault();
                    onTagDraftChange(
                      Array.from(
                        new Set([
                          ...tagsFromDraft(tagDraft),
                          newPlannerTag.trim(),
                        ]),
                      ).join(", "),
                    );
                    setNewPlannerTag("");
                  }}
                  className="h-7 min-w-[100px] flex-1 bg-transparent px-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Add tag"
                  aria-label="New task tag"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newPlannerTag.trim()) return;
                    onTagDraftChange(
                      Array.from(
                        new Set([
                          ...tagsFromDraft(tagDraft),
                          newPlannerTag.trim(),
                        ]),
                      ).join(", "),
                    );
                    setNewPlannerTag("");
                  }}
                  className="rounded-[6px] px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                >
                  Add
                </button>
              </div>
            </Field>
          </div>
          {scheduleError ? (
            <div
              className="mt-3 flex items-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_26%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] px-3 py-2 text-[11px] text-[var(--danger)]"
              role="status"
            >
              <AlertCircle className="h-3.5 w-3.5" /> {scheduleError}
            </div>
          ) : null}
          {task.source ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,#d88922_22%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_5%,var(--bg-primary))] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
              <Link2 className="h-3.5 w-3.5 text-[#d88922]" />
              Source-linked from {task.source.provider}
              <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] capitalize">
                {task.source.status}
              </span>
              {task.source.lockedFields.length ? (
                <span>
                  {task.source.lockedFields.length} source field
                  {task.source.lockedFields.length === 1 ? "" : "s"} protected
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="spectra-planner-advanced mt-4 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
            <button
              type="button"
              {...targetAttrs("/recurrence")}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[12px] font-semibold text-[var(--text-secondary)]"
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
            >
              Recurrence, timezone & people
              <ChevronDown
                className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen ? (
              <div className="grid gap-4 border-t border-[var(--border-subtle)] p-3 md:grid-cols-2">
                <Field
                  label="Progress note"
                  aiActive={pathTouches(aiChangedPaths, "/progressNote")}

                  path="/progressNote"
                >
                  <input
                    value={task.progressNote ?? ""}
                    onChange={(event) =>
                      commit({ ...task, progressNote: event.target.value })
                    }
                    className={inputClass()}
                    placeholder="Current blocker or next concrete step"
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    value={task.timezone}
                    onChange={(event) =>
                      commit({ ...task, timezone: event.target.value })
                    }
                    className={inputClass()}
                    list="spectra-planner-timezones"
                    aria-invalid={!timezoneValid}
                    placeholder="Europe/Madrid"
                  />
                  <datalist id="spectra-planner-timezones">
                    {Array.from(
                      new Set(
                        [
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                          "UTC",
                          "Europe/London",
                          "Europe/Madrid",
                          "America/New_York",
                          "America/Chicago",
                          "America/Los_Angeles",
                          "Asia/Dubai",
                          "Asia/Singapore",
                          "Asia/Tokyo",
                          "Australia/Sydney",
                        ].filter(Boolean),
                      ),
                    ).map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                  {!timezoneValid ? (
                    <p className="mt-1 text-[10px] text-[var(--danger)]">
                      Enter a valid IANA timezone.
                    </p>
                  ) : null}
                </Field>
                <Field label="Repeats">
                  <div className="grid grid-cols-[1fr_90px] gap-2">
                    <select
                      value={task.recurrence.frequency}
                      onChange={(event) =>
                        commit({
                          ...task,
                          recurrence: {
                            ...task.recurrence,
                            frequency: event.target
                              .value as PlannerRecurrence["frequency"],
                          },
                        })
                      }
                      className={inputClass()}
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={task.recurrence.interval}
                      disabled={task.recurrence.frequency === "none"}
                      onChange={(event) =>
                        commit({
                          ...task,
                          recurrence: {
                            ...task.recurrence,
                            interval: Math.max(
                              1,
                              Math.min(365, Number(event.target.value) || 1),
                            ),
                          },
                        })
                      }
                      className={inputClass()}
                      aria-label="Repeat interval"
                    />
                  </div>
                </Field>
                {task.recurrence.frequency === "weekly" ? (
                  <Field label="Repeat on">
                    <div className="flex flex-wrap gap-1.5">
                      {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => {
                        const active = task.recurrence.weekdays.includes(day);
                        return (
                          <button
                            key={`${label}-${day}`}
                            type="button"
                            className={`h-8 w-8 rounded-full border text-[11px] font-semibold ${active ? "border-[#d88922] bg-[color-mix(in_oklab,#d88922_10%,var(--bg-primary))] text-[#b96c0b]" : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
                            onClick={() =>
                              commit({
                                ...task,
                                recurrence: {
                                  ...task.recurrence,
                                  weekdays: active
                                    ? task.recurrence.weekdays.filter(
                                        (value) => value !== day,
                                      )
                                    : [...task.recurrence.weekdays, day].sort(),
                                },
                              })
                            }
                            aria-pressed={active}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                ) : null}
                {task.recurrence.frequency !== "none" ? (
                  <Field label="Repeat until">
                    <input
                      type="date"
                      value={dateInputValue(task.recurrence.untilAt)}
                      min={dueDate || startDate || undefined}
                      onChange={(event) =>
                        commit({
                          ...task,
                          recurrence: {
                            ...task.recurrence,
                            untilAt: event.target.value
                              ? dateTimeValue(event.target.value, "23:59")
                              : undefined,
                          },
                        })
                      }
                      className={inputClass()}
                    />
                  </Field>
                ) : null}
                <PlannerPeopleEditor
                  label="Assignees"
                  people={task.assignees}
                  onChange={(assignees) => commit({ ...task, assignees })}
                />
                <PlannerPeopleEditor
                  label="Watchers"
                  people={task.watchers}
                  onChange={(watchers) => commit({ ...task, watchers })}
                />
                {task.source ? (
                  <div className="md:col-span-2 rounded-[8px] border border-[var(--border-default)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-primary)]">
                          Source authority
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                          {task.source.externalId}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={smallActionClass()}
                        onClick={() =>
                          commit({
                            ...task,
                            source: task.source
                              ? {
                                  ...task.source,
                                  status: "detached",
                                  lockedFields: [],
                                }
                              : undefined,
                          })
                        }
                      >
                        Detach source
                      </button>
                    </div>
                    <Field label="Private planning note">
                      <textarea
                        value={task.personalOverlay?.note ?? ""}
                        onChange={(event) =>
                          commit({
                            ...task,
                            personalOverlay: {
                              ...task.personalOverlay,
                              note: event.target.value,
                            },
                          })
                        }
                        className={`${inputClass()} min-h-20 py-2`}
                        placeholder="Your private overlay is not written back to the source."
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <TaskListEditor
            task={task}
            commit={commit}
            aiChangedPaths={aiChangedPaths}
          />
          <AttachmentEditor
            artifactId={artifact._id}
            task={task}
            commit={commit}
            aiChangedPaths={aiChangedPaths}
            readOnly={readOnly}
          />
          <div className="mt-5">
            <Field label="Sources / provenance" path="/sourceRefs">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
                {task.sourceRefs.map((sourceRef) => {
                  const sourceArtifact = artifacts.find(
                    (item) => item._id === sourceRef,
                  );
                  const label = sourceArtifact?.title ?? sourceRef;
                  return (
                    <button
                      key={sourceRef}
                      type="button"
                      onClick={() =>
                        commit({
                          ...task,
                          sourceRefs: task.sourceRefs.filter(
                            (item) => item !== sourceRef,
                          ),
                        })
                      }
                      className="inline-flex max-w-full items-center gap-1 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                      title={`Remove source ${label}`}
                    >
                      <span className="truncate">{label}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  );
                })}
                <input
                  value={newSourceRef}
                  onChange={(event) => setNewSourceRef(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !newSourceRef.trim()) return;
                    event.preventDefault();
                    commit({
                      ...task,
                      sourceRefs: Array.from(
                        new Set([...task.sourceRefs, newSourceRef.trim()]),
                      ),
                    });
                    setNewSourceRef("");
                  }}
                  className="h-7 min-w-[150px] flex-1 bg-transparent px-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Add a source or linked artifact"
                  aria-label="Add source"
                />
              </div>
            </Field>
          </div>
        </section>
      </fieldset>
      {mode === "tab" && inspectorOpen ? (
        <aside className="space-y-4">
          <SideCard title="Task blueprint">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,#d88922_10%,var(--bg-primary))] text-[#d88922]">
                <CalendarCheck2 className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Planner task
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                  Active blueprint
                </div>
              </div>
              <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklab,var(--success)_11%,var(--bg-primary))] px-2 py-1 text-[10px] text-[var(--success)]">
                Active
              </span>
            </div>
            <div className="-mt-1 grid grid-cols-2 gap-2">
              <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                <strong className="block text-[12px] font-semibold text-[var(--text-primary)]">
                  {task.status === "done"
                    ? "Completed"
                    : task.status === "doing"
                      ? "In progress"
                      : "Active"}
                </strong>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  State
                </span>
              </div>
              <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2">
                <strong className="block text-[12px] font-semibold text-[var(--text-primary)]">
                  Task
                </strong>
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  Type
                </span>
              </div>
            </div>
          </SideCard>
          <fieldset className="contents" disabled={readOnly}>
            <SideCard title="Schedule">
              {scheduleOpen ? (
                <div className="spectra-planner-schedule-editor">
                  <Field
                    label="Starts"
                    aiActive={pathTouches(aiChangedPaths, "/startAt")}

                    path="/startAt"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-1.5">
                      <input
                        type="date"
                        value={startDate}
                        disabled={sourceLocked("startAt")}
                        onInput={(event) =>
                          updateSchedule({
                            startDate: event.currentTarget.value,
                          })
                        }
                        className={inputClass()}
                      />
                      <input
                        type="time"
                        value={startTime}
                        disabled={task.allDay || sourceLocked("startAt")}
                        onInput={(event) =>
                          updateSchedule({
                            startTime: event.currentTarget.value,
                          })
                        }
                        className={inputClass()}
                        aria-label="Start time"
                      />
                    </div>
                  </Field>
                  <div className="mt-3">
                    <Field
                      label="Ends"
                      aiActive={pathTouches(aiChangedPaths, "/endAt")}

                      path="/endAt"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-1.5">
                        <input
                          type="date"
                          value={endDate}
                          disabled={sourceLocked("endAt")}
                          onInput={(event) =>
                            updateSchedule({
                              endDate: event.currentTarget.value,
                            })
                          }
                          className={inputClass()}
                        />
                        <input
                          type="time"
                          value={endTime}
                          disabled={task.allDay || sourceLocked("endAt")}
                          onInput={(event) =>
                            updateSchedule({
                              endTime: event.currentTarget.value,
                            })
                          }
                          className={inputClass()}
                          aria-label="End time"
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="spectra-planner-schedule-summary">
                  <button type="button" onClick={() => setScheduleOpen(true)}>
                    <span>Starts</span>
                    <strong>{formatScheduleDateTime(task.startAt)}</strong>
                  </button>
                  <button type="button" onClick={() => setScheduleOpen(true)}>
                    <span>Ends</span>
                    <strong>{formatScheduleDateTime(task.endAt)}</strong>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="mt-3 flex h-9 w-full items-center justify-between rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[11px] text-[var(--text-secondary)]"
                onClick={() => commit({ ...task, allDay: !task.allDay })}
                aria-pressed={task.allDay}
              >
                All day
                <span
                  className={`h-5 w-9 rounded-full p-0.5 transition ${task.allDay ? "bg-[var(--success)]" : "bg-[var(--bg-secondary)]"}`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-white transition ${task.allDay ? "translate-x-4" : ""}`}
                  />
                </span>
              </button>
              {scheduleOpen ? (
                <button
                  type="button"
                  className="mt-2 w-full text-center text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  onClick={() => setScheduleOpen(false)}
                >
                  Done editing schedule
                </button>
              ) : null}
            </SideCard>
          </fieldset>
          <div className="contents">
            <SideCard title="Linked to">
              <div className="space-y-2">
                {linked.map((item) => {
                  const meta = blueprintMeta[item.blueprintKey];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={item._id}
                      className="flex items-center gap-1 rounded-[7px] hover:bg-[var(--bg-hover)]"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-[12px] text-[var(--text-primary)]"
                        onClick={() => onOpenArtifact(item._id)}
                      >
                        <Icon
                          className="h-4 w-4"
                          style={{ color: meta.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.title}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                        onClick={() =>
                          commit({
                            ...task,
                            linkedArtifactIds: task.linkedArtifactIds.filter(
                              (artifactId) => artifactId !== item._id,
                            ),
                          })
                        }
                        aria-label={`Unlink ${item.title}`}
                        disabled={readOnly}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
                {linked.length === 0 ? (
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    No linked artifacts.
                  </div>
                ) : null}
                <select
                  className={inputClass()}
                  value=""
                  disabled={readOnly}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    commit({
                      ...task,
                      linkedArtifactIds: Array.from(
                        new Set([
                          ...task.linkedArtifactIds,
                          event.target.value,
                        ]),
                      ),
                    });
                  }}
                >
                  <option value="">Link artifact</option>
                  {artifacts
                    .filter(
                      (item) =>
                        item._id !== artifact._id &&
                        !task.linkedArtifactIds.includes(item._id),
                    )
                    .map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </div>
            </SideCard>
          </div>
          <fieldset className="contents" disabled={readOnly}>
            <SideCard title="Reminders">
              <ReminderEditor task={task} commit={commit} />
            </SideCard>
          </fieldset>
          <SideCard title="Import & export">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`${smallActionClass()} justify-center`}
                onClick={() => plannerImportRef.current?.click()}
                disabled={readOnly || importingTask}
              >
                {importingTask ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Import className="h-3.5 w-3.5" />
                )}
                Import
              </button>
              <button
                type="button"
                className={`${smallActionClass()} justify-center`}
                onClick={() => exportTask("json")}
              >
                <FileDown className="h-3.5 w-3.5" /> JSON
              </button>
              <button
                type="button"
                className={`${smallActionClass()} justify-center`}
                onClick={() => exportTask("csv")}
              >
                <FileDown className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                type="button"
                className={`${smallActionClass()} justify-center`}
                onClick={() => exportTask("ics")}
              >
                <CalendarCheck2 className="h-3.5 w-3.5" /> ICS
              </button>
            </div>
            <input
              ref={plannerImportRef}
              type="file"
              accept=".json,.csv,.tsv,.ics,application/json,text/csv,text/tab-separated-values,text/calendar"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importTaskFile(file);
                event.currentTarget.value = "";
              }}
            />
            {taskToolReport ? (
              <p
                className="mt-2 text-[10px] leading-4 text-[var(--text-secondary)]"
                role="status"
              >
                {taskToolReport}
              </p>
            ) : null}
          </SideCard>
          <SideCard title="Created">
            <MetricRow
              label="Created"
              value={formatShortDate(artifact.createdAt)}
            />
            <MetricRow
              label="Updated"
              value={formatShortDate(artifact.updatedAt)}
            />
          </SideCard>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] text-[13px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))]"
            onClick={() => (onArchive ? void onArchive() : undefined)}
            disabled={readOnly || !onArchive}
          >
            <Archive className="h-4 w-4" />
            Move to trash
          </button>
        </aside>
      ) : null}
    </div>
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
          showComposer={false}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-[var(--bg-primary)] p-8 text-center">
      <div className="max-w-[420px]">
        <MessageSquare className="mx-auto h-10 w-10 rounded-[10px] bg-[color-mix(in_oklab,#8b6ff0_10%,var(--bg-elevated))] p-2.5 text-[#8b6ff0]" />
        <div>
          <h3 className="mt-4 font-display text-[22px] font-semibold text-[var(--text-primary)]">
            Conversation unavailable
          </h3>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
            This older artifact is a disconnected reference, not a conversation.
            Keep a current run or place a chat thread to create a working thread
            artifact.
          </p>
        </div>
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  questionNumber,
  questionCount,
  questionIndex,
  aiChangedPaths = [],
  onChange,
  onRemove,
  onDuplicate,
}: {
  question: QuizQuestion;
  questionNumber: number;
  questionCount: number;
  questionIndex: number;
  aiChangedPaths?: string[];
  onChange: (patch: Partial<QuizQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const qPath = `/questions/${questionIndex}`;
  const aiField = (suffix: string) =>
    pathTouches(aiChangedPaths, `${qPath}/${suffix}`);

  function addTag() {
    const tag = tagDraft.trim().replace(/^#+/, "");
    if (!tag) return;
    if (
      !(question.tags ?? []).some(
        (candidate) => candidate.toLowerCase() === tag.toLowerCase(),
      )
    ) {
      onChange({ tags: [...(question.tags ?? []), tag] });
    }
    setTagDraft("");
  }

  function updateOption(index: number, value: string) {
    const options = [...question.options];
    const previous = options[index] ?? "";
    options[index] = value;
    onChange({
      options,
      correctAnswer:
        question.correctAnswer === previous ? value : question.correctAnswer,
      correctAnswers: (question.correctAnswers ?? []).map((answer) =>
        answer === previous ? value : answer,
      ),
    });
  }
  return (
    <div className="spectra-quiz-question-editor">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">
          Question {questionNumber} of {questionCount}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButtonClass()}
            onClick={onDuplicate}
            aria-label="Duplicate question"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButtonClass()}
            onClick={onRemove}
            aria-label="Remove question"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="spectra-quiz-type-row">
        <span>Type</span>
        <select
          value={question.type}
          data-ai-region={aiRegionAttr(aiField("type"))}
          {...targetAttrs(`${qPath}/type`)}
          onChange={(event) => {
            const type = event.target.value as QuizQuestion["type"];
            onChange({
              type,
              options:
                type === "true_false"
                  ? ["True", "False"]
                  : ["multiple_choice", "select_all", "ordering"].includes(
                        type,
                      ) && question.options.length === 0
                    ? ["", "", "", ""]
                    : question.options,
              optionIds:
                type === "true_false"
                  ? [id("option"), id("option")]
                  : ["multiple_choice", "select_all", "ordering"].includes(
                        type,
                      ) && question.options.length === 0
                    ? [id("option"), id("option"), id("option"), id("option")]
                    : question.optionIds,
              correctAnswers:
                type === "select_all" ||
                type === "ordering" ||
                type === "fill_blank"
                  ? (question.correctAnswers ?? [])
                  : [],
              matchingPairs:
                type === "matching" && (question.matchingPairs ?? []).length < 2
                  ? [
                      { id: id("pair"), left: "", right: "" },
                      { id: id("pair"), left: "", right: "" },
                    ]
                  : question.matchingPairs,
            });
          }}
          className={inputClass()}
        >
          <option value="multiple_choice">Multiple choice</option>
          <option value="true_false">True / false</option>
          <option value="select_all">Select all that apply</option>
          <option value="ordering">Ordering</option>
          <option value="short_answer">Short answer</option>
          <option value="numeric">Numeric</option>
          <option value="fill_blank">Fill in the blank</option>
          <option value="long_response">Long response</option>
          <option value="matching">Matching</option>
        </select>
      </div>
      <div className="mt-2">
        <Field
          label="Question"
          aiActive={aiField("prompt")}
          path={`${qPath}/prompt`}
        >
          <ArtifactRichTextEditor
            value={question.prompt}
            onChange={(prompt) => onChange({ prompt })}
            path={`${qPath}/prompt`}
            placeholder="Write a clear question"
          />
        </Field>
      </div>
      {["multiple_choice", "true_false", "select_all", "ordering"].includes(
        question.type,
      ) ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
              Answer options
            </h4>
          </div>
          <div className="grid gap-1">
            {question.options.map((option, index) => (
              <div
                key={question.optionIds[index] ?? index}
                className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2"
              >
                {question.type === "ordering" ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-default)] text-[11px] font-semibold text-[var(--text-secondary)]">
                    {index + 1}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                      question.type === "select_all"
                        ? (question.correctAnswers ?? []).includes(option) &&
                          option
                          ? "border-[var(--success)] bg-[var(--success)] text-white"
                          : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                        : question.correctAnswer === option && option
                          ? "border-[var(--success)] text-[var(--success)]"
                          : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                    }`}
                    onClick={() => {
                      if (!option) return;
                      if (question.type === "select_all") {
                        const current = question.correctAnswers ?? [];
                        onChange({
                          correctAnswers: current.includes(option)
                            ? current.filter((answer) => answer !== option)
                            : [...current, option],
                        });
                      } else onChange({ correctAnswer: option });
                    }}
                    {...targetAttrs(
                      `${qPath}/${
                        question.type === "select_all"
                          ? "correctAnswers"
                          : "correctAnswer"
                      }`,
                      `option:${index}`,
                      "toggle",
                    )}
                    aria-label={`${
                      question.type === "select_all" &&
                      (question.correctAnswers ?? []).includes(option)
                        ? "Unmark"
                        : "Mark"
                    } option ${index + 1} correct`}
                  >
                    {(question.type === "select_all"
                      ? (question.correctAnswers ?? []).includes(option)
                      : question.correctAnswer === option) && option ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </button>
                )}
                <input
                  value={option}
                  onChange={(event) => updateOption(index, event.target.value)}
                  readOnly={question.type === "true_false"}
                  data-ai-region={aiRegionAttr(aiField(`options/${index}`))}
                  {...targetAttrs(`${qPath}/options/${index}`)}
                  className={`${inputClass()} ${
                    question.type === "true_false"
                      ? "cursor-default bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                      : ""
                  }`}
                  placeholder={`Option ${index + 1}`}
                />
                <div className="flex items-center gap-1">
                  {question.type === "ordering" ? (
                    <>
                      <button
                        type="button"
                        className={iconButtonClass()}
                        disabled={index === 0}
                        onClick={() => {
                          const options = [...question.options];
                          const optionIds = [...question.optionIds];
                          [options[index - 1], options[index]] = [
                            options[index]!,
                            options[index - 1]!,
                          ];
                          [optionIds[index - 1], optionIds[index]] = [
                            optionIds[index]!,
                            optionIds[index - 1]!,
                          ];
                          onChange({
                            options,
                            optionIds,
                            correctAnswers: options,
                          });
                        }}
                        aria-label={`Move option ${index + 1} earlier`}
                      >
                        <ChevronDown className="h-4 w-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass()}
                        disabled={index === question.options.length - 1}
                        onClick={() => {
                          const options = [...question.options];
                          const optionIds = [...question.optionIds];
                          [options[index], options[index + 1]] = [
                            options[index + 1]!,
                            options[index]!,
                          ];
                          [optionIds[index], optionIds[index + 1]] = [
                            optionIds[index + 1]!,
                            optionIds[index]!,
                          ];
                          onChange({
                            options,
                            optionIds,
                            correctAnswers: options,
                          });
                        }}
                        aria-label={`Move option ${index + 1} later`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                  {question.type !== "true_false" ? (
                    <button
                      type="button"
                      className={iconButtonClass()}
                      onClick={() => {
                        const removed = question.options[index];
                        const options = question.options.filter(
                          (_, candidate) => candidate !== index,
                        );
                        const optionIds = question.optionIds.filter(
                          (_, candidate) => candidate !== index,
                        );
                        onChange({
                          options,
                          optionIds,
                          correctAnswer:
                            question.correctAnswer === removed
                              ? ""
                              : question.correctAnswer,
                          correctAnswers: (
                            question.correctAnswers ?? []
                          ).filter((answer) => answer !== removed),
                        });
                      }}
                      aria-label="Remove option"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {question.type !== "true_false" ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={smallActionClass()}
                onClick={() =>
                  onChange({
                    options: [...question.options, ""],
                    optionIds: [...question.optionIds, id("option")],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </button>
              {question.type !== "ordering" ? (
                <button
                  type="button"
                  className={smallActionClass()}
                  onClick={() => {
                    const paired = question.options.map((option, index) => ({
                      option,
                      optionId: question.optionIds[index] ?? id("option"),
                    }));
                    for (let index = paired.length - 1; index > 0; index -= 1) {
                      const target = Math.floor(Math.random() * (index + 1));
                      [paired[index], paired[target]] = [
                        paired[target]!,
                        paired[index]!,
                      ];
                    }
                    onChange({
                      options: paired.map(({ option }) => option),
                      optionIds: paired.map(({ optionId }) => optionId),
                    });
                  }}
                >
                  <Shuffle className="h-3.5 w-3.5" /> Shuffle options
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            {question.type === "ordering"
              ? "The order shown above is the canonical answer."
              : question.type === "select_all"
                ? "Select every correct option using the marker beside it."
                : "Select the correct option using its marker."}
          </p>
        </section>
      ) : question.type === "matching" ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
              Matching pairs
            </h4>
            <button
              type="button"
              className={smallActionClass()}
              onClick={() =>
                onChange({
                  matchingPairs: [
                    ...(question.matchingPairs ?? []),
                    { id: id("pair"), left: "", right: "" },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add pair
            </button>
          </div>
          <div className="space-y-2">
            {(question.matchingPairs ?? []).map((pair, index) => (
              <div
                key={pair.id}
                className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)_30px] items-center gap-2"
              >
                <input
                  value={pair.left}
                  onChange={(event) =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).map(
                        (candidate) =>
                          candidate.id === pair.id
                            ? { ...candidate, left: event.target.value }
                            : candidate,
                      ),
                    })
                  }
                  data-ai-region={aiRegionAttr(
                    aiField(`matchingPairs/${index}/left`) ||
                      aiField(`matchingPairs/${index}`),
                  )}
                  {...targetAttrs(`${qPath}/matchingPairs/${index}/left`)}
                  className={inputClass()}
                  placeholder={`Prompt ${index + 1}`}
                />
                <span className="text-center text-[var(--text-tertiary)]">
                  →
                </span>
                <input
                  value={pair.right ?? ""}
                  onChange={(event) =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).map(
                        (candidate) =>
                          candidate.id === pair.id
                            ? { ...candidate, right: event.target.value }
                            : candidate,
                      ),
                    })
                  }
                  data-ai-region={aiRegionAttr(
                    aiField(`matchingPairs/${index}/right`) ||
                      aiField(`matchingPairs/${index}`),
                  )}
                  {...targetAttrs(`${qPath}/matchingPairs/${index}/right`)}
                  className={inputClass()}
                  placeholder={`Match ${index + 1}`}
                />
                <button
                  type="button"
                  className={iconButtonClass()}
                  disabled={(question.matchingPairs ?? []).length <= 2}
                  onClick={() =>
                    onChange({
                      matchingPairs: (question.matchingPairs ?? []).filter(
                        (candidate) => candidate.id !== pair.id,
                      ),
                    })
                  }
                  aria-label={`Remove matching pair ${index + 1}`}
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-[var(--text-tertiary)]">
            Matches are shuffled in each private practice attempt. The right
            side remains hidden from learners until feedback is released.
          </p>
        </section>
      ) : question.type === "long_response" ? (
        <div className="mt-4">
          <Field
            label="Formative rubric / review guidance"
            aiActive={aiField("rubric")}
            path={`${qPath}/rubric`}
          >
            <textarea
              value={question.rubric ?? ""}
              onChange={(event) => onChange({ rubric: event.target.value })}
              className={textareaClass("min-h-[110px]")}
              placeholder="What should a strong response include?"
            />
          </Field>
          <p className="mt-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
            Long responses are not auto-scored. Learners receive this guidance
            as advisory formative feedback.
          </p>
        </div>
      ) : question.type === "numeric" ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field
            label="Expected number"
            aiActive={aiField("correctAnswer")}
            path={`${qPath}/correctAnswer`}
          >
            <input
              type="number"
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={inputClass()}
              placeholder="42"
            />
          </Field>
          <Field
            label="Accepted tolerance (±)"
            aiActive={aiField("numericTolerance")}
            path={`${qPath}/numericTolerance`}
          >
            <input
              type="number"
              min={0}
              step="any"
              value={question.numericTolerance ?? 0}
              onChange={(event) =>
                onChange({
                  numericTolerance: Math.max(
                    0,
                    Number(event.target.value) || 0,
                  ),
                })
              }
              className={inputClass()}
              placeholder="0"
            />
          </Field>
        </div>
      ) : (
        <div className="mt-4">
          <Field
            label={
              question.type === "fill_blank"
                ? "Primary accepted answer"
                : "Expected answer"
            }
            aiActive={aiField("correctAnswer")}
            path={`${qPath}/correctAnswer`}
          >
            <input
              value={question.correctAnswer ?? ""}
              onChange={(event) =>
                onChange({ correctAnswer: event.target.value })
              }
              className={inputClass()}
              placeholder={
                question.type === "fill_blank"
                  ? "Text that completes the blank"
                  : "Short answer key"
              }
            />
          </Field>
          {question.type === "fill_blank" ? (
            <div className="mt-3">
              <Field
                label="Other accepted answers"
                aiActive={aiField("correctAnswers")}
                path={`${qPath}/correctAnswers`}
              >
                <input
                  value={(question.correctAnswers ?? []).join("; ")}
                  onChange={(event) =>
                    onChange({
                      correctAnswers: event.target.value
                        .split(";")
                        .map((answer) => answer.trim())
                        .filter(Boolean),
                    })
                  }
                  className={inputClass()}
                  placeholder="Alternative spelling; equivalent phrase"
                />
              </Field>
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-4">
        <Field
          label="Explanation"
          aiActive={aiField("explanation")}
          path={`${qPath}/explanation`}
        >
          <textarea
            value={question.explanation ?? ""}
            onChange={(event) => onChange({ explanation: event.target.value })}
            className={textareaClass("min-h-[110px]")}
            placeholder="Optional answer explanation"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field
          label="Tags / topics"
          aiActive={aiField("tags")}
          path={`${qPath}/tags`}
        >
          <div className="spectra-quiz-tag-editor">
            {(question.tags ?? []).map((tag) => (
              <span key={tag}>
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag} tag`}
                  onClick={() =>
                    onChange({
                      tags: (question.tags ?? []).filter(
                        (item) => item !== tag,
                      ),
                    })
                  }
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={addTag}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="+ Add tag"
            />
          </div>
        </Field>
      </div>
      <details className="spectra-quiz-content-advanced mt-4">
        <summary>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Feedback and source details
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        </summary>
        <div className="grid gap-4 pt-3">
          <Field
            label="Formative feedback / next step"
            aiActive={aiField("feedback")}
            path={`${qPath}/feedback`}
          >
            <textarea
              value={question.feedback ?? ""}
              onChange={(event) => onChange({ feedback: event.target.value })}
              className={textareaClass("min-h-[76px]")}
              placeholder="Offer a useful next step without turning practice into a grade."
            />
          </Field>
          <Field
            label="Sources / provenance"
            aiActive={aiField("sourceRefs")}
            path={`${qPath}/sourceRefs`}
          >
            <input
              value={(question.sourceRefs ?? []).join(", ")}
              onChange={(event) =>
                onChange({
                  sourceRefs: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              className={inputClass()}
              placeholder="Textbook p. 42, class notes"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function TaskListEditor({
  task,
  commit,
  aiChangedPaths = [],
}: {
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
  aiChangedPaths?: string[];
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Subtasks {task.subtasks.filter((item) => item.done).length}/
          {task.subtasks.length}
        </h4>
        <button
          type="button"
          className={smallActionClass()}
          {...targetAttrs("/subtasks")}
          onClick={() =>
            commit({
              ...task,
              subtasks: [
                ...task.subtasks,
                { id: id("subtask"), title: "", done: false },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add subtask
        </button>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-[var(--border-default)]">
        {(task.subtasks.length > 0
          ? task.subtasks
          : [{ id: "empty", title: "", done: false }]
        ).map((subtask, index) => (
          <div
            key={subtask.id}
            className="grid grid-cols-[32px_minmax(0,1fr)_34px] items-center gap-2 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 last:border-b-0"
          >
            <button
              type="button"
              {...targetAttrs(`/subtasks/${index}/done`)}
              disabled={subtask.id === "empty"}
              aria-label={
                subtask.id === "empty"
                  ? "New subtask"
                  : subtask.done
                    ? `Mark ${subtask.title || "subtask"} incomplete`
                    : `Mark ${subtask.title || "subtask"} complete`
              }
              className="text-[var(--text-secondary)] disabled:opacity-35"
              data-ai-region={aiRegionAttr(
                pathTouches(aiChangedPaths, `/subtasks/${index}/done`) ||
                  pathTouches(aiChangedPaths, `/subtasks/${index}`),
              )}
              onClick={() =>
                commit({
                  ...task,
                  subtasks: task.subtasks.map((item) =>
                    item.id === subtask.id
                      ? { ...item, done: !item.done }
                      : item,
                  ),
                })
              }
            >
              {subtask.done ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </button>
            <input
              {...targetAttrs(`/subtasks/${index}/title`)}
              value={subtask.title}
              onChange={(event) =>
                commit({
                  ...task,
                  subtasks:
                    subtask.id === "empty"
                      ? [
                          {
                            id: id("subtask"),
                            title: event.target.value,
                            done: false,
                          },
                        ]
                      : task.subtasks.map((item) =>
                          item.id === subtask.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                })
              }
              data-ai-region={aiRegionAttr(
                pathTouches(aiChangedPaths, `/subtasks/${index}/title`) ||
                  pathTouches(aiChangedPaths, `/subtasks/${index}`),
              )}
              className="h-8 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              placeholder="Add the first subtask"
              aria-label="Subtask"
            />
            <button
              type="button"
              {...targetAttrs(`/subtasks/${index}`)}
              disabled={subtask.id === "empty"}
              aria-label={`Remove ${subtask.title || "subtask"}`}
              className="text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-0"
              onClick={() =>
                commit({
                  ...task,
                  subtasks: task.subtasks.filter(
                    (item) => item.id !== subtask.id,
                  ),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlannerPeopleEditor({
  label,
  people,
  onChange,
}: {
  label: string;
  people: PlannerPerson[];
  onChange: (people: PlannerPerson[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpectraSchoolMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      setError(undefined);
      return;
    }
    let active = true;
    setSearching(true);
    const timeout = window.setTimeout(() => {
      void searchSpectraSchoolMembers(query.trim(), 8)
        .then((response) => {
          if (!active) return;
          setResults(
            response.members.filter(
              (member) =>
                !people.some((person) => person.accountId === member.accountId),
            ),
          );
          setError(undefined);
        })
        .catch((searchError: unknown) => {
          if (!active) return;
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "School member search failed.",
          );
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [people, query]);

  return (
    <Field label={label}>
      <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2">
        <div className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <button
              key={person.accountId}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] text-[var(--text-primary)]"
              onClick={() =>
                onChange(
                  people.filter((item) => item.accountId !== person.accountId),
                )
              }
              title={`Remove ${person.name}`}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[color-mix(in_oklab,#d88922_12%,var(--bg-primary))] text-[8px] font-semibold text-[#b96c0b]">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              {person.name}
              <X className="h-2.5 w-2.5" />
            </button>
          ))}
          {!people.length ? (
            <span className="px-1 py-1 text-[10px] text-[var(--text-tertiary)]">
              No one selected
            </span>
          ) : null}
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${inputClass()} pl-8`}
            placeholder="Search school members"
            aria-label={`Search ${label.toLowerCase()}`}
          />
          {searching ? (
            <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
          ) : null}
        </div>
        {results.length ? (
          <div className="mt-1 overflow-hidden rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-sm">
            {results.map((member) => (
              <button
                key={member.accountId}
                type="button"
                className="flex w-full items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2 text-left last:border-b-0 hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  onChange([
                    ...people,
                    {
                      accountId: member.accountId,
                      name: member.name,
                      email: member.email,
                    },
                  ]);
                  setQuery("");
                  setResults([]);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium text-[var(--text-primary)]">
                    {member.name}
                  </span>
                  <span className="block truncate text-[9px] text-[var(--text-tertiary)]">
                    {member.email}
                  </span>
                </span>
                <span className="ml-auto text-[9px] capitalize text-[var(--text-tertiary)]">
                  {member.role.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>
        ) : query.trim().length >= 2 && !searching && !error ? (
          <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
            No matching school members.
          </p>
        ) : null}
        {error ? (
          <p className="mt-1.5 text-[10px] text-[var(--danger)]" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </Field>
  );
}

function AttachmentEditor({
  artifactId,
  task,
  commit,
  aiChangedPaths = [],
  readOnly,
}: {
  artifactId: string;
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
  aiChangedPaths?: string[];
  readOnly: boolean;
}) {
  const [assets, setAssets] = useState<SpectraArtifactAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getArtifactAssets(artifactId)
      .then((response) => {
        if (active) setAssets(response.assets);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Attachments are unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const assetsById = new Map(assets.map((asset) => [asset.assetId, asset]));

  async function addFiles(files: File[]) {
    if (!files.length || readOnly) return;
    setUploading(true);
    setError(undefined);
    const additions: PlannerAttachment[] = [];
    const failures: string[] = [];
    for (const file of files.slice(0, 30 - task.attachments.length)) {
      const mediaType = plannerAssetMediaType(file);
      if (!mediaType) {
        failures.push(`${file.name}: unsupported or unidentifiable file type`);
        continue;
      }
      if (file.size < 1 || file.size > 100 * 1024 * 1024) {
        failures.push(
          `${file.name}: outside the 100 MB technical safety ceiling`,
        );
        continue;
      }
      try {
        const uploaded = await uploadArtifactAsset({
          artifactId,
          path: `planner/attachments/${Date.now().toString(36)}-${id("file")}-${file.name}`,
          name: file.name,
          mediaType,
          sha256: await artifactBlobSha256(file),
          blob: file,
        });
        additions.push({
          id: id("attachment"),
          assetId: uploaded.assetId,
          name: file.name,
          mediaType,
          bytes: file.size,
          meta: `${plannerBytesLabel(file.size)} · ${mediaType}`,
        });
      } catch (uploadError) {
        failures.push(
          `${file.name}: ${uploadError instanceof Error ? uploadError.message : "upload failed"}`,
        );
      }
    }
    if (additions.length)
      commit({ ...task, attachments: [...task.attachments, ...additions] });
    try {
      const refreshed = await getArtifactAssets(artifactId);
      setAssets(refreshed.assets);
    } catch {
      // References are already durable; the next refresh recovers metadata.
    }
    setError(failures.length ? failures.join(" · ") : undefined);
    setUploading(false);
  }

  async function removeAttachment(attachment: PlannerAttachment) {
    if (readOnly) return;
    setError(undefined);
    try {
      if (attachment.assetId) await revokeArtifactAsset(attachment.assetId);
      commit({
        ...task,
        attachments: task.attachments.filter(
          (item) => item.id !== attachment.id,
        ),
      });
      setAssets((current) =>
        current.map((asset) =>
          asset.assetId === attachment.assetId
            ? { ...asset, status: "revoked", downloadUrl: null }
            : asset,
        ),
      );
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The attachment could not be removed.",
      );
    }
  }

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Attachments
        </h4>
        <label
          className={`${smallActionClass()} cursor-pointer ${uploading ? "pointer-events-none opacity-55" : ""}`}
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {uploading ? "Uploading" : "Attach"}
          <input
            type="file"
            multiple
            hidden
            disabled={readOnly || uploading}
            accept="image/*,audio/*,video/*,.pdf,.txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pptx,.odt,.ods,.odp"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length) void addFiles(files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="space-y-2">
        {task.attachments.map((attachment, index) => (
          <div
            key={attachment.id}
            className="flex items-center gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5"
            data-ai-region={
              pathTouches(aiChangedPaths, `/attachments/${index}`) || undefined
            }
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,#e34d44_10%,var(--bg-elevated))] text-[#d94a42]">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">
                {attachment.name}
              </span>
              <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                {attachment.bytes
                  ? `${plannerBytesLabel(attachment.bytes)} · ${attachment.mediaType}`
                  : attachment.meta || "Legacy reference"}
              </span>
            </span>
            {assetsById.get(attachment.assetId)?.status === "active" &&
            assetsById.get(attachment.assetId)?.downloadUrl ? (
              <a
                href={assetsById.get(attachment.assetId)!.downloadUrl!}
                className={iconButtonClass()}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${attachment.name}`}
              >
                <FileDown className="h-4 w-4" />
              </a>
            ) : (
              <span className="rounded-[6px] bg-[var(--bg-secondary)] px-2 py-1 text-[9px] text-[var(--text-tertiary)]">
                {assetsById.get(attachment.assetId)?.status === "quarantined"
                  ? "Quarantined"
                  : assetsById.get(attachment.assetId)?.status === "revoked"
                    ? "Removed"
                    : "Unavailable"}
              </span>
            )}
            <button
              type="button"
              className={iconButtonClass()}
              onClick={() => void removeAttachment(attachment)}
              aria-label="Remove attachment"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <label
          className={`block rounded-[8px] border border-dashed px-4 py-5 text-center text-[12px] transition ${readOnly ? "cursor-default opacity-60" : "cursor-pointer"} ${dragActive ? "border-[#d88922] bg-[color-mix(in_oklab,#d88922_7%,var(--bg-primary))] text-[#b96c0b]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[color-mix(in_oklab,#d88922_45%,var(--border-default))] hover:bg-[var(--bg-hover)]"}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (!readOnly && !uploading)
              void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {uploading
            ? "Securing attachments…"
            : "Drop files here or click to attach"}
          <input
            type="file"
            multiple
            hidden
            disabled={readOnly || uploading}
            accept="image/*,audio/*,video/*,.pdf,.txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pptx,.odt,.ods,.odp"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length) void addFiles(files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {error ? (
          <p
            className="text-[10px] leading-4 text-[var(--danger)]"
            role="status"
          >
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ReminderEditor({
  task,
  commit,
}: {
  task: PlannerTask;
  commit: (task: PlannerTask) => void;
}) {
  const [draft, setDraft] = useState("30");
  return (
    <div className="space-y-2">
      {task.reminders.map((reminder) => (
        <div
          key={reminder.id}
          className="flex items-center justify-between gap-2 rounded-[7px] border border-[var(--border-default)] px-2 py-2 text-[12px] text-[var(--text-primary)]"
        >
          <button
            type="button"
            className={`h-4 w-7 rounded-full p-0.5 ${reminder.enabled ? "bg-[var(--success)]" : "bg-[var(--bg-secondary)]"}`}
            onClick={() =>
              commit({
                ...task,
                reminders: task.reminders.map((item) =>
                  item.id === reminder.id
                    ? { ...item, enabled: !item.enabled }
                    : item,
                ),
              })
            }
            aria-label={`${reminder.enabled ? "Disable" : "Enable"} reminder`}
            aria-pressed={reminder.enabled}
          >
            <span
              className={`block h-3 w-3 rounded-full bg-white transition ${reminder.enabled ? "translate-x-3" : ""}`}
            />
          </button>
          <span className="min-w-0 flex-1 truncate">
            {reminder.minutesBefore === 0
              ? "At due time"
              : reminder.minutesBefore < 60
                ? `${reminder.minutesBefore} min before`
                : reminder.minutesBefore % 1_440 === 0
                  ? `${reminder.minutesBefore / 1_440} day${reminder.minutesBefore === 1_440 ? "" : "s"} before`
                  : `${Math.round((reminder.minutesBefore / 60) * 10) / 10} hr before`}
          </span>
          <button
            type="button"
            onClick={() =>
              commit({
                ...task,
                reminders: task.reminders.filter(
                  (item) => item.id !== reminder.id,
                ),
              })
            }
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_34px] gap-2">
        <input
          type="number"
          min={0}
          max={525600}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={inputClass()}
          placeholder="Minutes before"
          aria-label="Reminder minutes before"
        />
        <button
          type="button"
          className={iconButtonClass()}
          onClick={() => {
            const minutes = Number(draft);
            if (!Number.isFinite(minutes) || minutes < 0) return;
            commit({
              ...task,
              reminders: [
                ...task.reminders,
                {
                  id: id("reminder"),
                  minutesBefore: Math.min(525_600, Math.round(minutes)),
                  enabled: true,
                },
              ],
            });
            setDraft("30");
          }}
          aria-label="Add reminder"
        >
          <Plus className="h-4 w-4" />
        </button>
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
  const meta = blueprintMeta[artifact.blueprintKey];
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
    SpectraArtifactVersion[]
  >([]);
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
    void getSpectraArtifactVersions(artifact._id)
      .then((result) => setHistoryVersions(result.versions))
      .catch(() => setHistoryVersions([]));
  }, [artifact._id, detailsTab]);
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
        explanation: "Confirmed from a related-artifact suggestion",
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
      window.dispatchEvent(new Event("spectra:refresh"));
      onOpenArtifact(result.artifactId);
    } finally {
      setDuplicating(false);
    }
  }
  return (
    <aside className="spectra-studio-details overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)]">
      <div className="grid grid-cols-2 border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 pt-1">
        <button
          type="button"
          onClick={() => setDetailsTab("details")}
          className={`h-11 border-b-2 text-[12px] font-semibold ${detailsTab === "details" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setDetailsTab("history")}
          className={`h-11 border-b-2 text-[12px] font-semibold ${detailsTab === "history" ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)]"}`}
        >
          Activity
        </button>
      </div>
      {detailsTab === "details" ? (
        <div className="space-y-3 p-3">
          <SideCard title="Blueprint">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
              <Icon className="h-4 w-4" style={{ color: meta.color }} />
              {meta.label}
              <span className="ml-auto rounded-[6px] bg-[color-mix(in_oklab,var(--success)_11%,var(--bg-primary))] px-2 py-1 text-[11px] text-[var(--success)]">
                Active
              </span>
            </div>
          </SideCard>
          <SideCard title="Placement">
            <div className="space-y-2">
              {placements.length > 0 ? (
                placements.map((placement) => (
                  <div
                    key={placement.workspaceItemId}
                    className="rounded-[7px] px-1 py-1 text-[12px] font-medium text-[var(--text-primary)]"
                  >
                    {placement.workspaceTitle}
                    <div className="text-[11px] font-normal text-[var(--text-secondary)]">
                      Workspace
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  Library inbox
                </div>
              )}
            </div>
          </SideCard>
          {detailWaveStats?.length ? (
            <SideCard title={detailWaveTitle}>
              <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] text-center">
                {detailWaveStats.map(([value, label]) => (
                  <div key={label} className="px-1">
                    <strong className="block font-sans text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                      {value}
                    </strong>
                    <span className="text-[9px] text-[var(--text-tertiary)]">
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
                  <strong className="block font-display text-[14px] text-[var(--text-primary)]">
                    {detailDeckCards.length}
                  </strong>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    Cards
                  </span>
                </div>
                <div>
                  <strong className="block font-display text-[14px] text-[var(--text-primary)]">
                    {detailDeckSections}
                  </strong>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    Sections
                  </span>
                </div>
                <div>
                  <strong className="block font-display text-[14px] text-[var(--text-primary)]">
                    ~{Math.max(1, Math.round(detailDeckCards.length * 0.75))}{" "}
                    min
                  </strong>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    Study time
                  </span>
                </div>
              </div>
            </SideCard>
          ) : null}
          <SideCard title="Linked artifacts">
            <div className="space-y-2">
              {durableLinks.slice(0, 8).map((link) =>
                link.artifact ? (
                  <div
                    key={link._id}
                    className="group rounded-[7px] px-1 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    data-link-direction={link.direction}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {link.artifact.title}
                      </span>
                      <span className="text-[9px] text-[var(--text-tertiary)]">
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
                const linkedMeta = blueprintMeta[linked.blueprintKey];
                const LinkedIcon = linkedMeta.icon;
                return (
                  <div
                    key={linked._id}
                    className="flex items-center gap-2 text-[12px] text-[var(--text-primary)]"
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
                <div className="text-[12px] text-[var(--text-secondary)]">
                  No confirmed links yet.
                </div>
              ) : null}
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-1.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setLinkPickerOpen((open) => !open)}
                aria-expanded={linkPickerOpen}
              >
                <Plus className="h-3 w-3" /> Link artifact
              </button>
              {linkPickerOpen ? (
                <div className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
                  {suggestions.map(({ candidate }) => (
                    <div
                      key={candidate._id}
                      className="flex items-center gap-2 rounded-[5px] px-1 py-1 text-[10px]"
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
              className="spectra-related-artifacts rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
            >
              <summary className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                Related suggestions · {suggestions.length}
              </summary>
              <div className="space-y-1.5">
                {suggestions.map(({ candidate }) => (
                  <div
                    key={candidate._id}
                    className="group flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 hover:bg-[var(--bg-primary)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
                      {candidate.title}
                    </span>
                    <button
                      type="button"
                      disabled={linkingId === candidate._id}
                      onClick={() => void confirmLink(candidate)}
                      className="rounded-[5px] px-1.5 py-1 text-[9px] font-medium text-[var(--accent-cyan)] opacity-70 hover:bg-[var(--bg-hover)] group-hover:opacity-100"
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
              <div className="text-[11px] leading-5 text-[var(--text-secondary)]">
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
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]"
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
                className="grid h-7 w-7 place-items-center rounded-[6px] border border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
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
                  className="h-8 min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Add a tag"
                />
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
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
            <div className="space-y-2 text-[10px] text-[var(--text-secondary)]">
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
                      window.dispatchEvent(
                        new CustomEvent("spectra:study-deck", {
                          detail: { artifactId: artifact._id },
                        }),
                      )
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
                      window.dispatchEvent(
                        new CustomEvent("spectra:preview-quiz", {
                          detail: { artifactId: artifact._id },
                        }),
                      )
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
              {historyVersions.map((version, index) => (
                <div
                  key={version._id}
                  className="rounded-[8px] bg-[var(--bg-primary)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
                    <History className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                    {index === 0
                      ? "Current saved version"
                      : version.summary || "Saved version"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>
                      {version.source === "ai" ? "Spectra edit" : "Manual save"}
                    </span>
                    <span>{formatRelativeTime(version.createdAt)}</span>
                  </div>
                </div>
              ))}
              {historyVersions.length === 0 ? (
                <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
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

function CardFace({
  label,
  value,
  placeholder,
  onChange,
  onFocus,
  clozeMode = false,
  noteValue,
  onNoteChange,
  aiActive = false,
  aiNoteActive = false,
  path,
  notePath,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  clozeMode?: boolean;
  noteValue?: string;
  onNoteChange?: (value: string) => void;
  aiActive?: boolean;
  aiNoteActive?: boolean;
  /** Canonical pointer for the face, e.g. `/cards/2/front`. */
  path?: string;
  /** Canonical pointer for the hint field. */
  notePath?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function markCloze() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "answer";
    const nextIndex =
      Math.max(0, ...clozeParts(value).map((part) => part.index)) + 1;
    const marker = `{{c${nextIndex}::${selected}}}`;
    onChange(`${value.slice(0, start)}${marker}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + `{{c${nextIndex}::`.length;
      textarea.setSelectionRange(
        selectionStart,
        selectionStart + selected.length,
      );
    });
  }

  return (
    <section data-card-face={label.toLowerCase()}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        <span>{label}</span>
        {clozeMode ? (
          <>
            <button
              type="button"
              onClick={markCloze}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[10px] font-semibold normal-case tracking-normal text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="Select text, then create a cloze deletion"
            >
              <Focus className="h-3.5 w-3.5" />
              Make cloze
            </button>
            <span className="normal-case tracking-normal text-[var(--text-tertiary)]">
              {clozeParts(value).length}{" "}
              {clozeParts(value).length === 1 ? "deletion" : "deletions"}
            </span>
          </>
        ) : null}
      </div>
      <div className={onNoteChange ? "spectra-card-face-shell" : undefined}>
        {clozeMode ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => onFocus?.()}
            data-ai-region={aiRegionAttr(aiActive)}
            {...(path ? targetAttrs(path) : {})}
            className="min-h-[180px] w-full resize-none rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-6 py-8 text-center font-serif text-[24px] leading-snug text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]"
            placeholder={placeholder}
          />
        ) : (
          <div data-ai-region={aiRegionAttr(aiActive)}>
            <ArtifactRichTextEditor
              value={value}
              onChange={onChange}
              onFocus={onFocus}
              path={path}
              placeholder={placeholder}
              variant="card"
            />
          </div>
        )}
        {onNoteChange ? (
          <input
            value={noteValue ?? ""}
            onChange={(event) => onNoteChange(event.target.value)}
            onFocus={() => onFocus?.()}
            data-ai-region={aiRegionAttr(aiNoteActive)}
            {...(notePath ? targetAttrs(notePath) : {})}
            className="spectra-card-face-note"
            placeholder="Add a note (optional)"
            aria-label="Note or hint"
          />
        ) : null}
      </div>
      {clozeMode && clozeParts(value).length ? (
        <div className="mt-2 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Study preview
          </span>
          <p className="font-serif text-[15px] leading-6 text-[var(--text-secondary)]">
            {clozePrompt(value)}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      data-spectra-card="side"
      data-side-card-title={title.toLowerCase().replaceAll(" ", "-")}
      className="p-4"
    >
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

const AI_FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "button"]);

function Field({
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
      className="block rounded-[8px]"
      data-ai-region={aiRegionAttr(aiActive && !markedControl)}
      // Fall back to the label only when the control itself could not be
      // annotated, so a target always resolves to something honest.
      {...(path && !markedControl ? targetAttrs(path) : {})}
    >
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">
        {label}
      </span>
      {control}
    </label>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <strong className="font-medium text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={toolbarClass(active)}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

function ToolbarTextButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={toolbarClass(active)}
        onClick={onClick}
        aria-label={label}
      >
        {children}
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

function Divider() {
  return <span className="mx-1 h-5 w-px bg-[var(--border-default)]" />;
}

function inputClass() {
  return "h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))]";
}

function textareaClass(extra = "") {
  return `w-full resize-none rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,#8b6ff0_55%,var(--border-default))] ${extra}`;
}

function iconButtonClass() {
  return "flex h-9 w-9 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function smallActionClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-transparent px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45";
}

function toolbarClass(active?: boolean) {
  return `flex h-8 min-w-8 items-center justify-center rounded-[7px] px-2 text-[12px] font-medium transition disabled:opacity-40 ${
    active
      ? "bg-[var(--text-primary)] text-[var(--bg-primary)]"
      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;
}

function tabButtonClass(active: boolean) {
  return `h-9 rounded-[8px] px-3 text-[13px] font-medium transition ${active ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_6px_rgba(27,20,12,0.08)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:text-[var(--text-tertiary)]"}`;
}
