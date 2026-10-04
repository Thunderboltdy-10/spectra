/**
 * Reads the cues in short, vague references ("my chemistry notes", "the essay from yesterday",
 * "esa presentación sobre células") so ranking can prefer the right type and time. Cues only
 * rank; they never filter. English and Spanish.
 */
import { foldForSearch } from "./semantic-chunks";
import type { IndexedSemanticKind } from "./semantic-types";

export type TypeCue = { kind: IndexedSemanticKind; subtypes?: string[] };

const TYPE_WORDS: Array<[string[], TypeCue[]]> = [
  [["deck", "decks", "slides", "slide", "presentation", "presentations", "ppt", "powerpoint", "diapositivas", "diapositiva",
    "presentacion", "presentaciones"], [{ kind: "artifact", subtypes: ["presentation"] }]],
  [["notes", "note", "doc", "docs", "document", "documents", "essay", "essays", "report", "reports", "writeup", "draft",
    "apuntes", "notas", "documento", "documentos", "ensayo", "ensayos", "informe", "redaccion", "borrador"],
    [{ kind: "artifact", subtypes: ["document"] }]],
  [["sheet", "sheets", "spreadsheet", "spreadsheets", "excel", "hoja", "hojas", "tabla", "calculo"], [{ kind: "artifact", subtypes: ["sheets"] }]],
  [["flashcards", "flashcard", "cards", "tarjetas", "fichas"], [{ kind: "artifact", subtypes: ["flashcard_deck"] }]],
  [["quiz", "quizzes", "cuestionario", "cuestionarios"], [{ kind: "artifact", subtypes: ["quiz"] }]],
  [["test", "tests", "exam", "exams", "examen", "examenes", "prueba"],
    [{ kind: "artifact", subtypes: ["quiz"] }, { kind: "event" }, { kind: "school", subtypes: ["assessment"] }]],
  [["whiteboard", "board", "mindmap", "diagram", "pizarra", "diagrama", "mapa"], [{ kind: "artifact", subtypes: ["whiteboard"] }]],
  [["task", "tasks", "todo", "tarea", "tareas", "pendiente"], [{ kind: "artifact", subtypes: ["planner_task"] }, { kind: "school", subtypes: ["task"] }]],
  [["code", "script", "program", "app", "codigo", "programa"], [{ kind: "artifact", subtypes: ["code"] }]],
  [["agent", "agents", "agente", "agentes"], [{ kind: "artifact", subtypes: ["agent"] }]],
  [["timetable", "horario"], [{ kind: "artifact", subtypes: ["timetable"] }, { kind: "event" }]],
  [["chat", "chats", "conversation", "conversations", "thread", "threads", "discussed", "talked", "ask", "asked", "asking",
    "conversacion", "conversaciones", "hablamos", "pregunte"], [{ kind: "thread" }]],
  [["event", "events", "meeting", "lesson", "appointment", "calendar", "evento", "eventos", "reunion", "cita", "calendario"], [{ kind: "event" }]],
  [["class", "classes", "clase", "clases"], [{ kind: "event" }, { kind: "school", subtypes: ["class", "course"] }]],
  [["assignment", "assignments", "homework", "deadline", "deadlines", "due", "deberes", "entrega", "entregas", "managebac"],
    [{ kind: "school", subtypes: ["assignment", "deadline", "task", "assessment"] }, { kind: "artifact", subtypes: ["planner_task"] }]],
  [["cas", "experience", "reflection", "experiencia", "reflexion"], [{ kind: "school", subtypes: ["cas_experience", "cas_reflection", "cas_evidence"] }]],
];
const TYPE_INDEX = new Map(TYPE_WORDS.flatMap(([words, cues]) => words.map((word) => [word, cues] as const)));

const DAY = 86_400_000;
type WindowWord = { span: number; days: number; future?: boolean };
/** Single-word windows: start offset in days from today's start (negative is past) and length. */
const WINDOW_WORDS: Record<string, WindowWord> = {
  today: { span: 0, days: 1 }, hoy: { span: 0, days: 1 }, tonight: { span: 0, days: 1 },
  yesterday: { span: -1, days: 1 }, ayer: { span: -1, days: 1 }, anoche: { span: -1, days: 1 },
  tomorrow: { span: 1, days: 1, future: true }, manana: { span: 1, days: 1, future: true },
};
const RECENCY_WORDS = new Set(["recent", "recently", "latest", "newest", "last", "lately", "just", "reciente", "recientes",
  "recientemente", "ultimo", "ultima", "ultimos", "ultimas", "nuevo", "nueva"]);
/** Question and filler words: kept for meaning, but not content words for full-text or hint fit. */
const QUESTION_WORDS = new Set(["what", "which", "who", "whom", "whose", "where", "how", "why", "did", "do", "does", "is", "are", "was",
  "were", "be", "been", "have", "has", "had", "can", "could", "should", "would", "will", "me", "we", "you", "it", "its", "our", "your",
  "any", "some", "all", "and", "or", "of", "to", "at", "by", "as", "we", "us", "they",
  "cual", "cuales", "quien", "donde", "como", "por", "porque", "tengo", "tiene", "es", "son", "fue", "era", "y", "o", "los", "las",
  "lo", "le", "se", "al", "su", "sus", "hay"]);

/** "When is…", "due", "next": prefer items that happen soon. */
const UPCOMING_WORDS = new Set(["when", "due", "deadline", "deadlines", "upcoming", "next", "soon", "cuando", "entrega", "entregas",
  "proximo", "proxima", "pronto"]);
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
/** Words that only carry time; they are dropped from the text that is searched. */
const TIME_ONLY = new Set([...Object.keys(WINDOW_WORDS), ...Object.keys(WEEKDAYS), "week", "semana", "month", "mes", "ago",
  "earlier", "esta", "este", "morning", "afternoon", "pasada", "pasado", "this", "next", "proxima", "proximo", "que", "viene", "hace", "el", "la",
  "on", "from", "de", "del", "made", "wrote", "created", "hice", "escribi", "cree", "that", "those", "ese", "esa", "eso", "aquel",
  "aquella", "the", "my", "mi", "mis", "a", "an", "un", "una", "about", "sobre", "with", "con", "for", "para", "in", "en"]);

export type QueryCues = {
  /** Type words found; an item matching any of them gets the type boost. */
  types: TypeCue[];
  /** A time window in epoch ms, compared with `updatedAt` and, for events and school items, `timeAt`. */
  window?: { from: number; to: number; future: boolean };
  /** "latest", "recent", "last": prefer what changed most recently. */
  recency: boolean;
  /** "when", "due", "next": prefer what happens soon (events, deadlines). */
  upcoming: boolean;
  /** The query without the pure time and filler words, for embedding and full-text. Never empty. */
  text: string;
  /** Content words other than type words, for deciding whether a hinted item fits. */
  contentTerms: string[];
};

export function parseQueryCues(query: string, options: { now?: number; timezoneOffsetMinutes?: number } = {}): QueryCues {
  const now = options.now ?? Date.now();
  const offset = (options.timezoneOffsetMinutes ?? 0) * 60_000;
  const localNow = now - offset;
  const todayStart = Math.floor(localNow / DAY) * DAY + offset;
  const words = foldForSearch(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const types: TypeCue[] = [];
  let window: QueryCues["window"];
  let recency = false;
  let upcoming = false;
  const kept: string[] = [];
  const contentTerms: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1];
    const previous = words[index - 1];
    const typeCues = TYPE_INDEX.get(word);
    if (typeCues) types.push(...typeCues);
    if ((word === "week" || word === "semana") && !window) {
      const weekStart = todayStart - ((new Date(localNow).getUTCDay() + 6) % 7) * DAY;
      const past = previous === "last" || next === "pasada" || previous === "ultima";
      const future = previous === "next" || next === "proxima" || previous === "proxima" || next === "que";
      window = past ? { from: weekStart - 7 * DAY, to: weekStart, future: false }
        : future ? { from: weekStart + 7 * DAY, to: weekStart + 14 * DAY, future: true }
        : { from: weekStart, to: weekStart + 7 * DAY, future: false };
    } else if ((word === "month" || word === "mes") && !window) {
      const past = previous === "last" || next === "pasado";
      window = { from: todayStart - (past ? 60 : 30) * DAY, to: past ? todayStart - 25 * DAY : now + DAY, future: false };
    } else if (word in WINDOW_WORDS && !window) {
      const spec = WINDOW_WORDS[word]!;
      // "mañana" after "esta" or "por la" is "this morning", not "tomorrow".
      const morning = word === "manana" && (previous === "esta" || previous === "la");
      window = morning ? { from: todayStart, to: todayStart + DAY, future: false }
        : { from: todayStart + spec.span * DAY, to: todayStart + (spec.span + spec.days) * DAY, future: Boolean(spec.future) };
    } else if (word in WEEKDAYS && !window) {
      const today = new Date(localNow).getUTCDay();
      const future = previous === "next" || next === "que" || previous === "proximo";
      const back = (today - WEEKDAYS[word]! + 7) % 7 || 7;
      const start = future ? todayStart + ((WEEKDAYS[word]! - today + 7) % 7 || 7) * DAY : todayStart - back * DAY;
      window = { from: start, to: start + DAY, future };
    }
    if (RECENCY_WORDS.has(word) && !(word === "last" && (next === "week" || next === "month" || (next && next in WEEKDAYS)))) recency = true;
    if (UPCOMING_WORDS.has(word)) upcoming = true;
    if (TIME_ONLY.has(word) || RECENCY_WORDS.has(word) || word === "when" || word === "cuando") continue;
    kept.push(word);
    if (!typeCues && word.length >= 2 && !QUESTION_WORDS.has(word)) contentTerms.push(word);
  }
  const text = kept.join(" ").trim();
  return { types, window, recency, upcoming: upcoming && !window, text: text || query.trim(), contentTerms };
}

export function matchesTypeCue(cues: QueryCues, item: { kind: IndexedSemanticKind; subtype?: string }) {
  return cues.types.some((cue) => cue.kind === item.kind && (!cue.subtypes || (item.subtype !== undefined && cue.subtypes.includes(item.subtype))));
}

/** Within the next two weeks: what "when is…" and "due" usually mean. */
export function isUpcoming(cues: QueryCues, item: { timeAt?: number }, now: number) {
  return cues.upcoming && item.timeAt !== undefined && item.timeAt >= now - 3_600_000 && item.timeAt < now + 14 * DAY;
}

export function inWindow(cues: QueryCues, item: { updatedAt?: number; timeAt?: number }) {
  const window = cues.window;
  if (!window) return false;
  const hit = (time?: number) => time !== undefined && time >= window.from && time < window.to;
  return window.future ? hit(item.timeAt) : hit(item.updatedAt) || hit(item.timeAt);
}
