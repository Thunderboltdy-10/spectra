import { describe, expect, it } from "vitest";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { requireArtifactTypeManifest } from "../artifacts/registry";
import {
  changedArtifactRegionIds,
  decomposeArtifactContent,
  recomposeArtifactContent,
} from "../collaboration/artifact-yjs-model";

/**
 * Hot paths that run per keystroke or per save must scale with the size of an
 * artifact, not with its square. Bounds are deliberately generous (an order
 * of magnitude above the measured cost) so a loaded CI machine stays green
 * while a quadratic regression still fails.
 */
function elapsed(run: () => unknown) {
  const start = performance.now();
  run();
  return performance.now() - start;
}

const sentence =
  "The mitochondria is the powerhouse of the cell and a student writes notes. ";

function largeQuiz(questions: number) {
  return normalizeArtifactContent("quiz", {
    questions: Array.from({ length: questions }, (_, index) => ({
      id: `q${index}`,
      type: "multiple_choice",
      prompt: `Question ${index}: ${sentence}`,
      options: ["Alpha", "Beta", "Gamma", "Delta"],
      correctAnswer: "Alpha",
      explanation: sentence,
    })),
  }) as { questions: Array<Record<string, unknown>> };
}

describe("region decomposition on large artifacts", () => {
  it("finds the region a keystroke changed in a 400-question quiz without a quadratic scan", () => {
    // 7,200 regions. The pairwise ancestor scan took ~3 s here (~800 ms at
    // 200 questions); the path index takes tens of milliseconds.
    const before = largeQuiz(400);
    const after = {
      ...before,
      questions: before.questions.map((question, index) =>
        index === 200 ? { ...question, prompt: `${String(question.prompt)}x` } : question,
      ),
    };
    let changed: string[] = [];
    const ms = elapsed(() => {
      changed = changedArtifactRegionIds("quiz", before, after);
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("q200");
    expect(ms).toBeLessThan(1_000);
  });

  it("nests every region template under its nearest ancestor", () => {
    const quiz = largeQuiz(3);
    const decomposed = decomposeArtifactContent("quiz", quiz);
    expect(
      recomposeArtifactContent(decomposed.rootTemplate, decomposed.regionValues),
    ).toEqual(requireArtifactTypeManifest("quiz").schemas.content.parse(quiz));
    // A question region holds markers for its own children, never their text,
    // and the root holds only the question markers.
    const questionRegion = [...decomposed.descriptors.values()].find(
      (descriptor) => descriptor.path.length === 2 && descriptor.path[0] === "questions",
    )!;
    const template = decomposed.regionValues.get(questionRegion.regionId)!;
    expect(template).not.toContain("Question 0");
    expect(template).toContain("$spectraRegion");
    expect(decomposed.rootTemplate).not.toContain("Question 0");
  });
});
