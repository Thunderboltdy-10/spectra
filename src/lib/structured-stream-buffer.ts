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
  return "none";
}

function processQuizBuffer(rawContent: string): Pick<BufferState, "safeContent" | "isComplete" | "detectedQuestionCount"> {
  const answerHeaderMatch = rawContent.match(/^##\s*(answers?|explanations?)\b.*$/im);
  const answerHeaderIndex = answerHeaderMatch?.index ?? -1;

  const answerLineRegex = /^\s*(correct\s*:\s*[A-D]).*$/gim;

  let safeContent = rawContent;
  if (answerHeaderIndex >= 0) {
    safeContent = rawContent.slice(0, answerHeaderIndex);
  }

  safeContent = safeContent.replace(answerLineRegex, "").replace(/\n{3,}/g, "\n\n").trimEnd();

  const questionCount = (rawContent.match(/^\s*\d+\./gm) ?? []).length;

  const isComplete = (() => {
    if (answerHeaderIndex < 0) return false;
    const answerSection = rawContent.slice(answerHeaderIndex);
    const answerLines = answerSection.match(answerLineRegex) ?? [];
    return answerLines.length > 0;
  })();

  return {
    safeContent,
    isComplete,
    detectedQuestionCount: questionCount,
  };
}

function processFlashcardBuffer(rawContent: string): Pick<BufferState, "safeContent" | "isComplete" | "detectedQuestionCount"> {
  const frontLines = rawContent.match(/^\s*FRONT\s*:\s*.*$/gim) ?? [];
  const backLines = rawContent.match(/^\s*BACK\s*:\s*.*$/gim) ?? [];
  const pairCount = Math.min(frontLines.length, backLines.length);

  const safeContent = rawContent
    .replace(/^\s*BACK\s*:\s*.*$/gim, "BACK: [Tap to reveal after generation]")
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
