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
  action: (editor: Editor) => void;
};

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // Text
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    section: "Text",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    section: "Text",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    section: "Text",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  // Lists
  {
    id: "bullet",
    label: "Bullet List",
    description: "Unordered list with bullets",
    icon: "list",
    section: "Lists",
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered List",
    description: "Ordered list with numbers",
    icon: "list-ordered",
    section: "Lists",
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "todo",
    label: "Task List",
    description: "Checkboxes for tasks",
    icon: "check-square",
    section: "Lists",
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  // Blocks
  {
    id: "quote",
    label: "Blockquote",
    description: "Indented quote block",
    icon: "quote",
    section: "Blocks",
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code Block",
    description: "Code with syntax highlighting",
    icon: "code",
    section: "Blocks",
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal separator line",
    icon: "minus",
    section: "Blocks",
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  // Media & Layout
  {
    id: "table",
    label: "Table",
    description: "Insert a 3×3 table",
    icon: "table",
    section: "Media",
    action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "image",
    label: "Image",
    description: "Embed an image from URL",
    icon: "image",
    section: "Media",
    action: (editor) => {
      const url = window.prompt("Image URL:");
      if (url) editor.chain().focus().setImage({ src: url }).run();
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

export function getFilteredCommands(query: string): SlashCommandItem[] {
  if (!query) return SLASH_COMMANDS;
  const lower = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.id.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower),
  );
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
