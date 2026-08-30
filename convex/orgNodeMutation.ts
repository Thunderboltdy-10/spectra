import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
} from "./_generated/server";
import { orgNodeAggregates } from "./orgNodeAggregates";
import {
  projectRunTabSummary,
  RUN_TAB_PROJECTION_VERSION,
} from "./spectraRunProjection";
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
for (const aggregate of orgNodeAggregates)
  triggers.register("orgNodes", aggregate.idempotentTrigger());

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

triggers.register("spectraArtifacts", async (ctx, change) => {
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
