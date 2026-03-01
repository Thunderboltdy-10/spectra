export type ParsedQuizOption = {
  letter: string;
  text: string;
};

export type ParsedQuizQuestion = {
  number: number;
  id: string;
  prompt: string;
  options: ParsedQuizOption[];
  correct?: string;
  explanation?: string;
};

function extractDelimitedQuizBody(content: string) {
  const start = content.match(/<<\s*quiz_start\s*>>/i);
  const end = content.match(/<<\s*quiz_end\s*>>/i);
  if (!start || !end || start.index === undefined || end.index === undefined) {
    return content;
  }
  const from = start.index + start[0].length;
  const to = end.index;
  if (to <= from) return content;
  return content.slice(from, to);
}

export function stripQuizMarkers(content: string): string {
  let cleaned = content;
  // Strip <<QUIZ_NOTE>>...<<QUIZ_NOTE_END>> blocks
  cleaned = cleaned.replace(/<<\s*QUIZ_NOTE\s*>>[\s\S]*?<<\s*QUIZ_NOTE_END\s*>>/gi, "");
  // Strip all other <<TAG>> markers
  cleaned = cleaned.replace(/<<\s*[^>]+\s*>>/g, "");
  return cleaned.trim();
}

export function parseQuiz(content: string): ParsedQuizQuestion[] {
  const quizBody = extractDelimitedQuizBody(content);
  const lines = quizBody.split("\n");
  const questions: ParsedQuizQuestion[] = [];
  const byNumber = new Map<number, ParsedQuizQuestion>();
  let inAnswerSection = false;
  let current: ParsedQuizQuestion | null = null;
  let currentOptionIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^<<\s*[^>]+\s*>>$/.test(line)) continue;

    if (/^#{1,4}\s*(answers?|explanations?)\b/i.test(line)) {
      inAnswerSection = true;
      current = null;
      currentOptionIndex = -1;
      continue;
    }

    const qMatch = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.):-]\s*(.+)$/i);
    if (qMatch && !inAnswerSection) {
      const number = Number.parseInt(qMatch[1] ?? "0", 10);
      const question: ParsedQuizQuestion = {
        number,
        id: String(number),
        prompt: qMatch[2] ?? "",
        options: [],
      };
      questions.push(question);
      byNumber.set(number, question);
      current = question;
      currentOptionIndex = -1;
      continue;
    }

    const optionMatch = line.match(/^[-*]?\s*([A-D])[.)]\s*(.+)$/i);
    if (optionMatch && !inAnswerSection && current) {
      current.options.push({
        letter: optionMatch[1] ?? "",
        text: optionMatch[2] ?? "",
      });
      currentOptionIndex = current.options.length - 1;
      continue;
    }

    const directCorrectMatch = line.match(/^Correct\s*[:=-]\s*([A-D])\b/i);
    if (directCorrectMatch && current) {
      current.correct = (directCorrectMatch[1] ?? "").toUpperCase();
      continue;
    }

    if (inAnswerSection) {
      const answerMatch = line.match(
        /^(?:Q(?:uestion)?\s*)?(\d+)[\s:.)-]*(?:correct\s*[:=-]\s*)?([A-D])\b(?:\s*[-:]\s*(.*))?$/i,
      );
      if (answerMatch) {
        const number = Number.parseInt(answerMatch[1] ?? "0", 10);
        const question = byNumber.get(number);
        if (question) {
          question.correct = (answerMatch[2] ?? "").toUpperCase();
          const maybeExplanation = answerMatch[3]?.trim();
          if (maybeExplanation) {
            question.explanation = maybeExplanation;
          }
        }
      }
      continue;
    }

    if (current && !inAnswerSection) {
      if (currentOptionIndex >= 0 && current.options[currentOptionIndex]) {
        current.options[currentOptionIndex]!.text = `${current.options[currentOptionIndex]!.text}\n${line}`;
      } else {
        current.prompt = `${current.prompt}\n${line}`;
      }
    }
  }

  return questions.filter((q) => q.prompt && q.options.length >= 2);
}
