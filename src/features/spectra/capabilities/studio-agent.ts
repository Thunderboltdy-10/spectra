import { z } from "zod";
import type { WorkCapability } from "../work/registry";
import type { AuthorityRisk, CapabilityDefinition } from "./types";

type AgentCapabilitySpec = {
  localId: string;
  description: string;
  params?: z.ZodType;
  manifestOperation: string;
  requires?: WorkCapability;
  exposed?: boolean;
  risk?: AuthorityRisk;
  disabledReason?: string;
};

const none = z.null();
const identifier = z.string().trim().min(1).max(180);
const shortText = z.string().trim().min(1).max(4_000);

const AGENT_SPECS: readonly AgentCapabilitySpec[] = [
  // Stable P3 ids retained for authored workbar bindings.
  {
    localId: "next",
    description: "Ask the next question this mission needs.",
    manifestOperation: "update_profile",
    requires: "edit",
  },
  {
    localId: "source",
    description: "Add reviewed source material.",
    manifestOperation: "bind_resource",
    requires: "edit",
  },
  {
    localId: "dismissed",
    description: "Show dismissed mission questions.",
    manifestOperation: "inspect_configuration",
  },
  {
    localId: "competence",
    description: "Show or hide the competence ledger.",
    manifestOperation: "inspect_configuration",
  },
  {
    localId: "refresh",
    description: "Refresh evaluation runs.",
    manifestOperation: "inspect_eval_results",
    requires: "edit",
  },
  {
    localId: "brief",
    description: "Show the operating brief the runtime reads.",
    manifestOperation: "inspect_configuration",
  },
  {
    localId: "private",
    description: "Release this agent to yourself.",
    manifestOperation: "prepare_release",
    requires: "edit",
    risk: "confirm",
  },

  {
    localId: "build.next",
    description: "Ask the next adaptive mission question.",
    manifestOperation: "update_profile",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "source.add",
    description: "Add source material for quarantined extraction and review.",
    params: z
      .object({
        label: z.string().trim().min(1).max(500),
        kind: z.enum([
          "rubric",
          "policy",
          "manual",
          "annotated_work",
          "accepted_example",
          "rejected_example",
          "source_document",
        ]),
        text: z.string().trim().min(1).max(250_000),
      })
      .strict(),
    manifestOperation: "bind_resource",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "source.review",
    description: "Confirm or revoke the review of extracted source material.",
    params: z
      .object({ bindingId: identifier, confirmed: z.boolean() })
      .strict(),
    manifestOperation: "inspect_resource_health",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "source.remove",
    description: "Remove a source binding without copying its content.",
    params: z.object({ bindingId: identifier }).strict(),
    manifestOperation: "bind_resource",
    requires: "edit",
    exposed: true,
    risk: "confirm",
  },

  {
    localId: "skills.compile",
    description: "Compile draft skills from the mission and reviewed evidence.",
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "skills.accept",
    description: "Approve a compiled skill for this draft.",
    params: z.object({ skillId: identifier }).strict(),
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "skills.reject",
    description: "Reject a compiled skill proposal.",
    params: z.object({ skillId: identifier }).strict(),
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "skills.edit",
    description: "Edit an approved skill and create its next draft version.",
    params: z.object({ skillId: identifier }).strict(),
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "skills.duplicate",
    description:
      "Duplicate an approved skill with a new identity at version one.",
    params: z.object({ skillId: identifier }).strict(),
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "skills.remove",
    description: "Remove an approved skill from the live draft.",
    params: z.object({ skillId: identifier }).strict(),
    manifestOperation: "bind_skill",
    requires: "edit",
    exposed: true,
    risk: "confirm",
  },

  {
    localId: "evaluation.inspectSuite",
    description: "Inspect the layered evaluation suite and missing coverage.",
    manifestOperation: "inspect_eval_results",
    exposed: true,
  },
  {
    localId: "evaluation.run",
    description: "Run the layered suite against the exact current draft.",
    manifestOperation: "run_evaluations",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "evaluation.refresh",
    description: "Refresh durable evaluation run history.",
    manifestOperation: "inspect_eval_results",
    requires: "edit",
  },
  {
    localId: "evaluation.inspectRun",
    description:
      "Inspect case verdicts, judge, latency, tokens, and recorded response excerpts.",
    params: z.object({ runId: identifier }).strict(),
    manifestOperation: "inspect_eval_results",
    exposed: true,
  },
  {
    localId: "evaluation.inspectLimitations",
    description: "Inspect what an evaluation run could not establish.",
    params: z.object({ runId: identifier }).strict(),
    manifestOperation: "inspect_eval_results",
    exposed: true,
  },
  {
    localId: "evaluation.filterCases",
    description: "Filter evaluation cases without changing run truth.",
    params: z.enum(["failures", "required", "all"]),
    manifestOperation: "inspect_eval_results",
  },
  {
    localId: "evaluation.compareRuns",
    description: "Compare two durable evaluation runs case by case.",
    params: z
      .object({ baselineRunId: identifier, candidateRunId: identifier })
      .strict(),
    manifestOperation: "evaluate",
    exposed: true,
  },

  {
    localId: "release.compare",
    description:
      "Compare two immutable releases and their linked evaluation evidence.",
    params: z
      .object({ baselineReleaseId: identifier, candidateReleaseId: identifier })
      .strict(),
    manifestOperation: "compare_release",
    exposed: true,
  },
  {
    localId: "release.private",
    description: "Create a release available only to its creator.",
    manifestOperation: "prepare_release",
    requires: "edit",
    exposed: true,
    risk: "confirm",
  },
  {
    localId: "release.limited",
    description: "Create an evidenced release available only on request.",
    manifestOperation: "prepare_release",
    requires: "edit",
    exposed: true,
    risk: "always-confirm",
  },
  {
    localId: "release.publish",
    description: "Publish the exact evaluated draft.",
    manifestOperation: "publish_release",
    requires: "edit",
    exposed: true,
    risk: "always-confirm",
  },
  {
    localId: "release.promote",
    description: "Promote an evidenced limited release.",
    params: z.object({ releaseId: identifier }).strict(),
    manifestOperation: "publish_release",
    requires: "edit",
    exposed: true,
    risk: "always-confirm",
  },
  {
    localId: "release.rollback",
    description: "Restore an earlier evidenced immutable release.",
    params: z.object({ releaseId: identifier }).strict(),
    manifestOperation: "compare_release",
    requires: "edit",
    exposed: true,
    risk: "always-confirm",
  },
  {
    localId: "release.suspend",
    description:
      "Suspend new routing to the current release without deleting evidence.",
    params: z.object({ releaseId: identifier }).strict(),
    manifestOperation: "publish_release",
    requires: "edit",
    exposed: true,
    risk: "always-confirm",
  },
  {
    localId: "release.deprecate",
    description:
      "Deprecate a non-serving release so it cannot be restored later.",
    params: z.object({ releaseId: identifier }).strict(),
    manifestOperation: "publish_release",
    requires: "edit",
    exposed: true,
    risk: "destructive",
  },
  {
    localId: "release.inspectBrief",
    description: "Inspect the complete operating brief the runtime reads.",
    manifestOperation: "inspect_release",
    exposed: true,
  },

  {
    localId: "routing.editDescription",
    description:
      "Describe when this specialist is substantially better than ordinary Spectra.",
    params: shortText,
    manifestOperation: "configure_routing",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "routing.editExamples",
    description: "Edit positive automatic-routing examples.",
    params: z.array(z.string().trim().min(1).max(500)).max(50),
    manifestOperation: "add_routing_example",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "routing.editNegativeExamples",
    description: "Edit requests that must retain ordinary Spectra.",
    params: z.array(z.string().trim().min(1).max(500)).max(50),
    manifestOperation: "add_routing_example",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "routing.toggle",
    description: "Enable or disable automatic routing.",
    params: z.boolean(),
    manifestOperation: "configure_routing",
    requires: "edit",
    exposed: true,
  },
  {
    localId: "routing.preview",
    description:
      "Preview the production routing decision for a sample request.",
    params: shortText,
    manifestOperation: "configure_routing",
    exposed: true,
  },

  {
    localId: "privacy.inspectInvocations",
    description: "Inspect private invocation prompts and responses.",
    manifestOperation: "check_privacy",
    disabledReason:
      "Private prompts, responses, threads, and memory are not available to an agent creator. Only consented feedback and aggregates are shown.",
  },
  {
    localId: "routing.trafficSplit",
    description: "Split traffic between arbitrary agent variants.",
    manifestOperation: "configure_routing",
    disabledReason:
      "Percentage traffic experiments are not available. Use creator-only, on-request, and published releases instead.",
  },
  {
    localId: "evaluation.providerTraces",
    description: "Inspect provider-private model traces.",
    manifestOperation: "inspect_eval_results",
    disabledReason:
      "Model-provider private traces are not available. Spectra shows only recorded case outcomes, timings, token counts, and response excerpts.",
  },
  {
    localId: "export.withSecrets",
    description: "Export an agent with credentials or protected source bytes.",
    manifestOperation: "check_resource_leakage",
    disabledReason:
      "Portable agent manifests never include secrets, private prompts, memory, outputs, or copied resource content.",
  },
];

export const AGENT_STUDIO_CAPABILITIES: readonly CapabilityDefinition[] =
  AGENT_SPECS.map((spec) => {
    const id = `agent.${spec.localId}` as CapabilityDefinition["id"];
    return {
      id,
      params: spec.params ?? none,
      scope: "artifact",
      availability: (context) => {
        if (spec.disabledReason)
          return { state: "disabled" as const, reason: spec.disabledReason };
        if (spec.requires && !context.can(spec.requires))
          return { state: "hidden" as const };
        return { state: "enabled" as const };
      },
      execute: { editor: id },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: spec.risk ?? "safe",
      },
      choreography: { target: "workbar-command", region: id },
      manifestOperation: spec.manifestOperation,
      ...(spec.requires ? { requires: spec.requires } : {}),
    } satisfies CapabilityDefinition;
  });
