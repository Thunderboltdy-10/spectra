import { ToolInputError, type HarnessTool, type InputOption, type TodoItem } from "../types";
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
      "Ask the user a question when a reasonable person could not proceed without the answer (which of two similar items, a missing choice that changes the result). Offer 2-4 short options when you can; the user may also type an answer. The run waits for the reply. Do not ask for anything you can find out or sensibly assume.",
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
    description:
      "Show a small interactive widget inline in the conversation: a self-contained HTML snippet with inline CSS and JS (no network access), such as a quick calculator, a slider demo or a small chart. Use CSS variables like var(--text-primary) and var(--bg-elevated) so it matches the theme. For anything the user will keep, create an artifact instead.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, html: { type: "string" } },
      required: ["title", "html"],
      additionalProperties: false,
    },
    effect: "read",
    label: (args) => `Drawing *${args.title}*`,
    parse: (raw) => ({ title: requireString(raw, "title", 120), html: requireString(raw, "html", 60_000) }),
    execute: async (args) => ({
      ok: true,
      content: `Showed the widget "${args.title}" to the user.`,
      widget: { title: args.title, html: args.html },
      doneLabel: `Showed *${args.title}*`,
    }),
  };
}
