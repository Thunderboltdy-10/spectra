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
  /** Set when the item is a disabled explanation rather than a verb. */
  disabledReason?: string;
  action: (editor: Editor) => void | boolean | Promise<void | boolean>;
};

/**
 * The slash menu is a view of the command registry.
 *
 * It used to be a second implementation: sixteen TipTap chains living beside a
 * work bar that had its own, so `/table` and the Insert tab could disagree, and
 * neither was reachable by the AI or by a shortcut (C1). Now each entry names a
 * command id and a parameter, the studio hands the menu one dispatcher, and the
 * menu renders whatever that dispatcher says is available — including the honest
 * refusal when a linked Word file cannot take the change.
 */
export type SlashCommandSpec = {
  id: string;
  /** Namespaced registry id, e.g. `document.insert.table`. */
  commandId: string;
  /** Scalar handed to the command's single `onSelect`, when it takes one. */
  param?: string | number | boolean;
  label: string;
  description: string;
  icon: string;
  section: string;
  aliases?: string[];
};

export const DOCUMENT_SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  { id: "heading1", commandId: "document.format.style", param: "h1", label: "Heading 1", description: "Large section heading", icon: "H1", section: "Text", aliases: ["h1", "title"] },
  { id: "heading2", commandId: "document.format.style", param: "h2", label: "Heading 2", description: "Medium section heading", icon: "H2", section: "Text", aliases: ["h2", "subtitle"] },
  { id: "heading3", commandId: "document.format.style", param: "h3", label: "Heading 3", description: "Small section heading", icon: "H3", section: "Text", aliases: ["h3"] },
  { id: "body", commandId: "document.format.style", param: "paragraph", label: "Body text", description: "Return the block to body text", icon: "text", section: "Text", aliases: ["paragraph", "normal"] },
  { id: "bullet", commandId: "document.format.list.bullet", label: "Bullet list", description: "Create a bulleted list", icon: "list", section: "Lists", aliases: ["ul", "bullets"] },
  { id: "numbered", commandId: "document.format.list.numbered", label: "Numbered list", description: "Create an ordered list", icon: "list-ordered", section: "Lists", aliases: ["ol", "numbers"] },
  { id: "todo", commandId: "document.insert.taskList", label: "Task list", description: "Create an interactive checklist", icon: "check-square", section: "Lists", aliases: ["checkbox", "tasks"] },
  { id: "quote", commandId: "document.format.quote", label: "Quote", description: "Emphasise a quoted passage", icon: "quote", section: "Blocks", aliases: ["blockquote"] },
  { id: "code", commandId: "document.format.code.block", label: "Code block", description: "Insert a code block", icon: "code", section: "Blocks", aliases: ["pre"] },
  { id: "equation", commandId: "document.insert.equation", label: "Equation", description: "Insert an editable LaTeX equation", icon: "sigma", section: "Blocks", aliases: ["math", "latex", "formula"] },
  { id: "inline-equation", commandId: "document.insert.equation.inline", label: "Inline equation", description: "An equation inside the sentence", icon: "sigma", section: "Blocks", aliases: ["imath"] },
  { id: "divider", commandId: "document.insert.divider", label: "Divider", description: "Separate sections visually", icon: "minus", section: "Blocks", aliases: ["hr", "separator"] },
  { id: "page-break", commandId: "document.insert.pageBreak", label: "Page break", description: "Start what follows on a new page", icon: "minus", section: "Blocks", aliases: ["pagebreak", "newpage"] },
  { id: "section-break", commandId: "document.insert.sectionBreak", label: "Section break", description: "Start a section with its own page setup", icon: "columns", section: "Blocks", aliases: ["section"] },
  { id: "table", commandId: "document.insert.table", label: "Table", description: "Insert a 3 × 3 table", icon: "table", section: "Media", aliases: ["grid"] },
  { id: "image", commandId: "document.insert.image", label: "Image", description: "Insert an image from your device", icon: "image", section: "Media", aliases: ["picture", "photo"] },
  { id: "reference", commandId: "document.insert.reference", label: "Reference", description: "Insert visible work without copying it", icon: "link", section: "Media", aliases: ["embed", "work"] },
  { id: "link", commandId: "document.insert.link", label: "Link", description: "Link the selection to a web address", icon: "link", section: "Media", aliases: ["url", "href"] },
  { id: "citation", commandId: "document.insert.citation", label: "Citation", description: "Insert a Spectra research citation (not a Word citation field)", icon: "book", section: "References", aliases: ["cite", "source"] },
  { id: "footnote", commandId: "document.insert.footnote", label: "Footnote", description: "A numbered note at the foot of the page", icon: "book", section: "References", aliases: ["note"] },
  { id: "endnote", commandId: "document.insert.endnote", label: "Endnote", description: "A note collected at the end", icon: "book", section: "References", aliases: [] },
  { id: "toc", commandId: "document.insert.toc", label: "Table of contents", description: "List the headings as they are now", icon: "list-ordered", section: "References", aliases: ["contents", "outline"] },
  { id: "caption", commandId: "document.insert.caption", label: "Caption", description: "A styled caption paragraph", icon: "quote", section: "References", aliases: [] },
  { id: "callout-info", commandId: "document.insert.callout.info", label: "Info callout", description: "Highlight useful context", icon: "info", section: "Callouts", aliases: ["note"] },
  { id: "callout-warning", commandId: "document.insert.callout.warning", label: "Warning callout", description: "Highlight a caution", icon: "alert-triangle", section: "Callouts" },
  { id: "callout-tip", commandId: "document.insert.callout.tip", label: "Tip callout", description: "Highlight a helpful idea", icon: "lightbulb", section: "Callouts" },
];

/**
 * How the menu asks the registry to do something, and whether it may.
 *
 * `availability` is the same function the work bar consults, so an item that is
 * greyed in the bar is greyed here with the same sentence — one availability
 * decision, two surfaces (C2).
 */
export type SlashCommandDispatcher = {
  run: (commandId: string, param?: string | number | boolean) => void | boolean | Promise<void | boolean>;
  availability?: (commandId: string) => { enabled: boolean; reason?: string };
};

export function documentSlashItems(
  dispatcher: SlashCommandDispatcher,
  specs: readonly SlashCommandSpec[] = DOCUMENT_SLASH_COMMANDS,
): SlashCommandItem[] {
  return specs.flatMap((spec) => {
    const state = dispatcher.availability?.(spec.commandId);
    // A verb the registry does not know is a bug, not a menu entry. Hiding it
    // is the honest outcome: a person never sees a command that cannot run.
    if (state && !state.enabled && !state.reason) return [];
    return [
      {
        id: spec.id,
        label: spec.label,
        description: state?.reason ?? spec.description,
        icon: spec.icon,
        section: spec.section,
        ...(spec.aliases ? { aliases: spec.aliases } : {}),
        ...(state && !state.enabled && state.reason ? { disabledReason: state.reason } : {}),
        action: () => dispatcher.run(spec.commandId, spec.param),
      },
    ];
  });
}

/**
 * The field-editor fallback: surfaces that hold a small rich-text field have no
 * command registry, so they keep a direct set. It is deliberately the short list
 * — the verbs a caption or a card back actually needs.
 */
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

export function filterSlashCommands(items: readonly SlashCommandItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.flatMap((command) => {
    const candidates = [command.id, command.label, command.description, ...(command.aliases ?? [])].map((value) => value.toLowerCase());
    const exact = candidates.some((value) => value === normalized);
    const contained = candidates.some((value) => value.includes(normalized));
    const fuzzy = candidates.some((value) => fuzzyMatch(value, normalized));
    return exact || contained || fuzzy ? [{ command, score: exact ? 3 : contained ? 2 : 1 }] : [];
  }).sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label)).map(({ command }) => command);
}

export function getFilteredCommands(query: string) {
  return filterSlashCommands(SLASH_COMMANDS, query);
}

export const SlashCommand = Extension.create({
  name: "spectraSlashCommand",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashCommandItem }) => {
          // A disabled entry explains itself and leaves the text alone; deleting
          // the "/word" a person typed and then doing nothing reads as a bug.
          if (props.disabledReason) return;
          const query = editor.state.doc.textBetween(range.from, range.to);
          const before = editor.state.doc;
          void Promise.resolve(props.action(editor)).then((accepted) => {
            if (editor.isDestroyed || accepted === false || editor.state.doc.eq(before))
              return;
            if (
              editor.state.doc.textBetween(range.from, range.to) === query
            )
              editor.chain().focus().deleteRange(range).run();
          }).catch(() => undefined);
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
