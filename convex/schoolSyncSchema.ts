import { v } from "convex/values";

/** Validators for the School sync model (shared/school-sync.ts). Kept literal so Convex types stay exact. */
export const vSchoolSyncKind = v.union(
  v.literal("classes"),
  v.literal("current_tasks"),
  v.literal("task_resources"),
  v.literal("grades"),
  v.literal("past_tasks"),
  v.literal("dropbox_files"),
  v.literal("cas"),
  v.literal("calendar_events"),
);

export const vSchoolSyncMode = v.union(v.literal("auto"), v.literal("manual"), v.literal("off"));

export const vSchoolSyncTrigger = v.union(v.literal("schedule"), v.literal("user"), v.literal("ai"));

export const vSchoolSyncState = v.union(
  v.literal("idle"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("blocked"),
);
