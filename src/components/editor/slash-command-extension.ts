/**
 * slash-command-extension.ts
 *
 * Tiptap extension for slash commands using @tiptap/suggestion.
 * Type "/" to trigger a filtered dropdown of block insertion commands.
 */

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";

export type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  section?: string;
  aliases?: string[];
  action: (editor: Editor) => void;
};

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // Inline formatting
  {
    id: "bold",
    label: "Bold",
    description: "Make the current text bold",
    icon: "bold",
    section: "Formatting",
    aliases: ["strong"],
    action: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    description: "Italicize the current text",
    icon: "italic",
    section: "Formatting",
    aliases: ["emphasis", "em"],
    action: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    id: "underline",
    label: "Underline",
    description: "Underline the current text",
    icon: "underline",
    section: "Formatting",
    aliases: ["underlined"],
    action: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  // Text
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    section: "Text",
    aliases: ["h1", "heading 1", "title"],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    section: "Text",
    aliases: ["h2", "heading 2", "subtitle"],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    section: "Text",
    aliases: ["h3", "heading 3"],
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  // Lists
  {
    id: "bullet",
    label: "Bullet List",
    description: "Unordered list with bullets",
    icon: "list",
    section: "Lists",
    aliases: ["ul", "unordered", "bullets"],
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered List",
    description: "Ordered list with numbers",
    icon: "list-ordered",
    section: "Lists",
    aliases: ["ol", "ordered", "numbers"],
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "todo",
    label: "Task List",
    description: "Checkboxes for tasks",
    icon: "check-square",
    section: "Lists",
    aliases: ["checkbox", "task", "tasks", "checklist"],
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  // Blocks
  {
    id: "quote",
    label: "Blockquote",
    description: "Indented quote block",
    icon: "quote",
    section: "Blocks",
    aliases: ["blockquote", "bq"],
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code Block",
    description: "Code with syntax highlighting",
    icon: "code",
    section: "Blocks",
    aliases: ["codeblock", "cb", "pre"],
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "equation",
    label: "Equation",
    description: "Editable LaTeX equation with live preview",
    icon: "sigma",
    section: "Blocks",
    aliases: ["math", "latex", "formula"],
    action: (editor) => editor.chain().focus().insertContent({ type: "equation", attrs: { latex: "", display: "block", alignment: "center" } }).run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal separator line",
    icon: "minus",
    section: "Blocks",
    aliases: ["hr", "line", "separator"],
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  // Media & Layout
  {
    id: "table",
    label: "Table",
    description: "Insert a 3×3 table",
    icon: "table",
    section: "Media",
    aliases: ["grid"],
    action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "image",
    label: "Image",
    description: "Upload an image from your device",
    icon: "image",
    section: "Media",
    aliases: ["img", "picture"],
    action: (editor) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;";
      document.body.appendChild(input);
      input.onchange = () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const src = e.target?.result as string | null;
          if (src) editor.chain().focus().setImage({ src }).run();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
  },
  // Callouts
  {
    id: "callout-info",
    label: "Info Callout",
    description: "Blue highlighted block",
    icon: "info",
    section: "Callouts",
    action: (editor) => editor.chain().focus().setCallout({ type: "info" }).run(),
  },
  {
    id: "callout-warning",
    label: "Warning Callout",
    description: "Amber warning block",
    icon: "alert-triangle",
    section: "Callouts",
    action: (editor) => editor.chain().focus().setCallout({ type: "warning" }).run(),
  },
  {
    id: "callout-tip",
    label: "Tip Callout",
    description: "Green tip/hint block",
    icon: "lightbulb",
    section: "Callouts",
    action: (editor) => editor.chain().focus().setCallout({ type: "tip" }).run(),
  },
];

function fuzzyMatches(target: string, query: string) {
  let queryIndex = 0;
  for (const character of target) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex >= query.length) {
        return true;
      }
    }
  }
  return queryIndex >= query.length;
}

export function getFilteredCommands(query: string): SlashCommandItem[] {
  if (!query) return SLASH_COMMANDS;
  const lower = query.toLowerCase();
  const scored = SLASH_COMMANDS.flatMap((cmd) => {
    const aliases = cmd.aliases?.map((alias) => alias.toLowerCase()) ?? [];
    const haystacks = [cmd.label.toLowerCase(), cmd.id.toLowerCase(), cmd.description.toLowerCase(), ...aliases];
    const exactAlias = aliases.some((alias) => alias === lower);
    const substring = haystacks.some((value) => value.includes(lower));
    const fuzzy = haystacks.some((value) => fuzzyMatches(value, lower));

    if (!exactAlias && !substring && !fuzzy) {
      return [];
    }

    const score = exactAlias ? 3 : substring ? 2 : 1;
    return [{ cmd, score }];
  });

  return scored
    .sort((left, right) => right.score - left.score || left.cmd.label.localeCompare(right.cmd.label))
    .map((entry) => entry.cmd);
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: SlashCommandItem;
        }) => {
          // Delete the slash + query text before executing the command
          editor.chain().focus().deleteRange(range).run();
          props.action(editor);
        },
      } as Partial<SuggestionOptions<SlashCommandItem>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => getFilteredCommands(query),
      }),
    ];
  },
});
