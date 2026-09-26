import { noteAiLocation, noteAiSurface } from "./follow-ai";
import { spectraBus } from "../events";
import { handleSettingsObservationEvent } from "./settings-observation-client";

export type SpectraAiUiEvent = {
  key: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

/** Remember only canonical artifact effects. operation_preview names a pending
 * shell that public artifact reads cannot open yet; following that id causes
 * a 403 loop while the real saved result is still being prepared. */
export function rememberCommittedArtifactResult(event: {
  runId: string;
  affected: Array<{ type: string; id: string }>;
}): void {
  const artifactId = [...event.affected]
    .reverse()
    .find((item) => item.type === "artifact" && item.id.trim())?.id;
  if (!artifactId) return;
  noteAiLocation({ actorId: event.runId, artifactId });
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
    const targetId = event.payload?.targetId;
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: typeof targetId === "string" && targetId ? targetId : "preferences",
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
    if (typeof hostWorkId !== "string" || typeof targetWorkId !== "string") return;
    const receipt = event.payload?.receipt;
    const saved = receipt && typeof receipt === "object"
      ? receipt as Record<string, unknown> : undefined;
    const canonical = saved?.phase === "canonical_write" && typeof saved.versionId === "string" &&
      typeof saved.operationId === "string" && typeof saved.embedId === "string";
    const message = canonical ? "Live reference saved" : "Waiting for the reference's saved version";
    // UI events may replay after reload. The journal already performed the
    // insertion; never invoke the mounted editor's mutation a second time.
    spectraBus.emit("ai.ui.referenceReceipt", {
      ...(event.runId ? { runId: event.runId } : {}), hostWorkId, targetWorkId,
      phase: canonical ? "canonical_write" : "queued_refresh", message, ok: Boolean(canonical),
    });
    noteAiLocation({ ...(event.runId ? { actorId: event.runId } : {}), artifactId: hostWorkId, note: message });
    return;
  }
  if (event.key === "comment_added") {
    const artifactId = event.payload?.targetId;
    if (typeof artifactId !== "string" || !artifactId) return;
    const regionId = event.payload?.regionId;
    noteAiLocation({
      ...(event.runId ? { actorId: event.runId } : {}),
      artifactId,
      ...(typeof regionId === "string" && regionId
        ? { path: `/comments/${regionId}` }
        : {}),
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Added an AI comment",
    });
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

/** Remember durable outcomes without replaying actions that already happened.
 * Non-followed actors update location without moving the user. Prepared local
 * performances use app-choreography-host before execution, never this feed. */
export function handleSpectraAiUiEvent(event: SpectraAiUiEvent): void {
  if (handleSettingsObservationEvent(event)) return;
  rememberEvent(event);
}
