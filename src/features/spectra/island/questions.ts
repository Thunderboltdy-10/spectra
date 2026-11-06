import { toast } from "@/components/ui/toast";
import type { CommandAttachment } from "../components/command-attachments";
import { postSpectra, type SpectraRunTab } from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";
import { deriveLiveDockTab } from "../runs/live-dock";
import type { SpectraRunEngine } from "./engine";
import { runTabCard, runTabSource } from "./run-tabs";

/*
 * Everything Spectra is waiting on the user for, as one list of questions the
 * island can show one card at a time (ISLAND.md, "Questions and approvals").
 * Two kinds of runs ask: the live harness run (its open `input`), and saved
 * runs listed in the tabs (a clarification, a choice, an approval of
 * proposed changes). Each question knows how to send its own answer.
 */

export type QuestionOption = { key: string; label: string; description?: string };

export type PendingQuestion = {
  key: string;
  runId: string;
  threadId: string | null;
  /** The thread's title, for "Open thread" and the screen reader. */
  threadTitle: string;
  kind: "approval" | "question";
  prompt: string;
  options: QuestionOption[];
  /** Several questions answered together, each with its own options. */
  batch?: Array<{ id: string; prompt: string; options: QuestionOption[] }>;
  allowText: boolean;
  /** "Always allow" with its category on the second line ("Deleting files"). */
  alwaysAllow?: { label: string; description: string };
  /** The run wants a file. */
  file?: { accept?: string };
};

export type QuestionAnswer =
  | { kind: "allow"; always?: boolean }
  | { kind: "deny"; text?: string }
  | { kind: "choice"; key: string; label: string }
  | { kind: "batch"; selections: Record<string, string> }
  | { kind: "text"; text: string; attachments?: CommandAttachment[] }
  | { kind: "skip" };

/** "Always allow sharing" → { label: "Always allow", description: "Sharing" }. */
export function splitAlwaysAllow(label: string) {
  const rest = label.replace(/^always allow\s*/i, "").trim();
  return { label: "Always allow", description: rest ? rest[0].toUpperCase() + rest.slice(1) : "This kind of step" };
}

export function pendingQuestions(engine: SpectraRunEngine | null, tabs: readonly SpectraRunTab[]): PendingQuestion[] {
  const list: PendingQuestion[] = [];
  const live = engine?.liveExchange;
  if (live?.input && live.runId) {
    const input = live.input;
    const tab = tabs.find((candidate) => candidate.runId === live.runId);
    list.push({
      key: `live:${live.runId}:${input.toolCallId}`,
      runId: live.runId,
      threadId: live.threadId ?? tab?.threadId ?? null,
      threadTitle: tab?.thread.title ?? (live.prompt.slice(0, 48) || "This conversation"),
      kind: input.kind,
      prompt: input.question,
      options: (input.options ?? []).slice(0, 4).map((option) => ({ key: option.key, label: option.label, description: option.description })),
      allowText: input.kind === "question" && (Boolean(input.allowText) || !input.options?.length),
      alwaysAllow: input.alwaysAllowLabel ? splitAlwaysAllow(input.alwaysAllowLabel) : undefined,
    });
  }
  for (const tab of tabs) {
    if (tab.hiddenAt || tab.runId === live?.runId) continue;
    const model = deriveLiveDockTab(runTabSource(tab));
    const request = model.inputRequest;
    if (!request || model.state !== "needs_input") continue;
    const base = { key: `tab:${tab.runId}`, runId: tab.runId, threadId: tab.threadId, threadTitle: model.title };
    if (request.kind === "approval") {
      const targets = model.targetNames.length ? ` (${model.targetNames.join(", ")})` : "";
      list.push({ ...base, kind: "approval", prompt: `${request.prompt}${targets}`, options: [], allowText: true });
    } else if (request.kind === "choice") {
      list.push({
        ...base,
        kind: "question",
        prompt: request.prompt,
        options: request.options.slice(0, 4).map((option, index) => ({
          key: option.key ?? `option-${index}`,
          label: option.displayTitle ?? option.title,
          description: option.description ?? undefined,
        })),
        allowText: true,
      });
    } else if (request.kind === "choice_batch") {
      list.push({
        ...base,
        kind: "question",
        prompt: request.questions.length === 1 ? request.questions[0].prompt : `${request.questions.length} quick questions`,
        options: [],
        batch: request.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          options: question.options.map((option, index) => ({
            key: option.key ?? `option-${index}`,
            label: option.displayTitle ?? option.title,
            description: option.description ?? undefined,
          })),
        })),
        allowText: false,
      });
    } else {
      list.push({
        ...base,
        kind: "question",
        prompt: request.prompt,
        options: [],
        allowText: true,
        ...(request.kind === "file" ? { file: { accept: request.accept } } : {}),
      });
    }
  }
  return list;
}

const SKIP_PROMPT = "Skip that question and continue with reasonable defaults.";

/** Send the user's answer to whichever run asked. True when the run took it. */
export async function answerQuestion(
  engine: SpectraRunEngine,
  question: PendingQuestion,
  answer: QuestionAnswer,
  tabs: readonly SpectraRunTab[],
): Promise<boolean> {
  if (question.key.startsWith("live:")) {
    const toolCallId = question.key.split(":").slice(2).join(":");
    if (answer.kind === "allow") return engine.answer(question.runId, toolCallId, { kind: "approval", allowed: true, ...(answer.always ? { alwaysAllow: true } : {}) });
    if (answer.kind === "deny") {
      if (answer.text?.trim()) return engine.revise({ runId: question.runId } as ResultCardStreamView, answer.text);
      return engine.answer(question.runId, toolCallId, { kind: "approval", allowed: false });
    }
    if (answer.kind === "choice") return engine.answer(question.runId, toolCallId, { kind: "question", choiceKey: answer.key });
    if (answer.kind === "text") return engine.answer(question.runId, toolCallId, { kind: "question", text: answer.text });
    if (answer.kind === "skip") return engine.answer(question.runId, toolCallId, { kind: "question", text: SKIP_PROMPT });
    return false;
  }

  const tab = tabs.find((candidate) => candidate.runId === question.runId);
  if (!tab) return false;
  const model = deriveLiveDockTab(runTabSource(tab));
  const request = model.inputRequest;
  const hide = async () => {
    await postSpectra({ action: "hideRunTab", runId: tab.runId }).catch(() => undefined);
  };

  if (request?.kind === "approval") {
    // A run can be waiting before its result card has reached this tab.
    const card = runTabCard(tab) ?? ({ runId: tab.runId } as ResultCardStreamView);
    if (answer.kind === "allow") {
      await engine.onCardAction(card, "confirm");
      return true;
    }
    if (answer.kind === "deny") {
      if (answer.text?.trim()) return engine.revise(card, answer.text);
      await engine.onCardAction(card, "cancel");
      return true;
    }
    if (answer.kind === "text") return engine.revise(card, answer.text);
    return false;
  }

  if (request?.kind === "choice" || request?.kind === "choice_batch") {
    const skip = answer.kind === "skip";
    let choiceKey: string;
    let response: string;
    let batchSelections: Array<{ questionId: string; choiceKey: string; choiceTitle: string }> | undefined;
    if (request.kind === "choice_batch") {
      const selections = answer.kind === "batch" ? answer.selections : {};
      batchSelections = request.questions.map((item) => {
        const key = selections[item.id] ?? "skip";
        const option = item.options.find((candidate, index) => (candidate.key ?? `option-${index}`) === key);
        return { questionId: item.id, choiceKey: option?.key ?? "skip", choiceTitle: option?.title ?? "Skipped" };
      });
      choiceKey = skip ? "skip" : "batch";
      response = skip ? "Skipped" : batchSelections.map((selection) => selection.choiceTitle).join("; ");
    } else if (answer.kind === "choice") {
      const option = request.options.find((candidate, index) => (candidate.key ?? `option-${index}`) === answer.key);
      if (!option?.key) {
        toast.error("This question is no longer open. Open the thread to see where it stands.");
        return false;
      }
      choiceKey = option.key;
      response = option.title;
    } else if (answer.kind === "text") {
      // A written answer goes into the thread as the reply.
      return engine.run(answer.text, answer.attachments ?? [], { threadId: tab.threadId });
    } else {
      choiceKey = "skip";
      response = "Skipped";
    }
    const executionId = request.executionId ?? tab.run.executionId;
    if (request.messageId) {
      await postSpectra({
        action: "selectMessageChoice",
        messageId: request.messageId,
        ...(request.clarificationId ? { clarificationId: request.clarificationId } : {}),
        ...(executionId ? { executionId } : {}),
        choiceKey,
        choiceTitle: response,
        ...(batchSelections ? { batchSelections } : {}),
      });
    }
    const accepted = await engine.run(skip ? SKIP_PROMPT : response, [], {
      threadId: tab.threadId,
      clarificationId: request.clarificationId,
      choiceKey,
      choiceMessageId: request.messageId,
      executionId,
      ...(batchSelections ? { batchSelections } : {}),
    });
    if (accepted) await hide();
    return accepted;
  }

  // A clarification or a file.
  const text = answer.kind === "text" ? answer.text : answer.kind === "skip" ? SKIP_PROMPT : "";
  if (!text) return false;
  const accepted = await engine.run(text, answer.kind === "text" ? answer.attachments ?? [] : [], { threadId: tab.threadId });
  if (accepted) await hide();
  return accepted;
}
