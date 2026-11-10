import { runUndoSummary, type RunUndoCounts } from "../../../../../../shared/run-undo";
import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";
import { deviceUndoPlan, restoreDeviceVersion } from "@/lib/device-restore-server";
import { errorStatus } from "@/lib/route-handler";
import type { RunDetail } from "./contract";
import { mutate, query } from "./io";
import { publicError } from "./report";

export async function revertRun(actorClerkId: string, runId: string, expectedExecutionId: string,
  authorize?: (state: RunDetail, artifactIds: string[], onDevice: boolean) => Promise<Response | void>, requestingRunId?: string) {
    let state: RunDetail;
    try {
      state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actorClerkId, runId });
    } catch (error) {
      return new Response(publicError(error), { status: errorStatus(error) });
    }
    if (state.run.executionId !== expectedExecutionId)
      return new Response("This run attempt has changed. Reload before undoing it.", { status: 409 });
    const undone = state.cards.find((card) => card.actions.some((entry) => entry.key === "undone"));
    const priorReversal = undone?.provenance as { undoneByRunId?: string; undoneNotes?: string[] } | undefined;
    if (undone && requestingRunId && priorReversal?.undoneByRunId === requestingRunId)
      return Response.json({ changed: true, summary: undone.summary, notes: priorReversal.undoneNotes ?? [] });
    if (undone)
      return new Response("This run has already been undone.", { status: 409 });
    if (!["completed", "failed", "cancelled"].includes(state.run.status))
      return new Response("Undo is available after Spectra finishes this run.", { status: 409 });
    let plan: {
      restored: Array<{ artifactId: string; snapshot: { title?: string; summary?: string | null; content?: unknown; tags?: string[] } }>;
      blocked: Array<{ artifactId: string; reason: string }>;
    };
    try {
      plan = await mutate<{ runId: string }, typeof plan>("changeGroups:revertPlanForRun", { runId });
    } catch (error) {
      return new Response(publicError(error), { status: errorStatus(error) });
    }
    // Works kept on a computer have their history there, so Bridge says what can go back.
    const touchedIds = [...new Set([
      ...plan.restored.map((item) => item.artifactId),
      ...state.cards.flatMap((card) => card.actions.flatMap((entry) => entry.key === "open" && entry.targetId ? [entry.targetId] : [])),
      ...state.operations.filter((operation) => operation.type.startsWith("artifact.") && ["executed", "executing", "failed"].includes(operation.status))
        .flatMap((operation) => [...(operation.affected ?? []).filter((item) => item.type === "artifact").map((item) => item.id), ...(operation.pendingArtifactId ? [operation.pendingArtifactId] : [])]),
    ])];
    const onDevice = await deviceUndoPlan(touchedIds, runId);
    const refused = await authorize?.(state, touchedIds, onDevice.restore.length > 0);
    if (refused) return refused;
    // Everything with a lasting effect goes back: new works, the calendar, the Library, settings, memory.
    let reversal: { counts: Partial<RunUndoCounts>; left: string[]; kept: string[]; trashedWorks: string[] };
    try {
      reversal = await mutate<{ runId: string; executionId: string; keepWorks: string[] }, typeof reversal>("spectraRunUndo:reverseWrites", {
        runId,
        executionId: expectedExecutionId,
        keepWorks: onDevice.keep,
      });
    } catch (error) {
      return new Response(publicError(error), { status: errorStatus(error) });
    }
    const gone = new Set(reversal.trashedWorks);
    plan.restored = plan.restored.filter((item) => !gone.has(item.artifactId));
    const restored: string[] = [];
    const failed: string[] = [];
    for (const item of plan.restored) {
      const snapshot = item.snapshot ?? {};
      try {
        await applyAiArtifactMutation({
          artifactId: item.artifactId,
          runId,
          // restore:* ids are human Undo fencing, never AI claim identities.
          operationId: `restore:${runId}:${item.artifactId}`,
          executionId: expectedExecutionId,
          checkpointBeforeAi: false,
          claimActorKind: "human",
          resolveDesired: (current) => ({
            title: snapshot.title ?? current.title,
            summary: typeof snapshot.summary === "string" ? snapshot.summary : current.summary,
            content: snapshot.content ?? current.content,
            tags: snapshot.tags ?? current.tags,
          }),
        });
        restored.push(item.artifactId);
      } catch (error) {
        failed.push(error instanceof Error ? publicError(error) : "Spectra could not restore that earlier copy.");
      }
    }
    for (const item of onDevice.restore) {
      if (gone.has(item.artifactId)) continue;
      try {
        await restoreDeviceVersion({
          artifactId: item.artifactId,
          versionId: `device:${item.versionId}`,
          requestId: `undo:${runId}:${item.artifactId}`,
        });
        restored.push(item.artifactId);
      } catch (error) {
        failed.push(error instanceof Error ? publicError(error) : "Spectra could not restore that earlier copy.");
      }
    }
    const counts = { ...reversal.counts, restored: restored.length };
    const reversedAnything = Object.values(counts).some(Boolean);
    const stayed = [...new Set([...plan.blocked.map((item) => item.reason), ...onDevice.notes, ...reversal.kept])];
    if (!reversedAnything && (failed.length || stayed.length))
      return new Response(failed[0] ?? stayed[0] ?? "Spectra could not undo this run.", { status: 409 });
    const summary = runUndoSummary(counts);
    const notes = [
      ...stayed,
      ...failed,
      ...(reversal.left.length ? [`Still in place: ${reversal.left.join(", ")}.`] : []),
    ];
    await Promise.all(
      state.cards.map((card) =>
        mutate("spectraRuns:patchResultCard", {
          resultCardId: card._id,
          executionId: expectedExecutionId,
          summary,
          ...(requestingRunId ? { provenance: { ...(card.provenance && typeof card.provenance === "object" ? card.provenance : {}), undoneByRunId: requestingRunId, undoneNotes: notes } } : {}),
          actions: [...card.actions.filter((entry) => entry.key !== "revert"), { key: "undone", label: "Undone" }].filter(
            (entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index,
          ),
        }).catch(() => null),
      ),
    );
    return Response.json({ changed: reversedAnything, restored: restored.length, blocked: plan.blocked, failed, summary, notes });
}
