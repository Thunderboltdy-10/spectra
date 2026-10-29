import { describe, expect, it } from "vitest";
import {
  applyBenchEdits,
  applyBenchInstructions,
  applySuggestion,
  benchSuggestionMessages,
  describeBenchEdit,
  parseBenchSuggestions,
  benchCaseToEvaluationCase,
  benchChecksEmpty,
  benchEntries,
  benchPair,
  benchPromptKey,
  buildEvaluationSuite,
  contractCasesForSkill,
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

describe("Generated output-contract checks", () => {
  it("judges descriptive requirements while preserving explicit literal checks", () => {
    const arithmetic = skill("math", "Calculate", "Calculate and explain", {
      outputContract: {
        shape: "An explained calculation",
        mustInclude: ["The calculated answer", "A clear explanation of the calculation"],
        mustNotInclude: ["An incorrect result"],
      },
    });
    const cases = contractCasesForSkill(arithmetic);
    expect(cases).toHaveLength(2);
    for (const entry of cases) {
      expect(entry.expectation).toMatchObject({ kind: "judged", externalTruth: false });
      expect(gradeDeterministically(entry.expectation, "18 + 24 = 42, because 18 + 20 + 4 = 42.")).toBeNull();
      expect(gradeDeterministically(entry.expectation, "18 + 24 = 7.")).toBeNull();
    }
    expect(cases[0].expectation).toMatchObject({ criteria: expect.stringContaining("A clear explanation of the calculation") });
    expect(cases[1].expectation).toMatchObject({ criteria: expect.stringContaining("An incorrect result") });
    expect(gradeDeterministically({ kind: "contains", values: ["42"] }, "The answer is 41.")).toMatchObject({ passed: false });
    expect(gradeDeterministically({ kind: "contains", values: ["42"] }, "The answer is 42.")).toMatchObject({ passed: true });
    expect(gradeDeterministically({ kind: "excludes", values: ["secret-token"] }, "secret-token")).toMatchObject({ passed: false });
  });
});

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

  it("shows a stopped answer as the latest, but compares with a finished one", () => {
    const stopped: BenchRun = { id: "e", prompt: "p", target: "draft", output: "half", createdAt: 5, stopped: true };
    const stoppedRelease: BenchRun = { ...stopped, id: "f", target: "release", releaseNumber: 2, createdAt: 6 };
    expect(benchPair([...runs, stopped], "previous")).toEqual({ current: stopped, baseline: runs[2] });
    expect(benchPair([...runs, { ...stopped, createdAt: 2.5 }], "previous").baseline).toBe(runs[0]);
    expect(benchPair([...runs, stoppedRelease], "release", 2).baseline).toBe(runs[1]);
    expect(benchPair([stoppedRelease], "release", 2).baseline).toBe(stoppedRelease);
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

describe("suggestions the model writes", () => {
  // Ids a creator never sees, to prove the copy never shows them.
  function named() {
    const content = agent();
    return {
      ...content,
      foundry: {
        ...content.foundry,
        skills: content.foundry.skills.map((entry) => ({ ...entry, id: `sk_${entry.id}_7f3a` })),
      },
    };
  }

  it("asks with the instructions, the answer and the failing checks, naming skills and never their ids", () => {
    const instructions = readBenchInstructions(named());
    const [system, user] = benchSuggestionMessages({
      instructions,
      prompt: "Mark this paragraph",
      output: "It is perfect.",
      checks: savedCase.checks,
    });
    expect(system!.role).toBe("system");
    expect(system!.content).toContain('{"suggestions":[]}');
    expect(user!.content).toContain('### Skill "Essay feedback"');
    expect(user!.content).toContain('Includes "thesis": fails');
    expect(user!.content).toContain('Leaves out "perfect": fails');
    expect(user!.content).toContain("What a good answer does: Names one concrete fix");
    expect(user!.content).toContain("It is perfect.");
    expect(`${system!.content}${user!.content}`).not.toContain("7f3a");
  });

  it("reads a fenced reply into edits on the skills it names, and drops what cannot apply", () => {
    const instructions = readBenchInstructions(named());
    const reply = [
      "Here you go:",
      "```json",
      JSON.stringify({
        suggestions: [
          {
            reason: "  It never names a  next step. ",
            edits: [
              { field: "include", skill: "essay FEEDBACK", value: "one concrete next step" },
              { field: "step", skill: "Essay feedback", value: "End with one question" },
              { field: "include", skill: "Essay feedback", value: "next step" },
              { field: "include", skill: "History coach", value: "dates" },
              { field: "tone", value: "Warm" },
              { field: "tone", value: "direct" },
              { field: "length", value: "huge" },
              { field: "avoid", value: "Write the essay for them" },
              { field: "rename", value: "x" },
            ],
          },
          { reason: "Nothing left to do.", edits: [{ field: "objective", value: instructions.objective }] },
          { reason: "Shorter.", edits: [{ field: "length", value: "concise" }, { field: "avoid", value: "long lists" }] },
        ],
      }),
      "```",
    ].join("\n");
    const suggestions = parseBenchSuggestions(reply, instructions);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]!.reason).toBe("It never names a next step.");
    expect(suggestions[0]!.edits).toEqual([
      { kind: "include", skillId: "sk_essay_7f3a", skillName: "Essay feedback", value: "one concrete next step" },
      { kind: "step", skillId: "sk_essay_7f3a", skillName: "Essay feedback", value: "End with one question" },
      { kind: "tone", value: "warm" },
    ]);
    expect(suggestions[1]!.edits).toEqual([
      { kind: "length", value: "concise" },
      { kind: "avoid", value: "long lists" },
    ]);
    expect(new Set(suggestions.map((entry) => entry.key)).size).toBe(2);
    expect(parseBenchSuggestions("Sorry, I cannot help.", instructions)).toEqual([]);
    expect(parseBenchSuggestions('{"suggestions": "none"}', instructions)).toEqual([]);
  });

  it("keeps a reply to four suggestions of four edits", () => {
    const instructions = readBenchInstructions(named());
    const edits = Array.from({ length: 6 }, (_, index) => ({ field: "avoid", value: `habit ${index}` }));
    const reply = JSON.stringify({
      suggestions: Array.from({ length: 6 }, (_, index) => ({
        reason: `r${index}`,
        edits: edits.map((edit) => ({ ...edit, value: `${edit.value} ${index}` })),
      })),
    });
    const suggestions = parseBenchSuggestions(reply, instructions);
    expect(suggestions).toHaveLength(4);
    expect(suggestions.every((entry) => entry.edits.length === 4)).toBe(true);
  });

  it("words each edit with the skill's name and the creator's labels", () => {
    const edits = parseBenchSuggestions(
      JSON.stringify({
        suggestions: [
          {
            edits: [
              { field: "objective", value: "Coach, never mark." },
              { field: "tone", value: "socratic" },
              { field: "length", value: "detailed" },
              { field: "avoid", value: "grades" },
            ],
          },
          {
            edits: [
              { field: "purpose", skill: "Lab report review", value: "Check the method" },
              { field: "exclude", skill: "Lab report review", value: "well done" },
            ],
          },
        ],
      }),
      readBenchInstructions(named()),
    ).flatMap((suggestion) => suggestion.edits);
    const words = edits.map(describeBenchEdit);
    expect(words).toEqual([
      "Objective: “Coach, never mark.”",
      "Tone: Asks questions back",
      "Length: Detailed",
      "It must not: “grades”",
      "Lab report review is for: “Check the method”",
      "Lab report review answers leave out “well done”",
    ]);
    expect(words.join(" ")).not.toContain("7f3a");
  });

  it("applies a suggestion's edits to the draft, keeping each step's tools", () => {
    const content = named();
    const instructions = readBenchInstructions(content);
    const [suggestion] = parseBenchSuggestions(
      JSON.stringify({
        suggestions: [
          {
            edits: [
              { field: "include", skill: "Essay feedback", value: "one question to think about" },
              { field: "step", skill: "Essay feedback", value: "End with one question" },
              { field: "tone", value: "warm" },
              { field: "avoid", value: "grades" },
            ],
          },
        ],
      }),
      instructions,
    );
    const next = applyBenchEdits(content, suggestion!.edits, 9);
    const essay = next.foundry.skills.find((entry) => entry.id === "sk_essay_7f3a")!;
    expect(essay.outputContract.mustInclude).toEqual(["next step", "one question to think about"]);
    expect(essay.procedure.map((step) => step.action)).toEqual([
      "Read the essay",
      "Mark against the rubric",
      "End with one question",
    ]);
    expect(essay.procedure[0]!.tools).toEqual(["artifact_read"]);
    expect(next.foundry.mission.interactionStyle.tone).toBe("warm");
    expect(next.foundry.mission.exclusions).toEqual(["write the essay for them", "grades"]);
    // The other skill is untouched.
    expect(next.foundry.skills.find((entry) => entry.id === "sk_lab_7f3a")).toBe(
      content.foundry.skills.find((entry) => entry.id === "sk_lab_7f3a"),
    );
  });
});
