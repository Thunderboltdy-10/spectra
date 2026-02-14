import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("refresh-model-catalog", { hourUTC: 3, minuteUTC: 30 }, internal.catalogSync.refreshCatalog, {});

export default crons;
