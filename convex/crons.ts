import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("refresh-model-catalog", { hourUTC: 3, minuteUTC: 30 }, internal.catalogSync.refreshCatalogRuntime, {});
crons.interval(
  "refresh-model-catalog-runtime",
  { hours: 12 },
  internal.catalogSync.refreshCatalogRuntime,
  {},
);
crons.daily("cleanup-expired-images", { hourUTC: 4, minuteUTC: 5 }, internal.images.cleanupExpiredImages, {});
crons.daily(
  "cleanup-expired-resources",
  { hourUTC: 2, minuteUTC: 0 },
  internal.resources.cleanupExpired,
  { limit: 300 },
);
crons.daily(
  "decay-memory-freshness",
  { hourUTC: 1, minuteUTC: 20 },
  internal.memory.runDailyMaintenance,
  {},
);
crons.daily(
  "sync-managebac",
  { hourUTC: 5, minuteUTC: 10 },
  internal.managebacSync.runScheduledSync,
  {},
);
crons.interval(
  "generate-study-reminders",
  { hours: 1 },
  internal.notifications.generateDailyStudyReminders,
  {},
);
crons.interval(
  "refresh-platform-stats",
  { hours: 1 },
  internal.superAdmin.refreshPlatformStats,
  {},
);
crons.interval(
  "retry-stale-resource-ingestion",
  { minutes: 15 },
  internal.resources.retryStaleResourcesInternal,
  { limit: 30 },
);
crons.interval(
  "evaluate-challenger-lane",
  { hours: 168 },
  internal.models.evaluateChallengerLane,
  {},
);
crons.interval(
  "regenerate-workspace-ghosts",
  { hours: 6 },
  internal.ghosts.runScheduledRegenerationSweep,
  {},
);
crons.interval("reconcile-stale-spectra-runs", { minutes: 2 }, internal.spectraRuns.reconcileStaleRuns, {});
export default crons;
