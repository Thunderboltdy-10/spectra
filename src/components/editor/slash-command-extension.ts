/**
 * slash-command-extension.ts
 *
 * Tiptap extension for slash commands.
 * Type "/" to trigger a filtered dropdown of block insertion commands.
 */

import type { Editor } from "@tiptap/core";

export type SlashCommandItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: (editor: Editor) => void;
};

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: "heading1",
    label: "Heading 1",
    description: "Large heading",
    icon: "H1",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium heading",
    icon: "H2",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small heading",
    icon: "H3",
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "Bullet List",
    description: "Unordered list",
    icon: "•",
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered List",
    description: "Ordered list",
    icon: "1.",
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "Blockquote",
    description: "Quote block",
    icon: "❝",
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code Block",
    description: "Code with syntax highlighting",
    icon: "<>",
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    icon: "─",
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

/**
 * Exported items list for the UI component to consume.
 * The extension itself just watches for "/" and provides context.
 * The actual dropdown rendering happens in a React component.
 */
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
