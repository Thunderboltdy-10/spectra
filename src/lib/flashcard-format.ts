export type FlashcardPair = {
  front: string;
  back: string;
};

const FRONT_LINE_PATTERN = /^(?:[-*]\s*)?(?:Card\s*\d+\s*[:.)-]\s*)?FRONT\s*:\s*(.*)$/i;
const BACK_LINE_PATTERN = /^(?:[-*]\s*)?BACK\s*:\s*(.*)$/i;

function extractDelimitedFlashcardBody(value: string) {
  const start = value.match(/<<\s*flashcards_start\s*>>/i);
  const end = value.match(/<<\s*flashcards_end\s*>>/i);
  if (!start || !end || start.index === undefined || end.index === undefined) {
    return value;
  }
  const from = start.index + start[0].length;
  const to = end.index;
  if (to <= from) return value;
  return value.slice(from, to);
}

function normalizeField(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

function collectLabeledPairs(value: string): FlashcardPair[] {
  const pairs: FlashcardPair[] = [];
  const lines = value.split("\n");
  let currentFront: string | null = null;
  let backLines: string[] = [];
  let collectingBack = false;

  const pushCurrent = () => {
    if (!currentFront) return;
    const front = normalizeField(currentFront);
    const back = normalizeField(backLines.join(" "));
    if (front && back) {
      pairs.push({ front, back });
    }
    currentFront = null;
    backLines = [];
    collectingBack = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^<<\s*[^>]+\s*>>$/.test(line)) continue;

    const frontMatch = line.match(FRONT_LINE_PATTERN);
    if (frontMatch) {
      pushCurrent();
      currentFront = frontMatch[1]?.trim() ?? "";
      backLines = [];
      collectingBack = false;
      continue;
    }

    const backMatch = line.match(BACK_LINE_PATTERN);
    if (backMatch) {
      if (!currentFront) continue;
      collectingBack = true;
      const firstBack = backMatch[1]?.trim() ?? "";
      if (firstBack) backLines.push(firstBack);
      continue;
    }

    if (currentFront && !collectingBack) {
      currentFront = `${currentFront} ${line}`.trim();
      continue;
    }

    if (currentFront && collectingBack) {
      // If the model switches to numbered definition lines, stop this BACK block so
      // fallback parsers can recover additional cards.
      if (/^(?:[-*]\s*)?\d+[.)]\s+.{2,90}\s(?:-|–|—|:)\s.{3,}$/i.test(line)) {
        pushCurrent();
        continue;
      }
      backLines.push(line);
    }
  }

  pushCurrent();
  return pairs;
}

function collectInlinePairs(value: string): FlashcardPair[] {
  const pairs: FlashcardPair[] = [];
  const inlinePattern = /(?:^|\n|\s)FRONT\s*:\s*([\s\S]*?)\s+BACK\s*:\s*([\s\S]*?)(?=(?:\s+FRONT\s*:)|$)/gi;
  for (const match of value.matchAll(inlinePattern)) {
    const front = normalizeField(match[1] ?? "");
    const back = normalizeField(match[2] ?? "");
    if (!front || !back) continue;
    pairs.push({ front, back });
  }
  return pairs;
}

function collectTablePairs(value: string): FlashcardPair[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"));
  if (lines.length < 3) return [];

  const pairs: FlashcardPair[] = [];
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const cells = lines[i]
      .split("|")
      .map((cell) => cell.trim().toLowerCase())
      .filter(Boolean);
    if (cells.length >= 2 && cells.some((cell) => cell.includes("front")) && cells.some((cell) => cell.includes("back"))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex < 0) return [];

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row || /^[:|\-\s]+$/.test(row)) continue;
    const cells = row
      .split("|")
      .map((cell) => normalizeField(cell))
      .filter(Boolean);
    if (cells.length < 2) continue;
    pairs.push({ front: cells[0]!, back: cells[1]! });
  }

  return pairs;
}

function collectDefinitionPairs(value: string): FlashcardPair[] {
  const pairs: FlashcardPair[] = [];
  const lines = value.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^front\s*:|^back\s*:/i.test(line)) continue;

    const match = line.match(/^(?:[-*]\s*|\d+[.)]\s*)?(.{2,90}?)\s(?:-|–|—|:)\s(.{3,})$/);
    if (!match) continue;
    const front = normalizeField(match[1] ?? "");
    const back = normalizeField(match[2] ?? "");
    if (!front || !back) continue;
    pairs.push({ front, back });
  }

  return pairs.length >= 2 ? pairs : [];
}

export function extractFlashcardPairs(value: string): FlashcardPair[] {
  const normalized = extractDelimitedFlashcardBody(value.replace(/\r/g, "")).trim();
  if (!normalized) return [];

  const pairs: FlashcardPair[] = [];
  const seen = new Set<string>();

  const addPair = (pair: FlashcardPair) => {
    const front = normalizeField(pair.front);
    const back = normalizeField(pair.back);
    if (!front || !back) return;
    const key = `${front.toLowerCase()}::${back.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ front, back });
  };

  for (const pair of collectLabeledPairs(normalized)) addPair(pair);
  if (pairs.length === 0) {
    for (const pair of collectInlinePairs(normalized)) addPair(pair);
  }
  for (const pair of collectTablePairs(normalized)) addPair(pair);

  if (pairs.length < 2) {
    for (const pair of collectDefinitionPairs(normalized)) addPair(pair);
  }

  return pairs;
}

export function countFlashcardPairs(value: string) {
  return extractFlashcardPairs(value).length;
}

export function isFlashcardDeckStructured(value: string, minimumPairs = 2) {
  return countFlashcardPairs(value) >= Math.max(1, minimumPairs);
}

export function normalizeFlashcardDeck(value: string) {
  const pairs = extractFlashcardPairs(value);
  if (pairs.length === 0) return "";
  return pairs.map((pair) => `FRONT: ${pair.front}\nBACK: ${pair.back}`).join("\n\n");
}
