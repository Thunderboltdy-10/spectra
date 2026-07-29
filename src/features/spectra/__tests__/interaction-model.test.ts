import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "../artifacts/types";
import {
  buildTarget,
  controlRulesForType,
  matchControl,
} from "../collaboration/control-descriptors";
import {
  actUsesCaret,
  canonicalPath,
  cursorModeForAct,
  describeAct,
  joinPath,
  normalizeInteractionState,
  pathSegments,
  pathsIntersect,
  pathWithin,
  presenceColor,
  readInteractionAct,
  readInteractionState,
  actorLabel,
  sameTarget,
  type ActorIdentity,
  type ControlPrimitive,
  type InteractionState,
  type SemanticTarget,
} from "../collaboration/interaction-model";

const humanActor: ActorIdentity = {
  clientId: "c1",
  kind: "human",
  name: "Nadia M.",
  accountId: "acc-nadia",
};

const aiActor: ActorIdentity = {
  clientId: "c2",
  kind: "ai",
  name: "Nadia M.'s AI",
  ownerAccountId: "acc-nadia",
  ownerName: "Nadia M.",
  runId: "run-1",
};

function target(overrides: Partial<SemanticTarget> = {}): SemanticTarget {
  return {
    artifactId: "art-1",
    path: "/title",
    primitive: "text",
    ...overrides,
  };
}

describe("canonical paths", () => {
  it("strips the /content prefix so server and editor pointers match", () => {
    expect(canonicalPath("/content/cards/0/front")).toBe("/cards/0/front");
    expect(canonicalPath("/content")).toBe("/");
    expect(canonicalPath("cards/0")).toBe("/cards/0");
    expect(canonicalPath("/cards/0/")).toBe("/cards/0");
    expect(canonicalPath("")).toBe("/");
    expect(canonicalPath(undefined)).toBe("/");
  });

  it("round-trips segments through pointer escaping", () => {
    const segments = ["sheets", "s1", "cells", "A/1", "we~ird"];
    expect(pathSegments(joinPath(segments))).toEqual(segments);
  });

  it("treats the root as containing everything", () => {
    expect(pathWithin("/cards/0", "/")).toBe(true);
    expect(pathWithin("/cards/0/front", "/cards/0")).toBe(true);
    expect(pathWithin("/cards/0", "/cards/0/front")).toBe(false);
  });

  it("intersects in both directions so parent and child both get chrome", () => {
    expect(pathsIntersect("/cards/0", "/cards/0/front")).toBe(true);
    expect(pathsIntersect("/cards/0/front", "/cards/0")).toBe(true);
    expect(pathsIntersect("/cards/0", "/cards/1")).toBe(false);
  });

  it("does not treat sibling prefixes as nested", () => {
    expect(pathsIntersect("/cards/1", "/cards/10")).toBe(false);
  });
});

describe("control descriptors", () => {
  it("covers every registered artifact type", () => {
    for (const typeKey of ARTIFACT_TYPE_KEYS) {
      expect(controlRulesForType(typeKey).length).toBeGreaterThan(0);
    }
  });

  it("prefers the most specific rule regardless of declaration order", () => {
    expect(matchControl("flashcard_deck", "/cards/0")?.primitive).toBe("listItem");
    expect(matchControl("flashcard_deck", "/cards/0/front")?.primitive).toBe(
      "richtext",
    );
    expect(matchControl("flashcard_deck", "/cards/0/variant")?.primitive).toBe(
      "dropdown",
    );
    expect(
      matchControl("flashcard_deck", "/cards/0/bidirectional")?.primitive,
    ).toBe("toggle");
  });

  it("resolves the same primitive from a /content-prefixed pointer", () => {
    expect(matchControl("quiz", "/content/questions/2/prompt")?.primitive).toBe(
      "richtext",
    );
  });

  it("labels array indices from one so peers read human positions", () => {
    expect(matchControl("quiz", "/questions/0/prompt")?.label).toBe(
      "Question 1 prompt",
    );
    expect(matchControl("presentation", "/slides/3/speakerNotes")?.label).toBe(
      "Slide 4 notes",
    );
  });

  it("maps sheet cells to grid cells addressed by A1 reference", () => {
    const match = matchControl("sheets", "/sheets/s1/cells/F2");
    expect(match?.primitive).toBe("gridCell");
    expect(match?.label).toBe("Cell F2");
    expect(match?.scope).toEqual({ kind: "sheet", id: "s1" });
  });

  it("scopes slide and file targets so peers know what must be on screen", () => {
    expect(matchControl("presentation", "/slides/2/objects/1")?.scope).toEqual({
      kind: "slide",
      id: "2",
    });
    expect(matchControl("code", "/files/0/source")?.scope).toEqual({
      kind: "file",
      id: "0",
    });
  });

  it("declares resize handles on spatial primitives only", () => {
    expect(matchControl("whiteboard", "/nodes/0")?.parts).toContain("handle:se");
    expect(matchControl("timetable", "/events/0")?.parts).toContain(
      "handle:start",
    );
    expect(matchControl("planner_task", "/status")?.parts).toEqual([]);
  });

  it("falls back to the shell fields shared by all types", () => {
    for (const typeKey of ARTIFACT_TYPE_KEYS) {
      expect(matchControl(typeKey, "/title")?.primitive).toBe("text");
    }
  });

  it("covers the whole primitive vocabulary across the type catalogue", () => {
    const seen = new Set<ControlPrimitive>();
    for (const typeKey of ARTIFACT_TYPE_KEYS) {
      for (const rule of controlRulesForType(typeKey)) seen.add(rule.primitive);
    }
    const expected: ControlPrimitive[] = [
      "text",
      "richtext",
      "code",
      "dropdown",
      "toggle",
      "slider",
      "gridCell",
      "timelineEvent",
      "canvasObject",
      "listItem",
      "viewSwitch",
      "surface",
    ];
    for (const primitive of expected) expect(seen).toContain(primitive);
  });
});

describe("buildTarget", () => {
  it("derives primitive, label and scope from the descriptor table", () => {
    const built = buildTarget({
      typeKey: "presentation",
      artifactId: "art-1",
      path: "/content/slides/1/objects/0/content",
    });
    expect(built.primitive).toBe("richtext");
    expect(built.path).toBe("/slides/1/objects/0/content");
    expect(built.scope).toEqual({ kind: "slide", id: "1" });
    expect(built.label).toBe("Slide 2 text");
  });

  it("degrades to a surface target for undeclared paths rather than guessing", () => {
    const built = buildTarget({
      typeKey: "document",
      artifactId: "art-1",
      path: "/somethingNew",
    });
    expect(built.primitive).toBe("surface");
  });

  it("keys targets by artifact, path, part and scope", () => {
    expect(sameTarget(target(), target())).toBe(true);
    expect(sameTarget(target(), target({ path: "/summary" }))).toBe(false);
    expect(sameTarget(target(), target({ part: "handle:se" }))).toBe(false);
  });
});

describe("act semantics", () => {
  it("gives every act exactly one cursor mode", () => {
    expect(cursorModeForAct({ kind: "hover" })).toBe("pointer");
    expect(cursorModeForAct({ kind: "type", point: { offset: 3 } })).toBe("caret");
    expect(
      cursorModeForAct({
        kind: "select",
        span: { anchor: { offset: 0 }, head: { offset: 4 } },
      }),
    ).toBe("selection");
    expect(cursorModeForAct({ kind: "menuOpen" })).toBe("menu");
    expect(cursorModeForAct({ kind: "dragMove" })).toBe("grab");
    expect(cursorModeForAct({ kind: "resizeMove" })).toBe("resize");
    expect(cursorModeForAct({ kind: "idle" })).toBe("hidden");
  });

  it("classifies caret-bearing acts", () => {
    expect(actUsesCaret({ kind: "type", point: { offset: 0 } })).toBe(true);
    expect(
      actUsesCaret({
        kind: "replace",
        span: { anchor: { offset: 0 }, head: { offset: 2 } },
      }),
    ).toBe(true);
    expect(actUsesCaret({ kind: "hover" })).toBe(false);
  });

  it("narrates acts using the control label", () => {
    expect(
      describeAct({ kind: "replace", span: { anchor: { offset: 0 }, head: { offset: 1 } } }, target({ label: "Priority" })),
    ).toBe("Rewriting Priority");
    expect(describeAct({ kind: "menuOpen" }, target({ label: "Status" }))).toBe(
      "Opening Status",
    );
  });
});

describe("state normalization", () => {
  const base = (overrides: Partial<InteractionState>): InteractionState => ({
    v: 2,
    actor: humanActor,
    act: { kind: "hover" },
    lifecycle: "active",
    target: target(),
    at: 1,
    ...overrides,
  });

  it("drops an act that has no target so a cursor cannot hover nothing", () => {
    const state = normalizeInteractionState(base({ target: null }));
    expect(state.act.kind).toBe("idle");
  });

  it("refuses a caret on a control that holds no text", () => {
    const state = normalizeInteractionState(
      base({
        target: target({ primitive: "dropdown", path: "/status" }),
        act: { kind: "type", point: { offset: 2 } },
      }),
    );
    expect(state.act.kind).toBe("focus");
  });

  it("refuses a resize without a handle, since it cannot be drawn accurately", () => {
    const state = normalizeInteractionState(
      base({
        target: target({ primitive: "canvasObject", path: "/nodes/0" }),
        act: { kind: "resizeMove" },
      }),
    );
    expect(state.act.kind).toBe("dragStart");
  });

  it("clears menu chrome when the act is not a menu act", () => {
    const state = normalizeInteractionState(
      base({
        act: { kind: "hover" },
        menu: { label: "Status", options: [{ value: "a", label: "A" }] },
      }),
    );
    expect(state.menu).toBeNull();
  });

  it("clears speculation once the work failed or was cancelled", () => {
    for (const lifecycle of ["failed", "cancelled", "settled"] as const) {
      const state = normalizeInteractionState(
        base({
          lifecycle,
          speculation: { sequence: 1, patches: [{ path: "/title", value: "x" }] },
        }),
      );
      expect(state.speculation).toBeNull();
    }
  });

  it("keeps speculation while the work is completing", () => {
    const state = normalizeInteractionState(
      base({
        lifecycle: "completed",
        speculation: { sequence: 1, patches: [{ path: "/title", value: "x" }] },
      }),
    );
    expect(state.speculation).not.toBeNull();
  });
});

describe("wire parsing", () => {
  it("ignores payloads that are not v2 frames", () => {
    expect(readInteractionState({ cursor: { x: 0.4, y: 0.2 } })).toBeNull();
    expect(readInteractionState(null)).toBeNull();
    expect(readInteractionState({ v: 1, actor: humanActor })).toBeNull();
  });

  it("parses a full frame and canonicalises its paths", () => {
    const parsed = readInteractionState({
      v: 2,
      actor: aiActor,
      act: { kind: "type", point: { offset: 12, line: 2 } },
      lifecycle: "active",
      target: {
        artifactId: "art-1",
        path: "/content/blocks/id:b3/text",
        primitive: "richtext",
      },
      speculation: {
        sequence: 4,
        patches: [{ path: "/content/blocks/0/text", value: "hello" }],
      },
      at: 99,
    });
    expect(parsed?.target?.path).toBe("/blocks/id:b3/text");
    expect(parsed?.speculation?.patches[0]?.path).toBe("/blocks/0/text");
    expect(parsed?.act).toEqual({ kind: "type", point: { offset: 12, line: 2 } });
  });

  it("degrades a malformed caret to focus instead of inventing a position", () => {
    expect(readInteractionAct({ kind: "type" })).toEqual({ kind: "focus" });
    expect(readInteractionAct({ kind: "select", span: {} })).toEqual({
      kind: "focus",
    });
    expect(readInteractionAct({ kind: "menuSelect" })).toEqual({
      kind: "menuOpen",
    });
  });

  it("rejects unknown primitives rather than rendering an unknown control", () => {
    const parsed = readInteractionState({
      v: 2,
      actor: humanActor,
      act: { kind: "hover" },
      target: { artifactId: "a", path: "/x", primitive: "telepathy" },
      at: 1,
    });
    expect(parsed?.target).toBeNull();
  });

  it("bounds speculative patch volume", () => {
    const parsed = readInteractionState({
      v: 2,
      actor: aiActor,
      act: { kind: "hover" },
      target: target(),
      speculation: {
        sequence: 1,
        patches: Array.from({ length: 500 }, (_, index) => ({
          path: `/cards/${index}`,
          value: index,
        })),
      },
      at: 1,
    });
    expect(parsed?.speculation?.patches.length).toBe(64);
  });
});

describe("actor identity", () => {
  it("labels AI by its owner", () => {
    expect(actorLabel(aiActor)).toBe("Nadia M.'s AI");
    expect(actorLabel(humanActor)).toBe("Nadia M.");
  });

  it("falls back to Spectra AI when no owner is known", () => {
    expect(actorLabel({ clientId: "x", kind: "ai", name: "" })).toBe("Spectra AI");
  });

  it("pairs an AI with its owner's colour so the relationship is visible", () => {
    expect(presenceColor(aiActor)).toBe(presenceColor(humanActor));
  });

  it("gives different accounts different colours", () => {
    const other: ActorIdentity = {
      clientId: "c9",
      kind: "human",
      name: "James T.",
      accountId: "acc-james",
    };
    expect(presenceColor(other)).not.toBe(presenceColor(humanActor));
  });
});

describe("descriptor coverage per type", () => {
  const probes: Record<ArtifactTypeKey, string[]> = {
    document: ["/blocks/0/text", "/blocks/0/type", "/outline/1"],
    flashcard_deck: ["/cards/0/front", "/cards/0/occlusions/1", "/settings/shuffle"],
    quiz: ["/questions/0/options/2", "/questions/0/type", "/published"],
    planner_task: ["/status", "/subtasks/0/done", "/recurrence/frequency"],
    agent: ["/instructions/text", "/skills/0/enabled", "/modelPolicy/primary"],
    timetable: ["/events/0/start", "/events/0/layerId", "/layers/0/visible"],
    presentation: ["/slides/0/objects/0", "/slides/0/speakerNotes", "/theme/palette"],
    sheets: ["/sheets/s1/cells/A1", "/sheets/s1/columns/B", "/activeSheetId"],
    code: ["/files/0/source", "/files/0/lines/12", "/parameters/0/value"],
    whiteboard: ["/nodes/0/content", "/edges/0", "/layers/0/visible"],
  };

  it("resolves a concrete primitive for every probe path", () => {
    for (const typeKey of ARTIFACT_TYPE_KEYS) {
      for (const path of probes[typeKey]) {
        const match = matchControl(typeKey, path);
        expect(match, `${typeKey} ${path}`).not.toBeNull();
        expect(match!.primitive, `${typeKey} ${path}`).not.toBe("surface");
      }
    }
  });
});
