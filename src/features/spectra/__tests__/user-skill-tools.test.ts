import { describe, expect, it } from "vitest";
import { skillWriteAuthority } from "@/features/spectra/ai/authority-policy";
import { applicationCapability } from "@/features/spectra/capabilities/application";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import {
  appCommandById,
  applicationCommandIdForTool,
} from "@/features/spectra/commands/app-registry";
import { evaluatePlanPolicy } from "@/features/spectra/operations/policy";
import { USER_SKILL_LIMITS } from "@/features/spectra/skills/contracts";
import {
  APPLICATION_AGENT_TOOL_IDS,
  spectraToolRegistry,
} from "@/features/spectra/tools/registry";

const validWrite = {
  action: "create" as const,
  name: "Essay evidence checks",
  purpose: "Check every essay claim against a cited source.",
  triggerTerms: ["essay evidence", "source check"],
  body: "# Procedure\n\nList each material claim, locate its source, and flag unsupported wording before revising.",
};

describe("self-authored skill tools and authority", () => {
  it("registers metadata-only reads and a confirmation-bound write", () => {
    expect(APPLICATION_AGENT_TOOL_IDS).toEqual(
      expect.arrayContaining(["list_skills", "read_skill", "write_skill"]),
    );
    expect(spectraToolRegistry.require("list_skills")).toMatchObject({
      category: "read",
      approval: "never",
    });
    expect(spectraToolRegistry.require("read_skill")).toMatchObject({
      category: "read",
      approval: "never",
    });
    expect(spectraToolRegistry.require("write_skill")).toMatchObject({
      category: "write",
      approval: "always",
      authorityTarget: "skill",
      concurrencyDomain: "user_skills",
    });
    expect(applicationCommandIdForTool("write_skill")).toBe("app.skill.write");
    expect(appCommandById("app.skill.write")?.risk).toBe("always-confirm");
    expect(applicationCapability("app.skill.write").ai).toMatchObject({
      exposed: true,
      riskClass: "always-confirm",
    });
  });

  it("validates create and update shapes at the tool boundary", () => {
    expect(spectraToolRegistry.parseInput("write_skill", validWrite)).toEqual(
      validWrite,
    );
    expect(() =>
      spectraToolRegistry.parseInput("write_skill", {
        ...validWrite,
        action: "update",
      }),
    ).toThrow(/exact skill id/i);
    expect(() =>
      spectraToolRegistry.parseInput("write_skill", {
        ...validWrite,
        body: "x".repeat(USER_SKILL_LIMITS.bodyCharacters + 1),
      }),
    ).toThrow();
  });

  it("always confirms the first write and confirms every later write", () => {
    expect(skillWriteAuthority(false).decision).toBe("always-confirm");
    expect(skillWriteAuthority(true).decision).toBe("confirm");

    const policy = evaluatePlanPolicy([
      {
        type: "app.command",
        input: { command: "write_skill", args: validWrite },
      },
    ] as never);
    expect(policy).toMatchObject({
      requiresConfirmation: true,
      reasons: ["Create an AI skill"],
    });
  });

  it("keeps a rejected skill's plain reason while removing its machine code", () => {
    expect(
      humanizePublicFailure(
        "USER_SKILL_INVALID: This skill cannot save secrets, credentials, or sensitive personal data.",
      ),
    ).toBe(
      "This skill cannot save secrets, credentials, or sensitive personal data.",
    );
  });
});
