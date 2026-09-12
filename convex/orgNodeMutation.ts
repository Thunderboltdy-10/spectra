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
  projectRunTabSummary,
  RUN_TAB_PROJECTION_VERSION,
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

const triggers = new Triggers<DataModel>();
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

triggers.register("spectraAiRuns", async (ctx, change) => {
  if (!change.newDoc) return;
  const tabs = await ctx.innerDb
    .query("spectraRunTabs")
    .withIndex("by_run", (q) => q.eq("runId", change.id))
    .collect();
  const runSummary = projectRunTabSummary(change.newDoc);
  await Promise.all(
    tabs.map((tab) =>
      ctx.innerDb.patch(tab._id, {
        projectionVersion: RUN_TAB_PROJECTION_VERSION,
        artifactId: change.newDoc.artifactId,
        runSummary,
      }),
    ),
  );
  const cards = await ctx.innerDb
    .query("spectraResultCards")
    .withIndex("by_run", (q) => q.eq("runId", change.id))
    .collect();
  await Promise.all(
    cards
      .filter(
        (card) =>
          card.runSummaryVersion !== RUN_TAB_PROJECTION_VERSION ||
          card.ownerAccountId !== change.newDoc.ownerAccountId ||
          card.schoolId !== change.newDoc.schoolId ||
          JSON.stringify(card.runSummary) !== JSON.stringify(runSummary),
      )
      .map((card) =>
        ctx.innerDb.patch(card._id, {
          ownerAccountId: change.newDoc.ownerAccountId,
          schoolId: change.newDoc.schoolId,
          runSummaryVersion: RUN_TAB_PROJECTION_VERSION,
          runSummary,
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
