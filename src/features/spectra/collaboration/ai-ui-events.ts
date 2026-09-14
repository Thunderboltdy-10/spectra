import { noteAiLocation, noteAiSurface } from "./follow-ai";
import { performAppUiEvent } from "./app-choreography-host";
import { spectraBus } from "../events";

export type SpectraAiUiEvent = {
  key: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

const ARTIFACT_TYPE_KEYS = [
  "document",
  "code",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "agent",
  "presentation",
  "sheets",
  "whiteboard",
  "timetable",
] as const;

function isArtifactTypeKey(value: unknown): value is (typeof ARTIFACT_TYPE_KEYS)[number] {
  return typeof value === "string" && (ARTIFACT_TYPE_KEYS as readonly string[]).includes(value);
}

function rememberEvent(event: SpectraAiUiEvent): void {
  if (event.key === "organize_library") {
    const targetId = event.payload?.targetId;
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "library",
      ...(typeof targetId === "string" && targetId ? { target: targetId } : {}),
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updating the Library",
    });
    return;
  }
  if (event.key === "settings_changed") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "preferences",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updating Spectra settings",
    });
    return;
  }
  if (event.key === "sync_policy_changed") {
    const targetId = event.payload?.targetId;
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "library",
      ...(typeof targetId === "string" && targetId ? { target: targetId } : {}),
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updating sync policy",
    });
    return;
  }
  if (event.key === "memory_written") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "memory",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updated memory",
    });
    return;
  }
  if (event.key === "sharing_changed") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "sharing",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updated sharing",
    });
    return;
  }
  if (event.key === "managebac_sync_requested") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "managebac",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Requested a ManageBac refresh",
    });
    return;
  }
  if (event.key === "bridge_setup") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "devices",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Open Bridge settings to finish setup",
    });
    return;
  }
  if (event.key === "managebac_classes_selected") {
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "managebac",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updated ManageBac class selection",
    });
    return;
  }
  if (event.key === "calendar_changed") {
    const targetId = event.payload?.targetId;
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "calendar",
      ...(typeof targetId === "string" && targetId ? { target: targetId } : {}),
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updating Calendar",
    });
    return;
  }
  if (event.key === "reference_insert") {
    const hostWorkId = event.payload?.hostWorkId;
    const targetWorkId = event.payload?.targetWorkId;
    const emitReceipt = (input: {
      phase:
        | "queued_refresh"
        | "consent"
        | "viewport_ready"
        | "canonical_write"
        | "verified_native_write"
        | "failed"
        | "host_unmounted";
      message: string;
      ok: boolean;
    }) => {
      if (typeof hostWorkId !== "string" || !hostWorkId.trim()) return;
      if (typeof targetWorkId !== "string" || !targetWorkId.trim()) return;
      spectraBus.emit("ai.ui.referenceReceipt", {
        ...(event.runId ? { runId: event.runId } : {}),
        hostWorkId,
        targetWorkId,
        phase: input.phase,
        message: input.message,
        ok: input.ok,
      });
      noteAiLocation({
        ...(event.runId ? { actorId: event.runId } : {}),
        artifactId: hostWorkId,
        note: input.message,
      });
    };
    if (
      typeof hostWorkId === "string" &&
      hostWorkId.trim() &&
      typeof targetWorkId === "string" &&
      targetWorkId.trim()
    ) {
      emitReceipt({
        phase: "queued_refresh",
        message:
          typeof event.payload?.note === "string"
            ? event.payload.note
            : "Reference insert queued for the host surface",
        ok: false,
      });
      // Await the shared command path. Offscreen / unmounted hosts must emit a
      // durable failure receipt instead of looking like a successful needs-ui handoff.
      void spectraBus
        .commandAsyncResults("reference.insert", {
          hostWorkId,
          target: {
            workId: targetWorkId,
            workType: isArtifactTypeKey(event.payload?.targetWorkType)
              ? event.payload.targetWorkType
              : "document",
            kind: "work:root",
            path: ["work", "root"],
            stableIds: { workId: targetWorkId },
            ...(typeof event.payload?.fallbackExcerpt === "string"
              ? { fallbackExcerpt: event.payload.fallbackExcerpt }
              : {}),
            schemaVersion:
              typeof event.payload?.schemaVersion === "number"
                ? event.payload.schemaVersion
                : 1,
          },
        })
        .then((dispatched) => {
          const failed = dispatched.results.some(
            (result) =>
              Boolean(result) &&
              typeof result === "object" &&
              ((result as { ok?: unknown }).ok === false ||
                (result as { status?: unknown }).status === "failed"),
          );
          const verified = dispatched.results.some(
            (result) =>
              Boolean(result) &&
              typeof result === "object" &&
              ((result as { status?: unknown }).status === "completed" ||
                (result as { ok?: unknown }).ok === true),
          );
          if (dispatched.listeners === 0) {
            emitReceipt({
              phase: "host_unmounted",
              message:
                "Reference insert failed: no mounted host surface is listening.",
              ok: false,
            });
            return;
          }
          if (failed || !verified) {
            emitReceipt({
              phase: "failed",
              message: "Reference insert did not complete in the host surface",
              ok: false,
            });
            return;
          }
          emitReceipt({
            phase: "verified_native_write",
            message: "Reference insert verified in the host surface",
            ok: true,
          });
        })
        .catch(() => {
          emitReceipt({
            phase: "failed",
            message: "Reference insert failed before the host acknowledged it",
            ok: false,
          });
        });
    }
    return;
  }
  if (event.key !== "navigate" && event.key !== "navigate_spectra") return;
  const destination = event.payload?.destination;
  const targetId = event.payload?.targetId;
  if (destination === "artifact" && typeof targetId === "string" && targetId) {
    noteAiLocation({
      ...(event.runId ? { actorId: event.runId } : {}),
      artifactId: targetId,
      note: "Opening the requested artifact",
    });
    return;
  }
  if (
    destination !== "library" &&
    destination !== "calendar" &&
    destination !== "settings" &&
    destination !== "workspace"
  )
    return;
  noteAiSurface({
    ...(event.runId ? { actorId: event.runId } : {}),
    route: destination,
    ...(typeof targetId === "string" && targetId ? { target: targetId } : {}),
    note: `Opening ${destination}`,
  });
}

/** Convert durable semantic UI events into the single Follow AI controller
 * and the app choreography coordinator. Non-followed actors update remembered
 * location without moving the user. */
export function handleSpectraAiUiEvent(event: SpectraAiUiEvent): void {
  rememberEvent(event);
  if (event.runId) performAppUiEvent(event);
}
