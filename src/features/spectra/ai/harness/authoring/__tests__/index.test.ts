import { describe, expect, it } from "vitest";
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
});
