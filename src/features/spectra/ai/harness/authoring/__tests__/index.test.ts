import { describe, expect, it } from "vitest";
import { createSkill, normalizeFoundryContent, projectFoundryToLegacy } from "../../../../agents/foundry";
import { resolveArtifactWriteInput } from "../../../../operations/artifact-write-content";
import { authorEdit, authorNew, readAuthored } from "../index";
import { sequentialIdFactory } from "../shared";

const context = { timeZone: "Europe/Madrid", ids: sequentialIdFactory() };

describe("authoring dispatcher", () => {
  it("creates, edits and reads a document by section", () => {
    const created = authorNew("document", { markdown: "# Cells\n\nIntro.\n\n## Membrane\n\nControls entry.\n\n## Nucleus\n\nHolds DNA." }, context);
    expect(created.problems).toEqual([]);
    expect(created.summary).toMatch(/^About \d+ words$/);
    const edited = authorEdit("document", created.content, [{ op: "replace", find: "Holds DNA.", replace: "Holds the cell's DNA." }], context);
    expect(edited.summary).toBe("Edited");
    expect(readAuthored("document", edited.content, { section: "Nucleus" })).toBe("## Nucleus\n\nHolds the cell's DNA.");
    expect(() => resolveArtifactWriteInput("document", created.content, { content: edited.content }, "")).not.toThrow();
  });

  it("summarises counts and flags placeholder content", () => {
    const deck = authorNew(
      "flashcard_deck",
      { items: [{ front: "H2O?", back: "Water" }, { front: "NaCl?", back: "Salt" }] },
      context,
    );
    expect(deck.summary).toBe("2 cards");
    const grown = authorEdit("flashcard_deck", deck.content, [{ op: "add", items: [{ front: "CO2?", back: "Carbon dioxide" }] }], context);
    expect(grown.summary).toBe("Added 1 card");
    const doc = authorNew("document", { markdown: "# Title\n\nAdd text" }, context);
    expect(doc.problems.join(" ")).toMatch(/placeholder/);
    expect(doc.readback).toMatch(/Problems:/);
  });

  it("authors a custom agent", () => {
    const agent = authorNew(
      "agent",
      {
        purpose: "Coaches students through IB Chemistry internal assessments step by step.",
        instructions: "Ask what stage the student is at, then give one concrete next step with an example from chemistry.",
        tone: "warm",
      },
      context,
    );
    expect(agent.problems).toEqual([]);
    const edited = authorEdit("agent", agent.content, [{ op: "set", tone: "socratic" }], context);
    expect(readAuthored("agent", edited.content)).toMatch(/Tone: socratic/);
    expect(() => authorEdit("agent", agent.content, [{ op: "set", tone: "rude" }], context)).toThrow(/Edit 1 \(set\): tone/);
  });

  it("keeps an agent's Foundry state through an edit, writing the mission's fields to the mission", () => {
    const skill = createSkill({ id: "mark", name: "Mark an essay", purpose: "Marks against the rubric" }, 1);
    const base = normalizeFoundryContent({});
    const built = projectFoundryToLegacy({
      ...base,
      foundry: {
        ...base.foundry,
        foundationEstablished: true,
        mission: { ...base.foundry.mission, objective: "Give students precise essay feedback.", domains: ["English"] },
        skills: [{ ...skill, status: "verified" }],
        evidenceBindings: [{ id: "e1", sourceId: "src", kind: "rubric", label: "Rubric", confirmed: true }],
      },
    });
    const edited = authorEdit("agent", built, [{ op: "set", purpose: "Give students kind, precise essay feedback.", tone: "warm", outOfScope: ["Writing essays"], audience: "Year 10", routingExamples: ["Mark my essay"] }], context);
    const after = normalizeFoundryContent(edited.content);
    expect(after.foundry).toMatchObject({ foundationEstablished: true, skills: [{ id: "mark" }], evidenceBindings: [{ id: "e1" }] });
    expect(after.foundry.mission).toMatchObject({ objective: "Give students kind, precise essay feedback.", domains: ["English"], exclusions: ["Writing essays"], interactionStyle: { tone: "warm" } });
    // Compiled again, as the studio does: the brief follows the mission and the skills stay.
    expect(after.instructions.text).toContain("Give students kind, precise essay feedback.");
    expect(after.instructions.text).toContain("Mark an essay");
    expect(after.profile).toMatchObject({ purpose: "Give students kind, precise essay feedback.", audienceIntent: "Year 10" });
    expect(after.routing.examples).toEqual(["Mark my essay"]);
    expect(readAuthored("agent", edited.content)).toMatch(/^Built in the Agent Foundry/);
    // And the server's write path keeps it too.
    const written = normalizeFoundryContent(resolveArtifactWriteInput("agent", built, { content: edited.content }, "Make it warmer").content);
    expect(written.foundry).toMatchObject({ foundationEstablished: true, skills: [{ id: "mark" }], mission: { interactionStyle: { tone: "warm" } } });

    // What compiling would replace is refused, never silently lost.
    expect(() => authorEdit("agent", built, [{ op: "set", instructions: "Be brief." }], context)).toThrow(/instructions cannot be set: this agent is built in the Agent Foundry/);
    expect(() => authorEdit("agent", built, [{ op: "replace", find: "essay", replace: "report" }], context)).toThrow(/compile_agent/);

    // An agent not yet built there keeps whatever Foundry state it has.
    const started = { ...authorNew("agent", { purpose: "Help with lab reports", instructions: "Be concise." }, context).content, foundry: { mission: { objective: "Lab reports" } } };
    expect((authorEdit("agent", started, [{ op: "set", tone: "direct" }], context).content as Record<string, unknown>).foundry).toEqual({ mission: { objective: "Lab reports" } });
  });
});
