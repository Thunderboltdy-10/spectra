/**
 * Agent mission foundation model
 * Phase 10 - Agent Foundry
 */

export type InputContract = {
  kind: "text" | "file" | "work" | "data" | "free_form";
  description: string;
  required: boolean;
};

export type OutputContract = {
  kind: "document" | "code" | "analysis" | "response" | "work";
  description: string;
  format?: string;
};

export type DecisionPolicy = {
  scope: string;
  autonomy: "always_ask" | "ask_when_uncertain" | "decide_and_inform";
  boundaries: string[];
};

export type ApprovalBoundary = {
  action: string;
  requiresApproval: boolean;
  reason: string;
};

export type EvidenceRequirement = {
  domain: string;
  minimumExamples: number;
  purpose: string;
};

export type InteractionStyle = {
  tone: "warm" | "direct" | "socratic" | "formal" | "playful" | "professional";
  responseLength: "concise" | "balanced" | "detailed";
  clarificationPolicy: "ask_when_needed" | "confirm" | "never_ask";
  voiceCharacteristics: string[];
};

export type AgentMission = {
  objective: string;
  domains: string[];
  intendedUsers: string[];
  expectedInputs: InputContract[];
  expectedOutputs: OutputContract[];
  decisionsAllowed: DecisionPolicy[];
  approvalBoundaries: ApprovalBoundary[];
  evidenceRequirements: EvidenceRequirement[];
  exclusions: string[];
  interactionStyle: InteractionStyle;
};

export function createDefaultMission(): AgentMission {
  return {
    objective: "",
    domains: [],
    intendedUsers: ["Any workspace member"],
    expectedInputs: [],
    expectedOutputs: [],
    decisionsAllowed: [],
    approvalBoundaries: [],
    evidenceRequirements: [],
    exclusions: [],
    interactionStyle: {
      tone: "professional",
      responseLength: "balanced",
      clarificationPolicy: "ask_when_needed",
      voiceCharacteristics: [],
    },
  };
}

export function validateMission(mission: AgentMission): string[] {
  const issues: string[] = [];

  if (!mission.objective || mission.objective.trim().length < 30) {
    issues.push("Mission objective must be at least 30 characters");
  }

  if (mission.domains.length === 0) {
    issues.push("Specify at least one domain or subject area");
  }

  if (mission.expectedInputs.length === 0) {
    issues.push("Define what inputs the agent expects");
  }

  if (mission.expectedOutputs.length === 0) {
    issues.push("Define what outputs the agent produces");
  }

  return issues;
}
