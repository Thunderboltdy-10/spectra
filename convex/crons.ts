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
  "deliver-planner-reminders",
  { minutes: 1 },
  internal.plannerReminders.dispatchDue,
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
