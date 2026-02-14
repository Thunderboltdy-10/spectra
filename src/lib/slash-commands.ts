import type { StudyMode } from "@/types";

export type SlashCommandId = "search" | "mode" | "model" | "export" | "clear" | "help";

export type SlashCommandDefinition = {
  id: SlashCommandId;
  trigger: `/${string}`;
  description: string;
  usage: string;
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { id: "search", trigger: "/search", usage: "/search on|off", description: "Toggle web search" },
  { id: "mode", trigger: "/mode", usage: "/mode tutor|quiz|research", description: "Switch study mode" },
  { id: "model", trigger: "/model", usage: "/model <model-id>", description: "Set manual model" },
  { id: "export", trigger: "/export", usage: "/export markdown|pdf", description: "Export conversation" },
  { id: "clear", trigger: "/clear", usage: "/clear", description: "Start a new chat" },
  { id: "help", trigger: "/help", usage: "/help", description: "Show command help" },
];

export type ParsedSlashCommand = {
  id: SlashCommandId;
  args: string[];
  raw: string;
};

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const clean = input.trim();
  if (!clean.startsWith("/")) return null;
  const [head, ...args] = clean.split(/\s+/);
  const command = SLASH_COMMANDS.find((item) => item.trigger === head.toLowerCase());
  if (!command) return null;
  return {
    id: command.id,
    args,
    raw: clean,
  };
}

export function normalizeModeArg(value: string): StudyMode | null {
  const mode = value.trim().toLowerCase().replace(/-/g, "_");
  const modes: StudyMode[] = ["tutor", "marker", "exam", "draft_coach", "quiz", "flashcard", "research", "explain", "general"];
  return modes.includes(mode as StudyMode) ? (mode as StudyMode) : null;
}
