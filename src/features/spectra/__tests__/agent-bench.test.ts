import { describe, expect, it } from "vitest";
import {
  applyBenchInstructions,
  applySuggestion,
  benchCaseToEvaluationCase,
  benchChecksEmpty,
  benchEntries,
  benchPair,
  benchPromptKey,
  buildEvaluationSuite,
  compareBenchOutputs,
  createSkill,
  describeComparison,
  describeInstructionChanges,
  gradeBenchChecks,
  gradeDeterministically,
  isBenchEvaluationCase,
  normalizeBenchChecks,
  normalizeFoundryContent,
  parseCheckLines,
  readBenchInstructions,
  samplePrompts,
  skillForPrompt,
  statementsOf,
  suggestAdjustments,
  SUITE_CASE_LIMIT,
  withBenchCases,
  type BenchCase,
  type BenchRun,
  type SpectraSkill,
} from "../agents/foundry";

function skill(id: string, name: string, purpose: string, extra: Partial<SpectraSkill> = {}) {
  return createSkill(
    {
      id,
      name,
      purpose,
      status: "verified",
      procedure: [
        { order: 1, action: "Read the essay", tools: ["artifact_read"] },
        { order: 2, action: "Mark against the rubric" },
      ],
      outputContract: { shape: "Feedback", mustInclude: ["next step"], mustNotInclude: [] },
      ...extra,
    },
    1,
  );
}

function agent() {
  return normalizeFoundryContent({
    routing: { enabled: true, description: "", examples: ["Mark my history essay please"], negativeExamples: [] },
    foundry: {
      foundationEstablished: true,
      mission: {
        objective: "Give students precise essay feedback against the rubric.",
        exclusions: ["write the essay for them"],
        interactionStyle: { tone: "direct", responseLength: "balanced", clarificationPolicy: "ask_when_needed" },
      },
      skills: [
        skill("essay", "Essay feedback", "Mark essays against a rubric", {
          examples: [{ id: "e1", input: "Here is my essay on the causes of WW1", output: "" }],
        }),
        skill("lab", "Lab report review", "Review science lab reports and their method"),
      ],
    },
  });
}

const savedCase: BenchCase = {
  id: "c1",
  prompt: "Mark this paragraph",
  checks: { mustInclude: ["thesis"], mustNotInclude: ["perfect"], rubric: "Names one concrete fix" },
  required: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("bench checks", () => {
  it("reads one check per line, without blanks, repeats or extra space", () => {
    expect(parseCheckLines("  thesis \n\nThesis\nnext   step\r\n")).toEqual(["thesis", "next step"]);
  });

  it("normalizes untrusted checks and keeps a rubric only when it says something", () => {
    expect(normalizeBenchChecks({ mustInclude: ["a", 3, "a"], mustNotInclude: "x", rubric: "  " })).toEqual({
      mustInclude: ["a"],
      mustNotInclude: [],
    });
    expect(benchChecksEmpty(normalizeBenchChecks({}))).toBe(true);
    expect(benchChecksEmpty(normalizeBenchChecks({ rubric: "Warm" }))).toBe(false);
  });

  it("grades each simple check, ignoring case and spacing", () => {
    const grade = gradeBenchChecks(savedCase.checks, "Your THESIS  is clear, but not perfect.");
    expect(grade.results).toEqual([
      { kind: "include", value: "thesis", passed: true },
      { kind: "exclude", value: "perfect", passed: false },
    ]);
    expect(grade).toMatchObject({ passed: 1, total: 2, allPassed: false, needsJudgement: true });
  });

  it("joins the suite in the regression layer and runs with Run checks", () => {
    const evaluation = benchCaseToEvaluationCase(savedCase);
    expect(evaluation).toMatchObject({ id: "bench-c1", layer: "regression", required: true, input: "Mark this paragraph" });
    expect(isBenchEvaluationCase(evaluation.id)).toBe(true);
    const content = agent();
    const suite = buildEvaluationSuite({
      agentId: "agent",
      mission: content.foundry.mission,
      skills: content.foundry.skills,
      bindings: [],
      previousCases: [evaluation],
    });
    expect(suite.filter((entry) => entry.layer === "regression").map((entry) => entry.id)).toEqual(["bench-c1"]);
  });

  it("keeps every saved test when the suite would overflow, trimming the fullest layer", () => {
    const compiled = [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `c${index}`, layer: "contract" })),
      { id: "a0", layer: "adversarial" },
      { id: "h0", layer: "held_out" },
    ];
    const kept = [{ id: "bench-1", layer: "regression" }, { id: "bench-2", layer: "regression" }];
    expect(withBenchCases(compiled, kept, 6).map((entry) => entry.id)).toEqual([
      "c0", "c1", "a0", "h0", "bench-1", "bench-2",
    ]);
    expect(withBenchCases(compiled, kept).map((entry) => entry.id)).toHaveLength(8);
    expect(SUITE_CASE_LIMIT).toBe(50);
  });

  it("decides a checklist in code, and asks a judge only when the checks hold and a rubric exists", () => {
    const { expectation } = benchCaseToEvaluationCase(savedCase);
    expect(gradeDeterministically(expectation, "Perfect work.")).toMatchObject({
      passed: false,
      score: 0,
      reason: "Missing: thesis. Included what it must not: perfect.",
    });
    expect(gradeDeterministically(expectation, "Sharpen the thesis.")).toBeNull();
    const plain = benchCaseToEvaluationCase({ ...savedCase, checks: { mustInclude: ["thesis"], mustNotInclude: [] } });
    expect(gradeDeterministically(plain.expectation, "The thesis works.")).toEqual({
      passed: true,
      score: 1,
      reason: "Every check you saved holds.",
    });
  });
});

describe("comparing two answers", () => {
  it("reads an answer as its points, without the markdown or headings", () => {
    expect(statementsOf("## Feedback\n- **Thesis** is clear. Add evidence.\n1. Fix [the link](https://x)\n```\ncode()\n```")).toEqual([
      "Thesis is clear.",
      "Add evidence.",
      "Fix the link",
    ]);
  });

  it("says when nothing changed", () => {
    const comparison = compareBenchOutputs("Same words.", "Same   words.");
    expect(comparison.identical).toBe(true);
    expect(describeComparison(comparison)).toEqual(["Same answer, word for word"]);
  });

  it("names new, dropped and reworded points and changes of shape", () => {
    const before = "Your thesis is clear and strong. Add a source for the second claim. The ending is weak.";
    const after = "## Feedback\n- Your thesis is clear and very strong.\n- Add a source for the second claim.\n- Try a counterargument in paragraph three.";
    const comparison = compareBenchOutputs(before, after);
    expect(comparison.added).toEqual(["Try a counterargument in paragraph three."]);
    expect(comparison.removed).toEqual(["The ending is weak."]);
    expect(comparison.kept).toBe(2);
    expect(comparison.reworded).toBe(1);
    expect(comparison.shape).toEqual([
      { label: "Headings", before: 0, after: 1 },
      { label: "List items", before: 0, after: 3 },
    ]);
    expect(describeComparison(comparison)).toEqual([
      "About the same length",
      "1 new point",
      "1 point dropped",
      "1 point reworded",
      "headings 0 to 1",
      "list items 0 to 3",
    ]);
  });

  it("reports a notable change in length", () => {
    const comparison = compareBenchOutputs("Short.", `Long ${"word ".repeat(40)}.`);
    expect(describeComparison(comparison)[0]).toBe("40 words longer");
  });
});

describe("which answers sit side by side", () => {
  const runs: BenchRun[] = [
    { id: "a", prompt: "p", target: "draft", output: "old", createdAt: 1 },
    { id: "b", prompt: "p", target: "release", releaseNumber: 2, output: "rel2", createdAt: 2 },
    { id: "c", prompt: "p", target: "draft", output: "new", createdAt: 3 },
    { id: "d", prompt: "p", target: "release", releaseNumber: 1, output: "rel1", createdAt: 4 },
  ];

  it("pairs the latest draft answer with the one before it", () => {
    expect(benchPair(runs, "previous")).toEqual({ current: runs[2], baseline: runs[0] });
  });

  it("pairs it with the last release's answer for that release only", () => {
    expect(benchPair(runs, "release", 2)).toEqual({ current: runs[2], baseline: runs[1] });
    expect(benchPair(runs, "release", 3)).toEqual({ current: runs[2] });
    expect(benchPair(runs, "release")).toEqual({ current: runs[2] });
  });

  it("lists kept tests first, then recent prompts, then new ones, once each", () => {
    const entries = benchEntries({
      cases: [{ ...savedCase, prompt: "Mark  this paragraph" }],
      runs: [
        { id: "1", prompt: "mark this paragraph", target: "draft", output: "x", createdAt: 5 },
        { id: "2", prompt: "Explain feudalism", target: "draft", output: "y", createdAt: 9 },
      ],
      added: ["Explain feudalism", "A brand new question"],
      removed: new Set([benchPromptKey("gone")]),
    });
    expect(entries.map((entry) => [entry.prompt, Boolean(entry.saved), entry.runs.length])).toEqual([
      ["Mark  this paragraph", true, 1],
      ["Explain feudalism", false, 1],
      ["A brand new question", false, 0],
    ]);
  });

  it("offers worked and routing examples that are not on the bench yet", () => {
    const content = agent();
    expect(samplePrompts(content, [], ["Mark my history essay please"])).toEqual([
      "Here is my essay on the causes of WW1",
    ]);
  });
});

describe("adjusting the instructions", () => {
  it("reads and writes back the parts the brief is compiled from", () => {
    const content = agent();
    const before = readBenchInstructions(content);
    expect(before.skills.map((entry) => entry.steps)).toEqual([
      ["Read the essay", "Mark against the rubric"],
      ["Read the essay", "Mark against the rubric"],
    ]);
    const after = {
      ...before,
      objective: "Give students short, precise essay feedback.",
      tone: "warm" as const,
      exclusions: ["write the essay for them", "  grade other subjects "],
      skills: before.skills.map((entry) =>
        entry.id === "essay" ? { ...entry, steps: ["Read the whole essay", "Mark against the rubric", ""] } : entry,
      ),
    };
    expect(describeInstructionChanges(before, after)).toEqual([
      "Objective",
      "Tone: warm",
      "What it must not do",
      "Essay feedback: steps",
    ]);
    const next = applyBenchInstructions(content, after, 99);
    expect(next.foundry.mission.objective).toBe("Give students short, precise essay feedback.");
    expect(next.foundry.mission.interactionStyle.tone).toBe("warm");
    expect(next.foundry.mission.exclusions).toEqual(["write the essay for them", "grade other subjects"]);
    const essay = next.foundry.skills.find((entry) => entry.id === "essay")!;
    // A reworded step keeps the tools it was granted.
    expect(essay.procedure).toEqual([
      { order: 1, action: "Read the whole essay", tools: ["artifact_read"] },
      { order: 2, action: "Mark against the rubric" },
    ]);
    expect(essay.updatedAt).toBe(99);
    // An untouched skill is the same object.
    expect(next.foundry.skills.find((entry) => entry.id === "lab")).toBe(content.foundry.skills.find((entry) => entry.id === "lab"));
  });

  it("suggests a fix for each failed check, on the skill the prompt reaches", () => {
    const content = agent();
    expect(skillForPrompt("Please review my lab report method", content.foundry.skills)?.id).toBe("lab");
    const grade = gradeBenchChecks({ mustInclude: ["hypothesis", "next step"], mustNotInclude: ["great"] }, "Great report.");
    const suggestions = suggestAdjustments("Please review my lab report method", grade, content.foundry.skills);
    // "next step" is already in the skill's contract, so it is not suggested again.
    expect(suggestions).toEqual([
      { kind: "include", value: "hypothesis", skillId: "lab", skillName: "Lab report review" },
      { kind: "exclude", value: "great", skillId: "lab", skillName: "Lab report review" },
    ]);
    const next = applySuggestion(applySuggestion(content, suggestions[0]!, 5), suggestions[1]!, 6);
    const lab = next.foundry.skills.find((entry) => entry.id === "lab")!;
    expect(lab.outputContract.mustInclude).toEqual(["next step", "hypothesis"]);
    expect(lab.outputContract.mustNotInclude).toEqual(["great"]);
  });

  it("has nothing to suggest without a skill", () => {
    expect(suggestAdjustments("x", gradeBenchChecks({ mustInclude: ["a"], mustNotInclude: [] }, ""), [])).toEqual([]);
  });
});
