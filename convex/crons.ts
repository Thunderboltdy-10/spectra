import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile-stale-spectra-runs",
  { minutes: 2 },
  internal.spectraRuns.reconcileStaleRuns,
  {},
);
crons.interval(
  "sweep-stale-bridge-work",
  { minutes: 2 },
  internal.bridgeSync.sweepStaleBridgeWork,
  {},
);
crons.interval(
  "sweep-replica-truth",
  { minutes: 2 },
  internal.replicas.sweepReplicaTruth,
  {},
);
crons.interval(
  "sweep-connection-health",
  { minutes: 2 },
  internal.connections.sweepStalledHealth,
  {},
);
crons.interval(
  "reconcile-legacy-replica-truth",
  { minutes: 1 },
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
  "maintain-private-memory",
  { minutes: 1 },
  internal.memory.maintain,
  {},
);
crons.daily(
  "evaluate-private-memory-safety",
  { hourUTC: 3, minuteUTC: 10 },
  internal.memory.evaluateSafety,
  {},
);
crons.interval(
  "deliver-school-announcements",
  { minutes: 1 },
  internal.administration.processScheduledAnnouncements,
  {},
);
crons.interval(
  "advance-school-lifecycle-jobs",
  { minutes: 2 },
  internal.administration.processLifecycleJobs,
  {},
);
crons.interval(
  "build-school-lifecycle-exports",
  { minutes: 2 },
  internal.administration.processLifecycleExports,
  {},
);
export default crons;
