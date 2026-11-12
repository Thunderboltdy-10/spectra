import { syncTaskWorkProjection } from "./calendarTaskWork";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from "./functions";
import {
  orgNodeAggregates,
  skipUnchangedCountTrigger,
  type OrgNodeCountKind,
} from "./orgNodeAggregates";
import {
  deleteResultCardSummary,
  projectResultCardRunSummary,
  projectRunTabSummary,
  RESULT_CARD_SUMMARY_READ_MODEL_VERSION,
  RUN_TAB_PROJECTION_VERSION,
  upsertResultCardSummary,
} from "./spectraRunProjection";
import { deleteArtifactSummary, upsertArtifactSummary } from "./orgTreeShared";
import { syncAnalyticsRun } from "./analyticsReadModels";
import {
  plannerReminderSourceChanged,
  plannerReminderSourceGeneration,
} from "./plannerReminders";
import {
  timetableReminderSourceChanged,
  timetableReminderSourceGeneration,
  timetableReminderUserStateChanged,
  timetableReminderUserStateGeneration,
} from "./timetableReminders";
import { reconcileDurablePayloadOwners, durablePayloadReferences } from "./durablePayloadOwnership";
import {
  deleteCalendarArtifactReadModels,
  syncCalendarMigrationFromMigration,
  syncCalendarMigrationReadModel,
  syncPlannerTaskReadModels,
  syncPlannerTaskScheduleState,
  syncPlannerTaskSourceProjection,
  upsertCalendarItemReadModel,
  deleteCalendarItemReadModel,
} from "./calendarReadModels";
import { applySemanticTrigger, SEMANTIC_TRIGGERS } from "./semanticSources";

const triggers = new Triggers<DataModel>();
for (const table of ["spectraArtifacts", "spectraArtifactVersions", "artifactSnapshotObjects", "artifactImportJobs", "changeGroups", "workReplicas", "bridgeWriteRequests", "syncConflicts", "collaborationUpdates", "collaborationSnapshots"] as const) {
  triggers.register(table, async (ctx, change) => {
    if (change.oldDoc && change.newDoc && JSON.stringify([...durablePayloadReferences(change.oldDoc)].sort()) === JSON.stringify([...durablePayloadReferences(change.newDoc)].sort())) return;
    await reconcileDurablePayloadOwners({ ...ctx, db: ctx.innerDb }, table, String(change.id), change.newDoc);
  });
}
const orgNodeCountKinds = [
  "type",
  "workspace",
  "parent",
] as const satisfies readonly OrgNodeCountKind[];

function projectedRunChanged(
  previous: Parameters<typeof projectRunTabSummary>[0] | null | undefined,
  next: Parameters<typeof projectRunTabSummary>[0],
  card: boolean,
) {
  if (!previous) return true;
  const previousProjection = card
    ? projectResultCardRunSummary(previous)
    : projectRunTabSummary(previous);
  const nextProjection = card
    ? projectResultCardRunSummary(next)
    : projectRunTabSummary(next);
  // Lease and heartbeat maintenance are intentionally not observable in the
  // compact tab/card projections. Do not reopen dependent rows for them.
  const withoutHeartbeat = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const copy = { ...(value as Record<string, unknown>) };
    delete copy.updatedAt;
    return copy;
  };
  return (
    JSON.stringify(withoutHeartbeat(previousProjection)) !==
    JSON.stringify(withoutHeartbeat(nextProjection))
  );
}
orgNodeAggregates.forEach((aggregate, index) =>
  triggers.register(
    "orgNodes",
    skipUnchangedCountTrigger(aggregate, orgNodeCountKinds[index]!),
  ),
);

// Trashing or restoring a task's place takes its calendar entry with it.
triggers.register("orgNodes", async (ctx, change) => {
  const node = change.newDoc ?? change.oldDoc;
  if (node?.kind !== "work" || !node.sourceId || change.oldDoc?.deletedAt === change.newDoc?.deletedAt) return;
  const id = ctx.innerDb.normalizeId("spectraArtifacts", node.sourceId);
  const artifact = id ? await ctx.innerDb.get(id) : null;
  if (artifact?.blueprintKey === "planner_task") await syncTaskWorkProjection({ db: ctx.innerDb }, artifact);
});

/** Test-only I/O counters for heartbeat short-circuit proofs (W9-02 / F3). */
export const runProjectionTriggerIo = {
  tabCollects: 0,
  cardSummaryCollects: 0,
  reset() {
    this.tabCollects = 0;
    this.cardSummaryCollects = 0;
  },
};

triggers.register("spectraAiRuns", async (ctx, change) => {
  await syncAnalyticsRun({ db: ctx.innerDb }, change.id, change.oldDoc, change.newDoc);
  if (!change.newDoc) return;
  const updateTabs = projectedRunChanged(change.oldDoc, change.newDoc, false);
  const updateCards = projectedRunChanged(change.oldDoc, change.newDoc, true) ||
    change.oldDoc?.ownerAccountId !== change.newDoc.ownerAccountId ||
    change.oldDoc?.schoolId !== change.newDoc.schoolId;
  const runSummary = projectRunTabSummary(change.newDoc);
  if (updateTabs) {
    runProjectionTriggerIo.tabCollects += 1;
    const tabs = await ctx.innerDb
      .query("spectraRunTabs")
      .withIndex("by_run", (q) => q.eq("runId", change.id))
      .collect();
    await Promise.all(
      tabs
        .filter(
          (tab) =>
            tab.projectionVersion !== RUN_TAB_PROJECTION_VERSION ||
            tab.artifactId !== change.newDoc!.artifactId ||
            JSON.stringify(tab.runSummary) !== JSON.stringify(runSummary),
        )
        .map((tab) =>
          ctx.innerDb.patch(tab._id, {
            projectionVersion: RUN_TAB_PROJECTION_VERSION,
            artifactId: change.newDoc!.artifactId,
            runSummary,
            updatedAt: Math.max(tab.updatedAt, change.newDoc!.updatedAt),
          }),
        ),
    );
  }
  // Run lifecycle writes are frequent and may only touch heartbeat/lease
  // fields. Update the already-compact card rows directly; reading canonical
  // cards here reopened evidence/provenance payloads on every run change and
  // also bypassed the result-card trigger.
  if (updateCards) {
    runProjectionTriggerIo.cardSummaryCollects += 1;
    const cardRunSummary = projectResultCardRunSummary(change.newDoc);
    const cardSummaries = await ctx.innerDb
      .query("spectraResultCardSummaries")
      .withIndex("by_run", (q) => q.eq("runId", change.id))
      .collect();
    await Promise.all(
      cardSummaries
        .filter(
          (card) =>
            card.readModelVersion !== RESULT_CARD_SUMMARY_READ_MODEL_VERSION ||
            card.ownerAccountId !== change.newDoc!.ownerAccountId ||
            card.schoolId !== change.newDoc!.schoolId ||
            JSON.stringify(card.runSummary) !== JSON.stringify(cardRunSummary),
        )
        .map((card) =>
          ctx.innerDb.patch(card._id, {
            readModelVersion: RESULT_CARD_SUMMARY_READ_MODEL_VERSION,
            ownerAccountId: change.newDoc!.ownerAccountId,
            schoolId: change.newDoc!.schoolId,
            runSummary: cardRunSummary,
            updatedAt: Math.max(card.updatedAt, change.newDoc!.updatedAt),
          }),
        ),
    );
  }
});

triggers.register("spectraThreads", async (ctx, change) => {
  if (!change.newDoc) return;
  const threadTitle = change.newDoc.title.slice(0, 120);
  if (change.oldDoc?.title.slice(0, 120) === threadTitle) return;
  const tabs = await ctx.innerDb
    .query("spectraRunTabs")
    .withIndex("by_thread", (q) => q.eq("threadId", change.id))
    .collect();
  await Promise.all(
    tabs.filter(tab => tab.threadTitle !== threadTitle).map((tab) =>
      ctx.innerDb.patch(tab._id, {
        threadTitle,
      }),
    ),
  );
});

triggers.register("spectraResultCards", async (ctx, change) => {
  if (change.newDoc)
    await upsertResultCardSummary({ db: ctx.innerDb }, change.newDoc);
  else await deleteResultCardSummary({ db: ctx.innerDb }, change.id);
});

triggers.register("spectraArtifacts", async (ctx, change) => {
  // The changed document is already present in the mutation transaction.  Use
  // it directly so every create/import/edit/checkpoint/rename/native
  // promotion/deletion seam maintains the compact authority row without a
  // second payload-bearing database read.  Physical deletion removes the
  // summary in the same transaction; a deleted tombstone remains authoritative
  // until the retention coordinator removes it.
  if (change.newDoc) {
    await upsertArtifactSummary({ db: ctx.innerDb }, change.newDoc);
  } else {
    await deleteArtifactSummary({ db: ctx.innerDb }, change.id);
  }
  if (plannerReminderSourceChanged(change.oldDoc, change.newDoc)) {
    await ctx.scheduler.runAfter(
      0,
      internal.plannerReminders.reconcileArtifact,
      {
        artifactId: change.id,
        expectedSourceGeneration: plannerReminderSourceGeneration(
          change.newDoc,
        ),
      },
    );
  }
  if (timetableReminderSourceChanged(change.oldDoc, change.newDoc)) {
    await ctx.scheduler.runAfter(
      0,
      internal.timetableReminders.reconcileArtifact,
      {
        artifactId: change.id,
        expectedSourceGeneration: timetableReminderSourceGeneration(
          change.newDoc,
        ),
      },
    );
  }
  if (change.newDoc?.blueprintKey === "planner_task") {
    // The task's own calendar item first, so the plan list knows it has a day.
    await syncTaskWorkProjection({ db: ctx.innerDb }, change.newDoc);
    await syncPlannerTaskReadModels({ db: ctx.innerDb }, change.newDoc);
  }
  if (!change.newDoc && change.oldDoc?.blueprintKey === "planner_task")
    await syncTaskWorkProjection({ db: ctx.innerDb }, { ...change.oldDoc, status: "deleted" });
  if (change.newDoc?.blueprintKey === "timetable")
    await syncCalendarMigrationReadModel({ db: ctx.innerDb }, change.newDoc);
  if (!change.newDoc && change.oldDoc)
    await deleteCalendarArtifactReadModels(
      { db: ctx.innerDb },
      change.oldDoc._id,
    );
});

triggers.register("calendarItems", async (ctx, change) => {
  if (change.newDoc)
    await upsertCalendarItemReadModel({ db: ctx.innerDb }, change.newDoc);
  else await deleteCalendarItemReadModel({ db: ctx.innerDb }, change.id);
  const source = change.newDoc ?? change.oldDoc;
  if (source) await syncPlannerTaskScheduleState({ db: ctx.innerDb }, source);
});

triggers.register("calendarMigrations", async (ctx, change) => {
  const migration = change.newDoc ?? change.oldDoc;
  if (migration)
    await syncCalendarMigrationFromMigration({ db: ctx.innerDb }, migration);
});

triggers.register("externalProjections", async (ctx, change) => {
  if (change.newDoc)
    await syncPlannerTaskSourceProjection({ db: ctx.innerDb }, change.newDoc);
});

triggers.register("artifactUserStates", async (ctx, change) => {
  if (!timetableReminderUserStateChanged(change.oldDoc, change.newDoc)) return;
  const source = change.newDoc ?? change.oldDoc;
  if (!source) return;
  const artifact = await ctx.innerDb.get(source.artifactId);
  await ctx.scheduler.runAfter(
    0,
    internal.timetableReminders.reconcileUserState,
    {
      artifactId: source.artifactId,
      accountId: source.accountId,
      expectedArtifactSourceGeneration:
        timetableReminderSourceGeneration(artifact),
      expectedStateSourceGeneration: timetableReminderUserStateGeneration(
        change.newDoc,
      ),
      offset: 0,
    },
  );
});

// Semantic index: saves of every registered source touch one debounced queue row
// (convex/semanticSources.ts); embedding happens later in an action.
for (const trigger of SEMANTIC_TRIGGERS) {
  triggers.register(trigger.table, async (ctx, change) => {
    await applySemanticTrigger({ db: ctx.innerDb, scheduler: ctx.scheduler }, trigger, change.oldDoc, change.newDoc);
  });
}

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);
