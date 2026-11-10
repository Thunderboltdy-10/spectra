import "server-only";
import { convexQuery } from "./convex-server";
import { deviceStoreCall } from "./device-store";
import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";

type StoredVersion = {
  id: number;
  title?: string | null;
  summary?: string | null;
  content?: unknown;
};

type VersionRow = { id: number; source: string; runId?: string | null; title?: string | null };

/*
 * What undoing a run can do to the works it touched on a computer. The earliest
 * "before" of the run is the way back, unless something happened to the work since:
 * a person's edit, or another run. Those stay, as they do for work in the cloud.
 */
export async function deviceUndoPlan(touched: string[], runId: string) {
  const plan = { restore: [] as Array<{ artifactId: string; versionId: number }>, keep: [] as string[], notes: [] as string[] };
  const artifactIds = [...new Set(touched)];
  if (!artifactIds.length) return plan;
  const homes = await Promise.all(Array.from({ length: Math.ceil(artifactIds.length / 24) }, (_, index) =>
    convexQuery<{ artifactIds: string[] }, { accountId: string; onDevice: string[] }>("deviceWorks:homesOf", { artifactIds: artifactIds.slice(index * 24, (index + 1) * 24) })));
  for (const home of homes) for (const artifactId of home.onDevice) {
    try {
      const versions = await deviceStoreCall<VersionRow[]>(home.accountId, "versions", { artifactId, limit: 200 });
      const ofRun = versions.filter((version) => version.runId === runId);
      const last = ofRun[0];
      if (!last) continue;
      if (versions.length === 200 && versions.at(-1)?.runId === runId) {
        plan.keep.push(artifactId);
        plan.notes.push("This run reaches beyond the available version history, so work kept on this computer stays as it is.");
        continue;
      }
      const [work, lastVersion] = await Promise.all([
        deviceStoreCall<{ title?: string; content?: unknown } | null>(home.accountId, "get", { artifactId }),
        deviceStoreCall<StoredVersion | null>(home.accountId, "version", { artifactId, id: last.id }),
      ]);
      const changedSince =
        versions.some((version) => version.id > last.id) ||
        (work?.title ?? null) !== (lastVersion?.title ?? null) ||
        JSON.stringify(work?.content ?? null) !== JSON.stringify(lastVersion?.content ?? null);
      if (changedSince) {
        plan.keep.push(artifactId);
        plan.notes.push(`"${work?.title ?? last.title ?? "This work"}" changed after Spectra finished, so it stays. Version history still has the earlier copy.`);
        continue;
      }
      const before = ofRun.filter((version) => version.source === "before_ai").at(-1);
      if (before) plan.restore.push({ artifactId, versionId: before.id });
    } catch {
      plan.keep.push(artifactId);
      plan.notes.push("Spectra Bridge isn't answering on this computer, so work kept there stays as it is. Open Bridge and try again.");
    }
  }
  return plan;
}

/*
 * Going back on work kept on a computer: the version comes from Bridge and is
 * written back into the room as a person's edit, so anything open follows it.
 * The room keeps the current work as a version first, as a restore always does.
 */
export async function restoreDeviceVersion(input: { artifactId: string; versionId: string; requestId: string }) {
  const me = await convexQuery<Record<string, never>, { accountId: string } | null>("identity:me", {});
  if (!me) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to restore this work.");
  const id = Number(input.versionId.replace(/^device:/, ""));
  if (!Number.isSafeInteger(id)) throw new Error("That version isn't available.");
  const version = await deviceStoreCall<StoredVersion | null>(me.accountId, "version", { artifactId: input.artifactId, id });
  if (!version || version.content === undefined || version.content === null)
    throw new Error("That version isn't available on this computer.");
  const result = await applyAiArtifactMutation({
    artifactId: input.artifactId,
    runId: `restore:${input.requestId}`,
    operationId: `restore:${input.requestId}`,
    executionId: `restore:${input.requestId}`,
    claimActorKind: "human",
    receipt: "placement",
    resolveDesired: (current) => ({
      title: version.title ?? current.title,
      ...(current.summary ? { summary: current.summary } : {}),
      tags: current.tags,
      content: version.content,
    }),
  });
  const restored = (result.changedRegionIds ?? []).length > 0;
  return { state: restored ? ("committed" as const) : ("unchanged" as const), receipt: { versionId: input.versionId } };
}
