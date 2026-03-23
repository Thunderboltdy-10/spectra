import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("refresh-model-catalog", { hourUTC: 3, minuteUTC: 30 }, internal.catalogSync.refreshCatalog, {});
crons.interval(
  "refresh-model-catalog-runtime",
  { hours: 6 },
  internal.catalogSync.refreshCatalogRuntime,
  {},
);
crons.daily("cleanup-expired-images", { hourUTC: 4, minuteUTC: 5 }, internal.images.cleanupExpiredImages, {});
crons.daily(
  "generate-study-reminders",
  { hourUTC: 5, minuteUTC: 10 },
  internal.notifications.generateDailyStudyReminders,
  {},
);
crons.interval(
  "retry-stale-resource-ingestion",
  { minutes: 3 },
  internal.resources.retryStaleResourcesInternal,
  { limit: 30 },
);

export default crons;
