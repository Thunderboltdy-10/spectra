import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("reconcile-stale-spectra-runs", { minutes: 2 }, internal.spectraRuns.reconcileStaleRuns, {});
export default crons;
