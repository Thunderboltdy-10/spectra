import {
  Brain,
  CalendarDays,
  Crosshair,
  DatabaseZap,
  FileX2,
  FolderTree,
  KeyRound,
  Link2,
  Map,
  MessageSquare,
  RefreshCw,
  Settings2,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  UserRoundX,
} from "lucide-react";
import type { Command, CommandContext } from "./types";

const appContext = (ctx: CommandContext) => ctx.permissions.editable;
const enabled = (ctx: CommandContext) =>
  appContext(ctx)
    ? { state: "enabled" as const }
    : {
        state: "disabled" as const,
      reason: "Your current access is read-only.",
    };
const readable = () => ({ state: "enabled" as const });

function executeApp(commandId: string, ctx: CommandContext, params: unknown) {
  if (!ctx.executeApplicationCommand)
    throw new Error(`APPLICATION_COMMAND_DISPATCHER_UNAVAILABLE: ${commandId}`);
  return ctx.executeApplicationCommand(commandId, params);
}

function appCommand(
  input: Omit<Command<unknown>, "domain" | "availability" | "execute" | "priority"> & {
    availability?: Command<unknown>["availability"];
    priority?: Command<unknown>["priority"];
    executeApplication?: (ctx: CommandContext, params: unknown) => void | Promise<void>;
  },
): Command<unknown> {
  const { executeApplication, ...command } = input;
  return {
    ...command,
    domain: "app:product",
    // App commands are reached from the palette, not from a width-constrained
    // bar, so they have no shedding order of their own. "secondary" is the
    // honest default: present, not pinned.
    priority: input.priority ?? "secondary",
    availability: input.availability ?? enabled,
    execute: executeApplication ?? ((ctx, params) => executeApp(command.id, ctx, params)),
  };
}

export const APP_COMMANDS: readonly Command<unknown>[] = [
  appCommand({
    id: "app.navigate",
    title: "Navigate Spectra",
    icon: Map,
    description: "Navigate to a registered Spectra route or work target through the shared product path.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Navigate" } },
    defaultPlacement: { tab: "General", group: "Navigation", order: -1 },
    availability: readable,
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "application-route" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.work.open",
    title: "Open work",
    icon: Map,
    description: "Open a work item through the shared product navigation path.",
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Open" },
    },
    defaultPlacement: { tab: "General", group: "Navigation", order: 0 },
    availability: readable,
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "library-work" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.work.reveal-anchor",
    title: "Reveal work anchor",
    icon: Map,
    description: "Reveal a semantic work location through the mounted editor surface.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Reveal" } },
    defaultPlacement: { tab: "General", group: "Navigation", order: 1 },
    availability: readable,
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "artifact-anchor" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.run.open-conversation",
    title: "Open run conversation",
    icon: MessageSquare,
    description: "Open the conversation associated with an AI run through the mounted route surface.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Open conversation" } },
    defaultPlacement: { tab: "General", group: "Navigation", order: 2 },
    availability: readable,
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "conversation-route" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.library.delete",
    title: "Delete Library items",
    icon: FileX2,
    description: "Move selected Library items through the recoverable tree deletion path.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Delete" } },
    defaultPlacement: { tab: "Library", group: "Organization", order: 1 },
    risk: "always-confirm",
    undo: "operation-inverse",
    choreography: { target: "library-tree" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.library.organize",
    title: "Organize Library",
    icon: FolderTree,
    description:
      "Create, rename, move, or link Library nodes through the canonical organization path.",
    presentation: {
      kind: "menu",
      compact: { iconOnly: true },
      medium: { label: "Organize" },
    },
    defaultPlacement: { tab: "Library", group: "Organization", order: 0 },
    risk: "confirm",
    undo: "operation-inverse",
    choreography: { target: "library-tree" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.sync.policy.change",
    title: "Change sync policy",
    icon: DatabaseZap,
    description: "Change storage and sync behavior through the shared N6 policy path.",
    presentation: { kind: "menu", compact: { iconOnly: true }, medium: { label: "Sync policy" } },
    defaultPlacement: { tab: "Settings", group: "Files & devices", order: 1 },
    risk: "always-confirm",
    undo: "operation-inverse",
    choreography: { target: "settings-control", region: "sync-policy" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.memory.write",
    title: "Update memory",
    icon: Brain,
    description: "Create or revise permission-bound memory with attribution and history.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Remember" } },
    defaultPlacement: { tab: "Context", group: "Memory", order: 0 },
    risk: "safe",
    undo: "operation-inverse",
    choreography: { target: "settings-control", region: "memory" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.sharing.change",
    title: "Change sharing",
    icon: Share2,
    description: "Change access to a work item or workspace through the shared permissions path.",
    presentation: { kind: "menu", compact: { iconOnly: true }, medium: { label: "Share" } },
    defaultPlacement: { tab: "General", group: "Collaboration", order: 0 },
    risk: "always-confirm",
    undo: "operation-inverse",
    choreography: { target: "sharing-control" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.managebac.sync",
    title: "Sync ManageBac",
    icon: RefreshCw,
    description: "Refresh normalized ManageBac data with visible freshness and status.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Sync" } },
    defaultPlacement: { tab: "Settings", group: "Integrations", order: 0 },
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "settings-control", region: "managebac" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.managebac.mapping",
    title: "Change ManageBac mapping",
    icon: SlidersHorizontal,
    description: "Change how normalized ManageBac records map into Spectra.",
    presentation: { kind: "menu", compact: { iconOnly: true }, medium: { label: "Mapping" } },
    defaultPlacement: { tab: "Settings", group: "Integrations", order: 1 },
    risk: "always-confirm",
    undo: "operation-inverse",
    availability: () => ({ state: "disabled", reason: "ManageBac mapping changes use the dedicated human admin flow." }),
    choreography: { target: "settings-control", region: "managebac" },
    aiAuthority: "prohibited",
    prohibitionReason: "ManageBac mapping changes are deferred to the dedicated human admin flow.",
  }),
  appCommand({
    id: "app.reference.insert",
    title: "Insert reference",
    icon: Link2,
    description: "Insert a reference through the shared work-reference command path.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Reference" } },
    defaultPlacement: { tab: "References", group: "Links", order: 0 },
    risk: "safe",
    undo: "operation-inverse",
    choreography: { target: "workbar-command", region: "reference.insert" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.reference.begin-picking",
    title: "Pick a reference",
    icon: Link2,
    description: "Begin semantic reference picking in the mounted artifact surface.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Pick reference" } },
    defaultPlacement: { tab: "References", group: "Links", order: 1 },
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "workbar-command", region: "reference.beginPicking" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.context.begin-picking",
    title: "Pick context",
    icon: Crosshair,
    description: "Begin semantic context picking from visible Spectra surfaces.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Pick context" } },
    defaultPlacement: { tab: "Context", group: "Selection", order: 1 },
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "context-picker" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.settings.change",
    title: "Change settings",
    icon: Settings2,
    description:
      "Change account-synced settings through the same preference path as the human UI.",
    presentation: {
      kind: "menu",
      compact: { iconOnly: true },
      medium: { label: "Settings" },
    },
    defaultPlacement: { tab: "Settings", group: "Preferences", order: 0 },
    risk: "always-confirm",
    undo: "operation-inverse",
    choreography: { target: "settings-control" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.settings.manage-account",
    title: "Manage account",
    icon: Settings2,
    description: "Open account management through the existing settings surface.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Manage account" } },
    defaultPlacement: { tab: "Settings", group: "Account", order: 1 },
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "settings-control", region: "account" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.settings.clear-compute-cache",
    title: "Clear local compute cache",
    icon: DatabaseZap,
    description: "Clear disposable local compute caches without changing Spectra work or native files.",
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Clear cache" } },
    defaultPlacement: { tab: "Settings", group: "Device", order: 2 },
    risk: "confirm",
    undo: "none(explain)",
    choreography: { target: "settings-control", region: "compute-cache" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.calendar.open",
    title: "Open Calendar",
    icon: CalendarDays,
    description: "Open Calendar without changing the user's work.",
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Calendar" },
    },
    defaultPlacement: { tab: "Navigation", group: "Routes", order: 0 },
    availability: readable,
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "calendar-route" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.bridge.pair",
    title: "Pair Bridge",
    icon: KeyRound,
    description:
      "Bridge pairing changes local security authority and must be performed by the user.",
    availability: () => ({
      state: "disabled",
      reason: "Bridge pairing is never AI-performable.",
    }),
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Pair Bridge" },
    },
    defaultPlacement: { tab: "Settings", group: "Security", order: 0 },
    risk: "always-confirm",
    undo: "none(explain)",
    aiAuthority: "prohibited",
    prohibitionReason: "Bridge pairing is never AI-performable.",
    choreography: { target: "settings-security" },
  }),
  appCommand({
    id: "app.security.credentials",
    title: "Change credentials",
    icon: ShieldAlert,
    description: "Credential changes are never available to AI.",
    availability: () => ({
      state: "disabled",
      reason: "Credential changes are never AI-performable.",
    }),
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Credentials" },
    },
    defaultPlacement: { tab: "Settings", group: "Security", order: 1 },
    risk: "destructive",
    undo: "none(explain)",
    aiAuthority: "prohibited",
    prohibitionReason: "Credential changes are never AI-performable.",
    choreography: { target: "settings-security" },
  }),
  appCommand({
    id: "app.security.authority-mode",
    title: "Change AI authority mode",
    icon: SlidersHorizontal,
    description: "AI cannot change the policy that governs its own authority.",
    availability: () => ({ state: "disabled", reason: "AI cannot change its own authority mode." }),
    presentation: { kind: "menu", compact: { iconOnly: true }, medium: { label: "AI authority" } },
    defaultPlacement: { tab: "Settings", group: "Security", order: 2 },
    risk: "always-confirm",
    undo: "none(explain)",
    aiAuthority: "prohibited",
    prohibitionReason: "AI cannot change its own authority mode.",
    choreography: { target: "settings-security" },
  }),
  appCommand({
    id: "app.security.delete-account",
    title: "Delete account",
    icon: UserRoundX,
    description: "Account deletion is never available to AI.",
    availability: () => ({ state: "disabled", reason: "Account deletion is never AI-performable." }),
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Delete account" } },
    defaultPlacement: { tab: "Settings", group: "Security", order: 3 },
    risk: "destructive",
    undo: "none(explain)",
    aiAuthority: "prohibited",
    prohibitionReason: "Account deletion is never AI-performable.",
    choreography: { target: "settings-security" },
  }),
  appCommand({
    id: "app.providers.connect",
    title: "Connect provider",
    icon: RefreshCw,
    description: "Future provider adapters are deliberately unavailable in this release.",
    availability: () => ({ state: "disabled", reason: "Future provider connections are deferred until an adapter exists." }),
    presentation: { kind: "button", compact: { iconOnly: true }, medium: { label: "Connect" } },
    defaultPlacement: { tab: "Settings", group: "Integrations", order: 9 },
    risk: "always-confirm",
    undo: "none(explain)",
    aiAuthority: "prohibited",
    prohibitionReason: "Future provider connections are not available in this release.",
    choreography: { target: "settings-control", region: "providers" },
  }),
];

export function appCommandById(id: string) {
  return APP_COMMANDS.find((command) => command.id === id);
}

/** Stable convergence map between the bounded AI capability ids and the
 * human-facing application command namespace. Artifact operations already
 * have their own typed operation ids; this map is only for app surfaces. */
export const APPLICATION_TOOL_COMMAND_MAP = {
  navigate_spectra: "app.navigate",
  reveal_work_anchor: "app.work.reveal-anchor",
  open_run_conversation: "app.run.open-conversation",
  organize_library: "app.library.organize",
  delete_library_items: "app.library.delete",
  change_spectra_settings: "app.settings.change",
  change_sync_policy: "app.sync.policy.change",
  write_memory: "app.memory.write",
  change_sharing: "app.sharing.change",
  trigger_managebac_sync: "app.managebac.sync",
  change_managebac_mapping: "app.managebac.mapping",
  insert_reference: "app.reference.insert",
  begin_reference_picking: "app.reference.begin-picking",
  begin_context_picking: "app.context.begin-picking",
  manage_account: "app.settings.manage-account",
  clear_local_compute_cache: "app.settings.clear-compute-cache",
  pair_bridge: "app.bridge.pair",
  change_credentials: "app.security.credentials",
  change_ai_authority_mode: "app.security.authority-mode",
  delete_account: "app.security.delete-account",
  connect_future_provider: "app.providers.connect",
} as const;

export type ApplicationToolId = keyof typeof APPLICATION_TOOL_COMMAND_MAP;

export function applicationCommandIdForTool(id: string): string | null {
  return (APPLICATION_TOOL_COMMAND_MAP as Record<string, string>)[id] ?? null;
}

export type CapabilityAuditEntry = {
  domain: string;
  action: string;
  commandId: string;
  status: "registered" | "prohibited" | "deferred";
  reason?: string;
};

export const APPLICATION_CAPABILITY_AUDIT: readonly CapabilityAuditEntry[] = [
  ...Object.entries(APPLICATION_TOOL_COMMAND_MAP).map(([action, commandId]) => {
    const command = appCommandById(commandId);
    return {
      domain: commandId.split(".")[1] ?? "application",
      action,
      commandId,
      status: command?.aiAuthority === "prohibited" ? "prohibited" as const : "registered" as const,
      ...(command?.prohibitionReason ? { reason: command.prohibitionReason } : {}),
    };
  }),
  { domain: "sync", action: "mount_grant_or_revoke", commandId: "app.bridge.mount-authority", status: "deferred", reason: "Native mount authority remains a deliberate human-only Bridge security action." },
  { domain: "embeds", action: "create_or_pin_embed", commandId: "app.embeds.create", status: "deferred", reason: "Living embed creation belongs to N9; N8 only exposes read_embeds." },
] as const;
