"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileUp,
  Link2,
  List,
  Loader2,
  Lock,
  MapPin,
  Plus,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useNow } from "@/hooks/use-now";
import {
  abortArtifactImportUpload,
  beginArtifactImportOriginal,
  completeArtifactImport,
  getSpectraArtifactUserState,
  saveSpectraArtifactUserState,
  uploadArtifactImportOriginal,
  type SpectraArtifact,
} from "../data/api";
import {
  createTimetableEvent,
  expandTimetableEvents,
  inputToIso,
  localDateInput,
  mergeTimetableState,
  normalizeTimetablePersonalState,
  partitionTimetableState,
  pickTimetableAnchorDate,
  sharedTimetableContent,
  timetableFocusMinutes,
  type TimetableContent,
  type TimetableEvent,
  type TimetableOccurrence,
  type TimetablePersonalState,
  type TimetableView,
} from "../timetable/model";
import {
  exportTimetableIcs,
  importTimetableFile,
  type TimetableImportReport,
} from "../timetable/io";
import { aiRegionAttr, pathTouches } from "./ai-region-path";
import { targetAttrs } from "../collaboration/target-attributes";

const HOUR_HEIGHT = 68;
const DAY_MS = 86_400_000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date, weekStartsOn: 0 | 1) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  const offset = (next.getDay() - weekStartsOn + 7) % 7;
  next.setDate(next.getDate() - offset);
  return next;
}

function startOfMonthGrid(date: Date, weekStartsOn: 0 | 1) {
  return startOfWeek(
    new Date(date.getFullYear(), date.getMonth(), 1, 12),
    weekStartsOn,
  );
}

function sameDay(left: Date, right: Date | null | undefined) {
  return Boolean(right) && dateKey(left) === dateKey(right!);
}

function formatDateRange(days: Date[], view: TimetableView) {
  if (view === "month") {
    return days[Math.floor(days.length / 2)]!.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }
  if (days.length === 1) {
    return days[0]!.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const first = days[0]!;
  const last = days.at(-1)!;
  return `${first.toLocaleDateString("en-US", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`;
}

function eventMinutes(event: TimetableEvent) {
  const start = new Date(event.overlay?.alternativeStart || event.start);
  const end = new Date(event.overlay?.alternativeEnd || event.end);
  const local = localDateInput(start.toISOString(), event.timezone);
  const localTime = local.match(/T(\d{2}):(\d{2})$/);
  return {
    start: localTime
      ? Number(localTime[1]) * 60 + Number(localTime[2])
      : start.getHours() * 60 + start.getMinutes(),
    duration: Math.max(15, (end.getTime() - start.getTime()) / 60_000),
  };
}

function eventSpansLocalDay(event: TimetableEvent, day: Date) {
  const timezone = event.timezone;
  const startKey = localDateInput(event.start, timezone).slice(0, 10);
  const endInstant = new Date(
    Math.max(Date.parse(event.start), Date.parse(event.end) - 1),
  );
  const endKey = localDateInput(endInstant.toISOString(), timezone).slice(
    0,
    10,
  );
  const target = dateKey(day);
  return startKey <= target && target <= endKey;
}

function collisionLayout(events: TimetableOccurrence[]) {
  const result = new Map<
    string,
    { lane: number; lanes: number; conflict: boolean }
  >();
  const grouped = new Map<string, TimetableOccurrence[]>();
  for (const event of events) {
    const key = localDateInput(event.start, event.timezone).slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  for (const candidates of grouped.values()) {
    const sorted = [...candidates].sort(
      (left, right) => Date.parse(left.start) - Date.parse(right.start),
    );
    let cluster: TimetableOccurrence[] = [];
    let clusterEnd = -Infinity;
    const finalize = () => {
      if (!cluster.length) return;
      const laneEnds: number[] = [];
      const placements: Array<{ event: TimetableOccurrence; lane: number }> =
        [];
      for (const event of cluster) {
        const start = Date.parse(event.start);
        let lane = laneEnds.findIndex((end) => end <= start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = Date.parse(event.end);
        placements.push({ event, lane });
      }
      const lanes = Math.max(1, laneEnds.length);
      for (const placement of placements)
        result.set(placement.event.occurrenceKey, {
          lane: placement.lane,
          lanes,
          conflict: lanes > 1,
        });
      cluster = [];
      clusterEnd = -Infinity;
    };
    for (const event of sorted) {
      const start = Date.parse(event.start);
      if (cluster.length && start >= clusterEnd) finalize();
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, Date.parse(event.end));
    }
    finalize();
  }
  return result;
}

function downloadText(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function EventCard({
  event,
  color,
  compact,
  readOnly,
  changed,
  conflict,
  onSelect,
  onDragStart,
  path,
}: {
  event: TimetableEvent;
  color: string;
  compact?: boolean;
  readOnly: boolean;
  changed: boolean;
  conflict?: boolean;
  onSelect: () => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  /** Canonical pointer for this event, e.g. `/events/4`. */
  path?: string;
}) {
  const start = new Date(event.overlay?.alternativeStart || event.start);
  const end = new Date(event.overlay?.alternativeEnd || event.end);
  return (
    <button
      type="button"
      className="timetable-event"
      data-compact={compact || undefined}
      data-source={event.sourceRef ? "source" : "local"}
      data-status={event.sourceStatus}
      data-conflict={conflict || undefined}
      data-ai-region={aiRegionAttr(changed)}
      {...(path ? targetAttrs(path) : {})}
      draggable={
        !readOnly && !event.locked && !event.sourceRef && !event.recurrence
      }
      title={
        conflict
          ? "This event overlaps another busy event. Open it to review the conflict."
          : event.recurrence
            ? "Recurring events are edited from their series details. Dragging a single occurrence is intentionally disabled."
            : undefined
      }
      style={
        {
          "--event-color": event.overlay?.color || color,
        } as CSSProperties
      }
      onClick={(interaction) => {
        interaction.stopPropagation();
        onSelect();
      }}
      onDragStart={onDragStart}
    >
      <strong>{event.title}</strong>
      {!event.allDay ? (
        <time suppressHydrationWarning>
          {start.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: event.timezone,
          })}
          {compact
            ? null
            : `–${end.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: event.timezone,
              })}`}
        </time>
      ) : null}
      {!compact && event.location ? <small>{event.location}</small> : null}
      {event.recurrence ? (
        <Repeat2 className="timetable-event-recurrence" />
      ) : null}
      {event.sourceRef ? <Lock className="timetable-event-source" /> : null}
      {conflict ? <AlertTriangle className="timetable-event-conflict" /> : null}
    </button>
  );
}

export function TimetableStudio({
  artifactId,
  artifacts,
  content,
  onChange,
  aiChangedPaths = [],
  readOnly,
  synchronizationReady: _synchronizationReady = true,
  onActiveRegionChange,
}: {
  artifactId: string;
  artifacts: SpectraArtifact[];
  content: unknown;
  onChange: (content: unknown) => void;
  aiChangedPaths?: string[];
  readOnly: boolean;
  synchronizationReady?: boolean;
  syncMessage?: string;
  onActiveRegionChange?: (regionId: string) => void;
}) {
  const sharedTimetable = useMemo(
    () => sharedTimetableContent(content),
    [content],
  );
  const [personalState, setPersonalState] = useState<TimetablePersonalState>(
    () => normalizeTimetablePersonalState(null, sharedTimetable.timezone),
  );
  const [personalReady, setPersonalReady] = useState(false);
  const [personalSaveState, setPersonalSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [personalError, setPersonalError] = useState<string>();
  const personalSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const personalSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const personalSaveSequenceRef = useRef(0);
  const [personalDraft, setPersonalDraft] = useState<TimetablePersonalState | null>(
    null,
  );
  const nowMs = useNow(60_000);
  const timetable = useMemo(
    () => mergeTimetableState(sharedTimetable, personalState),
    [personalState, sharedTimetable],
  );
  const view = timetable.view!;
  const anchor = parseDateKey(view.anchorDate);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [layersOpen, setLayersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importReport, setImportReport] = useState<TimetableImportReport>();
  const [importError, setImportError] = useState<string>();
  const [importBusy, setImportBusy] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoAnchoredRef = useRef(false);
  const userMovedAnchorRef = useRef(false);
  useEffect(() => {
    autoAnchoredRef.current = false;
    userMovedAnchorRef.current = false;
  }, [artifactId]);
  useEffect(() => {
    let active = true;
    setPersonalReady(false);
    setPersonalError(undefined);
    setPersonalSaveState("idle");
    void getSpectraArtifactUserState(artifactId)
      .then((result) => {
        if (!active) return;
        setPersonalState(
          normalizeTimetablePersonalState(
            result.state,
            sharedTimetable.timezone,
          ),
        );
        setPersonalReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setPersonalError(
          error instanceof Error
            ? error.message
            : "Your personal calendar settings could not be loaded.",
        );
        setPersonalReady(true);
        setPersonalSaveState("error");
      });
    return () => {
      active = false;
      if (personalSaveTimerRef.current)
        clearTimeout(personalSaveTimerRef.current);
    };
  }, [artifactId, sharedTimetable.timezone]);

  function savePersonalState(next: TimetablePersonalState) {
    setPersonalState(next);
    setPersonalSaveState("saving");
    setPersonalError(undefined);
    setPersonalDraft(next);
  }

  useEffect(() => {
    if (personalDraft === null) return;
    const next = personalDraft;
    const sequence = ++personalSaveSequenceRef.current;
    if (personalSaveTimerRef.current)
      clearTimeout(personalSaveTimerRef.current);
    personalSaveTimerRef.current = setTimeout(() => {
      personalSaveChainRef.current = personalSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await saveSpectraArtifactUserState({ artifactId, state: next });
          if (sequence === personalSaveSequenceRef.current) {
            setPersonalSaveState("saved");
            setTimeout(() => {
              if (sequence === personalSaveSequenceRef.current)
                setPersonalSaveState("idle");
            }, 1_600);
          }
        })
        .catch((error) => {
          if (sequence !== personalSaveSequenceRef.current) return;
          setPersonalSaveState("error");
          setPersonalError(
            error instanceof Error
              ? error.message
              : "Your personal calendar changes could not be synchronized.",
          );
        });
    }, 180);
    return () => {
      if (personalSaveTimerRef.current)
        clearTimeout(personalSaveTimerRef.current);
    };
  }, [artifactId, personalDraft]);

  const visibleLayers = useMemo(
    () => timetable.layers.filter((layer) => layer.visible),
    [timetable.layers],
  );
  const visibleLayerIds = useMemo(
    () => new Set(visibleLayers.map((layer) => layer.id)),
    [visibleLayers],
  );
  const layerMap = new Map(timetable.layers.map((layer) => [layer.id, layer]));
  const artifactMap = new Map(
    artifacts.map((artifact) => [artifact._id, artifact]),
  );
  const baseVisibleEvents = useMemo(
    () =>
      timetable.events.filter(
        (event) => visibleLayerIds.has(event.layerId) && !event.overlay?.hidden,
      ),
    [timetable.events, visibleLayerIds],
  );
  const selectedEvent = timetable.events.find(
    (event) => event.id === selectedEventId,
  );
  const privateLayerIds = new Set(
    personalState.privateLayers.map((layer) => layer.id),
  );
  const selectedIsPersonal = Boolean(
    selectedEvent && privateLayerIds.has(selectedEvent.layerId),
  );
  const selectedCanEditBase = Boolean(
    selectedEvent &&
    !selectedEvent.locked &&
    (selectedIsPersonal || (!readOnly && !selectedEvent.sourceRef)),
  );
  const selectedCanEditOverlay = Boolean(
    selectedEvent && personalReady && !selectedIsPersonal,
  );
  const selectedCanPersonalize = Boolean(selectedEvent && personalReady);

  const days = useMemo(() => {
    if (view.kind === "day") return [anchor];
    if (view.kind === "month") {
      const start = startOfMonthGrid(anchor, view.weekStartsOn);
      return Array.from({ length: 42 }, (_, index) => addDays(start, index));
    }
    const start = startOfWeek(anchor, view.weekStartsOn);
    const length = view.showWeekends ? 7 : 5;
    return Array.from({ length }, (_, index) => addDays(start, index));
  }, [anchor, view.kind, view.showWeekends, view.weekStartsOn]);
  const visibleEvents = useMemo(() => {
    const firstDay = days[0] ?? anchor;
    const lastDay = days.at(-1) ?? anchor;
    const rangeStart = new Date(firstDay);
    rangeStart.setHours(0, 0, 0, 0);
    if (view.kind === "agenda") rangeStart.setTime(anchor.getTime() - DAY_MS);
    const rangeEnd = new Date(lastDay);
    rangeEnd.setHours(24, 0, 0, 0);
    if (view.kind === "agenda")
      rangeEnd.setTime(anchor.getTime() + 366 * DAY_MS);
    return expandTimetableEvents(
      baseVisibleEvents,
      rangeStart,
      rangeEnd,
      timetable.timezone,
    );
  }, [anchor, baseVisibleEvents, days, timetable.timezone, view.kind]);
  const aiRevealKeyRef = useRef<string | undefined>(undefined);

  // Do not steal the user's calendar viewport for AI edits — cyan ink on the
  // event card is enough. Peers may be reading a different week on purpose.
  useEffect(() => {
    if (!aiChangedPaths.length) {
      aiRevealKeyRef.current = undefined;
    }
  }, [aiChangedPaths]);

  // After AI create (or any load) where personal view still defaults to "today"
  // but events live in another week, jump once to the earliest upcoming event.
  useEffect(() => {
    if (!personalReady || autoAnchoredRef.current || userMovedAnchorRef.current)
      return;
    if (!nowMs) return;
    if (!baseVisibleEvents.length) return;
    if (visibleEvents.length > 0) {
      autoAnchoredRef.current = true;
      return;
    }
    const nextAnchor = pickTimetableAnchorDate({
      events: baseVisibleEvents,
      timezone: timetable.timezone,
      now: new Date(nowMs),
    });
    autoAnchoredRef.current = true;
    if (!nextAnchor || nextAnchor === view.anchorDate) return;
    setPersonalState((current) => {
      const next = {
        ...current,
        view: { ...current.view!, anchorDate: nextAnchor },
      };
      setPersonalDraft(next);
      setPersonalSaveState("saving");
      setPersonalError(undefined);
      return next;
    });
  }, [
    baseVisibleEvents,
    nowMs,
    personalReady,
    timetable.timezone,
    view.anchorDate,
    visibleEvents.length,
  ]);

  const eventCollisionLayout = useMemo(
    () =>
      collisionLayout(
        visibleEvents.filter(
          (event) => !event.allDay && event.availability !== "free",
        ),
      ),
    [visibleEvents],
  );
  // Prefer the mounted clock so SSR and hydration share a stable "no now line"
  // until the client is ready.
  const now = nowMs > 0 ? new Date(nowMs) : null;
  const timetableNow = now
    ? localDateInput(now.toISOString(), timetable.timezone)
    : null;
  const timetableToday = timetableNow
    ? parseDateKey(timetableNow.slice(0, 10))
    : null;
  const [, nowHour = "0", nowMinute = "0"] = timetableNow
    ? (timetableNow.match(/T(\d{2}):(\d{2})$/) ?? [])
    : [];
  const timetableNowMinutes = Number(nowHour) * 60 + Number(nowMinute);

  function emit(recipe: (draft: TimetableContent) => void) {
    if (!personalReady) return;
    const next = clone(timetable);
    recipe(next);
    const partitioned = partitionTimetableState(next);
    if (JSON.stringify(partitioned.personal) !== JSON.stringify(personalState))
      savePersonalState(partitioned.personal);
    if (
      !readOnly &&
      JSON.stringify(partitioned.shared) !== JSON.stringify(sharedTimetable)
    )
      onChange(partitioned.shared);
  }

  function instantForDay(day: Date, minutes: number) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return new Date(
      inputToIso(
        `${dateKey(day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        timetable.timezone,
      ),
    );
  }

  function updateView(kind: TimetableView) {
    emit((draft) => {
      draft.view!.kind = kind;
    });
  }

  function moveAnchor(direction: number) {
    userMovedAnchorRef.current = true;
    const amount =
      view.kind === "month"
        ? 30 * direction
        : view.kind === "day"
          ? direction
          : 7 * direction;
    emit((draft) => {
      draft.view!.anchorDate = dateKey(addDays(anchor, amount));
    });
  }

  function selectEvent(event: TimetableEvent) {
    setSelectedEventId(event.id);
    onActiveRegionChange?.(event.id);
  }

  function updateSelected(recipe: (event: TimetableEvent) => void) {
    if (!selectedEventId) return;
    emit((draft) => {
      const event = draft.events.find(
        (candidate) => candidate.id === selectedEventId,
      );
      if (event) recipe(event);
    });
  }

  function addEvent(start = new Date()) {
    const layer = timetable.layers.find(
      (candidate) =>
        privateLayerIds.has(candidate.id) &&
        candidate.visible &&
        !candidate.locked &&
        candidate.authority === "user",
    );
    if (!layer) return;
    const event = createTimetableEvent(layer.id, start);
    emit((draft) => draft.events.push(event));
    setSelectedEventId(event.id);
    setAddOpen(false);
    onActiveRegionChange?.(event.id);
  }

  function addSharedEvent(start = new Date()) {
    if (readOnly) return;
    const layer = timetable.layers.find(
      (candidate) =>
        !privateLayerIds.has(candidate.id) &&
        candidate.visible &&
        !candidate.locked &&
        candidate.authority !== "external" &&
        candidate.authority !== "school",
    );
    if (!layer) {
      setLayersOpen(true);
      setAddOpen(false);
      return;
    }
    const event = createTimetableEvent(layer.id, start);
    emit((draft) => draft.events.push(event));
    setSelectedEventId(event.id);
    setAddOpen(false);
    onActiveRegionChange?.(event.id);
  }

  function dropEvent(day: Date, clientY: number, target: HTMLElement) {
    if (!draggingId) return;
    const existing = timetable.events.find((event) => event.id === draggingId);
    if (!existing || existing.locked || existing.sourceRef) return;
    const bounds = target.getBoundingClientRect();
    const minutes = Math.max(
      view.startHour * 60,
      Math.min(
        view.endHour * 60 - 15,
        view.startHour * 60 +
          Math.round((((clientY - bounds.top) / HOUR_HEIGHT) * 60) / 15) * 15,
      ),
    );
    const duration =
      new Date(existing.end).getTime() - new Date(existing.start).getTime();
    const start = instantForDay(day, minutes);
    emit((draft) => {
      const event = draft.events.find(
        (candidate) => candidate.id === draggingId,
      );
      if (!event) return;
      event.start = start.toISOString();
      event.end = new Date(start.getTime() + duration).toISOString();
      event.provenance = { actor: "user" };
    });
    setDraggingId(undefined);
  }

  async function importFile(file: File) {
    setImportError(undefined);
    setImportReport(undefined);
    const layer = timetable.layers.find(
      (candidate) =>
        !privateLayerIds.has(candidate.id) &&
        candidate.visible &&
        !candidate.locked &&
        candidate.authority !== "external" &&
        candidate.authority !== "school",
    );
    if (!layer) {
      setImportError("Unlock a visible calendar before importing.");
      return;
    }
    setImportBusy("Retaining the original calendar");
    let jobId: string | undefined;
    let originalRetained = false;
    try {
      if (!file.size || file.size > 20 * 1024 * 1024)
        throw new Error("Calendar import must be between 1 byte and 20 MB.");
      const format = file.name.split(".").at(-1)?.toLowerCase() || "unknown";
      const beginning = await beginArtifactImportOriginal({
        artifactId,
        typeKey: "timetable",
        format,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        sha256: await sha256Blob(file),
      });
      jobId = beginning.jobId;
      try {
        await uploadArtifactImportOriginal(jobId, file);
        originalRetained = true;
      } catch (error) {
        await abortArtifactImportUpload(
          jobId,
          error instanceof Error ? error.message : "Original upload failed.",
        ).catch(() => undefined);
        throw error;
      }
      setImportBusy("Checking events, recurrence, and duplicates");
      const report = await importTimetableFile(file, layer.id);
      const existingKeys = new Set(
        timetable.events.map(
          (event) => `${event.start}|${event.title.trim().toLowerCase()}`,
        ),
      );
      const unique = report.events.filter(
        (event) =>
          !existingKeys.has(
            `${event.start}|${event.title.trim().toLowerCase()}`,
          ),
      );
      const warnings =
        unique.length < report.events.length
          ? [...report.warnings, "Duplicate events were left unchanged."]
          : report.warnings;
      const importedContent = clone(timetable);
      importedContent.events.push(...unique);
      const importedSharedContent =
        partitionTimetableState(importedContent).shared;
      await completeArtifactImport({
        jobId,
        typeKey: "timetable",
        status: "imported",
        fidelityReport: [
          {
            scope: format === "csv" ? "CSV event fields" : "Calendar events",
            level: warnings.length ? "adapted" : "exact",
            message: warnings.length
              ? warnings.join(" ")
              : "Supported event times, timezones, recurrence, descriptions, and locations were retained.",
          },
          {
            scope: "Duplicate protection",
            level: "exact",
            message: `${report.events.length - unique.length} existing event${report.events.length - unique.length === 1 ? " was" : "s were"} left unchanged.`,
          },
        ],
        unsupportedFeatures:
          format === "ics"
            ? [
                "external organizer authority",
                "attendee responses",
                "provider reminders",
              ]
            : [
                "organizers",
                "attendees",
                "provider reminders",
                "calendar permissions",
              ],
        importedContent: importedSharedContent,
      });
      emit((draft) => draft.events.push(...unique));
      setImportReport({
        ...report,
        imported: unique.length,
        skipped: report.skipped + report.events.length - unique.length,
        warnings,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The calendar could not be imported.";
      if (jobId && originalRetained)
        await completeArtifactImport({
          jobId,
          typeKey: "timetable",
          status: "quarantined",
          fidelityReport: [
            {
              scope: "Calendar safety and conversion",
              level: "unsupported",
              message,
            },
          ],
          unsupportedFeatures: ["Malformed or unsupported calendar content"],
          quarantineReason: message,
        }).catch(() => undefined);
      setImportError(
        `${message} The original is retained when upload succeeded and the live timetable was left unchanged.`,
      );
    } finally {
      setImportBusy(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const linkedArtifacts = Array.from(
    new Set(visibleEvents.flatMap((event) => event.artifactIds ?? [])),
  )
    .map((id) => artifactMap.get(id))
    .filter((artifact): artifact is SpectraArtifact => Boolean(artifact));
  const upcoming = expandTimetableEvents(
    baseVisibleEvents,
    new Date(nowMs - DAY_MS),
    new Date(nowMs + 366 * DAY_MS),
    timetable.timezone,
  )
    .filter((event) => new Date(event.end).getTime() >= nowMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 4);
  const studyMinutes = timetableFocusMinutes(visibleEvents, timetable.layers);
  /**
   * Canonical pointer for an event, resolved against the shared content so the
   * pointer matches the one the AI pipeline and history use. Falls back to the
   * merged list for events that exist only in a personal overlay.
   */
  const eventPath = (eventId: string) => {
    const sharedIndex = sharedTimetable.events.findIndex(
      (item) => item.id === eventId,
    );
    if (sharedIndex >= 0) return `/events/${sharedIndex}`;
    const mergedIndex = timetable.events.findIndex(
      (item) => item.id === eventId,
    );
    return mergedIndex >= 0 ? `/events/${mergedIndex}` : `/events/${eventId}`;
  };

  const eventAiChanged = (eventId: string) => {
    if (!aiChangedPaths.length) return false;
    // Whole-create / catch-up shells use "/" (and occasionally bare "/events").
    // Do not use pathTouches("/events") here — that also matches "/events/0"
    // and would light every card during a single-event edit.
    if (
      aiChangedPaths.includes("/") ||
      aiChangedPaths.includes("/events")
    )
      return true;
    const sharedIndex = sharedTimetable.events.findIndex(
      (item) => item.id === eventId,
    );
    if (
      sharedIndex >= 0 &&
      pathTouches(aiChangedPaths, `/events/${sharedIndex}`)
    )
      return true;
    const mergedIndex = timetable.events.findIndex(
      (item) => item.id === eventId,
    );
    return (
      (mergedIndex >= 0 &&
        pathTouches(aiChangedPaths, `/events/${mergedIndex}`)) ||
      pathTouches(aiChangedPaths, `/events/${eventId}`)
    );
  };

  function renderWeekOrDay() {
    const timedEvents = visibleEvents.filter((event) => !event.allDay);
    const allDayEvents = visibleEvents.filter((event) => event.allDay);
    const height = (view.endHour - view.startHour) * HOUR_HEIGHT;
    return (
      <div
        className="timetable-week"
        style={{ "--day-count": days.length } as CSSProperties}
      >
        <div className="timetable-week-header">
          <span />
          {days.map((day) => (
            <button
              type="button"
              key={dateKey(day)}
              data-today={sameDay(day, timetableToday) || undefined}
              onClick={() => {
                userMovedAnchorRef.current = true;
                emit((draft) => {
                  draft.view!.kind = "day";
                  draft.view!.anchorDate = dateKey(day);
                });
              }}
            >
              <span>
                {day.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <strong>{day.getDate()}</strong>
            </button>
          ))}
        </div>
        <div className="timetable-all-day">
          <span>All day</span>
          {days.map((day) => (
            <div key={dateKey(day)}>
              {allDayEvents
                .filter((event) => eventSpansLocalDay(event, day))
                .map((event) => (
                  <EventCard
                    key={event.occurrenceKey}
                    event={event}
                    color={layerMap.get(event.layerId)?.color ?? "#7865ea"}
                    compact
                    readOnly={readOnly && !privateLayerIds.has(event.layerId)}
changed={eventAiChanged(event.id)}

path={eventPath(event.id)}
                    onSelect={() => selectEvent(event)}
                  />
                ))}
            </div>
          ))}
        </div>
        <div className="timetable-time-grid">
          <div className="timetable-hours" style={{ height }}>
            {Array.from(
              { length: view.endHour - view.startHour + 1 },
              (_, index) => (
                <time key={index} style={{ top: index * HOUR_HEIGHT }}>
                  {String(view.startHour + index).padStart(2, "0")}:00
                </time>
              ),
            )}
          </div>
          {days.map((day) => (
            <div
              key={dateKey(day)}
              className="timetable-day-column"
              style={{ height }}
              onDoubleClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const minutes =
                  view.startHour * 60 +
                  Math.round(((event.clientY - bounds.top) / HOUR_HEIGHT) * 4) *
                    15;
                addEvent(instantForDay(day, minutes));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) =>
                dropEvent(day, event.clientY, event.currentTarget)
              }
            >
              {Array.from(
                { length: view.endHour - view.startHour },
                (_, index) => (
                  <i key={index} style={{ top: index * HOUR_HEIGHT }} />
                ),
              )}
              {timedEvents
                .filter(
                  (event) =>
                    localDateInput(event.start, event.timezone).slice(0, 10) ===
                    dateKey(day),
                )
                .map((event) => {
                  const timing = eventMinutes(event);
                  const collision = eventCollisionLayout.get(
                    event.occurrenceKey,
                  ) ?? { lane: 0, lanes: 1, conflict: false };
                  const top =
                    ((timing.start - view.startHour * 60) / 60) * HOUR_HEIGHT;
                  const eventHeight = Math.max(
                    25,
                    (timing.duration / 60) * HOUR_HEIGHT,
                  );
                  return (
                    <div
                      key={event.occurrenceKey}
                      className="timetable-event-position"
                      style={{
                        top,
                        height: eventHeight,
                        left: `calc(${(collision.lane / collision.lanes) * 100}% + 4px)`,
                        right: "auto",
                        width: `calc(${100 / collision.lanes}% - 8px)`,
                      }}
                    >
                      <EventCard
                        event={event}
                        color={layerMap.get(event.layerId)?.color ?? "#7865ea"}
                        compact={eventHeight < 48}
                        readOnly={
                          readOnly && !privateLayerIds.has(event.layerId)
                        }
changed={eventAiChanged(event.id)}

path={eventPath(event.id)}
                        conflict={collision.conflict}
                        onSelect={() => selectEvent(event)}
                        onDragStart={(interaction) => {
                          interaction.dataTransfer.effectAllowed = "move";
                          interaction.dataTransfer.setData(
                            "text/plain",
                            event.id,
                          );
                          setDraggingId(event.id);
                        }}
                      />
                    </div>
                  );
                })}
              {timetableToday && sameDay(day, timetableToday) ? (
                <div
                  className="timetable-now"
                  style={{
                    top:
                      ((timetableNowMinutes - view.startHour * 60) / 60) *
                      HOUR_HEIGHT,
                  }}
                >
                  <span suppressHydrationWarning>{`${nowHour}:${nowMinute}`}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderMonth() {
    return (
      <div className="timetable-month">
        {Array.from({ length: 7 }, (_, index) => (
          <strong key={index}>
            {addDays(
              startOfWeek(new Date(), view.weekStartsOn),
              index,
            ).toLocaleDateString("en-US", { weekday: "short" })}
          </strong>
        ))}
        {days.map((day) => {
          const events = visibleEvents
            .filter((event) => eventSpansLocalDay(event, day))
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
          return (
            <section
              key={dateKey(day)}
              data-outside={day.getMonth() !== anchor.getMonth() || undefined}
              data-today={sameDay(day, timetableToday) || undefined}
              onDoubleClick={() => {
                addEvent(instantForDay(day, 9 * 60));
              }}
            >
              <button
                type="button"
                onClick={() => {
                  userMovedAnchorRef.current = true;
                  emit((draft) => {
                    draft.view!.kind = "day";
                    draft.view!.anchorDate = dateKey(day);
                  });
                }}
              >
                {day.getDate()}
              </button>
              {events.slice(0, 4).map((event) => (
                <EventCard
                  key={event.occurrenceKey}
                  event={event}
                  color={layerMap.get(event.layerId)?.color ?? "#7865ea"}
                  compact
                  readOnly={readOnly && !privateLayerIds.has(event.layerId)}
changed={eventAiChanged(event.id)}

path={eventPath(event.id)}
                  conflict={
                    eventCollisionLayout.get(event.occurrenceKey)?.conflict
                  }
                  onSelect={() => selectEvent(event)}
                />
              ))}
              {events.length > 4 ? (
                <small>+{events.length - 4} more</small>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }

  function renderAgenda() {
    const agenda = [...visibleEvents]
      .filter((event) => Date.parse(event.end) >= anchor.getTime() - DAY_MS)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const grouped = agenda.reduce((groups, event) => {
      const key = localDateInput(event.start, event.timezone).slice(0, 10);
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
      return groups;
    }, new Map<string, TimetableOccurrence[]>());
    return (
      <div
        className="timetable-agenda"
        role="list"
        aria-label="Calendar agenda"
      >
        {[...grouped.entries()].map(([date, events]) => (
          <section key={date}>
            <header>
              <strong>
                {parseDateKey(date).toLocaleDateString("en-US", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </strong>
              <span>{events.length} events</span>
            </header>
            {events.map((event) => (
              <button
                key={event.occurrenceKey}
                type="button"
                role="listitem"
                onClick={() => selectEvent(event)}
                data-ai-region={aiRegionAttr(eventAiChanged(event.id))}
                {...targetAttrs(eventPath(event.id))}
              >
                <i
                  style={{
                    background: layerMap.get(event.layerId)?.color ?? "#7865ea",
                  }}
                />
                <time suppressHydrationWarning>
                  {event.allDay
                    ? "All day"
                    : new Date(event.start).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                        timeZone: event.timezone,
                      })}
                </time>
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {layerMap.get(event.layerId)?.name}
                    {event.location ? ` · ${event.location}` : ""}
                  </small>
                </span>
                {event.sourceRef ? <Lock className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </section>
        ))}
        {!agenda.length ? (
          <div className="timetable-empty">
            <CalendarDays className="h-6 w-6" />
            <strong>No upcoming events</strong>
            <span>
              Add time or ask Spectra to create a balanced study plan.
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="timetable-studio">
      <input
        ref={fileInputRef}
        type="file"
        accept=".ics,.csv,text/calendar,text/csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <header className="timetable-toolbar">
        <div className="timetable-date-navigation">
          <button
            type="button"
            onClick={() => {
              userMovedAnchorRef.current = true;
              emit((draft) => {
                draft.view!.anchorDate = dateKey(new Date());
              });
            }}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous range"
            onClick={() => moveAnchor(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next range"
            onClick={() => moveAnchor(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <strong>{formatDateRange(days, view.kind)}</strong>
        </div>
        <div className="timetable-toolbar-actions">
          <label>
            <span className="sr-only">Calendar view</span>
            <select
              value={view.kind}
              onChange={(event) =>
                updateView(event.target.value as TimetableView)
              }
            >
              <option value="week">Week</option>
              <option value="day">Day</option>
              <option value="month">Month</option>
              <option value="agenda">Agenda</option>
            </select>
            <ChevronDown className="h-3.5 w-3.5" />
          </label>
          <button
            type="button"
            className="timetable-calendars-trigger"
            data-active={layersOpen || undefined}
            onClick={() => setLayersOpen(!layersOpen)}
          >
            All calendars <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="timetable-add-trigger"
            disabled={!personalReady}
            onClick={() => setAddOpen(!addOpen)}
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </header>
      {!personalReady || personalSaveState !== "idle" || personalError ? (
        <div
          className="timetable-personal-sync"
          data-error={personalSaveState === "error" || undefined}
          role={personalError ? "alert" : "status"}
        >
          {personalSaveState === "saving" || !personalReady ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : personalSaveState === "error" ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span>
            {personalError ??
              (!personalReady
                ? "Loading your private calendar layer"
                : personalSaveState === "saving"
                  ? "Synchronizing your private calendar changes"
                  : "Private calendar changes synchronized")}
          </span>
        </div>
      ) : null}

      {layersOpen ? (
        <aside className="timetable-layers-popover">
          <header>
            <strong>Calendars</strong>
            <button type="button" onClick={() => setLayersOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </header>
          {timetable.layers.map((layer) => (
            <label key={layer.id}>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() =>
                  emit((draft) => {
                    const found = draft.layers.find(
                      (candidate) => candidate.id === layer.id,
                    );
                    if (found) found.visible = !found.visible;
                  })
                }
              />
              <i style={{ background: layer.color }} />
              <span>
                <strong>{layer.name}</strong>
                <small>
                  {layer.authority || layer.kind}
                  {layer.private ? " · private" : ""}
                </small>
              </span>
              {layer.locked ? <Lock className="h-3.5 w-3.5" /> : null}
            </label>
          ))}
          <button
            type="button"
            disabled={!personalReady}
            onClick={() =>
              emit((draft) =>
                draft.layers.push({
                  id: `layer-${Date.now().toString(36)}`,
                  name: `Calendar ${draft.layers.length + 1}`,
                  kind: "personal",
                  visible: true,
                  color: "#4a91de",
                  authority: "user",
                  private: true,
                }),
              )
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add calendar
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={() =>
                emit((draft) =>
                  draft.layers.push({
                    id: `shared-layer-${Date.now().toString(36)}`,
                    name: `Shared calendar ${draft.layers.filter((layer) => !privateLayerIds.has(layer.id)).length + 1}`,
                    kind: "class",
                    visible: true,
                    color: "#26a879",
                    authority: "workspace",
                  }),
                )
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add shared calendar
            </button>
          ) : null}
        </aside>
      ) : null}

      {addOpen ? (
        <aside className="timetable-add-popover">
          <button type="button" onClick={() => addEvent(new Date())}>
            <CalendarDays className="h-4 w-4" />
            <span>
              <strong>Event</strong>
              <small>Class, meeting, or personal time</small>
            </span>
          </button>
          {!readOnly ? (
            <button type="button" onClick={() => addSharedEvent(new Date())}>
              <CalendarDays className="h-4 w-4" />
              <span>
                <strong>Shared event</strong>
                <small>Visible to people with access to this timetable</small>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const start = new Date();
              start.setMinutes(0, 0, 0);
              const layer = timetable.layers.find(
                (candidate) => candidate.kind === "study",
              );
              const event = createTimetableEvent(
                layer?.id ?? timetable.layers[0]!.id,
                start,
                90,
              );
              event.title = "Study block";
              emit((draft) => draft.events.push(event));
              setSelectedEventId(event.id);
              setAddOpen(false);
            }}
          >
            <Clock3 className="h-4 w-4" />
            <span>
              <strong>Study block</strong>
              <small>Focused time linked to learning work</small>
            </span>
          </button>
          <button
            type="button"
            disabled={readOnly || Boolean(importBusy)}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
            <span>
              <strong>Import calendar</strong>
              <small>ICS or CSV with duplicate protection</small>
            </span>
          </button>
        </aside>
      ) : null}

      {importBusy ? (
        <div className="timetable-import-report" role="status">
          <div>
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            <span>
              <strong>Importing calendar</strong>
              <small>{importBusy}</small>
            </span>
          </div>
        </div>
      ) : null}

      {importError || importReport ? (
        <aside
          className="timetable-import-report"
          data-error={Boolean(importError) || undefined}
          role="status"
        >
          <div>
            {importError ? (
              <X className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            <span>
              <strong>
                {importError ? "Import quarantined" : "Import complete"}
              </strong>
              <small>
                {importError ||
                  `${importReport!.imported} added · ${importReport!.skipped} unchanged or skipped`}
              </small>
            </span>
            <button
              type="button"
              onClick={() => {
                setImportError(undefined);
                setImportReport(undefined);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {importReport?.warnings.length ? (
            <ul>
              {importReport.warnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}

      <div className="timetable-body">
        <main>
          {view.kind === "week" || view.kind === "day"
            ? renderWeekOrDay()
            : view.kind === "month"
              ? renderMonth()
              : renderAgenda()}
          {linkedArtifacts.length ? (
            <section className="timetable-linked-work">
              <header>
                <strong>Linked work</strong>
                <span>{linkedArtifacts.length} linked work items</span>
              </header>
              <div>
                {linkedArtifacts.slice(0, 6).map((artifact) => (
                  <button
                    key={artifact._id}
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("spectra:open-artifact", {
                          detail: { artifactId: artifact._id },
                        }),
                      )
                    }
                  >
                    <Link2 className="h-4 w-4" />
                    <span>
                      <strong>{artifact.title}</strong>
                      <small>
                        {artifact.blueprintKey.replaceAll("_", " ")}
                      </small>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="timetable-overview">
          <section>
            <header>
              <strong>Upcoming</strong>
              <List className="h-4 w-4" />
            </header>
            {upcoming.map((event) => (
              <button
                key={event.occurrenceKey}
                type="button"
                onClick={() => selectEvent(event)}
              >
                <i style={{ background: layerMap.get(event.layerId)?.color }} />
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {parseDateKey(
                      localDateInput(event.start, event.timezone).slice(0, 10),
                    ).toLocaleDateString("en-US", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </small>
                </span>
              </button>
            ))}
          </section>
          <section className="timetable-focus-progress">
            <header>
              <strong>Focus time</strong>
              <span>
                {Math.round(
                  (studyMinutes /
                    (timetable.preferences?.focusGoalMinutes || 720)) *
                    100,
                )}
                %
              </span>
            </header>
            <div>
              <i
                style={{
                  width: `${Math.min(100, (studyMinutes / (timetable.preferences?.focusGoalMinutes || 720)) * 100)}%`,
                }}
              />
            </div>
            <small>
              {Math.floor(studyMinutes / 60)}h {Math.round(studyMinutes % 60)}m
              scheduled
            </small>
          </section>
          <section className="timetable-export-actions">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={readOnly || Boolean(importBusy)}
            >
              <FileUp className="h-4 w-4" /> Import ICS or CSV
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  "spectra-timetable.ics",
                  "text/calendar;charset=utf-8",
                  exportTimetableIcs(baseVisibleEvents, "Spectra timetable"),
                )
              }
            >
              <Download className="h-4 w-4" /> Export visible calendar
            </button>
          </section>
        </aside>
      </div>

      {selectedEvent ? (
        <aside className="timetable-event-editor" aria-label="Event details">
          <header>
            <span>
              <i
                style={{
                  background: layerMap.get(selectedEvent.layerId)?.color,
                }}
              />
              <strong>
                {selectedEvent.sourceRef ? "Source event" : "Event details"}
              </strong>
            </span>
            <button type="button" onClick={() => setSelectedEventId(undefined)}>
              <X className="h-4 w-4" />
            </button>
          </header>
          {selectedEvent.sourceStatus === "changed" ||
          selectedEvent.sourceStatus === "removed" ? (
            <div className="timetable-source-warning">
              Source {selectedEvent.sourceStatus}. Your personal overlay remains
              preserved.
            </div>
          ) : null}
          <label>
            Title
            <input
              value={selectedEvent.title}
              disabled={!selectedCanEditBase}
              onChange={(event) =>
                updateSelected((candidate) => {
                  candidate.title = event.target.value;
                })
              }
            />
          </label>
          <div className="timetable-event-date-fields">
            <label>
              Starts
              <input
                type="datetime-local"
                value={localDateInput(selectedEvent.start, timetable.timezone)}
                disabled={!selectedCanEditBase}
                onInput={(event) =>
                  updateSelected((candidate) => {
                    const duration =
                      Date.parse(candidate.end) - Date.parse(candidate.start);
                    candidate.start = inputToIso(
                      event.currentTarget.value,
                      timetable.timezone,
                    );
                    candidate.end = new Date(
                      Date.parse(candidate.start) + duration,
                    ).toISOString();
                  })
                }
              />
            </label>
            <label>
              Ends
              <input
                type="datetime-local"
                value={localDateInput(selectedEvent.end, timetable.timezone)}
                disabled={!selectedCanEditBase}
                min={localDateInput(selectedEvent.start, timetable.timezone)}
                onInput={(event) =>
                  updateSelected((candidate) => {
                    const next = inputToIso(
                      event.currentTarget.value,
                      timetable.timezone,
                    );
                    if (Date.parse(next) > Date.parse(candidate.start))
                      candidate.end = next;
                  })
                }
              />
            </label>
          </div>
          <label className="timetable-check-field">
            <input
              type="checkbox"
              checked={selectedEvent.allDay}
              disabled={!selectedCanEditBase}
              onChange={() =>
                updateSelected((candidate) => {
                  candidate.allDay = !candidate.allDay;
                })
              }
            />
            All-day event
          </label>
          <label>
            Calendar
            <select
              value={selectedEvent.layerId}
              disabled={!selectedCanEditBase}
              onChange={(event) =>
                updateSelected((candidate) => {
                  candidate.layerId = event.target.value;
                })
              }
            >
              {timetable.layers.map((layer) => (
                <option key={layer.id} value={layer.id} disabled={layer.locked}>
                  {layer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <MapPin className="h-3.5 w-3.5" /> Location or video
            <input
              value={selectedEvent.location ?? ""}
              disabled={!selectedCanEditBase}
              onChange={(event) =>
                updateSelected((candidate) => {
                  candidate.location = event.target.value;
                })
              }
            />
          </label>
          <label>
            Recurrence
            <select
              value={selectedEvent.recurrence ?? ""}
              disabled={!selectedCanEditBase}
              onChange={(event) =>
                updateSelected((candidate) => {
                  candidate.recurrence = event.target.value || undefined;
                })
              }
            >
              <option value="">Does not repeat</option>
              <option value="FREQ=DAILY">Daily</option>
              <option value="FREQ=WEEKLY">Weekly</option>
              <option value="FREQ=MONTHLY">Monthly</option>
            </select>
          </label>
          <div className="timetable-event-date-fields">
            <label>
              Show as
              <select
                value={selectedEvent.availability ?? "busy"}
                disabled={!selectedCanEditBase}
                onChange={(event) =>
                  updateSelected((candidate) => {
                    candidate.availability = event.target.value as
                      "busy" | "free";
                  })
                }
              >
                <option value="busy">Busy</option>
                <option value="free">Free</option>
              </select>
            </label>
            <label>
              Reminder
              <select
                value={
                  selectedIsPersonal
                    ? (selectedEvent.reminders?.[0]?.minutesBefore ?? -1)
                    : (selectedEvent.overlay?.reminderMinutes ?? -1)
                }
                disabled={!selectedCanPersonalize}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  updateSelected((candidate) => {
                    if (!selectedIsPersonal) {
                      candidate.overlay = {
                        ...candidate.overlay,
                        reminderMinutes: minutes >= 0 ? minutes : undefined,
                      };
                    } else {
                      candidate.reminders =
                        minutes >= 0
                          ? [
                              {
                                id:
                                  candidate.reminders?.[0]?.id ??
                                  `reminder-${crypto.randomUUID()}`,
                                minutesBefore: minutes,
                                method: "in_app",
                              },
                            ]
                          : [];
                    }
                  });
                }}
              >
                <option value={-1}>None</option>
                <option value={0}>At start time</option>
                <option value={5}>5 minutes before</option>
                <option value={10}>10 minutes before</option>
                <option value={15}>15 minutes before</option>
                <option value={30}>30 minutes before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </select>
            </label>
          </div>
          <label className="timetable-color-field">
            Personal event colour
            <span>
              <input
                type="color"
                value={
                  selectedEvent.overlay?.color ||
                  layerMap.get(selectedEvent.layerId)?.color ||
                  "#4a91de"
                }
                disabled={!selectedCanPersonalize}
                onChange={(event) =>
                  updateSelected((candidate) => {
                    candidate.overlay = {
                      ...candidate.overlay,
                      color: event.target.value,
                    };
                  })
                }
              />
              <button
                type="button"
                disabled={
                  !selectedCanPersonalize || !selectedEvent.overlay?.color
                }
                onClick={() =>
                  updateSelected((candidate) => {
                    if (!candidate.overlay) return;
                    delete candidate.overlay.color;
                  })
                }
              >
                Use calendar colour
              </button>
            </span>
          </label>
          <label className="timetable-check-field">
            <input
              type="checkbox"
              checked={selectedEvent.overlay?.hidden === true}
              disabled={!selectedCanPersonalize}
              onChange={() =>
                updateSelected((candidate) => {
                  candidate.overlay = {
                    ...candidate.overlay,
                    hidden: !candidate.overlay?.hidden,
                  };
                })
              }
            />
            Hide this event from my view
          </label>
          {!selectedIsPersonal ? (
            <section className="timetable-source-overlay-time">
              <label className="timetable-check-field">
                <input
                  type="checkbox"
                  checked={Boolean(selectedEvent.overlay?.alternativeStart)}
                  disabled={!selectedCanEditOverlay}
                  onChange={() =>
                    updateSelected((candidate) => {
                      const enabled = Boolean(
                        candidate.overlay?.alternativeStart,
                      );
                      candidate.overlay = {
                        ...candidate.overlay,
                        alternativeStart: enabled ? undefined : candidate.start,
                        alternativeEnd: enabled ? undefined : candidate.end,
                      };
                    })
                  }
                />
                Show at an alternative time in my view
              </label>
              {selectedEvent.overlay?.alternativeStart ? (
                <div className="timetable-event-date-fields">
                  <label>
                    Personal start
                    <input
                      type="datetime-local"
                      value={localDateInput(
                        selectedEvent.overlay.alternativeStart,
                        timetable.timezone,
                      )}
                      disabled={!selectedCanEditOverlay}
                      onInput={(event) =>
                        updateSelected((candidate) => {
                          const duration =
                            Date.parse(
                              candidate.overlay?.alternativeEnd ??
                                candidate.end,
                            ) -
                            Date.parse(
                              candidate.overlay?.alternativeStart ??
                                candidate.start,
                            );
                          const nextStart = inputToIso(
                            event.currentTarget.value,
                            timetable.timezone,
                          );
                          candidate.overlay = {
                            ...candidate.overlay,
                            alternativeStart: nextStart,
                            alternativeEnd: new Date(
                              Date.parse(nextStart) + duration,
                            ).toISOString(),
                          };
                        })
                      }
                    />
                  </label>
                  <label>
                    Personal end
                    <input
                      type="datetime-local"
                      value={localDateInput(
                        selectedEvent.overlay.alternativeEnd ??
                          selectedEvent.end,
                        timetable.timezone,
                      )}
                      min={localDateInput(
                        selectedEvent.overlay.alternativeStart,
                        timetable.timezone,
                      )}
                      disabled={!selectedCanEditOverlay}
                      onInput={(event) =>
                        updateSelected((candidate) => {
                          const nextEnd = inputToIso(
                            event.currentTarget.value,
                            timetable.timezone,
                          );
                          if (
                            Date.parse(nextEnd) >
                            Date.parse(
                              candidate.overlay?.alternativeStart ??
                                candidate.start,
                            )
                          )
                            candidate.overlay = {
                              ...candidate.overlay,
                              alternativeEnd: nextEnd,
                            };
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
              <p>
                The school or external source time remains unchanged. Only your
                personal overlay moves.
              </p>
            </section>
          ) : null}
          <label>
            Notes / personal overlay
            <textarea
              value={
                selectedIsPersonal
                  ? (selectedEvent.notes ?? "")
                  : (selectedEvent.overlay?.note ?? "")
              }
              disabled={!selectedCanPersonalize}
              onChange={(event) =>
                updateSelected((candidate) => {
                  if (!selectedIsPersonal) {
                    candidate.overlay = {
                      ...candidate.overlay,
                      note: event.target.value,
                    };
                  } else candidate.notes = event.target.value;
                })
              }
            />
          </label>
          <label>
            Linked artifacts
            <select
              value=""
              disabled={!selectedCanEditBase}
              onChange={(event) => {
                const artifactId = event.target.value;
                if (!artifactId) return;
                updateSelected((candidate) => {
                  candidate.artifactIds = Array.from(
                    new Set([...(candidate.artifactIds ?? []), artifactId]),
                  );
                });
              }}
            >
              <option value="">Link work…</option>
              {artifacts
                .filter(
                  (artifact) =>
                    artifact._id !== artifactId && artifact.status === "active",
                )
                .map((artifact) => (
                  <option key={artifact._id} value={artifact._id}>
                    {artifact.title}
                  </option>
                ))}
            </select>
          </label>
          {selectedEvent.artifactIds?.length ? (
            <div className="timetable-event-links">
              {selectedEvent.artifactIds.map((id) => (
                <span key={id}>
                  <Link2 className="h-3.5 w-3.5" />
                  {artifactMap.get(id)?.title ?? "Access unavailable"}
                  {selectedCanEditBase ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateSelected((candidate) => {
                          candidate.artifactIds = candidate.artifactIds?.filter(
                            (artifactId) => artifactId !== id,
                          );
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
          {selectedCanEditBase ? (
            <button
              type="button"
              className="timetable-delete-event"
              onClick={() => {
                emit((draft) => {
                  draft.events = draft.events.filter(
                    (event) => event.id !== selectedEvent.id,
                  );
                });
                setSelectedEventId(undefined);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete event
            </button>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
