import { type NextRequest } from "next/server";
import { handleSpectraRunRequest } from "./runtime";

export const runtime = "nodejs";
// Scheduled runs (Convex executionScheduler -> action "scheduled_run") execute
// the whole AI run inside this request. Pin the limit so a project without
// fluid compute does not cut every run off at its 15 second default; a run
// that still outlives it is recovered by the run lease + reconcileStaleRuns.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return handleSpectraRunRequest(request);
}
