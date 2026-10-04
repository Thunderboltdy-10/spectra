import { z } from "zod";
import type { CommandAvailability, CommandContext } from "../commands/types";
import type { AuthorityRisk, CapabilityDefinition } from "./types";
import { aiAuthorityForApp } from "../commands/ai-reach";

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
};

const APP_SPECS: readonly AppSpec[] = [
  {
    id: "app.navigate",
    description:
      "Navigate to a registered Spectra route or work target through the shared product path.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "application-route" },
  },
  {
    id: "app.work.open",
    description: "Open a work item through the shared product navigation path.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "library-work" },
  },
  {
    id: "app.work.reveal-anchor",
    description: "Reveal a semantic work location through the mounted editor surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "artifact-anchor" },
  },
  {
    id: "app.run.open-conversation",
    description:
      "Open the conversation associated with an AI run through the mounted route surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.page.chat",
    description: "Open the shared conversation surface without opening a second dock panel.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.page.workspace",
    description: "Open the workspace home surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "workspace-route" },
  },
  {
    id: "app.page.library",
    description: "Open Library and its authorized work tree.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "library-route" },
  },
  {
    id: "app.page.calendar",
    description: "Open the personal calendar surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "calendar-route" },
  },
  {
    id: "app.page.settings",
    description: "Open account, appearance, workbar, or device settings.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "settings-route" },
  },
  {
    id: "app.page.agents",
    description: "Browse authorized specialist agents.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "agents-route" },
  },
  {
    id: "app.page.school",
    description: "Open school data and class shelves.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "school-route" },
  },
  {
    id: "app.page.analytics",
    description: "Open your authorized learning analytics surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "analytics-route" },
  },
  {
    id: "app.thread.open",
    description: "Open one authorized conversation in the current conversation surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.chat.new",
    description: "Start a new conversation without changing existing work.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.chat.continue",
    description: "Keep the current conversation as the explicit continuation target.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.run.stop",
    description: "Request a stop for the active run without changing committed work.",
    risk: "confirm",
    availability: "readable",
    choreography: { target: "conversation-route" },
  },
  {
    id: "app.follow.stop",
    description: "Stop visible follow choreography; durable work continues unless separately stopped.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "application-route" },
  },
  {
    id: "app.comments.open",
    description: "Open comments for the work currently mounted in the editor.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "artifact-comments" },
  },
  {
    id: "app.comments.add",
    description: "Add an anchored comment to the mounted work after you enter its text.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "artifact-comments" },
  },
  {
    id: "app.library.import",
    description: "Open the existing Library import flow for an authorized local file.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "library-import" },
  },
  {
    id: "app.workspace.import",
    description: "Open the existing workspace manifest import flow.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "workspace-import" },
  },
  {
    id: "app.settings.toggle-continuation",
    description: "Change whether unassigned messages continue the current conversation.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "settings-control", region: "continueCurrentConversation" },
  },
  {
    id: "app.bridge.open-settings",
    description: "Open the existing Files and devices surface for Bridge setup and status.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "settings-control", region: "devices" },
  },
  {
    id: "app.library.delete",
    description: "Move selected Library items through the recoverable tree deletion path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "library-tree" },
  },
  {
    id: "app.library.organize",
    description:
      "Create, rename, move, or link Library nodes through the canonical organization path.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "library-tree" },
  },
  {
    id: "app.sync.policy.change",
    description: "Change storage and sync behavior through the shared N6 policy path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "sync-policy" },
  },
  {
    id: "app.memory.write",
    description: "Create or revise permission-bound memory with attribution and history.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "settings-control", region: "memory" },
  },
  {
    id: "app.sharing.change",
    description:
      "Change access to a work item or workspace through the shared permissions path.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "sharing-control" },
  },
  {
    id: "app.managebac.sync",
    description: "Refresh normalized ManageBac data with visible freshness and status.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "settings-control", region: "managebac" },
  },
  {
    id: "app.managebac.select-classes",
    description:
      "Choose the ManageBac classes whose verified details may enter the account's Spectra planning scope.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "managebac" },
  },
  {
    id: "app.managebac.import-resource",
    description: "Fetch one permissioned resource from a selected ManageBac class shelf into Library.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "school-resource-row" },
  },
  {
    id: "app.managebac.mapping",
    description: "Change how normalized ManageBac records map into Spectra.",
    risk: "always-confirm",
    availability: {
      reason: "ManageBac mapping changes use the dedicated human admin flow.",
    },
    choreography: { target: "settings-control", region: "managebac" },
  },
  {
    id: "app.reference.insert",
    description: "Insert a reference through the shared work-reference command path.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "workbar-command", region: "reference.insert" },
  },
  {
    id: "app.reference.begin-picking",
    description: "Begin semantic reference picking in the mounted artifact surface.",
    risk: "safe",
    availability: "editable",
    choreography: { target: "workbar-command", region: "reference.beginPicking" },
  },
  {
    id: "app.settings.change",
    description:
      "Change account-synced settings through the same preference path as the human UI.",
    risk: "always-confirm",
    availability: "editable",
    choreography: { target: "settings-control" },
  },
  {
    id: "app.settings.manage-account",
    description: "Open account management through the existing settings surface.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "settings-control", region: "account" },
  },
  {
    id: "app.settings.clear-compute-cache",
    description:
      "Clear disposable local compute caches without changing Spectra work or native files.",
    risk: "confirm",
    availability: "editable",
    choreography: { target: "settings-control", region: "compute-cache" },
  },
  {
    id: "app.calendar.open",
    description: "Open Calendar without changing the user's work.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "calendar-route" },
  },
  {
    id: "app.bridge.pair",
    description:
      "Bridge pairing changes local security authority and must be performed by the user.",
    risk: "always-confirm",
    availability: "readable",
    choreography: { target: "settings-security" },
  },
  {
    id: "app.bridge.setup",
    description:
      "Prepare the exact Bridge settings handoff for pairing, folder selection, or a truthful recovery retry; the user completes local consent.",
    risk: "safe",
    availability: "readable",
    choreography: { target: "settings-security", region: "bridge-setup" },
  },
  {
    id: "app.bridge.policy.change",
    description:
      "Change the Bridge trust preset through the existing account policy path.",
    risk: "always-confirm",
    availability: "readable",
    choreography: { target: "settings-control", region: "bridge-trust" },
  },
  {
    id: "app.security.credentials",
    description: "Credential changes are never available to AI.",
    risk: "destructive",
    availability: { reason: "Credential changes are never AI-performable." },
    choreography: { target: "settings-security" },
  },
  {
    id: "app.security.authority-mode",
    description: "AI cannot change the policy that governs its own authority.",
    risk: "always-confirm",
    availability: { reason: "AI cannot change its own authority mode." },
    choreography: { target: "settings-security" },
  },
  {
    id: "app.security.delete-account",
    description: "Account deletion is never available to AI.",
    risk: "destructive",
    availability: { reason: "Account deletion is never AI-performable." },
    choreography: { target: "settings-security" },
  },
  {
    id: "app.providers.connect",
    description: "Future provider adapters are deliberately unavailable in this release.",
    risk: "always-confirm",
    availability: {
      reason: "Future provider connections are deferred until an adapter exists.",
    },
    choreography: { target: "settings-control", region: "providers" },
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

/** Whether the AI reaches each one, and why not, comes from the command catalog. */
export const APPLICATION_CAPABILITIES: readonly CapabilityDefinition<"app">[] =
  APP_SPECS.map((spec) => {
    const authority = aiAuthorityForApp(spec.id);
    return {
      id: spec.id,
      params: none,
      scope: "application",
      availability: availabilityForSpec(spec),
      execute: { editor: spec.id },
      ai: {
        exposed: authority.aiAuthority === "allowed",
        description: authority.aiAuthority === "allowed" ? spec.description : authority.prohibitionReason,
        riskClass: spec.risk,
      },
      choreography: spec.choreography,
    };
  });

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
