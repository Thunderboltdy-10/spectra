/*
 * The names of the Devices actions that run on a computer through its local
 * Bridge. Pure, so the server's tool registry, the harness and the client
 * share one list.
 */
export const LOCAL_DEVICE_ACTIONS = [
  "add_folder",
  "add_files",
  "sync_path",
  "retry_folder",
  "pause_folder",
  "resume_folder",
  "remove_folder",
  "pause_syncing",
  "resume_syncing",
  "show_logs",
  "update",
] as const;

export type LocalDeviceAction = (typeof LOCAL_DEVICE_ACTIONS)[number];

/** Actions on one folder: they need its grant id. */
export const FOLDER_ACTIONS: ReadonlySet<LocalDeviceAction> = new Set([
  "retry_folder",
  "pause_folder",
  "resume_folder",
  "remove_folder",
]);

export type LocalDeviceRequest = { action: LocalDeviceAction; grantId?: string; path?: string };

export function isLocalDeviceAction(value: unknown): value is LocalDeviceAction {
  return typeof value === "string" && (LOCAL_DEVICE_ACTIONS as readonly string[]).includes(value);
}
