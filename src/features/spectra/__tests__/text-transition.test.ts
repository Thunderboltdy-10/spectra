import { describe, expect, it } from "vitest";
import {
  changedLineRange,
  planTextTransition,
  pointForOffset,
} from "../collaboration/text-transition";
import { planChoreography, scheduleConcurrently } from "../collaboration/choreography";
import type { SemanticTarget } from "../collaboration/interaction-model";

function frames(before: string, after: string, code = false) {
  const plan = planTextTransition(before, after, code ? { code: true } : {});
  expect(plan).not.toBeNull();
  return plan!;
}

describe("planTextTransition", () => {
  it("returns null for a no-op so nothing animates without a change", () => {
    expect(planTextTransition("same", "same")).toBeNull();
  });

  it("ends on the exact target value", () => {
    const plan = frames("Old summary", "New summary text");
    expect(plan.frames[plan.frames.length - 1]!.value).toBe("New summary text");
  });

  it("never emits a partial word", () => {
    // The naive diff of colour -> color leaves "colr"; snapping to token
    // boundaries must replace the whole word instead.
    const plan = frames(
      "The colour of the sky",
      "The color of the sky",
    );
    for (const frame of plan.frames) {
      expect(frame.value).not.toContain("colr");
      expect(frame.value).not.toMatch(/\bcolo\b/);
    }
  });

  it("preserves the untouched prefix and suffix in every frame", () => {
    const before = "Intro sentence. The middle claim is wrong. Closing note.";
    const after = "Intro sentence. The middle claim is now correct. Closing note.";
    const plan = frames(before, after);
    for (const frame of plan.frames) {
      expect(frame.value.startsWith("Intro sentence.")).toBe(true);
      expect(frame.value.endsWith("Closing note.")).toBe(true);
    }
  });

  it("clears the old span before typing, so text never overlaps", () => {
    const plan = frames("alpha beta gamma", "alpha delta gamma");
    const select = plan.frames.find((frame) => frame.phase === "select");
    const remove = plan.frames.find((frame) => frame.phase === "delete");
    expect(select?.value).toBe("alpha beta gamma");
    expect(remove?.value).toContain("alpha");
    expect(remove?.value).toContain("gamma");
    expect(remove?.value).not.toContain("beta");
    expect(remove?.value).not.toContain("delta");
  });

  it("marks the selection span over the old content, not the new", () => {
    const plan = frames("alpha beta gamma", "alpha delta gamma");
    const select = plan.frames.find((frame) => frame.phase === "select")!;
    const span = select.span!;
    expect(select.value.slice(span.start, span.end)).toContain("beta");
  });

  it("skips selection and deletion for a pure insertion", () => {
    const plan = frames("alpha gamma", "alpha beta gamma");
    expect(plan.frames.some((frame) => frame.phase === "select")).toBe(false);
    expect(plan.frames.some((frame) => frame.phase === "insert")).toBe(true);
  });

  it("handles pure deletion without typing anything back", () => {
    const plan = frames("alpha beta gamma", "alpha gamma");
    expect(plan.frames[plan.frames.length - 1]!.value).toBe("alpha gamma");
    expect(plan.frames.some((frame) => frame.phase === "type")).toBe(false);
  });

  it("splits code on line boundaries so no frame shows a broken statement", () => {
    const before = "const a = 1;\nconst b = 2;\nreturn a + b;";
    const after = "const a = 1;\nconst b = 20;\nconst c = 3;\nreturn a + b + c;";
    const plan = frames(before, after, true);
    for (const frame of plan.frames) {
      // Every line in every frame is either empty or terminated.
      const lines = frame.value.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        expect(line.trim().endsWith(";")).toBe(true);
      }
    }
  });

  it("bounds the frame count so long rewrites stay readable", () => {
    const before = "short";
    const after = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const plan = frames(before, after);
    expect(plan.frames.length).toBeLessThanOrEqual(12);
  });

  it("keeps the total budget inside a human rhythm", () => {
    const small = frames("a", "b");
    expect(small.totalMs).toBeLessThan(900);
    const large = frames(
      "old",
      Array.from({ length: 400 }, (_, i) => `w${i}`).join(" "),
    );
    // Fast model output becomes readable, never a crawl.
    expect(large.totalMs).toBeLessThanOrEqual(1900);
  });

  it("reports the changed span in final-value coordinates", () => {
    const before = "alpha beta gamma";
    const after = "alpha delta gamma";
    const plan = frames(before, after);
    expect(after.slice(plan.changed.start, plan.changed.end)).toContain("delta");
  });

  it("survives replacing everything", () => {
    const plan = frames("completely different", "nothing alike here");
    expect(plan.frames[plan.frames.length - 1]!.value).toBe("nothing alike here");
  });

  it("survives an empty starting value", () => {
    const plan = frames("", "First words");
    expect(plan.frames[plan.frames.length - 1]!.value).toBe("First words");
  });

  it("survives clearing to empty", () => {
    const plan = frames("Some words", "");
    expect(plan.frames[plan.frames.length - 1]!.value).toBe("");
  });

  it("never leaves unbalanced quotes mid-transition in a quoted value", () => {
    const before = 'title: "Old Heading"';
    const after = 'title: "A New Heading"';
    const plan = frames(before, after, true);
    for (const frame of plan.frames) {
      const quotes = (frame.value.match(/"/g) ?? []).length;
      expect(quotes % 2).toBe(0);
    }
  });
});

describe("line helpers", () => {
  it("locates the changed line range", () => {
    expect(changedLineRange("a\nb\nc", "a\nB\nc")).toEqual({ start: 1, end: 1 });
    expect(changedLineRange("a\nb", "a\nb")).toBeNull();
  });

  it("converts flat offsets into line and column", () => {
    expect(pointForOffset("abc\ndefgh", 6)).toEqual({ line: 1, offset: 2 });
    expect(pointForOffset("abc", 2)).toEqual({ line: 0, offset: 2 });
  });
});

const textTarget: SemanticTarget = {
  artifactId: "art-1",
  path: "/summary",
  primitive: "richtext",
  label: "Summary",
};

describe("planChoreography", () => {
  it("performs a text edit as focus, select, clear, type, settle", () => {
    const plan = planChoreography({
      target: textTarget,
      before: "alpha beta",
      after: "alpha gamma",
    })!;
    const kinds = plan.frames.map((frame) => frame.act.kind);
    expect(kinds[0]).toBe("hover");
    expect(kinds).toContain("focus");
    expect(kinds).toContain("select");
    expect(kinds).toContain("delete");
    expect(kinds).toContain("type");
    expect(plan.frames[plan.frames.length - 1]!.lifecycle).toBe("settled");
  });

  it("returns null when nothing changes", () => {
    expect(
      planChoreography({ target: textTarget, before: "same", after: "same" }),
    ).toBeNull();
  });

  it("opens, walks and closes a dropdown", () => {
    const plan = planChoreography({
      target: {
        artifactId: "art-1",
        path: "/status",
        primitive: "dropdown",
        label: "Status",
      },
      before: "todo",
      after: "done",
      menuOptions: [
        { value: "todo", label: "To do" },
        { value: "doing", label: "In progress" },
        { value: "done", label: "Done" },
      ],
    })!;
    const kinds = plan.frames.map((frame) => frame.act.kind);
    expect(kinds).toContain("press");
    expect(kinds).toContain("menuOpen");
    expect(kinds).toContain("menuNavigate");
    expect(kinds).toContain("menuSelect");
    expect(kinds).toContain("menuClose");
    // The observed menu walks through the intervening option.
    const navigated = plan.frames
      .filter((frame) => frame.act.kind === "menuNavigate")
      .map((frame) => (frame.act as { option: string }).option);
    expect(navigated).toEqual(["doing", "done"]);
  });

  it("only shows menu options it actually knows about", () => {
    const plan = planChoreography({
      target: { artifactId: "a", path: "/priority", primitive: "dropdown" },
      before: "low",
      after: "high",
    })!;
    const open = plan.frames.find((frame) => frame.act.kind === "menuOpen")!;
    expect(open.menu?.options.map((option) => option.value)).toEqual([
      "low",
      "high",
    ]);
  });

  it("animates a toggle as press then state change", () => {
    const plan = planChoreography({
      target: { artifactId: "a", path: "/allDay", primitive: "toggle", label: "All day" },
      before: false,
      after: true,
    })!;
    expect(plan.frames.map((frame) => frame.act.kind)).toEqual([
      "hover",
      "press",
      "toggle",
      "focus",
    ]);
  });

  it("drags a spatial object through movement to a settled drop", () => {
    const plan = planChoreography({
      target: {
        artifactId: "a",
        path: "/events/2",
        primitive: "timelineEvent",
        label: "Event 3",
      },
      before: { start: "09:00", end: "10:00" },
      after: { start: "13:00", end: "14:00" },
    })!;
    const kinds = plan.frames.map((frame) => frame.act.kind);
    expect(kinds).toContain("dragStart");
    expect(kinds.filter((kind) => kind === "dragMove").length).toBeGreaterThan(2);
    expect(kinds).toContain("dragRelease");
  });

  it("only commits the durable position on the final drag frames", () => {
    const plan = planChoreography({
      target: { artifactId: "a", path: "/nodes/0", primitive: "canvasObject" },
      before: { x: 0, y: 0 },
      after: { x: 100, y: 40 },
    })!;
    const moves = plan.frames.filter((frame) => frame.act.kind === "dragMove");
    const withValues = moves.filter((frame) => frame.value !== undefined);
    expect(withValues.length).toBe(1);
  });

  it("resizes from a handle", () => {
    const plan = planChoreography({
      target: {
        artifactId: "a",
        path: "/nodes/0",
        primitive: "canvasObject",
        part: "handle:se",
      },
      handle: "handle:se",
      size: { width: 220, height: 120 },
      after: { width: 220, height: 120 },
    })!;
    const kinds = plan.frames.map((frame) => frame.act.kind);
    expect(kinds).toContain("resizeStart");
    expect(kinds).toContain("resizeMove");
    expect(kinds).toContain("resizeRelease");
  });

  it("treats a text change inside a canvas object as a text edit", () => {
    const plan = planChoreography({
      target: {
        artifactId: "a",
        path: "/nodes/0/content",
        primitive: "richtext",
      },
      before: "Old note",
      after: "New note",
    })!;
    expect(plan.frames.map((frame) => frame.act.kind)).toContain("select");
  });

  it("plans structural create and remove", () => {
    const created = planChoreography({
      target: { artifactId: "a", path: "/slides/4", primitive: "listItem", label: "Slide 5" },
      intent: "create",
      after: { id: "s5" },
    })!;
    expect(created.frames.map((frame) => frame.act.kind)).toContain("create");

    const removed = planChoreography({
      target: { artifactId: "a", path: "/slides/4", primitive: "listItem" },
      intent: "remove",
    })!;
    expect(removed.frames.map((frame) => frame.act.kind)).toContain("remove");
    // Presence must not linger on an object that no longer exists.
    expect(removed.frames[removed.frames.length - 1]!.act.kind).toBe("idle");
  });

  it("plans a view switch for slides, sheets and files", () => {
    const plan = planChoreography({
      target: {
        artifactId: "a",
        path: "/activeSheetId",
        primitive: "viewSwitch",
        label: "Analysis",
      },
      intent: "switchView",
      after: "sheet-2",
    })!;
    expect(plan.frames.map((frame) => frame.act.kind)).toContain("switchView");
  });

  it("ignores surface targets", () => {
    expect(
      planChoreography({
        target: { artifactId: "a", path: "/viewport", primitive: "surface" },
        before: 1,
        after: 2,
      }),
    ).toBeNull();
  });
});

describe("scheduleConcurrently", () => {
  it("starts independent targets at once", () => {
    const one = planChoreography({
      target: { artifactId: "a", path: "/cards/0/front", primitive: "richtext" },
      before: "a",
      after: "b",
    })!;
    const two = planChoreography({
      target: { artifactId: "a", path: "/cards/1/front", primitive: "richtext" },
      before: "a",
      after: "c",
    })!;
    const scheduled = scheduleConcurrently([one, two]);
    expect(scheduled.every((entry) => entry.startAt === 0)).toBe(true);
  });

  it("serialises plans on the same target so values cannot interleave", () => {
    const one = planChoreography({
      target: { artifactId: "a", path: "/title", primitive: "text" },
      before: "a",
      after: "b",
    })!;
    const two = planChoreography({
      target: { artifactId: "a", path: "/title", primitive: "text" },
      before: "b",
      after: "c",
    })!;
    const scheduled = scheduleConcurrently([one, two]);
    expect(scheduled[1]!.startAt).toBe(one.totalMs);
  });
});
