import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { delimitedValue, parseDelimited } from "../sheets/model";

export const QUIZ_QUESTION_TYPES = [
  "multiple_choice",
  "short_answer",
  "true_false",
  "select_all",
  "ordering",
  "numeric",
  "fill_blank",
  "long_response",
  "matching",
] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

export type PortableQuizQuestion = {
  id: string;
  prompt: string;
  type: QuizQuestionType;
  options: string[];
  optionIds?: string[];
  correctAnswer?: string;
  correctAnswers?: string[];
  numericTolerance?: number;
  rubric?: string;
  matchingPairs?: Array<{ id: string; left: string; right?: string }>;
  explanation?: string;
  feedback?: string;
  difficulty?: "easy" | "medium" | "hard";
  points?: number;
  timeLimitSeconds?: number;
  sourceRefs?: string[];
  media?: {
    assetId: string;
    name: string;
    mediaType: string;
    altText?: string;
  };
  bloomLevel?:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  standards?: string[];
  tags?: string[];
  poolId?: string;
  poolDrawCount?: number;
  section?: string;
};

export type QuizInterchangeContent = {
  questions: PortableQuizQuestion[];
  settings?: Record<string, unknown>;
};

export type QuizImportResult = {
  content: QuizInterchangeContent;
  format: "spectra-json" | "csv" | "tsv" | "moodle-xml" | "qti";
  fidelity: Array<{
    scope: string;
    level: "exact" | "adapted" | "unsupported";
    message: string;
  }>;
  unsupportedFeatures: string[];
};

function portableId(prefix: string, value?: string) {
  const clean = (value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return clean || `${prefix}-${crypto.randomUUID()}`;
}

function cleanText(value: unknown, maximum = 100_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanList(value: unknown, delimiter = /[;|]/) {
  if (Array.isArray(value))
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 100);
  return cleanText(value)
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function questionType(value: unknown): QuizQuestionType {
  const normalized = cleanText(value)
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");
  const aliases: Record<string, QuizQuestionType> = {
    mcq: "multiple_choice",
    multiplechoice: "multiple_choice",
    multiple_choice: "multiple_choice",
    multichoice: "multiple_choice",
    checkbox: "select_all",
    multiple_response: "select_all",
    select_all: "select_all",
    truefalse: "true_false",
    true_false: "true_false",
    shortanswer: "short_answer",
    short_answer: "short_answer",
    essay: "long_response",
    long_response: "long_response",
    numerical: "numeric",
    numeric: "numeric",
    fill_blank: "fill_blank",
    fill_in_the_blank: "fill_blank",
    ordering: "ordering",
    matching: "matching",
  };
  return aliases[normalized] ?? "multiple_choice";
}

function normalizedQuestion(
  value: Record<string, unknown>,
  index: number,
): PortableQuizQuestion | null {
  const prompt = cleanText(value.prompt ?? value.question ?? value.text);
  if (!prompt) return null;
  const type = questionType(value.type);
  let options = cleanList(value.options);
  if (type === "true_false") options = ["True", "False"];
  const correctAnswers = cleanList(
    value.correctAnswers ?? value.correct_answers,
  );
  const correctAnswer =
    cleanText(value.correctAnswer ?? value.correct_answer) ||
    correctAnswers[0] ||
    "";
  const rawPairs = Array.isArray(value.matchingPairs)
    ? value.matchingPairs
    : Array.isArray(value.matching_pairs)
      ? value.matching_pairs
      : [];
  const matchingPairs = rawPairs.flatMap((candidate, pairIndex) => {
    const pair =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    const left = cleanText(pair.left ?? pair.prompt);
    const right = cleanText(pair.right ?? pair.answer);
    return left && right
      ? [
          {
            id: portableId(
              "pair",
              cleanText(pair.id) || `pair-${pairIndex + 1}`,
            ),
            left,
            right,
          },
        ]
      : [];
  });
  return {
    id: portableId("question", cleanText(value.id) || `question-${index + 1}`),
    prompt,
    type,
    options,
    correctAnswer,
    ...(correctAnswers.length ? { correctAnswers } : {}),
    ...(matchingPairs.length ? { matchingPairs } : {}),
    ...(Number.isFinite(Number(value.numericTolerance))
      ? { numericTolerance: Math.max(0, Number(value.numericTolerance)) }
      : {}),
    ...(cleanText(value.rubric) ? { rubric: cleanText(value.rubric) } : {}),
    ...(cleanText(value.explanation)
      ? { explanation: cleanText(value.explanation) }
      : {}),
    ...(cleanText(value.feedback)
      ? { feedback: cleanText(value.feedback) }
      : {}),
    ...(value.difficulty === "easy" ||
    value.difficulty === "medium" ||
    value.difficulty === "hard"
      ? { difficulty: value.difficulty }
      : {}),
    points: Math.max(0, Number(value.points) || 1),
    ...(Number(value.timeLimitSeconds ?? value.time_limit_seconds) > 0
      ? {
          timeLimitSeconds: Number(
            value.timeLimitSeconds ?? value.time_limit_seconds,
          ),
        }
      : {}),
    ...(cleanList(value.sourceRefs ?? value.source_refs).length
      ? { sourceRefs: cleanList(value.sourceRefs ?? value.source_refs) }
      : {}),
    ...(cleanList(value.standards).length
      ? { standards: cleanList(value.standards) }
      : {}),
    ...(cleanList(value.tags).length ? { tags: cleanList(value.tags) } : {}),
    ...(cleanText(value.poolId ?? value.pool_id)
      ? { poolId: cleanText(value.poolId ?? value.pool_id, 180) }
      : {}),
    ...(Number(value.poolDrawCount ?? value.pool_draw_count) > 0
      ? {
          poolDrawCount: Math.max(
            1,
            Math.min(
              100,
              Math.floor(Number(value.poolDrawCount ?? value.pool_draw_count)),
            ),
          ),
        }
      : {}),
    ...(cleanText(value.section)
      ? { section: cleanText(value.section, 500) }
      : {}),
  };
}

function parseJson(text: string): QuizImportResult {
  const parsed: unknown = JSON.parse(text);
  const root =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.questions)
      ? root.questions
      : Array.isArray(root.items)
        ? root.items
        : [];
  const questions = candidates.flatMap((candidate, index) => {
    const value =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    const question = normalizedQuestion(value, index);
    return question ? [question] : [];
  });
  if (!questions.length)
    throw new Error("The JSON file does not contain any usable questions.");
  const hasExternalMedia = candidates.some(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      "media" in candidate,
  );
  return {
    content: {
      questions,
      settings:
        root.settings && typeof root.settings === "object"
          ? (root.settings as Record<string, unknown>)
          : undefined,
    },
    format: "spectra-json",
    fidelity: [
      {
        scope: "quiz",
        level: hasExternalMedia ? "adapted" : "exact",
        message: `${questions.length} editable questions were restored from structured JSON.${hasExternalMedia ? " External asset identifiers were not rebound automatically." : ""}`,
      },
    ],
    unsupportedFeatures: hasExternalMedia
      ? ["External or cross-artifact media identifiers"]
      : [],
  };
}

function parseRows(text: string, delimiter: "," | "\t"): QuizImportResult {
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2)
    throw new Error("The table needs a header and at least one question row.");
  const header = rows[0]!.map((value) =>
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[\s-]+/g, "_"),
  );
  const candidates = rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        header.map((key, index) => [key, row[index]?.trim() ?? ""]),
      ),
    );
  const questions = candidates.flatMap((candidate, index) => {
    const question = normalizedQuestion(candidate, index);
    return question ? [question] : [];
  });
  if (!questions.length)
    throw new Error(
      "No usable questions were found. Include a prompt or question column.",
    );
  return {
    content: { questions },
    format: delimiter === "\t" ? "tsv" : "csv",
    fidelity: [
      {
        scope: "questions",
        level: "adapted",
        message:
          "Simple question fields were mapped from columns. Rich text, media, pools, and interaction-specific metadata remain in the retained original.",
      },
    ],
    unsupportedFeatures: [
      "Rich text formatting in tabular cells",
      "Embedded media",
      "Complex interaction metadata",
    ],
  };
}

function directChildText(element: Element, selector: string) {
  return (
    element.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ??
    ""
  );
}

function parseMoodle(xml: Document): QuizImportResult {
  const unsupported = new Set<string>();
  if (xml.querySelector("file"))
    unsupported.add("Embedded Moodle media and file packages");
  const questions = [...xml.querySelectorAll("quiz > question")].flatMap(
    (element, index): PortableQuizQuestion[] => {
      const moodleType = element.getAttribute("type") ?? "";
      if (moodleType === "category") return [];
      const prompt =
        directChildText(element, ":scope > questiontext > text") ||
        directChildText(element, ":scope > name > text");
      if (!prompt) return [];
      if (
        ![
          "multichoice",
          "truefalse",
          "shortanswer",
          "numerical",
          "essay",
          "matching",
        ].includes(moodleType)
      ) {
        unsupported.add(`Moodle ${moodleType || "unknown"} interaction`);
        return [];
      }
      const answers = [...element.querySelectorAll(":scope > answer")];
      const correct = answers.filter(
        (answer) => Number(answer.getAttribute("fraction") ?? 0) > 0,
      );
      const options = answers
        .map((answer) => directChildText(answer, ":scope > text"))
        .filter(Boolean);
      const type: QuizQuestionType =
        moodleType === "multichoice"
          ? element.querySelector(":scope > single")?.textContent?.trim() ===
            "false"
            ? "select_all"
            : "multiple_choice"
          : moodleType === "truefalse"
            ? "true_false"
            : moodleType === "shortanswer"
              ? "short_answer"
              : moodleType === "numerical"
                ? "numeric"
                : moodleType === "essay"
                  ? "long_response"
                  : "matching";
      const matchingPairs =
        type === "matching"
          ? [...element.querySelectorAll(":scope > subquestion")].flatMap(
              (pair, pairIndex) => {
                const left = directChildText(pair, ":scope > text");
                const right = directChildText(pair, ":scope > answer > text");
                return left && right
                  ? [
                      {
                        id: `pair-${pairIndex + 1}`,
                        left,
                        right,
                      },
                    ]
                  : [];
              },
            )
          : undefined;
      const correctAnswers = correct
        .map((answer) => directChildText(answer, ":scope > text"))
        .filter(Boolean);
      return [
        {
          id: portableId(
            "question",
            directChildText(element, ":scope > name > text") ||
              `question-${index + 1}`,
          ),
          prompt,
          type,
          options: type === "true_false" ? ["True", "False"] : options,
          correctAnswer: correctAnswers[0] ?? "",
          ...(type === "select_all" ? { correctAnswers } : {}),
          ...(matchingPairs?.length ? { matchingPairs } : {}),
          ...(type === "numeric"
            ? {
                numericTolerance: Math.max(
                  0,
                  Number(
                    correct[0]?.querySelector(":scope > tolerance")
                      ?.textContent ?? 0,
                  ) || 0,
                ),
              }
            : {}),
          explanation: directChildText(
            element,
            ":scope > generalfeedback > text",
          ),
          points: Math.max(
            0,
            Number(
              element.querySelector(":scope > defaultgrade")?.textContent,
            ) || 1,
          ),
        },
      ];
    },
  );
  if (!questions.length)
    throw new Error("No supported Moodle questions were found in this file.");
  return {
    content: { questions },
    format: "moodle-xml",
    fidelity: [
      {
        scope: "questions",
        level: unsupported.size ? "adapted" : "exact",
        message: `${questions.length} Moodle questions were converted to editable formative Spectra questions.`,
      },
    ],
    unsupportedFeatures: [...unsupported],
  };
}

function qtiPrompt(item: Element) {
  const body = item.querySelector("itemBody");
  if (!body) return "";
  const clone = body.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      "choiceInteraction, matchInteraction, textEntryInteraction, extendedTextInteraction",
    )
    .forEach((interaction) => interaction.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function parseQtiDocuments(documents: Document[]): QuizImportResult {
  const unsupported = new Set<string>();
  if (
    documents.some((document) =>
      document.querySelector("customInteraction, responseProcessing template"),
    )
  )
    unsupported.add("Custom QTI interactions or response processing");
  const questions = documents.flatMap((xml) =>
    [...xml.querySelectorAll("assessmentItem")].flatMap(
      (item, index): PortableQuizQuestion[] => {
        const prompt =
          qtiPrompt(item) ||
          item.getAttribute("title")?.trim() ||
          `Imported question ${index + 1}`;
        const choice = item.querySelector("choiceInteraction");
        const textEntry = item.querySelector("textEntryInteraction");
        const extended = item.querySelector("extendedTextInteraction");
        const correctIds = [
          ...item.querySelectorAll("responseDeclaration correctResponse value"),
        ]
          .map((node) => node.textContent?.trim() ?? "")
          .filter(Boolean);
        if (choice) {
          const options = [...choice.querySelectorAll("simpleChoice")].map(
            (option) => ({
              id: option.getAttribute("identifier") ?? "",
              text: option.textContent?.replace(/\s+/g, " ").trim() ?? "",
            }),
          );
          const answers = options
            .filter((option) => correctIds.includes(option.id))
            .map((option) => option.text);
          const type =
            Number(choice.getAttribute("maxChoices") ?? 1) > 1
              ? "select_all"
              : "multiple_choice";
          return [
            {
              id: portableId(
                "question",
                item.getAttribute("identifier") ?? undefined,
              ),
              prompt,
              type,
              options: options.map((option) => option.text),
              correctAnswer: answers[0] ?? "",
              ...(type === "select_all" ? { correctAnswers: answers } : {}),
              explanation:
                item
                  .querySelector("modalFeedback")
                  ?.textContent?.replace(/\s+/g, " ")
                  .trim() ?? "",
              points: 1,
            },
          ];
        }
        if (textEntry || extended) {
          return [
            {
              id: portableId(
                "question",
                item.getAttribute("identifier") ?? undefined,
              ),
              prompt,
              type: extended ? "long_response" : "short_answer",
              options: [],
              correctAnswer: correctIds[0] ?? "",
              points: 1,
            },
          ];
        }
        unsupported.add(
          `QTI interaction in ${item.getAttribute("identifier") ?? "unnamed item"}`,
        );
        return [];
      },
    ),
  );
  if (!questions.length)
    throw new Error("No supported QTI questions were found in this package.");
  return {
    content: { questions },
    format: "qti",
    fidelity: [
      {
        scope: "assessment items",
        level: unsupported.size ? "adapted" : "exact",
        message: `${questions.length} QTI items were converted into editable formative questions.`,
      },
      {
        scope: "assessment policy",
        level: "adapted",
        message:
          "Consequential grading, delivery security, and proctoring metadata were intentionally not activated.",
      },
    ],
    unsupportedFeatures: [...unsupported],
  };
}

function xmlDocument(value: string) {
  const parsed = new DOMParser().parseFromString(value, "application/xml");
  const parserError = parsed.querySelector("parsererror");
  if (parserError) throw new Error("The XML is malformed and was quarantined.");
  return parsed;
}

export async function parseQuizImport(file: File): Promise<QuizImportResult> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("This quiz file exceeds the 100 MB safety ceiling.");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return parseJson(await file.text());
  if (extension === "csv") return parseRows(await file.text(), ",");
  if (extension === "tsv") return parseRows(await file.text(), "\t");
  if (extension === "xml") {
    const parsed = xmlDocument(await file.text());
    return parsed.documentElement.localName === "quiz"
      ? parseMoodle(parsed)
      : parseQtiDocuments([parsed]);
  }
  if (extension === "zip" || extension === "qti") {
    let acceptedEntries = 0;
    let acceptedBytes = 0;
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: ({ name, size, originalSize }) => {
        const safe =
          !name.startsWith("__MACOSX/") &&
          !name.includes("../") &&
          !name.startsWith("/") &&
          !/^[a-zA-Z]:/.test(name) &&
          size <= 12 * 1024 * 1024 &&
          originalSize <= 36 * 1024 * 1024 &&
          acceptedEntries < 1_000 &&
          acceptedBytes + originalSize <= 160 * 1024 * 1024;
        if (safe) {
          acceptedEntries += 1;
          acceptedBytes += originalSize;
        }
        return safe;
      },
    });
    const xmlFiles = Object.entries(archive)
      .filter(([name]) => name.toLowerCase().endsWith(".xml"))
      .slice(0, 500);
    if (!xmlFiles.length)
      throw new Error("The QTI package does not contain XML assessment items.");
    const documents = xmlFiles.flatMap(([, bytes]) => {
      try {
        const document = xmlDocument(strFromU8(bytes));
        return document.querySelector("assessmentItem") ||
          document.documentElement.localName === "assessmentItem"
          ? [document]
          : [];
      } catch {
        return [];
      }
    });
    const result = parseQtiDocuments(documents);
    if (
      Object.keys(archive).some(
        (name) =>
          !name.toLowerCase().endsWith(".xml") &&
          !name.endsWith("/") &&
          !name.startsWith("__MACOSX/"),
      )
    )
      result.unsupportedFeatures.push(
        "Packaged media and non-XML resources remain in the retained original.",
      );
    return result;
  }
  throw new Error(
    "Use Spectra JSON, CSV, TSV, Moodle XML, or a QTI XML/ZIP package.",
  );
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function qtiItem(question: PortableQuizQuestion, index: number) {
  const identifier = `item-${index + 1}-${portableId("q", question.id)}`;
  const response = `RESPONSE_${index + 1}`;
  const choiceTypes = new Set<QuizQuestionType>([
    "multiple_choice",
    "true_false",
    "select_all",
  ]);
  if (choiceTypes.has(question.type)) {
    const identifiers = question.options.map(
      (_, optionIndex) => `O${optionIndex + 1}`,
    );
    const answers =
      question.type === "select_all"
        ? (question.correctAnswers ?? [])
        : [question.correctAnswer ?? ""];
    const correctIds = question.options.flatMap((option, optionIndex) =>
      answers.includes(option) ? [identifiers[optionIndex]!] : [],
    );
    return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" identifier="${xml(identifier)}" title="${xml(question.prompt.slice(0, 120))}" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="${response}" cardinality="${question.type === "select_all" ? "multiple" : "single"}" baseType="identifier">
    ${correctIds.length ? `<correctResponse>${correctIds.map((id) => `<value>${id}</value>`).join("")}</correctResponse>` : ""}
  </responseDeclaration>
  <itemBody>
    <p>${xml(question.prompt)}</p>
    <choiceInteraction responseIdentifier="${response}" maxChoices="${question.type === "select_all" ? Math.max(2, correctIds.length) : 1}">
      ${question.options.map((option, optionIndex) => `<simpleChoice identifier="${identifiers[optionIndex]}">${xml(option)}</simpleChoice>`).join("")}
    </choiceInteraction>
  </itemBody>
  ${question.explanation ? `<modalFeedback outcomeIdentifier="FEEDBACK" identifier="general" showHide="show">${xml(question.explanation)}</modalFeedback>` : ""}
</assessmentItem>`;
  }
  const extended = question.type === "long_response";
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2" identifier="${xml(identifier)}" title="${xml(question.prompt.slice(0, 120))}" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="${response}" cardinality="single" baseType="string">
    ${!extended && question.correctAnswer ? `<correctResponse><value>${xml(question.correctAnswer)}</value></correctResponse>` : ""}
  </responseDeclaration>
  <itemBody>
    <p>${xml(question.prompt)}</p>
    ${extended ? `<extendedTextInteraction responseIdentifier="${response}"/>` : `<textEntryInteraction responseIdentifier="${response}"/>`}
  </itemBody>
</assessmentItem>`;
}

export function quizJson(content: QuizInterchangeContent) {
  return JSON.stringify(
    {
      format: "spectra-quiz",
      version: 1,
      exportedAt: new Date().toISOString(),
      ...content,
    },
    null,
    2,
  );
}

export function quizCsv(questions: PortableQuizQuestion[], delimiter = ",") {
  const headings = [
    "id",
    "type",
    "prompt",
    "options",
    "correct_answer",
    "correct_answers",
    "explanation",
    "feedback",
    "rubric",
    "difficulty",
    "points",
    "time_limit_seconds",
    "section",
    "pool_id",
    "pool_draw_count",
    "standards",
    "tags",
    "source_refs",
  ];
  const encode = (value: unknown) =>
    delimitedValue(
      Array.isArray(value)
        ? value.join(" | ")
        : value === undefined
          ? ""
          : String(value),
    );
  return [
    headings.join(delimiter),
    ...questions.map((question) =>
      [
        question.id,
        question.type,
        question.prompt,
        question.options,
        question.correctAnswer,
        question.correctAnswers,
        question.explanation,
        question.feedback,
        question.rubric,
        question.difficulty,
        question.points,
        question.timeLimitSeconds,
        question.section,
        question.poolId,
        question.poolDrawCount,
        question.standards,
        question.tags,
        question.sourceRefs,
      ]
        .map(encode)
        .join(delimiter),
    ),
  ].join("\r\n");
}

export function quizQtiPackage(questions: PortableQuizQuestion[]) {
  const files: Record<string, Uint8Array> = {};
  const resources = questions.map((question, index) => {
    const path = `items/item-${index + 1}.xml`;
    const identifier = `resource-${index + 1}`;
    files[path] = strToU8(qtiItem(question, index));
    return `<resource identifier="${identifier}" type="imsqti_item_xmlv2p2" href="${path}"><file href="${path}"/></resource>`;
  });
  files["imsmanifest.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="spectra-quiz-export">
  <metadata><schema>IMS Content</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations/>
  <resources>${resources.join("")}</resources>
</manifest>`);
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], {
    type: "application/zip",
  });
}

export function validateQuizForPublishing(
  questions: PortableQuizQuestion[],
): Array<{ questionId?: string; message: string }> {
  const issues: Array<{ questionId?: string; message: string }> = [];
  if (!questions.length) issues.push({ message: "Add at least one question." });
  const ids = new Set<string>();
  questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    if (!question.id.trim() || ids.has(question.id))
      issues.push({
        questionId: question.id,
        message: `${label} needs a unique stable identity.`,
      });
    ids.add(question.id);
    if (!question.prompt.trim())
      issues.push({
        questionId: question.id,
        message: `${label} needs a clear prompt.`,
      });
    if ((question.points ?? 1) < 0)
      issues.push({
        questionId: question.id,
        message: `${label} cannot use negative practice points.`,
      });
    if (
      question.type === "multiple_choice" ||
      question.type === "true_false" ||
      question.type === "select_all" ||
      question.type === "ordering"
    ) {
      const options = question.options
        .map((option) => option.trim())
        .filter(Boolean);
      if (
        question.optionIds &&
        (question.optionIds.length !== question.options.length ||
          new Set(question.optionIds).size !== question.optionIds.length)
      )
        issues.push({
          questionId: question.id,
          message: `${label} needs one unique stable identity per answer option.`,
        });
      if (options.length < 2)
        issues.push({
          questionId: question.id,
          message: `${label} needs at least two complete options.`,
        });
      if (
        new Set(options.map((option) => option.toLocaleLowerCase())).size !==
        options.length
      )
        issues.push({
          questionId: question.id,
          message: `${label} contains duplicate answer options.`,
        });
      if (
        (question.type === "multiple_choice" ||
          question.type === "true_false") &&
        !options.includes(question.correctAnswer?.trim() ?? "")
      )
        issues.push({
          questionId: question.id,
          message: `${label} needs exactly one marked correct option.`,
        });
      if (
        question.type === "select_all" &&
        (!question.correctAnswers?.length ||
          question.correctAnswers.some((answer) => !options.includes(answer)))
      )
        issues.push({
          questionId: question.id,
          message: `${label} needs one or more valid marked answers.`,
        });
    } else if (question.type === "matching") {
      const pairs = (question.matchingPairs ?? []).filter(
        (pair) => pair.left.trim() && pair.right?.trim(),
      );
      if (pairs.length < 2)
        issues.push({
          questionId: question.id,
          message: `${label} needs at least two complete matching pairs.`,
        });
    } else if (
      question.type !== "long_response" &&
      !question.correctAnswer?.trim()
    )
      issues.push({
        questionId: question.id,
        message: `${label} needs an expected formative answer.`,
      });
    if (question.type === "long_response" && !question.rubric?.trim())
      issues.push({
        questionId: question.id,
        message: `${label} needs formative review guidance.`,
      });
    const media = question.media;
    if (media && !media.altText?.trim())
      issues.push({
        questionId: question.id,
        message: `${label} needs an image description before publishing.`,
      });
    if (question.poolDrawCount && !question.poolId?.trim())
      issues.push({
        questionId: question.id,
        message: `${label} has a pool draw count but no random-pool name.`,
      });
  });
  const pools = new Map<string, PortableQuizQuestion[]>();
  for (const question of questions) {
    if (!question.poolId?.trim()) continue;
    pools.set(question.poolId, [
      ...(pools.get(question.poolId) ?? []),
      question,
    ]);
  }
  for (const [poolId, pool] of pools) {
    const counts = new Set(pool.map((question) => question.poolDrawCount ?? 1));
    if (counts.size > 1)
      issues.push({
        questionId: pool[0]?.id,
        message: `Random pool “${poolId}” must use one consistent draw count.`,
      });
    const count = pool[0]?.poolDrawCount ?? 1;
    if (count > pool.length)
      issues.push({
        questionId: pool[0]?.id,
        message: `Random pool “${poolId}” asks for ${count} questions but contains only ${pool.length}.`,
      });
  }
  return issues;
}
