import { noteAiLocation, noteAiSurface } from "./follow-ai";
import { isFollowRoute } from "./follow-navigation";
import { spectraBus } from "../events";
import { handleSettingsObservationEvent } from "./settings-observation-client";
import { DEVICES_HREF } from "../bridge/client";
import { runAiDeviceAction } from "../devices/device-actions";
import { devicePairing } from "../devices/pairing";
import { postSpectra } from "../data/api";
import { toast } from "@/components/ui/toast";

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

const SHOWN_LINKS_KEY = "spectra.ai.shownPublicLinks";

/** True the first time this computer shows a link's notice: run events replay
 * after a reload and reach every tab watching the run. */
function claimPublicLinkNotice(operationId: string): boolean {
  try {
    const shown = JSON.parse(window.localStorage.getItem(SHOWN_LINKS_KEY) ?? "[]") as unknown;
    const list = Array.isArray(shown) ? shown.filter((id): id is string => typeof id === "string") : [];
    if (list.includes(operationId)) return false;
    window.localStorage.setItem(SHOWN_LINKS_KEY, JSON.stringify([...list, operationId].slice(-50)));
    return true;
  } catch {
    return true;
  }
}

/** A public link Spectra made: its address reaches the user alone, fetched
 * from the server with their own session, never through the run's events. */
async function showAiPublicLink(runId: string, operationId: string) {
  if (!claimPublicLinkNotice(operationId)) return;
  let url: string;
  try {
    url = new URL((await postSpectra<{ url: string }>({ action: "revealAiPublicLink", runId, operationId })).url, window.location.origin).toString();
  } catch {
    return; // Turned off or expired since; Share shows what is on.
  }
  toast.success("Spectra made a public link", {
    id: `ai-public-link:${operationId}`,
    description: "Anyone with the link can view this work. Turn it off any time in Share.",
    duration: Infinity,
    closeButton: true,
    action: {
      label: "Copy link",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Link copied.");
        } catch {
          toast.error("Could not copy the link. Open Share to make a new one.");
        }
      },
    },
  });
}

function rememberEvent(event: SpectraAiUiEvent): void {
  if (event.key === "public_link_created") {
    const operationId = event.payload?.operationId;
    const targetId = event.payload?.targetId;
    if (event.runId && typeof operationId === "string" && operationId) void showAiPublicLink(event.runId, operationId);
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "settings",
      target: "sharing",
      note: typeof targetId === "string" && targetId ? "Made a public link" : "Updated sharing",
    });
    return;
  }
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
  if (event.key === "devices_action") {
    const payload = event.payload ?? {};
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const action = text(payload.action);
    if (!action) return;
    const actorId = event.runId;
    const note = text(payload.note) ?? "Working on your devices";
    void runAiDeviceAction(
      { action, actionId: text(payload.actionId), grantId: text(payload.grantId), deviceId: text(payload.deviceId) },
      (connect) => {
        if (!connect) {
          noteAiSurface({ ...(actorId ? { actorId } : {}), route: "devices", note });
          return;
        }
        // The user approved connecting this computer: show Devices, which
        // starts pairing, whether or not they follow Spectra.
        devicePairing().want();
        if (window.location.pathname.startsWith(DEVICES_HREF)) return;
        // The app shell's navigator moves there with the client router.
        spectraBus.command("navigation.show", { route: "devices", intent: "explicit", target: "connect" });
      },
    );
    return;
  }
  if (event.key === "devices_changed") {
    spectraBus.emit("devices.changed", {});
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: "devices",
      note: typeof event.payload?.note === "string" ? event.payload.note : "Updated your devices",
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
  if (event.key === "managebac_sync_preferences" || event.key === "managebac_class_workspaces") {
    // What syncs is set on the School page; class workspaces live in the library.
    noteAiSurface({
      ...(event.runId ? { actorId: event.runId } : {}),
      route: event.key === "managebac_sync_preferences" ? "school" : "library",
      note:
        typeof event.payload?.note === "string"
          ? event.payload.note
          : "Updating your school sync",
    });
    return;
  }
  if (event.key === "version_saved" || event.key === "version_restored") {
    const artifactId = event.payload?.targetId;
    if (typeof artifactId !== "string" || !artifactId) return;
    noteAiLocation({
      ...(event.runId ? { actorId: event.runId } : {}),
      artifactId,
      note: typeof event.payload?.note === "string" ? event.payload.note : "Saved a version",
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
  if (event.key === "runtime_published") {
    const artifactId = event.payload?.targetId;
    if (typeof artifactId !== "string" || !artifactId) return;
    spectraBus.emit("code.publishedChanged", { artifactId });
    noteAiLocation({
      ...(event.runId ? { actorId: event.runId } : {}),
      artifactId,
      note: typeof event.payload?.note === "string" ? event.payload.note : "Published the live build",
    });
    return;
  }
  if (event.key === "comment_changed" || event.key === "embed_changed") {
    const artifactId = event.payload?.targetId;
    if (typeof artifactId !== "string" || !artifactId) return;
    noteAiLocation({
      ...(event.runId ? { actorId: event.runId } : {}),
      artifactId,
      note: typeof event.payload?.note === "string" ? event.payload.note : "Changed a comment",
    });
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
      note: "Opening the requested work",
    });
    return;
  }
  if (!isFollowRoute(destination) || destination === "artifact") return;
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
