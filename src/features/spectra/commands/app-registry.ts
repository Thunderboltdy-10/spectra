import {
  CalendarDays,
  FolderTree,
  KeyRound,
  Map,
  Settings2,
  ShieldAlert,
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

function appCommand(
  input: Omit<Command<void>, "domain" | "availability"> & {
    availability?: Command<void>["availability"];
  },
): Command<void> {
  return {
    ...input,
    domain: "app:product",
    availability: input.availability ?? enabled,
  };
}

export const APP_COMMANDS: readonly Command<void>[] = [
  appCommand({
    id: "app.work.open",
    title: "Open work",
    icon: Map,
    description: "Open a work item through the shared product navigation path.",
    execute: () => undefined,
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Open" },
    },
    defaultPlacement: { tab: "General", group: "Navigation", order: 0 },
    risk: "safe",
    undo: "none(explain)",
    choreography: { target: "library-work" },
    aiAuthority: "allowed",
  }),
  appCommand({
    id: "app.library.organize",
    title: "Organize Library",
    icon: FolderTree,
    description:
      "Create, rename, move, or link Library nodes through the canonical organization path.",
    execute: () => undefined,
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
    id: "app.settings.change",
    title: "Change settings",
    icon: Settings2,
    description:
      "Change account-synced settings through the same preference path as the human UI.",
    execute: () => undefined,
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
    id: "app.calendar.open",
    title: "Open Calendar",
    icon: CalendarDays,
    description: "Open Calendar without changing the user's work.",
    execute: () => undefined,
    presentation: {
      kind: "button",
      compact: { iconOnly: true },
      medium: { label: "Calendar" },
    },
    defaultPlacement: { tab: "Navigation", group: "Routes", order: 0 },
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
    execute: () => undefined,
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
    execute: () => undefined,
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
];

export function appCommandById(id: string) {
  return APP_COMMANDS.find((command) => command.id === id);
}
