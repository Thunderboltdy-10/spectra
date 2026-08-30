import { z } from "zod";
import type { CommandAvailability, CommandContext } from "../commands/types";
import type { AuthorityRisk, CapabilityDefinition } from "./types";

const none = z.null();

const readable = (): CommandAvailability => ({ state: "enabled" });
const editable = (ctx: CommandContext): CommandAvailability =>
  ctx.permissions.editable
    ? { state: "enabled" }
    : { state: "disabled", reason: "Your current access is read-only." };

type AppSpec = {
  id: `app.${string}`;
  description: string;
  risk: AuthorityRisk;
  availability: "readable" | "editable" | { reason: string };
  choreography: { target: string; region?: string };
  exposed: boolean;
};

const APP_SPECS: readonly AppSpec[] = [
  {
    id: "app.navigate",
    description:
      "Navigate to a registered Spectra route or work target through the shared product path.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "application-route" },
    exposed: true,
  },
  {
    id: "app.work.open",
    description: "Open a work item through the shared product navigation path.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "library-work" },
    exposed: true,
  },
  {
    id: "app.work.reveal-anchor",
    description: "Reveal a semantic work location through the mounted editor surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "artifact-anchor" },
    exposed: true,
  },
  {
    id: "app.run.open-conversation",
    description:
      "Open the conversation associated with an AI run through the mounted route surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
    exposed: true,
  },
  {
    id: "app.library.delete",
    description: "Move selected Library items through the recoverable tree deletion path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "library-tree" },
    exposed: true,
  },
  {
    id: "app.library.organize",
    description:
      "Create, rename, move, or link Library nodes through the canonical organization path.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "library-tree" },
    exposed: true,
  },
  {
    id: "app.sync.policy.change",
    description: "Change storage and sync behavior through the shared N6 policy path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "sync-policy" },
    exposed: true,
  },
  {
    id: "app.memory.write",
    description: "Create or revise permission-bound memory with attribution and history.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "settings-control", region: "memory" },
    exposed: true,
  },
  {
    id: "app.skill.write",
    description:
      "Create or revise a capped account skill with approval, safety checks, and retained versions.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "skills" },
    exposed: true,
  },
  {
    id: "app.sharing.change",
    description:
      "Change access to a work item or workspace through the shared permissions path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "sharing-control" },
    exposed: true,
  },
  {
    id: "app.managebac.sync",
    description: "Refresh normalized ManageBac data with visible freshness and status.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "settings-control", region: "managebac" },
    exposed: true,
  },
  {
    id: "app.managebac.mapping",
    description: "Change how normalized ManageBac records map into Spectra.",
    risk: "always-confirm",
    availability: {
      reason: "ManageBac mapping changes use the dedicated human admin flow.",
    },
    choreography: { target: "settings-control", region: "managebac" },
    exposed: false,
  },
  {
    id: "app.reference.insert",
    description: "Insert a reference through the shared work-reference command path.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "workbar-command", region: "reference.insert" },
    exposed: true,
  },
  {
    id: "app.reference.begin-picking",
    description: "Begin semantic reference picking in the mounted artifact surface.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "workbar-command", region: "reference.beginPicking" },
    exposed: true,
  },
  {
    id: "app.context.begin-picking",
    description: "Begin semantic context picking from visible Spectra surfaces.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "context-picker" },
    exposed: true,
  },
  {
    id: "app.settings.change",
    description:
      "Change account-synced settings through the same preference path as the human UI.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "settings-control" },
    exposed: true,
  },
  {
    id: "app.settings.manage-account",
    description: "Open account management through the existing settings surface.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "settings-control", region: "account" },
    exposed: true,
  },
  {
    id: "app.settings.clear-compute-cache",
    description:
      "Clear disposable local compute caches without changing Spectra work or native files.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "compute-cache" },
    exposed: true,
  },
  {
    id: "app.calendar.open",
    description: "Open Calendar without changing the user's work.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "calendar-route" },
    exposed: true,
  },
  {
    id: "app.bridge.pair",
    description:
      "Bridge pairing changes local security authority and must be performed by the user.",
    risk: "always-confirm",
    availability: { reason: "Bridge pairing is never AI-performable." },
    choreography: { target: "settings-security" },
    exposed: false,
  },
  {
    id: "app.security.credentials",
    description: "Credential changes are never available to AI.",
    risk: "destructive",
    availability: { reason: "Credential changes are never AI-performable." },
    choreography: { target: "settings-security" },
    exposed: false,
  },
  {
    id: "app.security.authority-mode",
    description: "AI cannot change the policy that governs its own authority.",
    risk: "always-confirm",
    availability: { reason: "AI cannot change its own authority mode." },
    choreography: { target: "settings-security" },
    exposed: false,
  },
  {
    id: "app.security.delete-account",
    description: "Account deletion is never available to AI.",
    risk: "destructive",
    availability: { reason: "Account deletion is never AI-performable." },
    choreography: { target: "settings-security" },
    exposed: false,
  },
  {
    id: "app.providers.connect",
    description: "Future provider adapters are deliberately unavailable in this release.",
    risk: "always-confirm",
    availability: {
      reason: "Future provider connections are deferred until an adapter exists.",
    },
    choreography: { target: "settings-control", region: "providers" },
    exposed: false,
  },
];

function availabilityForSpec(
  spec: AppSpec,
): (ctx: CommandContext) => CommandAvailability {
  if (spec.availability === "readable") return readable;
  if (spec.availability === "editable") return editable;
  const reason = spec.availability.reason;
  return () => ({ state: "disabled", reason });
}

export const APPLICATION_CAPABILITIES: readonly CapabilityDefinition<"app">[] =
  APP_SPECS.map((spec) => ({
    id: spec.id,
    params: none,
    scope: "application",
    availability: availabilityForSpec(spec),
    execute: { editor: spec.id },
    ai: {
      exposed: spec.exposed,
      description: spec.exposed
        ? spec.description
        : spec.availability !== "readable" && spec.availability !== "editable"
          ? spec.availability.reason
          : spec.description,
      riskClass: spec.risk,
    },
    choreography: spec.choreography,
  }));

export function applicationCapability(
  id: string,
): CapabilityDefinition<"app"> {
  const definition = APPLICATION_CAPABILITIES.find(
    (candidate) => candidate.id === id,
  );
  if (!definition) {
    throw new Error(`CAPABILITY_DEFINITION_MISSING: ${id}`);
  }
  return definition;
}
