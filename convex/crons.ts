import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("cleanup-expired-resources", { hourUTC: 3, minuteUTC: 0 }, internal.resources.cleanupExpired, {});
crons.daily("refresh-model-catalog", { hourUTC: 3, minuteUTC: 30 }, internal.catalogSync.refreshCatalog, {});

export default crons;
