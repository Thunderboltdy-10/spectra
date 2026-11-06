import type { AuthoredType } from "./index";

/*
 * The authoring format of each type, in the words the model reads. The create
 * and edit tools carry the short form; load_skill returns the full form with
 * the type's craft guidance.
 */

export const AUTHORING_FORMATS: Record<AuthoredType, { create: string; edit: string; read: string }> = {
  document: {
    create: '{"markdown": "# Title\\n\\nThe document in Markdown: headings, lists, tables, **bold**, $math$, > quotes, - [ ] checklists."}',
    edit:
      'replace {find, replace, all?} or {from, to, replace}: find quotes the text; for a longer passage, from and to quote only its first and last words and all of it is replaced, so never write out what is going away. Formatting marks need not match; no replace deletes | insert {markdown, after?, before?, position?: "start"|"end"}: after and before take a heading or any unique text | move_section {heading, after?|before?|position?} | delete_section {heading} | rewrite {markdown} (the whole document, only when nearly all of it changes)',
    read: "section: a heading, to read only that section",
  },
  presentation: {
    create:
      '{"slides": [{"title": "...", "body": "- point\\n- point" | ["column one", "column two"], "visual"?: {"type": "chart", "chartType": "bar"|"column"|"line"|"pie"|"area", "categories": [...], "series": [{"name", "values": [numbers]}], "title"?} | {"type": "table", "rows": [["header", ...], [...]]} | {"type": "shape", "text"}, "layout"?: "title-only"|"statement"|"title-content"|"two-column"|"three-ideas"|"title-visual-text"|"visual-story"|"full-bleed", "notes"?: "speaker notes"}], "theme"?: {"name"?, "background"?, "heading"?, "body"?, "accent"?, "headingFont"?, "bodyFont"?}, "design"?: "rule"|"band"|"panel"|"night"|"none"}. Designer finishes the deck in the look named (default "rule"; "none" leaves the plain layouts). Body lines starting "- " are bullets; an array body makes columns or idea cards. Layout is chosen from the content when omitted. Images are not available. A short deck goes in whole; a long one can start with its opening slides and grow with add_slide, then take one design edit at the end.',
    edit:
      "add_slide {position?, title?, body?, visual?, layout?, notes?} | update_slide {slide: number, title?, body?, visual? (null removes it), layout?, notes?} | delete_slide {slide} | move_slide {slide, to} | set_theme {background?, heading?, body?, accent?, headingFont?, bodyFont?} | replace {find, replace, all?} | design {look?: rule|band|panel|night} (Designer re-finishes the whole deck) | design {slide, look?: rule|band|panel|centred|night|cards|half|half-right|framed|stage|row|mosaic} (one slide; the best fit when look is omitted). A designed slide keeps its look through later edits.",
    read: "from/to: slide numbers",
  },
  sheets: {
    create:
      '{"sheets": [{"name": "Budget", "rows": [["Item", "Cost"], ["Rent", 500], ["Total", "=SUM(B2:B2)"]], "start"?: "A1", "format"?: [{"range": "A1:B1", "bold": true}], "charts"?: [{"type": "bar", "range": "A1:B3", "title"}], "frozenRows"?: 1, "columnWidths"?: {"A": 160}}]}. A value starting with "=" is a formula.',
    edit:
      'set_range {sheet?, range: "B2" or "B2:C4", values: [[...]]} | clear_range {range} | format_range {range, bold?, italic?, align?, wrap?, numberFormat?, decimals?, currency?, textColor?, fillColor?} | insert_rows/delete_rows {at: row number, count?} | insert_columns/delete_columns {at: letter, count?} | add_sheet {name} | rename_sheet {sheet, name} | delete_sheet {sheet} | add_chart {type, range, title?} | set_column_width {column, width} | freeze {rows?, columns?}',
    read: "sheet and range (A1 notation)",
  },
  whiteboard: {
    create:
      '{"nodes": [{"key": "sun", "text": "The sun heats water", "type"?: "shape"|"note"|"card"|"text", "color"?: "mint"|"gold"|"violet"|"cyan"|"coral"|"orange"|"plain"}], "edges"?: [{"from": "sun", "to": "vapour", "label"?}], "layout"?: "flow-down"|"flow-right"|"cycle"|"mind-map"|"grid"}. Positions are computed; never give coordinates.',
    edit:
      "add_nodes {nodes, edges?} | update_node {node: key or text, text?, type?, color?} | delete_nodes {nodes} | connect {from, to, label?} | disconnect {from, to} | relayout {layout?} | replace {find, replace}",
    read: "the whole board",
  },
  flashcard_deck: {
    create: '{"items": [{"front": "question", "back": "answer", "hint"?, "explanation"?, "section"?, "difficulty"?, "tags"?}], "settings"?: {...}}',
    edit: "add {items, position?} | update {item: number, ...fields} | delete {items: [numbers]} | move {item, to} | replace {find, replace, all?} | settings {...}",
    read: "from/to: card numbers",
  },
  quiz: {
    create:
      '{"items": [{"prompt": "...", "type": "multiple_choice"|"select_all"|"true_false"|"short_answer"|"numeric"|"fill_blank"|"ordering"|"matching"|"long_response", "options"?: [...], "answer": "exactly one option" | ["several", "for select_all or ordering"] | number, "pairs"?: [{"left", "right"}], "explanation"?, "points"?}], "settings"?: {"instructions"?, ...}}',
    edit: "add {items, position?} | update {item: number, ...fields} | delete {items} | move {item, to} | replace {find, replace, all?} | settings {...} | publish (opens it for attempts by everyone who can open it; every question must be complete) | unpublish (closes it to new attempts)",
    read: "from/to: question numbers",
  },
  timetable: {
    create: '{"items": [{"title": "...", "start": "2026-10-05T09:00:00+02:00", "end": "...", "location"?, "notes"?}]}',
    edit: "add {items} | update {item: number, ...fields} | delete {items} | move {item, to} | replace {find, replace}",
    read: "from/to: event numbers",
  },
  planner_task: {
    create:
      '{"title": "...", "due"?: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (the user\'s time zone), "description"? (notes), "subtasks"?: ["step", ...] (only when the user asks for steps), "priority"?: "low"|"medium"|"high", "estimateMinutes"?, "start"?, "end"?}',
    edit:
      "set {title?, description?, due?, start?, end?, status?: todo|doing|done, priority?, estimateMinutes?, progressNote?} | add_subtasks {subtasks} | update_subtask {subtask: number or title, title?, done?} | delete_subtasks {subtasks}",
    read: "the whole task",
  },
  code: {
    create:
      '{"files": [{"path": "index.html", "source": "..."}], "runtime"?: "browser"|"react"|"python"|"none", "entry"?: "index.html", "title"?, "description"?}',
    edit: "replace {file, find, replace, all?} or {file, from, to, replace}: from and to quote only the first and last lines of a passage, and all of it is replaced | write_file {path, source} | delete_file {path} | rename_file {path, to} | set_entry {path} | set_accessibility {title, description, reducedMotion?} (required metadata before publishing a visualisation; HTML labels alone do not set it)",
    read: "file, and from/to line numbers",
  },
  agent: {
    create:
      '{"purpose": "...", "instructions": "prose", "outcomes"?: [...], "audience"?, "inScope"?: [...], "outOfScope"?: [...], "tone"?: "warm"|"direct"|"socratic"|"formal"|"playful", "responseLength"?: "concise"|"balanced"|"detailed", "boundaries"?: [...], "skills"?: [{"name", "instructions"}], "routingDescription"?, "routingExamples"?: [...]}',
    edit: "set {any create field} | replace {find, replace, all?} (in the instructions). An agent built in the Agent Foundry compiles its instructions, skills and boundaries: set its other fields, and change skills with compile_agent",
    read: "the whole agent",
  },
};

export function formatCheatSheet(kind: "create" | "edit") {
  return Object.entries(AUTHORING_FORMATS)
    .filter(([type]) => type !== "timetable")
    .map(([type, format]) => `- ${type}: ${format[kind]}`)
    .join("\n");
}
