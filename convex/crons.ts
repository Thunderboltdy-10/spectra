import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile-stale-spectra-runs",
  { minutes: 5 },
  internal.spectraRuns.reconcileStaleRuns,
  {},
);
crons.interval(
  "sweep-stale-bridge-work",
  { minutes: 15 },
  internal.bridgeSync.sweepStaleBridgeWork,
  {},
);
crons.interval(
  "sweep-replica-truth",
  { minutes: 15 },
  internal.replicas.sweepReplicaTruth,
  {},
);
crons.interval(
  "reconcile-legacy-replica-truth",
  { hours: 6 },
  internal.replicas.reconcileReplicaTruthMigration,
  {},
);
crons.interval(
  "safety-sweep-planner-reminders",
  { hours: 1 },
  internal.plannerReminders.safetySweep,
  {},
);
crons.interval(
  "safety-sweep-timetable-reminders",
  { hours: 1 },
  internal.timetableReminders.safetySweep,
  {},
);
crons.daily(
  "maintain-artifact-snapshots",
  { hourUTC: 2, minuteUTC: 20 },
  internal.artifactSnapshots.maintain,
  {},
);
crons.interval(
  "deliver-school-announcements",
  { minutes: 5 },
  internal.administration.processScheduledAnnouncements,
  {},
);
crons.interval(
  "advance-school-lifecycle-jobs",
  { minutes: 10 },
  internal.administration.processLifecycleJobs,
  {},
);
crons.interval(
  "resume-account-erasures",
  { minutes: 15 },
  internal.accountErasure.resumeStalled,
  {},
);
crons.interval(
  "build-school-lifecycle-exports",
  { minutes: 10 },
  internal.administration.processLifecycleExports,
  {},
);
crons.interval(
  "maintain-semantic-index",
  { minutes: 30 },
  internal.semanticIndex.maintain,
  {},
);
crons.interval(
  "dispatch-morning-briefs",
  { minutes: 10 },
  internal.dailyBriefs.dispatchDue,
  {},
);
export default crons;
