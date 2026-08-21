import { Extension, type Editor } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { spectraBus } from "../events";

export type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  section: string;
  aliases?: string[];
  action: (editor: Editor) => void;
};

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: "heading1", label: "Heading 1", description: "Large section heading", icon: "H1", section: "Text", aliases: ["h1", "title"], action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "heading2", label: "Heading 2", description: "Medium section heading", icon: "H2", section: "Text", aliases: ["h2", "subtitle"], action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "heading3", label: "Heading 3", description: "Small section heading", icon: "H3", section: "Text", aliases: ["h3"], action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "bullet", label: "Bullet list", description: "Create a bulleted list", icon: "list", section: "Lists", aliases: ["ul", "bullets"], action: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: "numbered", label: "Numbered list", description: "Create an ordered list", icon: "list-ordered", section: "Lists", aliases: ["ol", "numbers"], action: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: "todo", label: "Task list", description: "Create an interactive checklist", icon: "check-square", section: "Lists", aliases: ["checkbox", "tasks"], action: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "Quote", description: "Emphasise a quoted passage", icon: "quote", section: "Blocks", aliases: ["blockquote"], action: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code block", description: "Insert a code block", icon: "code", section: "Blocks", aliases: ["pre"], action: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: "equation", label: "Equation", description: "Insert an editable LaTeX equation", icon: "sigma", section: "Blocks", aliases: ["math", "latex", "formula"], action: (editor) => editor.chain().focus().insertContent({ type: "equation", attrs: { latex: "", display: "block", alignment: "center" } }).run() },
  { id: "divider", label: "Divider", description: "Separate sections visually", icon: "minus", section: "Blocks", aliases: ["hr", "separator"], action: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: "table", label: "Table", description: "Insert a 3 × 3 table", icon: "table", section: "Media", aliases: ["grid"], action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "image", label: "Image", description: "Insert an image from your device", icon: "image", section: "Media", aliases: ["picture", "photo"], action: (editor) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") editor.chain().focus().setImage({ src: reader.result }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  } },
  { id: "reference", label: "Reference", description: "Insert visible work without copying it", icon: "link", section: "Media", aliases: ["embed", "work"], action: (editor) => {
    const hostWorkId = editor.view.dom.dataset.workId;
    if (hostWorkId) spectraBus.command("reference.beginPicking", { hostWorkId });
  } },
  { id: "callout-info", label: "Info callout", description: "Highlight useful context", icon: "info", section: "Callouts", aliases: ["note"], action: (editor) => editor.chain().focus().setCallout({ type: "info" }).run() },
  { id: "callout-warning", label: "Warning callout", description: "Highlight a caution", icon: "alert-triangle", section: "Callouts", action: (editor) => editor.chain().focus().setCallout({ type: "warning" }).run() },
  { id: "callout-tip", label: "Tip callout", description: "Highlight a helpful idea", icon: "lightbulb", section: "Callouts", action: (editor) => editor.chain().focus().setCallout({ type: "tip" }).run() },
];

function fuzzyMatch(value: string, query: string) {
  let cursor = 0;
  for (const character of value) {
    if (character === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return false;
}

export function getFilteredCommands(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SLASH_COMMANDS;
  return SLASH_COMMANDS.flatMap((command) => {
    const candidates = [command.id, command.label, command.description, ...(command.aliases ?? [])].map((value) => value.toLowerCase());
    const exact = candidates.some((value) => value === normalized);
    const contained = candidates.some((value) => value.includes(normalized));
    const fuzzy = candidates.some((value) => fuzzyMatch(value, normalized));
    return exact || contained || fuzzy ? [{ command, score: exact ? 3 : contained ? 2 : 1 }] : [];
  }).sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label)).map(({ command }) => command);
}

export const SlashCommand = Extension.create({
  name: "spectraSlashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashCommandItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.action(editor);
        },
      } as Partial<SuggestionOptions<SlashCommandItem>>,
    };
  },
  addProseMirrorPlugins() {
    const configuredItems = this.options.suggestion.items as
      | ((input: { query: string }) => SlashCommandItem[])
      | undefined;
    return [Suggestion<SlashCommandItem>({
      editor: this.editor,
      ...this.options.suggestion,
      items:
        configuredItems ??
        (({ query }: { query: string }) => getFilteredCommands(query)),
    })];
  },
});
