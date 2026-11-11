import { describe, expect, it } from "vitest";
import {
  controlOwnershipKey,
  heldControlsFrom,
  heldExplanation,
} from "../collaboration/held-controls";
import type {
  InteractionAct,
  InteractionLifecycle,
  InteractionState,
} from "../collaboration/interaction-model";

function state(overrides: {
  clientId?: string;
  kind?: "human" | "ai";
  name?: string;
  path?: string;
  act?: InteractionAct;
  lifecycle?: InteractionLifecycle;
}): InteractionState {
  return {
    v: 2,
    actor: {
      clientId: overrides.clientId ?? "peer-1",
      kind: overrides.kind ?? "human",
      name: overrides.name ?? "Nadia M.",
    },
    act: overrides.act ?? { kind: "type", point: { offset: 3 } },
    lifecycle: overrides.lifecycle ?? "active",
    target: {
      artifactId: "art-1",
      path: overrides.path ?? "/questions/2/prompt",
      primitive: "text",
    },
    at: Date.now(),
  };
}

describe("heldControlsFrom", () => {
  it("holds the exact control a peer is typing into", () => {
    const held = heldControlsFrom([state({})]);
    expect([...held.keys()]).toEqual(["/questions/2/prompt"]);
    expect(held.get("/questions/2/prompt")?.label).toBe("Nadia M.");
  });

  it("holds nothing wider than the control itself", () => {
    const held = heldControlsFrom([state({})]);
    // The question, the card and the artifact all remain editable.
    expect(held.has("/questions/2")).toBe(false);
    expect(held.has("/questions")).toBe(false);
    expect(held.has("/")).toBe(false);
  });

  it("treats an AI exactly like a human collaborator", () => {
    const held = heldControlsFrom([
      state({ kind: "ai", name: "Pablo's AI", clientId: "ai-1" }),
    ]);
    const entry = held.get("/questions/2/prompt")!;
    expect(entry.kind).toBe("ai");
    expect(entry.label).toBe("Pablo's AI");
  });

  it("ignores the local actor's own frames", () => {
    expect(heldControlsFrom([state({ clientId: "me" })], "me").size).toBe(0);
  });

  it("does not hold a control a peer is merely hovering", () => {
    expect(
      heldControlsFrom([
        state({ act: { kind: "hover", at: { x: 0.5, y: 0.5 } } }),
      ]).size,
    ).toBe(0);
    expect(heldControlsFrom([state({ act: { kind: "idle" } })]).size).toBe(0);
  });

  it("releases the control once the artifact settles", () => {
    expect(heldControlsFrom([state({ lifecycle: "settled" })]).size).toBe(0);
    expect(heldControlsFrom([state({ lifecycle: "completed" })]).size).toBe(0);
  });

  it("does not let a waiting actor hold what it is still queued for", () => {
    expect(heldControlsFrom([state({ lifecycle: "blocked" })]).size).toBe(0);
    expect(heldControlsFrom([state({ lifecycle: "queued" })]).size).toBe(0);
  });

  it("holds carets, selections, menus, drags and resizes alike", () => {
    const acts: InteractionAct[] = [
      { kind: "caret", point: { offset: 0 } },
      { kind: "select", span: { anchor: { offset: 0 }, head: { offset: 4 } } },
      { kind: "menuOpen" },
      { kind: "dragStart" },
      { kind: "resizeStart" },
      { kind: "toggle", value: true },
    ];
    for (const act of acts) {
      expect(heldControlsFrom([state({ act })]).size).toBe(1);
    }
  });

  it("attributes a contested control to one actor, never both", () => {
    const held = heldControlsFrom([
      state({ clientId: "peer-1", name: "Nadia M." }),
      state({ clientId: "peer-2", name: "Tom R." }),
    ]);
    expect(held.size).toBe(1);
    expect(held.get("/questions/2/prompt")?.label).toBe("Nadia M.");
  });

  it("leaves unrelated controls free while one is held", () => {
    const held = heldControlsFrom([
      state({ path: "/questions/2/prompt" }),
      state({ clientId: "peer-2", path: "/questions/5/prompt" }),
    ]);
    expect([...held.keys()].sort()).toEqual([
      "/questions/2/prompt",
      "/questions/5/prompt",
    ]);
    expect(held.has("/questions/3/prompt")).toBe(false);
  });
});

describe("heldExplanation", () => {
  it("names the holder and reassures about the rest of the artifact", () => {
    const message = heldExplanation({
      path: "/questions/2/prompt",
      label: "Pablo's AI",
      kind: "ai",
    });
    expect(message).toContain("Pablo's AI");
    expect(message).toContain("other changes are unaffected");
  });
});

describe("controlOwnershipKey", () => {
  it("treats a sheet cell and its detached formula/value affordances as one control", () => {
    expect(controlOwnershipKey("/sheets/0/cells/B4")).toBe(
      "/sheets/0/cells/B4",
    );
    expect(controlOwnershipKey("/sheets/0/cells/B4/value")).toBe(
      "/sheets/0/cells/B4",
    );
    expect(controlOwnershipKey("/sheets/0/cells/B4/formula")).toBe(
      "/sheets/0/cells/B4",
    );
    expect(controlOwnershipKey("/sheets/0/cells/B4/format/bold")).toBe(
      "/sheets/0/cells/B4",
    );
  });

  it("does not widen ownership to neighbouring cells or structured fields", () => {
    expect(controlOwnershipKey("/sheets/0/cells/B5")).toBe(
      "/sheets/0/cells/B5",
    );
    expect(controlOwnershipKey("/questions/2/prompt")).toBe(
      "/questions/2/prompt",
    );
    expect(controlOwnershipKey("/questions/2/options/0")).toBe(
      "/questions/2/options/0",
    );
  });
});
