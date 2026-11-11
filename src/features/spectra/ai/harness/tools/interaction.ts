import { ToolInputError, type HarnessTool, type InputOption, type TodoItem } from "../types";
import { WIDGET_LIMITS, WidgetLimitError, checkWidgetHtml } from "../../../widgets/widget-document";
import { requireString, type HarnessSession } from "./shared";

/*
 * Talking with the user during a run: a question that pauses the run until
 * they answer, a visible to-do list for longer work, and an inline widget.
 */

type AskArgs = { question: string; options: InputOption[]; allowText: boolean };

export function askUserTool(): HarnessTool<AskArgs> {
  return {
    name: "ask_user",
    description:
      "Ask a question the user explicitly requests, or one needed to proceed (which of two similar items, a missing choice that changes the result). Offer 2-4 short options when you can; the user may also type an answer. The run waits for the reply. Otherwise do not ask for anything you can find out or sensibly assume.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One plain question." },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, description: { type: "string" } },
            required: ["label"],
          },
        },
        allowText: { type: "boolean", description: "Accept a typed answer. Default true." },
      },
      required: ["question"],
      additionalProperties: false,
    },
    effect: "read",
    label: () => "Asking you a question",
    parse: (raw) => {
      const options = Array.isArray(raw.options) ? raw.options : [];
      if (options.length > 6) throw new ToolInputError("Offer at most 6 options.");
      return {
        question: requireString(raw, "question", 600),
        options: options.map((option, index) => {
          const value = option && typeof option === "object" ? (option as Record<string, unknown>) : {};
          const label = typeof value.label === "string" ? value.label.trim() : typeof option === "string" ? option.trim() : "";
          if (!label) throw new ToolInputError(`options[${index}].label is required.`);
          return {
            key: `option-${index + 1}`,
            label: label.slice(0, 160),
            ...(typeof value.description === "string" && value.description.trim()
              ? { description: value.description.trim().slice(0, 300) }
              : {}),
          };
        }),
        allowText: raw.allowText !== false || !options.length,
      };
    },
    execute: async (args) => ({
      ok: true,
      content: "",
      pause: {
        kind: "question",
        question: args.question,
        ...(args.options.length ? { options: args.options } : {}),
        allowText: args.allowText,
      },
    }),
    answer: (args, answer) => {
      if (answer.kind !== "question") return { ok: false, content: "The user did not answer the question." };
      const chosen = answer.choiceKey ? args.options.find((option) => option.key === answer.choiceKey)?.label : undefined;
      const reply = answer.text?.trim() || chosen || answer.choiceLabel;
      return {
        ok: true,
        content: reply ? `The user answered: ${reply}` : "The user skipped the question. Use your best judgement and say what you assumed.",
        doneLabel: "Got your answer",
      };
    },
  };
}

type TodoArgs = { todos: TodoItem[] };

export function updateTodosTool(session: HarnessSession): HarnessTool<TodoArgs> {
  return {
    name: "update_todos",
    description:
      "Keep a short visible to-do list for work with three or more steps. Send the whole list each time; mark one item in_progress while you work on it and completed as soon as it is done. Skip it for quick requests.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    effect: "read",
    label: () => "Planning the steps",
    parse: (raw) => {
      if (!Array.isArray(raw.todos)) throw new ToolInputError("todos must be a list.");
      if (raw.todos.length > 20) throw new ToolInputError("Keep the list to 20 items or fewer.");
      return {
        todos: raw.todos.map((item, index) => {
          const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const content = typeof value.content === "string" ? value.content.trim() : "";
          if (!content) throw new ToolInputError(`todos[${index}].content is required.`);
          const status = value.status;
          if (status !== "pending" && status !== "in_progress" && status !== "completed")
            throw new ToolInputError(`todos[${index}].status must be pending, in_progress or completed.`);
          return { content: content.slice(0, 200), status };
        }),
      };
    },
    execute: async (args) => {
      session.todos = args.todos;
      const done = args.todos.filter((todo) => todo.status === "completed").length;
      return { ok: true, content: `To-do list updated (${done} of ${args.todos.length} done).`, todos: args.todos, doneLabel: "Updated the plan" };
    },
  };
}

type WidgetArgs = { title: string; html: string };

export function showWidgetTool(): HarnessTool<WidgetArgs> {
  return {
    name: "show_widget",
    description: `Show an interactive HTML or SVG visual inline in the conversation: a slider demo, a small simulation, a calculator, a chart, a labelled diagram. Write a fragment (no <html> or <head>) with inline <style> and <script>. It runs sandboxed with no network: no external scripts, styles, fonts, images or fetch. Colour it with the theme variables (var(--paper-0), var(--ink-1), var(--blue), var(--blue-tint), var(--font-ui) and the rest in the frontend-design skill); they follow light and dark mode. It sits directly on the conversation's page with the app's typefaces, so don't paint a page background or wrap it in a card: draw on the page, with var(--paper-1) only for a panel that needs one. Limits: ${WIDGET_LIMITS.maxHtmlChars.toLocaleString("en")} characters, ${WIDGET_LIMITS.maxScripts} script blocks, height up to ${WIDGET_LIMITS.maxHeight}px. The user can save it as work; for something they asked to keep, create a code artifact instead.`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short name, shown above the visual." },
        html: { type: "string", description: "The widget's HTML fragment." },
      },
      required: ["title", "html"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Drawing *${args.title}*`,
    parse: (raw) => {
      const title = requireString(raw, "title", WIDGET_LIMITS.maxTitleChars);
      if (typeof raw.html !== "string") throw new ToolInputError("html is required.");
      try {
        checkWidgetHtml(raw.html);
      } catch (error) {
        if (error instanceof WidgetLimitError) throw new ToolInputError(error.message);
        throw error;
      }
      return { title, html: raw.html.trim() };
    },
    execute: async (args) => ({
      ok: true,
      content: `Showed the widget "${args.title}" to the user. They can save it as work.`,
      widget: { title: args.title, html: args.html },
      doneLabel: `Showed *${args.title}*`,
    }),
  };
}

type AgentArgs = { agentId: string };

export function agentHandoffTool(session: HarnessSession): HarnessTool<AgentArgs> {
  const titleOf = (id: string) => session.agents.find((agent) => agent.id === id)?.title;
  return {
    name: "use_agent",
    description:
      "Hand this request to one of the user's own agents (listed in the environment) when it clearly matches what the agent is for. You receive the agent's instructions and follow them for the rest of the conversation. Most requests need no agent: use one only when the request is squarely what it is for, never just because it is related.",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string", description: "The agent's id from the environment." } },
      required: ["agentId"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Calling on *${titleOf(args.agentId) ?? "your agent"}*`,
    parse: (raw) => {
      const agentId = requireString(raw, "agentId", 200);
      if (!titleOf(agentId)) throw new ToolInputError("agentId must be one of the user's agents listed in the environment.");
      return { agentId };
    },
    execute: async (args, ctx) => {
      const agent = await session.backend.useAgent?.(args.agentId, ctx.signal);
      if (!agent) return { ok: false, content: "That agent is unavailable or no longer shared with the user. Carry on as Spectra." };
      return {
        ok: true,
        content: `You now work as the user's agent "${agent.title}". Follow its instructions where they fit your rules:\n${agent.instructions.slice(0, 4_000) || "(It has no extra instructions.)"}`,
        doneLabel: `Working as *${agent.title}*`,
      };
    },
  };
}
