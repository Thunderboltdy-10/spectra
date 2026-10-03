import { plannerTaskBlueprint } from "../../../artifacts/schema/planner-task";
import { validateQuizForPublishing } from "../../../quiz/interchange";
import { AuthoringError, type IdFactory, defaultIdFactory, isPlaceholder, list, record, text, truncate } from "./shared";

/*
 * Quizzes, flashcard decks, planner tasks and timetables are lists of items.
 * The model adds, updates, deletes and moves items by number (1-based, as the
 * readback shows them) or by id. Every edit applies to a copy.
 */

type Item = Record<string, unknown> & { id: string };

export type ListEditOp =
  | { op: "add"; items: Record<string, unknown>[]; position?: number }
  | ({ op: "update"; item: number | string } & Record<string, unknown>)
  | { op: "delete"; items: Array<number | string> }
  | { op: "move"; item: number | string; to: number }
  | { op: "replace"; find: string; replace: string; all?: boolean }
  | ({ op: "settings" } & Record<string, unknown>);

type ListKind = {
  noun: string;
  field: "cards" | "questions" | "events";
  idPrefix: string;
  /** Turns the model's item into a stored item; `previous` is set on update. */
  build(input: Record<string, unknown>, previous: Item | null, label: string, ids: IdFactory, content: Record<string, unknown>): Item;
  textFields: readonly string[];
  settings?(content: Record<string, unknown>, input: Record<string, unknown>, label: string): void;
  describe(item: Item, index: number): string;
  problems(content: Record<string, unknown>): string[];
};

function trimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) return;
  const next = trimmed(value);
  if (next) target[key] = next;
  else delete target[key];
}

// ---------------------------------------------------------------- flashcards

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const flashcards: ListKind = {
  noun: "card",
  field: "cards",
  idPrefix: "card",
  textFields: ["front", "back", "hint", "explanation"],
  build(input, previous, label, ids) {
    const card: Item = previous ? { ...previous } : { id: ids("card"), variant: "basic", confidence: "unknown" };
    if (input.front !== undefined || !previous) card.front = trimmed(input.front);
    if (input.back !== undefined || !previous) card.back = trimmed(input.back);
    if (!previous && (!card.front || !card.back)) throw new AuthoringError(`${label}: a card needs both front and back.`);
    optionalText(card, "hint", input.hint);
    optionalText(card, "explanation", input.explanation);
    optionalText(card, "section", input.section);
    if (input.difficulty !== undefined) {
      if (!DIFFICULTIES.has(String(input.difficulty))) throw new AuthoringError(`${label}: difficulty must be easy, medium or hard.`);
      card.difficulty = input.difficulty;
    }
    if (input.tags !== undefined) card.tags = list(input.tags).map(trimmed).filter(Boolean).slice(0, 8).map((tag) => tag.slice(0, 48));
    if (input.variant !== undefined) {
      if (input.variant !== "basic" && input.variant !== "cloze") throw new AuthoringError(`${label}: variant must be basic or cloze.`);
      card.variant = input.variant;
    }
    return card;
  },
  settings(content, input, label) {
    const settings = { ...record(content.settings) };
    for (const key of ["shuffle", "showHints"] as const)
      if (input[key] !== undefined) {
        if (typeof input[key] !== "boolean") throw new AuthoringError(`${label}: ${key} must be true or false.`);
        settings[key] = input[key];
      }
    if (input.revealMode !== undefined) {
      if (input.revealMode !== "click" && input.revealMode !== "type") throw new AuthoringError(`${label}: revealMode must be click or type.`);
      settings.revealMode = input.revealMode;
    }
    content.settings = settings;
  },
  describe(card, index) {
    return `${index + 1}. ${truncate(text(card.front), 140)} → ${truncate(text(card.back), 160)}${card.hint ? ` (hint: ${truncate(text(card.hint), 60)})` : ""}`;
  },
  problems(content) {
    const problems: string[] = [];
    const seen = new Map<string, number>();
    list(content.cards).forEach((value, index) => {
      const card = record(value);
      if (isPlaceholder(card.front) || isPlaceholder(card.back)) problems.push(`card ${index + 1} has an empty side`);
      const key = trimmed(card.front).toLowerCase();
      if (key && seen.has(key)) problems.push(`card ${index + 1} repeats card ${seen.get(key)! + 1}`);
      else if (key) seen.set(key, index);
    });
    return problems;
  },
};

// ---------------------------------------------------------------- quiz

const QUESTION_TYPES = new Set([
  "multiple_choice", "short_answer", "true_false", "select_all", "ordering", "numeric", "fill_blank", "long_response", "matching",
]);

const quiz: ListKind = {
  noun: "question",
  field: "questions",
  idPrefix: "question",
  textFields: ["prompt", "correctAnswer", "explanation", "rubric", "feedback"],
  build(input, previous, label, ids) {
    const question: Item = previous ? { ...previous } : { id: ids("question"), type: "multiple_choice", correctAnswer: "" };
    if (input.prompt !== undefined || !previous) question.prompt = trimmed(input.prompt);
    if (!question.prompt) throw new AuthoringError(`${label}: prompt is empty.`);
    if (input.type !== undefined) {
      if (!QUESTION_TYPES.has(String(input.type)))
        throw new AuthoringError(`${label}: type must be one of ${[...QUESTION_TYPES].join(", ")}.`);
      question.type = input.type;
    }
    const type = String(question.type);
    if (type === "true_false" && !Array.isArray(question.options)) question.options = ["True", "False"];
    if (input.options !== undefined) {
      const options = list(input.options).map(trimmed).filter(Boolean);
      question.options = options;
      delete question.optionIds;
    }
    if (input.answer !== undefined) {
      const answers = (Array.isArray(input.answer) ? input.answer : [input.answer]).map((value) => text(value).trim()).filter(Boolean);
      if (type === "select_all" || type === "ordering") {
        question.correctAnswers = answers;
        question.correctAnswer = answers.join(", ");
      } else {
        if (answers.length > 1) throw new AuthoringError(`${label}: answer must be one value for ${type} questions.`);
        question.correctAnswer = answers[0] ?? "";
        delete question.correctAnswers;
      }
    }
    if (type === "ordering" && Array.isArray(question.options) && !question.correctAnswers)
      question.correctAnswers = [...(question.options as string[])];
    if (input.pairs !== undefined) {
      question.matchingPairs = list(input.pairs).map((pair, index) => {
        const value = record(pair);
        if (!trimmed(value.left) || !trimmed(value.right)) throw new AuthoringError(`${label}: pairs[${index}] needs left and right.`);
        return { id: ids("pair"), left: trimmed(value.left), right: trimmed(value.right) };
      });
    }
    if (input.tolerance !== undefined) question.numericTolerance = Math.max(0, Number(input.tolerance) || 0);
    optionalText(question, "explanation", input.explanation);
    optionalText(question, "rubric", input.rubric);
    optionalText(question, "section", input.section);
    if (input.points !== undefined) {
      const points = Number(input.points);
      if (!(points > 0)) throw new AuthoringError(`${label}: points must be a positive number.`);
      question.points = points;
    }
    if (input.difficulty !== undefined) {
      if (!DIFFICULTIES.has(String(input.difficulty))) throw new AuthoringError(`${label}: difficulty must be easy, medium or hard.`);
      question.difficulty = input.difficulty;
    }
    // Check the shape the quiz player needs now, so the model fixes it in the same turn.
    const options = list(question.options).map(text);
    if ((type === "multiple_choice" || type === "true_false") && !options.includes(text(question.correctAnswer)))
      throw new AuthoringError(`${label}: answer must be exactly one of the options (${options.map((option) => `"${option}"`).join(", ") || "no options given"}).`);
    if (type === "select_all" && list(question.correctAnswers).some((answer) => !options.includes(text(answer))))
      throw new AuthoringError(`${label}: every answer must be one of the options.`);
    return question;
  },
  settings(content, input, label) {
    const settings = { ...record(content.settings) };
    if (input.instructions !== undefined) optionalText(settings, "instructions", input.instructions);
    for (const key of ["shuffleQuestions", "shuffleOptions", "showAnswersImmediately"] as const)
      if (input[key] !== undefined) {
        if (typeof input[key] !== "boolean") throw new AuthoringError(`${label}: ${key} must be true or false.`);
        settings[key] = input[key];
      }
    if (input.passingScore !== undefined) {
      const score = Number(input.passingScore);
      if (!(score >= 0 && score <= 100)) throw new AuthoringError(`${label}: passingScore must be 0 to 100.`);
      settings.passingScore = score;
    }
    content.settings = settings;
  },
  describe(question, index) {
    const options = list(question.options).map(text);
    const answer = list(question.correctAnswers).length ? list(question.correctAnswers).map(text).join(" | ") : text(question.correctAnswer);
    const pairs = list(question.matchingPairs).map((pair) => `${text(record(pair).left)} = ${text(record(pair).right)}`);
    return [
      `${index + 1}. [${text(question.type)}] ${truncate(text(question.prompt), 200)}`,
      ...(options.length ? [`   options: ${options.join(" | ")}`] : []),
      ...(pairs.length ? [`   pairs: ${pairs.join("; ")}`] : []),
      ...(answer ? [`   answer: ${truncate(answer, 160)}`] : []),
    ].join("\n");
  },
  problems(content) {
    const questions = list(content.questions).map((value) => {
      const question = record(value);
      return { ...question, id: text(question.id), prompt: text(question.prompt), options: list(question.options).map(text) };
    });
    return validateQuizForPublishing(questions as never).map((issue) => issue.message.replace(/\.$/, ""));
  },
};

// ---------------------------------------------------------------- timetable events

function isoWithOffset(value: unknown, label: string, field: string) {
  const raw = trimmed(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw)))
    throw new AuthoringError(`${label}: ${field} must be an ISO time with an offset, such as "2026-10-05T09:00:00+02:00".`);
  return raw;
}

const timetable: ListKind = {
  noun: "event",
  field: "events",
  idPrefix: "event",
  textFields: ["title", "location", "notes"],
  build(input, previous, label, ids, content) {
    const event: Item = previous ? { ...previous } : { id: ids("event"), allDay: false };
    if (input.title !== undefined || !previous) event.title = trimmed(input.title);
    if (!event.title) throw new AuthoringError(`${label}: title is empty.`);
    if (input.start !== undefined || !previous) event.start = isoWithOffset(input.start, label, "start");
    if (input.end !== undefined || !previous) event.end = isoWithOffset(input.end, label, "end");
    if (Date.parse(text(event.end)) <= Date.parse(text(event.start))) throw new AuthoringError(`${label}: end must be after start.`);
    if (input.allDay !== undefined) event.allDay = input.allDay === true;
    optionalText(event, "location", input.location);
    optionalText(event, "notes", input.notes);
    const layers = list(content.layers).map(record);
    if (input.layer !== undefined || !previous) {
      const wanted = trimmed(input.layer).toLowerCase();
      const layer = wanted
        ? layers.find((entry) => text(entry.id) === input.layer || text(entry.name).toLowerCase() === wanted)
        : layers.find((entry) => entry.kind === "personal" || entry.kind === "study") ?? layers[0];
      if (!layer)
        throw new AuthoringError(`${label}: layer must be one of ${layers.map((entry) => `"${text(entry.name)}"`).join(", ") || "(no layers)"}.`);
      event.layerId = text(layer.id);
    }
    event.provenance = { ...record(event.provenance), actor: "ai" };
    return event;
  },
  describe(event, index) {
    return `${index + 1}. ${text(event.title)}: ${text(event.start)} to ${text(event.end)}${event.location ? ` at ${text(event.location)}` : ""}`;
  },
  problems() {
    return [];
  },
};

const LIST_KINDS: Record<string, ListKind> = { flashcard_deck: flashcards, quiz, timetable };

export function isListType(type: string) {
  return type in LIST_KINDS;
}

function findItem(items: Item[], ref: unknown, kind: ListKind, label: string) {
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const index = Number(ref) - 1;
    if (index < 0 || index >= items.length)
      throw new AuthoringError(`${label}: ${kind.noun} ${String(ref)} does not exist; there are ${items.length}.`);
    return index;
  }
  const index = items.findIndex((item) => item.id === ref);
  if (index < 0) throw new AuthoringError(`${label}: no ${kind.noun} has id "${String(ref)}". Use its number from the readback.`);
  return index;
}

/** Applies list operations to a copy of a quiz, deck or timetable. */
export function applyListEdits(type: string, content: unknown, ops: ListEditOp[], ids: IdFactory = defaultIdFactory()) {
  const kind = LIST_KINDS[type];
  if (!kind) throw new AuthoringError(`${type} is not a list artifact.`);
  const next = structuredClone(record(content)) as Record<string, unknown>;
  let items = list(next[kind.field]).map((value) => ({ ...record(value) }) as Item);
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "add": {
        if (!Array.isArray(op.items) || !op.items.length) throw new AuthoringError(`${label}: items is empty.`);
        const at = op.position === undefined ? items.length : Number(op.position) - 1;
        if (!Number.isInteger(at) || at < 0 || at > items.length)
          throw new AuthoringError(`${label}: position must be from 1 to ${items.length + 1}.`);
        const built = op.items.map((item, position) => kind.build(record(item), null, `${label} items[${position}]`, ids, next));
        items.splice(at, 0, ...built);
        break;
      }
      case "update": {
        const at = findItem(items, op.item, kind, label);
        const { op: _op, item: _item, ...fields } = op;
        if (!Object.keys(fields).length) throw new AuthoringError(`${label}: give at least one field to change.`);
        items[at] = kind.build(fields, items[at]!, label, ids, next);
        break;
      }
      case "delete": {
        if (!Array.isArray(op.items) || !op.items.length) throw new AuthoringError(`${label}: items is empty.`);
        const doomed = new Set(op.items.map((ref) => items[findItem(items, ref, kind, label)]!.id));
        items = items.filter((item) => !doomed.has(item.id));
        break;
      }
      case "move": {
        const from = findItem(items, op.item, kind, label);
        const to = Number(op.to) - 1;
        if (!Number.isInteger(to) || to < 0 || to >= items.length)
          throw new AuthoringError(`${label}: to must be from 1 to ${items.length}.`);
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item!);
        break;
      }
      case "replace": {
        if (!op.find) throw new AuthoringError(`${label}: \`find\` is empty.`);
        let count = 0;
        for (const item of items)
          for (const field of kind.textFields) count += text(item[field]).split(op.find).length - 1;
        if (!count) throw new AuthoringError(`${label}: \`find\` text was not found.`);
        if (count > 1 && !op.all) throw new AuthoringError(`${label}: \`find\` text appears ${count} times. Set "all": true or include more text.`);
        items = items.map((item) => {
          const copy = { ...item };
          for (const field of kind.textFields)
            if (typeof copy[field] === "string") copy[field] = (copy[field] as string).split(op.find).join(op.replace);
          return copy;
        });
        break;
      }
      case "settings": {
        if (!kind.settings) throw new AuthoringError(`${label}: ${type} has no settings to change.`);
        const { op: _op, ...fields } = op;
        kind.settings(next, fields, label);
        break;
      }
      default:
        throw new AuthoringError(`${label}: unknown operation. Use add, update, delete, move, replace or settings.`);
    }
  });
  if (!items.length && type !== "timetable") throw new AuthoringError(`A ${type === "quiz" ? "quiz" : "deck"} keeps at least one ${kind.noun}.`);
  next[kind.field] = items;
  return next;
}

/** A new quiz or deck from items plus optional settings. */
export function listFromSpec(type: string, spec: { items: Record<string, unknown>[]; settings?: Record<string, unknown> }, ids: IdFactory = defaultIdFactory()) {
  const kind = LIST_KINDS[type];
  if (!kind) throw new AuthoringError(`${type} is not a list artifact.`);
  if (!Array.isArray(spec?.items) || !spec.items.length) throw new AuthoringError(`items: give at least one ${kind.noun}.`);
  const base: Record<string, unknown> =
    type === "flashcard_deck" ? { cards: [], settings: { shuffle: true, revealMode: "click" } } : { questions: [], settings: {} };
  const ops: ListEditOp[] = [{ op: "add", items: spec.items }];
  if (spec.settings && Object.keys(spec.settings).length) ops.push({ op: "settings", ...spec.settings });
  return applyListEdits(type, base, ops, ids);
}

export function listOutline(type: string, content: unknown, options: { from?: number; to?: number; max?: number } = {}) {
  const kind = LIST_KINDS[type];
  if (!kind) return "";
  const items = list(record(content)[kind.field]).map((value) => record(value) as Item);
  const from = Math.max(1, options.from ?? 1);
  const to = Math.min(items.length, options.to ?? items.length);
  const lines = items.slice(from - 1, to).map((item, offset) => kind.describe(item, from - 1 + offset));
  const settings = record(record(content).settings);
  return truncate(
    [`${items.length} ${kind.noun}${items.length === 1 ? "" : "s"}${Object.keys(settings).length ? `; settings ${JSON.stringify(settings)}` : ""}.`, ...lines].join("\n"),
    options.max ?? 6_000,
  );
}

export function listProblems(type: string, content: unknown) {
  return LIST_KINDS[type]?.problems(record(content)) ?? [];
}

export function listReadback(type: string, content: unknown, previous?: unknown) {
  const kind = LIST_KINDS[type];
  if (!kind) return "";
  const items = list(record(content)[kind.field]).map((value) => record(value) as Item);
  const lines = [`${items.length} ${kind.noun}${items.length === 1 ? "" : "s"}.`];
  const problems = listProblems(type, content);
  if (problems.length) lines.push(`Problems: ${problems.slice(0, 12).join("; ")}.`);
  if (previous) {
    const prior = new Map(list(record(previous)[kind.field]).map((value) => [text(record(value).id), JSON.stringify(value)]));
    const changed = items.map((item, index) => ({ item, index })).filter(({ item }) => prior.get(item.id) !== JSON.stringify(item));
    const removed = [...prior.keys()].filter((id) => !items.some((item) => item.id === id)).length;
    lines.push(changed.length ? `Changed or new:\n${truncate(changed.map(({ item, index }) => kind.describe(item, index)).join("\n"), 2_400)}` : "No item changed.");
    if (removed) lines.push(`${removed} removed.`);
  } else lines.push(truncate(items.map((item, index) => kind.describe(item, index)).join("\n"), 2_400));
  return lines.join("\n");
}

// ---------------------------------------------------------------- planner task

export type PlannerTaskOp =
  | {
      op: "set";
      title?: string;
      description?: string;
      due?: string | null;
      start?: string | null;
      end?: string | null;
      status?: "todo" | "doing" | "done";
      priority?: "low" | "medium" | "high";
      estimateMinutes?: number | null;
      progressNote?: string;
    }
  | { op: "add_subtasks"; subtasks: string[] }
  | { op: "update_subtask"; subtask: number | string; title?: string; done?: boolean }
  | { op: "delete_subtasks"; subtasks: Array<number | string> };

function zonedOffsetMs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - instant;
}

/** "2026-10-10" (end of that day), "2026-10-10T09:00" (local) or a full ISO time, in the task's zone. */
export function plannerTime(value: unknown, timeZone: string, label: string, field: string): number | null {
  if (value === null) return null;
  const raw = trimmed(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (dateOnly || local) {
    const [, y, m, d, h = "23", min = "59", s = "0"] = (dateOnly ?? local)!;
    const guess = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
    return guess - zonedOffsetMs(guess - zonedOffsetMs(guess, timeZone), timeZone);
  }
  const parsed = Date.parse(raw);
  if (!raw || Number.isNaN(parsed))
    throw new AuthoringError(`${label}: ${field} must be a date such as "2026-10-10" or "2026-10-10T09:00".`);
  return parsed;
}

function findSubtask(subtasks: Array<Record<string, unknown>>, ref: unknown, label: string) {
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const index = Number(ref) - 1;
    if (index >= 0 && index < subtasks.length) return index;
    throw new AuthoringError(`${label}: subtask ${String(ref)} does not exist; there are ${subtasks.length}.`);
  }
  const wanted = trimmed(ref).toLowerCase();
  const index = subtasks.findIndex((entry) => entry.id === ref || text(entry.title).toLowerCase() === wanted);
  if (index < 0) throw new AuthoringError(`${label}: no subtask matches "${String(ref)}".`);
  return index;
}

export function applyPlannerTaskEdits(content: unknown, ops: PlannerTaskOp[], ids: IdFactory = defaultIdFactory()) {
  const task = { ...structuredClone(plannerTaskBlueprint.defaultContent as Record<string, unknown>), ...structuredClone(record(content)) };
  const timeZone = text(task.timezone) || "UTC";
  let subtasks = list(task.subtasks).map((entry) => ({ ...record(entry) }));
  if (!Array.isArray(ops) || !ops.length) throw new AuthoringError("No operations were given.");
  ops.forEach((op, index) => {
    const label = `Edit ${index + 1} (${String(op?.op)})`;
    switch (op?.op) {
      case "set": {
        if (op.title !== undefined) {
          if (!trimmed(op.title)) throw new AuthoringError(`${label}: title is empty.`);
          task.taskTitle = trimmed(op.title).slice(0, 500);
        }
        if (op.description !== undefined) task.description = String(op.description);
        if (op.progressNote !== undefined) task.progressNote = String(op.progressNote).slice(0, 2_000);
        for (const [field, key] of [["due", "dueAt"], ["start", "startAt"], ["end", "endAt"]] as const)
          if (op[field] !== undefined) task[key] = plannerTime(op[field], timeZone, label, field);
        if (op.due !== undefined && typeof op.due === "string") task.allDay = /^\d{4}-\d{2}-\d{2}$/.test(op.due.trim());
        if (op.status !== undefined) {
          if (!["todo", "doing", "done"].includes(op.status)) throw new AuthoringError(`${label}: status must be todo, doing or done.`);
          task.status = op.status;
        }
        if (op.priority !== undefined) {
          if (!["low", "medium", "high"].includes(op.priority)) throw new AuthoringError(`${label}: priority must be low, medium or high.`);
          task.priority = op.priority;
        }
        if (op.estimateMinutes !== undefined) {
          const minutes = op.estimateMinutes === null ? null : Math.round(Number(op.estimateMinutes));
          if (minutes !== null && !(minutes > 0)) throw new AuthoringError(`${label}: estimateMinutes must be a positive number.`);
          task.estimateMinutes = minutes;
        }
        break;
      }
      case "add_subtasks": {
        const titles = list(op.subtasks).map(trimmed).filter(Boolean);
        if (!titles.length) throw new AuthoringError(`${label}: subtasks is empty.`);
        subtasks.push(...titles.map((title) => ({ id: ids("subtask"), title: title.slice(0, 500), done: false })));
        break;
      }
      case "update_subtask": {
        const at = findSubtask(subtasks, op.subtask, label);
        if (op.title !== undefined && !trimmed(op.title)) throw new AuthoringError(`${label}: title is empty.`);
        subtasks[at] = {
          ...subtasks[at],
          ...(op.title !== undefined ? { title: trimmed(op.title) } : {}),
          ...(op.done !== undefined ? { done: op.done === true } : {}),
        };
        break;
      }
      case "delete_subtasks": {
        const doomed = new Set(list(op.subtasks).map((ref) => subtasks[findSubtask(subtasks, ref, label)]!.id));
        subtasks = subtasks.filter((entry) => !doomed.has(entry.id));
        break;
      }
      default:
        throw new AuthoringError(`${label}: unknown operation. Use set, add_subtasks, update_subtask or delete_subtasks.`);
    }
  });
  if (subtasks.length > 100) throw new AuthoringError("A task holds at most 100 subtasks.");
  task.subtasks = subtasks;
  if (typeof task.startAt === "number" && typeof task.endAt === "number" && task.endAt <= task.startAt)
    throw new AuthoringError("end must be after start.");
  return task;
}

export function plannerTaskFromSpec(
  spec: { title: string; description?: string; due?: string; start?: string; end?: string; priority?: "low" | "medium" | "high"; subtasks?: string[]; estimateMinutes?: number },
  timeZone: string,
  ids: IdFactory = defaultIdFactory(),
) {
  const ops: PlannerTaskOp[] = [
    {
      op: "set",
      title: spec.title,
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      ...(spec.due !== undefined ? { due: spec.due } : {}),
      ...(spec.start !== undefined ? { start: spec.start } : {}),
      ...(spec.end !== undefined ? { end: spec.end } : {}),
      ...(spec.priority !== undefined ? { priority: spec.priority } : {}),
      ...(spec.estimateMinutes !== undefined ? { estimateMinutes: spec.estimateMinutes } : {}),
    },
  ];
  if (spec.subtasks?.length) ops.push({ op: "add_subtasks", subtasks: spec.subtasks });
  return applyPlannerTaskEdits({ timezone: timeZone }, ops, ids);
}

function formatInstant(value: unknown, timeZone: string, allDay: boolean) {
  if (typeof value !== "number") return "none";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    ...(allDay ? {} : { timeStyle: "short" }),
  }).format(new Date(value));
}

export function plannerTaskOutline(content: unknown) {
  const task = record(content);
  const timeZone = text(task.timezone) || "UTC";
  const subtasks = list(task.subtasks).map(record);
  return [
    `Task: ${text(task.taskTitle) || "(untitled)"} [${text(task.status)}, ${text(task.priority) || "medium"} priority]`,
    `Due: ${formatInstant(task.dueAt, timeZone, task.allDay === true)} (${timeZone})`,
    ...(task.description ? [`Description: ${truncate(text(task.description), 600)}`] : []),
    ...(subtasks.length ? [`Subtasks:`, ...subtasks.map((entry, index) => `${index + 1}. [${entry.done ? "x" : " "}] ${text(entry.title)}`)] : []),
  ].join("\n");
}

export function plannerTaskProblems(content: unknown) {
  const task = record(content);
  const problems: string[] = [];
  if (!trimmed(task.taskTitle)) problems.push("the task has no title");
  list(task.subtasks).forEach((entry, index) => {
    if (isPlaceholder(record(entry).title)) problems.push(`subtask ${index + 1} is empty`);
  });
  return problems;
}
