import { describe, expect, it } from "vitest";
import { resolveArtifactWriteInput } from "../../../../operations/artifact-write-content";
import { applyCodeEdits, codeFromSpec, codeOutline, codeReadback } from "../code";
import {
  applyListEdits,
  applyPlannerTaskEdits,
  listFromSpec,
  listOutline,
  listProblems,
  listReadback,
  plannerTaskFromSpec,
  plannerTaskOutline,
  plannerTime,
} from "../items";
import { AuthoringError, sequentialIdFactory } from "../shared";

const cards = Array.from({ length: 8 }, (_, index) => ({ front: `Term ${index + 1}?`, back: `Meaning ${index + 1}` }));

describe("flashcard and quiz authoring", () => {
  it("builds an eight-card deck that the writer accepts", () => {
    const deck = listFromSpec("flashcard_deck", { items: cards }, sequentialIdFactory());
    expect((deck.cards as unknown[]).length).toBe(8);
    expect(listProblems("flashcard_deck", deck)).toEqual([]);
    expect(listOutline("flashcard_deck", deck)).toMatch(/^8 cards/);
    expect(() => resolveArtifactWriteInput("flashcard_deck", null, { content: deck }, "")).not.toThrow();
  });

  it("updates, moves, deletes and replaces cards atomically", () => {
    const deck = listFromSpec("flashcard_deck", { items: cards }, sequentialIdFactory());
    const before = JSON.stringify(deck);
    const next = applyListEdits("flashcard_deck", deck, [
      { op: "update", item: 2, back: "A better meaning" },
      { op: "move", item: 8, to: 1 },
      { op: "delete", items: [3] },
      { op: "replace", find: "Term 5?", replace: "Term five?" },
    ]);
    const fronts = (next.cards as Array<{ front: string }>).map((card) => card.front);
    expect(fronts[0]).toBe("Term 8?");
    expect(fronts).toContain("Term five?");
    expect(fronts).toHaveLength(7);
    expect(listReadback("flashcard_deck", next, deck)).toMatch(/Changed or new:/);
    expect(() =>
      applyListEdits("flashcard_deck", deck, [
        { op: "update", item: 1, back: "x" },
        { op: "update", item: 40, back: "y" },
      ]),
    ).toThrow(/Edit 2 \(update\): card 40 does not exist; there are 8/);
    expect(JSON.stringify(deck)).toBe(before);
  });

  it("checks quiz answers against options at write time", () => {
    const quiz = listFromSpec(
      "quiz",
      {
        items: [
          { prompt: "2 + 2?", type: "multiple_choice", options: ["3", "4", "5"], answer: "4", explanation: "Add." },
          { prompt: "Water boils at 100 °C at sea level.", type: "true_false", answer: "True" },
          { prompt: "Pick the primes", type: "select_all", options: ["2", "4", "5"], answer: ["2", "5"] },
          { prompt: "Match", type: "matching", pairs: [{ left: "H", right: "Hydrogen" }, { left: "O", right: "Oxygen" }] },
        ],
        settings: { instructions: "Answer every question." },
      },
      sequentialIdFactory(),
    );
    expect(listProblems("quiz", quiz)).toEqual([]);
    expect(() => resolveArtifactWriteInput("quiz", null, { content: quiz }, "")).not.toThrow();
    expect(() =>
      applyListEdits("quiz", quiz, [{ op: "add", items: [{ prompt: "Capital of France?", options: ["Paris", "Rome"], answer: "Lyon" }] }]),
    ).toThrow(/Edit 1 \(add\) items\[0\]: answer must be exactly one of the options/);
    expect(listOutline("quiz", quiz)).toMatch(/1\. \[multiple_choice\] 2 \+ 2\?\n {3}options: 3 \| 4 \| 5\n {3}answer: 4/);
  });

  it("opens a quiz for attempts and closes it again, as the studio's Publish and Unpublish", () => {
    const quiz = listFromSpec("quiz", { items: [{ prompt: "2 + 2?", options: ["3", "4"], answer: "4" }] }, sequentialIdFactory());
    expect(listOutline("quiz", quiz)).toContain("Not published: closed to new attempts.");
    const open = applyListEdits("quiz", quiz, [{ op: "publish" }]);
    expect(open).toMatchObject({ published: true, publishedAt: expect.any(Number) });
    expect(listOutline("quiz", open)).toContain("Published: open for attempts.");
    expect(() => resolveArtifactWriteInput("quiz", quiz, { content: open }, "")).not.toThrow();
    const closed = applyListEdits("quiz", open, [{ op: "unpublish" }]);
    expect(closed.published).toBe(false);
    expect(closed.questions).toEqual(open.questions);
    // Publishing checks the quiz as it is after every edit in the call.
    expect(() => applyListEdits("quiz", quiz, [{ op: "publish" }, { op: "add", items: [{ prompt: "Explain osmosis.", type: "short_answer" }] }])).toThrow(
      /cannot open for attempts yet/,
    );
    const deck = listFromSpec("flashcard_deck", { items: [{ front: "a", back: "b" }] }, sequentialIdFactory());
    expect(() => applyListEdits("flashcard_deck", deck, [{ op: "publish" }])).toThrow(/is not published/);
  });
});

describe("planner task authoring", () => {
  it("resolves dates in the task's time zone and edits subtasks", () => {
    const task = plannerTaskFromSpec(
      { title: "History essay", due: "2026-10-10", subtasks: ["Outline", "Draft", "Edit"], priority: "high" },
      "Europe/Madrid",
      sequentialIdFactory(),
    );
    expect(task.dueAt).toBe(Date.parse("2026-10-10T23:59:00+02:00"));
    expect(task.allDay).toBe(true);
    const next = applyPlannerTaskEdits(task, [
      { op: "update_subtask", subtask: "Outline", done: true },
      { op: "set", status: "doing" },
    ]);
    expect(plannerTaskOutline(next)).toMatch(/\[doing, high priority\][\s\S]*1\. \[x\] Outline/);
    expect(() => resolveArtifactWriteInput("planner_task", null, { content: next }, "")).not.toThrow();
    expect(() => applyPlannerTaskEdits(task, [{ op: "set", due: "next friday" }])).toThrow(AuthoringError);
    expect(plannerTime("2026-01-15T09:00", "Europe/Madrid", "x", "due")).toBe(Date.parse("2026-01-15T09:00:00+01:00"));
  });
});

describe("code authoring", () => {
  it("creates files, edits by find-and-replace and reads back the changed lines", () => {
    const code = codeFromSpec(
      { files: [{ path: "index.html", source: "<main>\n  <h1>Hello</h1>\n</main>" }, { path: "app.js", source: "console.log(1);" }] },
      sequentialIdFactory(),
    );
    expect(code.runtime).toBe("browser");
    expect(code.files.find((file) => file.id === code.entryFileId)?.path).toBe("index.html");
    const next = applyCodeEdits(code, [{ op: "replace", file: "index.html", find: "<h1>Hello</h1>", replace: "<h1>Hello, class</h1>" }]);
    const html = next.files.find((file) => file.path === "index.html")!;
    expect(html.lineIds?.[0]).toBe(code.files.find((file) => file.path === "index.html")!.lineIds?.[0]);
    expect(codeReadback(next, code)).toMatch(/index\.html lines 1-3 now:[\s\S]*Hello, class/);
    expect(codeOutline(next, { file: "app.js" })).toMatch(/1 {2}console\.log\(1\);/);
    expect(() => resolveArtifactWriteInput("code", null, { content: next }, "")).not.toThrow();
    expect(() => applyCodeEdits(code, [{ op: "replace", find: "x", replace: "y" }])).toThrow(/file is required/);
    expect(() => applyCodeEdits(code, [{ op: "replace", file: "app.js", find: "nothing", replace: "y" }])).toThrow(
      /Edit 1 \(replace\): `find` text is not in app\.js/,
    );
  });
});
