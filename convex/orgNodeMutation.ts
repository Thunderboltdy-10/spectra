import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from "./_generated/server";
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
  runProjectionFactsUnchanged,
  upsertResultCardSummary,
} from "./spectraRunProjection";
import {
  deleteArtifactSummary,
  upsertArtifactSummary,
} from "./orgTreeShared";
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
orgNodeAggregates.forEach((aggregate, index) =>
  triggers.register(
    "orgNodes",
    skipUnchangedCountTrigger(aggregate, orgNodeCountKinds[index]!),
  ),
);

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
  if (!change.newDoc) return;
  // Lease/heartbeat-only patches must not collect tabs or card summaries.
  // Compare the same observable facts that feed projectRunTabSummary /
  // projectResultCardRunSummary (+ owner/school for card rows) before any
  // dependent reads. Heartbeat does not bump updatedAt, so equality holds.
  if (runProjectionFactsUnchanged(change.oldDoc, change.newDoc)) return;
  runProjectionTriggerIo.tabCollects += 1;
  const tabs = await ctx.innerDb
    .query("spectraRunTabs")
    .withIndex("by_run", (q) => q.eq("runId", change.id))
    .collect();
  const runSummary = projectRunTabSummary(change.newDoc);
  const cardRunSummary = projectResultCardRunSummary(change.newDoc);
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
  // Update already-compact card rows directly; reading canonical cards here
  // reopened evidence/provenance payloads and bypassed the result-card trigger.
  runProjectionTriggerIo.cardSummaryCollects += 1;
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
});

triggers.register("spectraThreads", async (ctx, change) => {
  if (!change.newDoc) return;
  const tabs = await ctx.innerDb
    .query("spectraRunTabs")
    .withIndex("by_thread", (q) => q.eq("threadId", change.id))
    .collect();
  await Promise.all(
    tabs.map((tab) =>
      ctx.innerDb.patch(tab._id, {
        threadTitle: change.newDoc.title.slice(0, 120),
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
    await deleteArtifactSummary(
      { db: ctx.innerDb },
      change.id,
    );
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

export const mutation = customMutation(
  rawMutation,
  customCtx(triggers.wrapDB),
);

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);
