export type BufferMode = "quiz" | "flashcard" | "none";

export type BufferState = {
  mode: BufferMode;
  rawContent: string;
  safeContent: string;
  isComplete: boolean;
  detectedQuestionCount: number;
};

function normalizeMode(mode: string): BufferMode {
  if (mode === "quiz" || mode === "exam") return "quiz";
  if (mode === "flashcard") return "flashcard";
  // "auto" mode uses "none" buffering since the effective mode is resolved server-side
  return "none";
}

function processQuizBuffer(rawContent: string): Pick<BufferState, "safeContent" | "isComplete" | "detectedQuestionCount"> {
  // Detect the start of any answer/explanation section and strip it entirely from safeContent
  const answerHeaderMatch =
    rawContent.match(/^#{1,4}\s*(answers?|explanations?|solutions?|key)\b.*$/im) ||
    rawContent.match(/^(?:Answers?|Explanations?|Solutions?|Answer Key)\s*[:=-]/im);
  const answerHeaderIndex = answerHeaderMatch?.index ?? -1;

  // Strip the answer section (from header to end) so correct answers are never exposed
  let safeContent = answerHeaderIndex >= 0 ? rawContent.slice(0, answerHeaderIndex) : rawContent;

  // Also strip any inline "Correct: [letter]" lines that appear within the question body
  // Use a new RegExp each call to avoid `lastIndex` state issues with the `g` flag
  const inlineCorrectRegex = new RegExp(
    /^\s*(?:Correct\s*[:=-]\s*[A-D]|Q(?:uestion)?\s*\d+[\s:.)-]*(?:correct\s*[:=-]\s*)?[A-D])\b.*$/,
    "gim",
  );
  safeContent = safeContent.replace(inlineCorrectRegex, "").replace(/\n{3,}/g, "\n\n").trimEnd();

  const questionCount = (rawContent.match(/^\s*\d+\./gm) ?? []).length;

  const isComplete = (() => {
    if (answerHeaderIndex < 0) return false;
    const answerSection = rawContent.slice(answerHeaderIndex);
    // Check that the answer section contains at least one answer line
    const answerLineCheck = new RegExp(
      /^\s*(?:Correct\s*[:=-]\s*[A-D]|Q(?:uestion)?\s*\d+[\s:.)-]*(?:correct\s*[:=-]\s*)?[A-D])\b.*$/,
      "im",
    );
    return answerLineCheck.test(answerSection);
  })();

  return {
    safeContent,
    isComplete,
    detectedQuestionCount: questionCount,
  };
}

function processFlashcardBuffer(rawContent: string): Pick<BufferState, "safeContent" | "isComplete" | "detectedQuestionCount"> {
  const lineFronts = rawContent.match(/^\s*(?:[-*]\s*)?(?:Card\s*\d+\s*[:.)-]\s*)?FRONT\s*:\s*.+$/gim) ?? [];
  const lineBacks = rawContent.match(/^\s*(?:[-*]\s*)?BACK\s*:\s*.+$/gim) ?? [];
  const inlinePairs = rawContent.match(/FRONT\s*:\s*[\s\S]*?\s+BACK\s*:\s*[\s\S]*?(?=(?:\s+FRONT\s*:)|$)/gi) ?? [];
  const pairCount = Math.max(Math.min(lineFronts.length, lineBacks.length), inlinePairs.length);

  const safeContent = rawContent
    .replace(/^\s*(?:[-*]\s*)?BACK\s*:\s*.*$/gim, "BACK: [Tap to reveal after generation]")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return {
    safeContent,
    isComplete: pairCount >= 2,
    detectedQuestionCount: pairCount,
  };
}

export function createBufferState(mode: string): BufferState {
  return {
    mode: normalizeMode(mode),
    rawContent: "",
    safeContent: "",
    isComplete: false,
    detectedQuestionCount: 0,
  };
}

export function appendToBuffer(state: BufferState, newRaw: string): BufferState {
  const rawContent = newRaw;

  if (state.mode === "quiz") {
    const processed = processQuizBuffer(rawContent);
    return {
      ...state,
      rawContent,
      ...processed,
    };
  }

  if (state.mode === "flashcard") {
    const processed = processFlashcardBuffer(rawContent);
    return {
      ...state,
      rawContent,
      ...processed,
    };
  }

  return {
    ...state,
    rawContent,
    safeContent: rawContent,
    isComplete: true,
  };
}
