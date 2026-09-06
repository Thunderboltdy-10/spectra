import { describe, expect, it } from "vitest";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateBlueprintContent } from "../artifacts/blueprint-catalog";

describe("model artifact content normalization", () => {
  it("adds storage ids and canonicalizes rich document block aliases", () => {
    const content = normalizeArtifactContent("document", { blocks: [
      { type: "h1", content: "Cellular respiration" },
      { type: "collapsible", title: "Detailed steps", body: "Ten reactions" },
      { type: "table", rows: [["Stage", "ATP"], ["Glycolysis", "2"]] },
    ] });
    expect(validateBlueprintContent("document", content).success).toBe(true);
    expect(content.blocks).toMatchObject([
      { id: "block-1", type: "heading", text: "Cellular respiration", attrs: { level: 1 } },
      { id: "block-2", type: "callout", text: "Detailed steps: Ten reactions" },
      { id: "block-3", type: "table", text: "Stage | ATP\nGlycolysis | 2" },
    ]);
  });

  it("normalizes ids and common aliases for every artifact family", () => {
    const deck = normalizeArtifactContent("flashcard_deck", { cards: [{ term: "ATP", definition: "Energy carrier" }] });
    const quiz = normalizeArtifactContent("quiz", { questions: [{ question: "ATP?", type: "mcq", choices: ["A", "B"], answer: 1 }] });
    const task = normalizeArtifactContent("planner_task", { status: "in progress", subtasks: [{ text: "Read chapter" }] });
    expect(validateBlueprintContent("flashcard_deck", deck).success).toBe(true);
    expect(validateBlueprintContent("quiz", quiz).success).toBe(true);
    expect(validateBlueprintContent("planner_task", task).success).toBe(true);
  });

  it("recovers blank MCQ options as short-answer instead of failing the plan", () => {
    const quiz = normalizeArtifactContent("quiz", {
      questions: [
        {
          prompt: "What is ATP?",
          type: "multiple_choice",
          options: ["", " ", ""],
          correctAnswer: "Energy currency",
        },
        {
          prompt: "Mitochondria make ATP?",
          type: "true_false",
          correctAnswer: "True",
        },
        {
          prompt: "Pick a stage",
          type: "multiple_choice",
          options: [{ label: "A", text: "Glycolysis" }, { text: "Krebs" }],
          correctAnswer: "Glycolysis",
        },
      ],
    });
    expect(validateBlueprintContent("quiz", quiz).success).toBe(true);
    expect((quiz.questions as Array<Record<string, unknown>>)?.[0]).toMatchObject({
      type: "short_answer",
      correctAnswer: "Energy currency",
    });
    expect((quiz.questions as Array<Record<string, unknown>>)?.[1]).toMatchObject({
      type: "true_false",
      options: ["True", "False"],
    });
    expect((quiz.questions as Array<Record<string, unknown>>)?.[2]).toMatchObject({
      type: "multiple_choice",
      options: ["Glycolysis", "Krebs"],
      correctAnswer: "Glycolysis",
    });
  });

  it("makes the classic blank-option pending quiz shell schema-valid after normalize", () => {
    const shell = normalizeArtifactContent("quiz", {
      questions: [
        {
          id: "question-1",
          prompt: "",
          type: "multiple_choice",
          options: ["", "", "", ""],
          optionIds: [
            "question-1:option:1",
            "question-1:option:2",
            "question-1:option:3",
            "question-1:option:4",
          ],
          correctAnswer: "",
        },
      ],
      settings: {},
      published: false,
    });
    expect(validateBlueprintContent("quiz", shell).success).toBe(true);
    expect((shell.questions as Array<Record<string, unknown>>)?.[0]).toMatchObject({
      type: "short_answer",
    });
  });

  it("preserves an owner's explicit quiz publication state", () => {
    const published = normalizeArtifactContent("quiz", {
      questions: [
        {
          id: "question-1",
          prompt: "What changed?",
          type: "short_answer",
          options: [],
          correctAnswer: "The durable state",
        },
      ],
      settings: {},
      published: true,
      publishedAt: 1_786_550_400_000,
    });
    expect(published.published).toBe(true);
    expect(published.publishedAt).toBe(1_786_550_400_000);
  });

  it("fills sparse live-Yjs sheets required strings and identity maps", () => {
    const sparse = normalizeArtifactContent("sheets", {
      workbook: { calculationMode: "automatic" },
      activeSheetId: "sheet-1",
      sheets: [
        {
          id: "sheet-1",
          // name / locale / chart.title intentionally missing
          cells: {
            A1: { value: "Enzyme" },
            B2: { value: 1.2 },
          },
          rowIdentities: { "0": undefined, "1": undefined },
          columnIdentities: { "0": undefined, "1": undefined },
          charts: [
            {
              id: "chart-1",
              type: "line",
              sourceRange: "A1:B2",
              position: { x: 0, y: 0, width: 400, height: 240 },
            },
          ],
          tables: [{ id: "table-1", range: "A1:B2" }],
        },
      ],
    }) as {
      workbook: { locale: string };
      sheets: Array<{
        name: string;
        rowIdentities: Record<string, string>;
        columnIdentities: Record<string, string>;
        charts: Array<{ title: string }>;
        tables: Array<{ name: string }>;
      }>;
    };

    expect(validateBlueprintContent("sheets", sparse).success).toBe(true);
    expect(sparse.workbook.locale).toBe("en-US");
    expect(sparse.sheets[0]!.name).toBe("Sheet 1");
    expect(sparse.sheets[0]!.charts[0]!.title).toBe("Chart 1");
    expect(sparse.sheets[0]!.tables[0]!.name).toBe("Table 1");
    expect(sparse.sheets[0]!.rowIdentities["0"]).toBe("sheet-1:row:1");
    expect(sparse.sheets[0]!.rowIdentities["1"]).toBe("sheet-1:row:2");
    expect(sparse.sheets[0]!.columnIdentities["0"]).toBe("sheet-1:column:1");
    expect(sparse.sheets[0]!.columnIdentities["1"]).toBe("sheet-1:column:2");
  });

  it("preserves the quiz experience contract through normalize", () => {
    const quiz = normalizeArtifactContent("quiz", {
      questions: [
        {
          id: "question-1",
          prompt: "What should this quiz check?",
          type: "short_answer",
          options: [],
          correctAnswer: "A clear response",
        },
      ],
      settings: {
        showAnswersImmediately: false,
        timed: false,
        shuffleQuestions: false,
        passingScore: 0,
        experience: {
          persistence: "personal",
          identity: "signed_in",
          timing: "untimed",
          attempts: "unlimited",
          revealAnswers: "immediate",
          resultsVisibility: "learner",
        },
      },
      published: false,
    });
    expect(quiz.settings).toMatchObject({
      feedbackRelease: "on_each_response",
      showAnswersImmediately: true,
      experience: {
        persistence: "personal",
        identity: "signed_in",
        timing: "untimed",
        attempts: "unlimited",
        revealAnswers: "immediate",
        resultsVisibility: "learner",
      },
    });
  });

});
