import type { PermissionCategory } from "../src/features/spectra/settings/schema/ai-permissions";

/*
 * Which Spectra AI application commands ask the user first, and under which
 * permission category. One table for the harness tools (whether to ask, and
 * the "Always allow" choice), the worker (whether the staged operation needs
 * approval) and Convex (which approval scope the user's answer binds to, and
 * which stored choice may stand in for it). When they disagreed, an approval
 * the user gave could not bind and the change failed after "Allow".
 *
 * Commands not listed run as ordinary undoable writes. Commands that change
 * files on the user's computer also ask, under bridge_files, whenever the
 * server counts affected files (LOCAL_FILE_COMMANDS).
 */

type Args = Record<string, unknown>;

/** The category a command asks under, or null when it runs without asking. */
export function applicationCommandCategory(command: string, args: Args): PermissionCategory | null {
  switch (command) {
    case "change_spectra_settings":
    case "pair_device":
    case "remove_device":
      return "settings";
    // Removing a Bridge folder stops syncing it; the other device controls are undoable.
    case "control_device":
      return args.action === "remove_folder" ? "settings" : null;
    // A published build and a public link reach people outside the work's audience.
    case "publish_code":
      return "external_send";
    case "change_sharing":
      return args.action === "create_public_link" ? "external_send" : "sharing";
    // Accepting or declining an invitation someone sent the user.
    case "respond_share_invitation":
      return "sharing";
    // A release only the owner reaches changes nothing for anyone else.
    case "release_agent":
      return args.action === "release_private" ? null : "sharing";
    case "trigger_managebac_sync":
    case "select_managebac_classes":
    case "set_school_sync_mode":
    case "manage_class_workspaces":
    // A class resource copied into the Library, downloaded with the school's ManageBac key.
    case "import_managebac_resource":
      return "managebac";
    case "change_sync_policy":
      return "bridge_files";
    // A deleted comment is gone for everyone; the other comment changes can be undone.
    case "manage_comment":
      return args.action === "delete" ? "permanent_delete" : null;
    // A removed bench test is deleted, not trashed, and it leaves the agent's checks.
    case "remove_agent_bench_case":
      return "permanent_delete";
    // A forgotten memory is erased, not hidden; saving or revising one can be undone.
    case "write_memory":
      return args.action === "forget" ? "permanent_delete" : null;
    default:
      return null;
  }
}

/** Commands that can move, overwrite or remove files on the user's computer. */
export const LOCAL_FILE_COMMANDS: ReadonlySet<string> = new Set(["organize_library", "delete_library_items", "change_sync_policy"]);

/** The category an approval for this command is stored under: its own, or bridge_files for desktop files. */
export function applicationApprovalCategory(command: string, args: Args): PermissionCategory | null {
  return applicationCommandCategory(command, args) ?? (LOCAL_FILE_COMMANDS.has(command) ? "bridge_files" : null);
}
