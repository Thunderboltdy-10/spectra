import { z } from "zod";
import { artifactContentSchemas } from "./schemas";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactSkill,
  type ArtifactTypeKey,
  type ArtifactTypeManifest,
  type SemanticRegion,
} from "./types";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const rows = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];
const stringValue = (value: unknown, fallback: string) =>
  typeof value === "string" && value ? value : fallback;

function region(
  regionId: string,
  kind: string,
  label: string,
  path: readonly (string | number)[],
  parentRegionId?: string,
  readableText?: string,
): SemanticRegion {
  return {
    regionId,
    kind,
    label,
    path,
    parentRegionId,
    overlapDomain: regionId,
    readableText,
  };
}

const regionAdapters: Record<
  ArtifactTypeKey,
  (content: unknown) => SemanticRegion[]
> = {
  document: (content) => {
    const root = record(content);
    return [
      region(
        "document:properties",
        "document_properties",
        "Document properties",
        ["properties"],
      ),
      ...rows(root.blocks).flatMap((block, index) => {
        const blockId = stringValue(block.id, `block-${index + 1}`);
        const blockType = stringValue(block.type, "block");
        const rawText =
          typeof block.text === "string" ? block.text.trim() : "";
        const firstLine = rawText.split("\n")[0]?.trim() ?? "";
        const excerpt =
          firstLine.length > 48 ? `${firstLine.slice(0, 45)}…` : firstLine;
        const typeLabel =
          blockType === "heading"
            ? "Heading"
            : blockType === "list" ||
                blockType === "bulletList" ||
                blockType === "orderedList"
              ? "List"
              : blockType === "table"
                ? "Table"
                : blockType === "paragraph"
                  ? "Paragraph"
                  : "Block";
        const label = excerpt ? `${typeLabel}: ${excerpt}` : `${typeLabel} ${index + 1}`;
        return [
          region(
            blockId,
            blockType,
            label,
            ["blocks", index],
            undefined,
            typeof block.text === "string" ? block.text : undefined,
          ),
          ...(block.type === "table"
            ? rows(block.rows).flatMap((row, rowIndex) =>
                rows(row.cells).map((cell, cellIndex) =>
                  region(
                    // Always namespace cells under the block so a short AI
                    // cell.id like "b6" cannot collide with another block id.
                    `${blockId}:cell:${rowIndex + 1}:${cellIndex + 1}`,
                    "document_table_cell",
                    `Table ${index + 1} cell ${rowIndex + 1}, ${cellIndex + 1}`,
                    ["blocks", index, "rows", rowIndex, "cells", cellIndex],
                    blockId,
                    typeof cell.text === "string" ? cell.text : undefined,
                  ),
                ),
              )
            : []),
        ];
      }),
      ...rows(root.outline).map((entry, index) =>
        region(
          `document:outline:${stringValue(entry.id, String(index + 1))}`,
          "document_outline_entry",
          stringValue(entry.title, `Section ${index + 1}`),
          ["outline", index],
          typeof entry.id === "string" ? entry.id : undefined,
        ),
      ),
    ];
  },
  flashcard_deck: (content) =>
    rows(record(content).cards).flatMap((card, index) => {
      const cardId = stringValue(card.id, `card-${index + 1}`);
      return [
        region(cardId, "card", `Card ${index + 1}`, ["cards", index]),
        region(
          `${cardId}:front`,
          "card_front",
          `Card ${index + 1} front`,
          ["cards", index, "front"],
          cardId,
          typeof card.front === "string" ? card.front : undefined,
        ),
        ...(typeof card.front === "string"
          ? [
              ...card.front.matchAll(
                /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi,
              ),
            ].map((match, clozeIndex) =>
              region(
                `${cardId}:cloze-${match[1] ?? clozeIndex + 1}`,
                "card_cloze",
                `Card ${index + 1} cloze ${clozeIndex + 1}`,
                ["cards", index, "front"],
                `${cardId}:front`,
                match[2],
              ),
            )
          : []),
        region(
          `${cardId}:back`,
          "card_back",
          `Card ${index + 1} back`,
          ["cards", index, "back"],
          cardId,
          typeof card.back === "string" ? card.back : undefined,
        ),
        region(
          `${cardId}:hint`,
          "card_hint",
          `Card ${index + 1} hint`,
          ["cards", index, "hint"],
          cardId,
          typeof card.hint === "string" ? card.hint : undefined,
        ),
        region(
          `${cardId}:explanation`,
          "card_explanation",
          `Card ${index + 1} explanation`,
          ["cards", index, "explanation"],
          cardId,
          typeof card.explanation === "string" ? card.explanation : undefined,
        ),
        region(
          `${cardId}:media`,
          "card_media",
          `Card ${index + 1} media`,
          ["cards", index, "media"],
          cardId,
        ),
        ...rows(card.occlusions).map((mask, maskIndex) =>
          region(
            stringValue(mask.id, `${cardId}:mask-${maskIndex + 1}`),
            "card_occlusion",
            `Card ${index + 1} hidden region ${maskIndex + 1}`,
            ["cards", index, "occlusions", maskIndex],
            cardId,
            typeof mask.label === "string" ? mask.label : undefined,
          ),
        ),
        region(
          `${cardId}:alternatives`,
          "card_alternatives",
          `Card ${index + 1} accepted alternatives`,
          ["cards", index, "acceptedAlternatives"],
          cardId,
        ),
        region(
          `${cardId}:sources`,
          "card_sources",
          `Card ${index + 1} sources`,
          ["cards", index, "sourceRefs"],
          cardId,
        ),
      ];
    }),
  quiz: (content) => {
    const value = record(content);
    const questionRegions = rows(value.questions).flatMap((question, index) => {
      const questionId = stringValue(question.id, `question-${index + 1}`);
      const options = Array.isArray(question.options) ? question.options : [];
      const optionIds = Array.isArray(question.optionIds)
        ? question.optionIds
        : [];
      const pairs = rows(question.matchingPairs);
      return [
        region(questionId, "question", `Question ${index + 1}`, [
          "questions",
          index,
        ]),
        region(
          `${questionId}:prompt`,
          "quiz_prompt",
          `Question ${index + 1} prompt`,
          ["questions", index, "prompt"],
          questionId,
          typeof question.prompt === "string" ? question.prompt : undefined,
        ),
        ...options.map((option, optionIndex) =>
          region(
            stringValue(
              optionIds[optionIndex],
              `${questionId}:option:${optionIndex}`,
            ),
            "answer_option",
            `Question ${index + 1} option ${optionIndex + 1}`,
            ["questions", index, "options", optionIndex],
            questionId,
            typeof option === "string" ? option : undefined,
          ),
        ),
        region(
          `${questionId}:answer`,
          "correct_answer",
          `Question ${index + 1} answer`,
          ["questions", index, "correctAnswer"],
          questionId,
        ),
        region(
          `${questionId}:answers`,
          "correct_answer_set",
          `Question ${index + 1} correct answers`,
          ["questions", index, "correctAnswers"],
          questionId,
        ),
        ...pairs.map((pair, pairIndex) =>
          region(
            `${questionId}:pair:${stringValue(pair.id, String(pairIndex))}`,
            "matching_pair",
            `Question ${index + 1} pair ${pairIndex + 1}`,
            ["questions", index, "matchingPairs", pairIndex],
            questionId,
          ),
        ),
        ...[
          ["rubric", "formative_rubric"],
          ["explanation", "answer_explanation"],
          ["feedback", "formative_feedback"],
          ["media", "question_media"],
          ["difficulty", "question_difficulty"],
          ["timeLimitSeconds", "question_timing"],
          ["poolId", "question_pool"],
          ["section", "question_section"],
          ["standards", "question_standards"],
          ["sourceRefs", "question_sources"],
        ].map(([field, semanticType]) =>
          region(
            `${questionId}:${field}`,
            semanticType,
            `Question ${index + 1} ${field}`,
            ["questions", index, field],
            questionId,
          ),
        ),
      ];
    });
    const settings = record(value.settings);
    return [
      ...questionRegions,
      ...Object.keys(settings).map((field) =>
        region(
          `quiz-setting:${field}`,
          "quiz_setting",
          field.replaceAll(/([A-Z])/g, " $1").trim(),
          ["settings", field],
        ),
      ),
      region("quiz:published", "quiz_publish_state", "Practice publish state", [
        "published",
      ]),
    ];
  },
  planner_task: (content) => {
    const value = record(content);
    const scalarFields = [
      "taskTitle",
      "description",
      "status",
      "priority",
      "dueAt",
      "startAt",
      "endAt",
      "allDay",
      "estimateMinutes",
      "progressNote",
      "timezone",
      "recurrence",
      "linkedArtifactIds",
      "linkedThreadIds",
      "sourceRefs",
      "personalOverlay",
    ];
    return [
      ...scalarFields.map((field) =>
        region(`task:${field}`, "task_field", field.replaceAll("At", " time"), [
          field,
        ]),
      ),
      ...rows(value.subtasks).flatMap((subtask, index) => {
        const subtaskId = stringValue(subtask.id, `subtask-${index + 1}`);
        return [
          region(
            `task:subtask:${subtaskId}:title`,
            "task_subtask_field",
            `Subtask ${index + 1} title`,
            ["subtasks", index, "title"],
          ),
          region(
            `task:subtask:${subtaskId}:done`,
            "task_subtask_field",
            `Subtask ${index + 1} completion`,
            ["subtasks", index, "done"],
          ),
        ];
      }),
      ...rows(value.reminders).map((reminder, index) =>
        region(
          `task:reminder:${stringValue(reminder.id, `reminder-${index + 1}`)}`,
          "task_reminder",
          `Reminder ${index + 1}`,
          ["reminders", index],
        ),
      ),
      ...rows(value.assignees).map((person, index) =>
        region(
          `task:assignee:${stringValue(person.accountId, `assignee-${index + 1}`)}`,
          "task_person",
          `Assignee ${stringValue(person.name, String(index + 1))}`,
          ["assignees", index],
        ),
      ),
      ...rows(value.watchers).map((person, index) =>
        region(
          `task:watcher:${stringValue(person.accountId, `watcher-${index + 1}`)}`,
          "task_person",
          `Watcher ${stringValue(person.name, String(index + 1))}`,
          ["watchers", index],
        ),
      ),
      region("task:source", "task_source", "Source authority", ["source"]),
    ];
  },
  agent: (content) => {
    const value = record(content);
    return [
      region("agent:profile", "agent_profile", "Profile and purpose", [
        "profile",
      ]),
      region(
        "agent:audience",
        "agent_audience",
        "Audience intent",
        ["profile", "audienceIntent"],
        "agent:profile",
      ),
      region(
        "agent:scope",
        "agent_scope",
        "Scope and exclusions",
        ["profile"],
        "agent:profile",
      ),
      region(
        "agent-instructions",
        "agent_instructions",
        "Instructions",
        ["instructions", "text"],
        undefined,
        typeof record(value.instructions).text === "string"
          ? (record(value.instructions).text as string)
          : undefined,
      ),
      ...rows(value.skills).map((skill, index) =>
        region(
          stringValue(skill.id, `skill-${index + 1}`),
          "agent_skill",
          stringValue(skill.name, `Skill ${index + 1}`),
          ["skills", index],
        ),
      ),
      ...rows(value.tools).map((tool, index) =>
        region(
          stringValue(tool.id, `tool-${index + 1}`),
          "agent_tool",
          `Tool ${stringValue(tool.key, String(index + 1))}`,
          ["tools", index],
        ),
      ),
      ...rows(value.resources).map((resource, index) =>
        region(
          stringValue(resource.id, `resource-${index + 1}`),
          "resource_binding",
          stringValue(resource.label, `Resource ${index + 1}`),
          ["resources", index],
        ),
      ),
      region("agent:routing", "agent_routing", "Automatic routing", [
        "routing",
      ]),
      ...(Array.isArray(record(value.routing).examples)
        ? (record(value.routing).examples as unknown[]).map((_example, index) =>
            region(
              `agent:routing:positive:${index + 1}`,
              "agent_routing_example",
              `Positive routing example ${index + 1}`,
              ["routing", "examples", index],
              "agent:routing",
            ),
          )
        : []),
      ...(Array.isArray(record(value.routing).negativeExamples)
        ? (record(value.routing).negativeExamples as unknown[]).map(
            (_example, index) =>
              region(
                `agent:routing:negative:${index + 1}`,
                "agent_routing_example",
                `Negative routing example ${index + 1}`,
                ["routing", "negativeExamples", index],
                "agent:routing",
              ),
          )
        : []),
      region("agent:behavior", "agent_behavior", "Tone and behavior", [
        "behavior",
      ]),
      region("agent:model-policy", "agent_model_policy", "Model policy", [
        "modelPolicy",
      ]),
      ...rows(value.evals).map((evaluation, index) =>
        region(
          stringValue(evaluation.id, `eval-${index + 1}`),
          "agent_evaluation",
          `Evaluation ${index + 1}: ${stringValue(evaluation.category, "quality")}`,
          ["evals", index],
        ),
      ),
      region("agent:release", "agent_release_notes", "Release notes", [
        "releaseNotes",
      ]),
    ];
  },
  timetable: (content) => [
    ...rows(record(content).layers).map((layer, index) =>
      region(
        `calendar:layer:${stringValue(layer.id, `layer-${index + 1}`)}`,
        "calendar_layer",
        stringValue(layer.name, `Layer ${index + 1}`),
        ["layers", index],
      ),
    ),
    ...rows(record(content).events).map((event, index) =>
      region(
        stringValue(event.id, `event-${index + 1}`),
        "calendar_event",
        stringValue(event.title, `Event ${index + 1}`),
        ["events", index],
      ),
    ),
  ],
  presentation: (content) =>
    rows(record(content).slides)
      .flatMap((slide, slideIndex) => {
        const slideId = stringValue(slide.id, `slide-${slideIndex + 1}`);
        return [
          region(
            slideId,
            "slide",
            stringValue(slide.title, `Slide ${slideIndex + 1}`),
            ["slides", slideIndex],
          ),
          ...rows(slide.objects).map((object, objectIndex) =>
            region(
              stringValue(object.id, `${slideId}:object-${objectIndex + 1}`),
              "slide_object",
              `Slide ${slideIndex + 1} object ${objectIndex + 1}`,
              ["slides", slideIndex, "objects", objectIndex],
              slideId,
            ),
          ),
          region(
            `${slideId}:notes`,
            "slide_notes",
            `Slide ${slideIndex + 1} speaker notes`,
            ["slides", slideIndex, "speakerNotes"],
            slideId,
          ),
          region(
            `${slideId}:accessibility`,
            "slide_accessibility",
            `Slide ${slideIndex + 1} accessibility`,
            ["slides", slideIndex, "accessibility"],
            slideId,
          ),
          region(
            `${slideId}:citations`,
            "slide_citations",
            `Slide ${slideIndex + 1} citations`,
            ["slides", slideIndex, "citations"],
            slideId,
          ),
        ];
      })
      .concat([
        region(
          "presentation:theme",
          "presentation_theme",
          "Presentation theme",
          ["theme"],
        ),
        region(
          "presentation:settings",
          "presentation_settings",
          "Presentation settings",
          ["settings"],
        ),
        region(
          "presentation:sections",
          "presentation_sections",
          "Presentation sections",
          ["sections"],
        ),
        region(
          "presentation:components",
          "presentation_components",
          "Reusable components",
          ["components"],
        ),
      ]),
  sheets: (content) => {
    const root = record(content);
    const workbook = record(root.workbook);
    const workbookRegions = [
      region("workbook", "workbook", "Workbook", ["workbook"]),
      ...Object.keys(workbook)
        .sort()
        .map((key) =>
          region(
            `workbook:setting:${key}`,
            "workbook_setting",
            `Workbook ${key}`,
            ["workbook", key],
            "workbook",
          ),
        ),
      ...Object.keys(record(workbook.namedRanges))
        .sort()
        .map((name) =>
          region(
            `workbook:named-range:${name}`,
            "sheet_named_range",
            `Named range ${name}`,
            ["workbook", "namedRanges", name],
            "workbook",
          ),
        ),
    ];
    const sheetRegions = rows(root.sheets).flatMap((sheet, sheetIndex) => {
      const sheetId = stringValue(sheet.id, `sheet-${sheetIndex + 1}`);
      const cells = record(sheet.cells);
      const rowIdentities = record(sheet.rowIdentities);
      const columnIdentities = record(sheet.columnIdentities);
      const rowCount = Math.max(
        1,
        Math.min(1_000_000, Number(sheet.rowCount) || 100),
      );
      const columnCount = Math.max(
        1,
        Math.min(16_384, Number(sheet.columnCount) || 26),
      );
      const usedRows = new Set<number>();
      const usedColumns = new Set<number>();
      Object.keys(cells).forEach((address) => {
        const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
        if (!match) return;
        usedRows.add(Number(match[2]) - 1);
        usedColumns.add(
          match[1]!
            .split("")
            .reduce(
              (total, character) => total * 26 + character.charCodeAt(0) - 64,
              0,
            ) - 1,
        );
      });
      return [
        region(
          sheetId,
          "sheet",
          stringValue(sheet.name, `Sheet ${sheetIndex + 1}`),
          ["sheets", sheetIndex],
          "workbook",
        ),
        ...[...usedRows]
          .filter((row) => row >= 0 && row < rowCount)
          .sort((left, right) => left - right)
          .map((row) => {
            const rowId = stringValue(
              rowIdentities[String(row)],
              `${sheetId}:row:${row + 1}`,
            );
            return region(
              rowId,
              "sheet_row",
              `${stringValue(sheet.name, "Sheet")} row ${row + 1}`,
              ["sheets", sheetIndex, "rowIdentities", String(row)],
              sheetId,
            );
          }),
        ...[...usedColumns]
          .filter((column) => column >= 0 && column < columnCount)
          .sort((left, right) => left - right)
          .map((column) => {
            const columnId = stringValue(
              columnIdentities[String(column)],
              `${sheetId}:column:${column + 1}`,
            );
            return region(
              columnId,
              "sheet_column",
              `${stringValue(sheet.name, "Sheet")} column ${column + 1}`,
              ["sheets", sheetIndex, "columnIdentities", String(column)],
              sheetId,
            );
          }),
        ...Object.keys(cells)
          .sort()
          .flatMap((address) => {
            const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
            const rowId = match
              ? stringValue(
                  rowIdentities[String(Number(match[2]) - 1)],
                  `${sheetId}:row:${match[2]}`,
                )
              : address;
            const columnIndex = match
              ? match[1]!
                  .split("")
                  .reduce(
                    (total, character) =>
                      total * 26 + character.charCodeAt(0) - 64,
                    0,
                  ) - 1
              : -1;
            const columnId = match
              ? stringValue(
                  columnIdentities[String(columnIndex)],
                  `${sheetId}:column:${columnIndex + 1}`,
                )
              : address;
            const cellId = `${sheetId}:${rowId}:${columnId}`;
            const cell = record(cells[address]);
            return [
              region(
                cellId,
                "sheet_cell",
                `${stringValue(sheet.name, "Sheet")} ${address}`,
                ["sheets", sheetIndex, "cells", address],
                sheetId,
                typeof cell.value === "string"
                  ? cell.value
                  : typeof cell.formula === "string"
                    ? cell.formula
                    : undefined,
              ),
              ...(typeof cell.formula === "string"
                ? [
                    region(
                      `${cellId}:formula`,
                      "sheet_formula",
                      `${stringValue(sheet.name, "Sheet")} ${address} formula`,
                      ["sheets", sheetIndex, "cells", address, "formula"],
                      cellId,
                      cell.formula,
                    ),
                  ]
                : []),
              ...(cell.validation
                ? [
                    region(
                      `${cellId}:validation`,
                      "sheet_validation",
                      `${stringValue(sheet.name, "Sheet")} ${address} validation`,
                      ["sheets", sheetIndex, "cells", address, "validation"],
                      cellId,
                    ),
                  ]
                : []),
            ];
          }),
        ...rows(sheet.tables).flatMap((table, tableIndex) => {
          const tableId = stringValue(
            table.id,
            `${sheetId}:table-${tableIndex + 1}`,
          );
          return [
            region(
              tableId,
              "sheet_table",
              stringValue(table.name, `Table ${tableIndex + 1}`),
              ["sheets", sheetIndex, "tables", tableIndex],
              sheetId,
            ),
            region(
              `${tableId}:filters`,
              "sheet_filters",
              `${stringValue(table.name, "Table")} filters`,
              ["sheets", sheetIndex, "tables", tableIndex, "filters"],
              tableId,
            ),
            region(
              `${tableId}:sort`,
              "sheet_sort",
              `${stringValue(table.name, "Table")} sort`,
              ["sheets", sheetIndex, "tables", tableIndex, "sort"],
              tableId,
            ),
          ];
        }),
        ...rows(sheet.conditionalFormats).map((rule, ruleIndex) =>
          region(
            stringValue(rule.id, `${sheetId}:conditional-${ruleIndex + 1}`),
            "sheet_conditional_format",
            `Conditional format ${ruleIndex + 1}`,
            ["sheets", sheetIndex, "conditionalFormats", ruleIndex],
            sheetId,
          ),
        ),
        ...rows(sheet.charts).map((chart, chartIndex) =>
          region(
            stringValue(chart.id, `${sheetId}:chart-${chartIndex + 1}`),
            "sheet_chart",
            stringValue(chart.title, `Chart ${chartIndex + 1}`),
            ["sheets", sheetIndex, "charts", chartIndex],
            sheetId,
          ),
        ),
      ];
    });
    return [...workbookRegions, ...sheetRegions];
  },
  code: (content) => {
    const root = record(content);
    const entryFileId = stringValue(root.entryFileId, "entry-file");
    return [
      region("code:runtime", "code_runtime", "Runtime", ["runtime"]),
      region(
        "code:entry",
        "code_entry",
        "Entry point",
        ["entryFileId"],
        entryFileId,
      ),
      ...rows(root.files).flatMap((file, index) => {
        const fileId = stringValue(file.id, `file-${index + 1}`);
        const path = stringValue(file.path, `File ${index + 1}`);
        const source = typeof file.source === "string" ? file.source : "";
        const lineIds = Array.isArray(file.lineIds) ? file.lineIds : [];
        return [
          region(fileId, "code_file", path, ["files", index]),
          ...source
            .split("\n")
            .map((line, lineIndex) =>
              region(
                stringValue(
                  lineIds[lineIndex],
                  `${fileId}:line:${lineIndex + 1}`,
                ),
                "code_line",
                `${path} line ${lineIndex + 1}`,
                ["files", index, "source", lineIndex],
                fileId,
                line,
              ),
            ),
        ];
      }),
      ...Object.keys(record(root.dependencies))
        .sort()
        .map((name) =>
          region(
            `code:dependency:${name}`,
            "code_dependency",
            `Dependency ${name}`,
            ["dependencies", name],
          ),
        ),
      ...rows(root.tests).map((test, index) =>
        region(
          stringValue(test.id, `test-${index + 1}`),
          "code_test",
          stringValue(test.name, `Test ${index + 1}`),
          ["tests", index],
          typeof test.fileId === "string" ? test.fileId : undefined,
          typeof test.source === "string" ? test.source : undefined,
        ),
      ),
      ...rows(root.parameters).map((parameter, index) =>
        region(
          stringValue(parameter.id, `parameter-${index + 1}`),
          "code_parameter",
          stringValue(parameter.label, `Control ${index + 1}`),
          ["parameters", index],
        ),
      ),
      ...rows(root.assets).map((asset, index) =>
        region(
          stringValue(asset.id, `asset-${index + 1}`),
          "code_asset",
          stringValue(asset.path, `Asset ${index + 1}`),
          ["assets", index],
        ),
      ),
      ...rows(root.resourceBindings).map((binding, index) =>
        region(
          stringValue(binding.id, `resource-${index + 1}`),
          "code_resource_binding",
          stringValue(binding.label, `Resource ${index + 1}`),
          ["resourceBindings", index],
        ),
      ),
      ...rows(root.environmentSchema).map((variable, index) =>
        region(
          `code:environment:${stringValue(variable.key, String(index + 1))}`,
          "code_environment_declaration",
          stringValue(variable.key, `Environment ${index + 1}`),
          ["environmentSchema", index],
        ),
      ),
      region(
        "code:visualisation",
        "code_visualisation",
        "Visualisation settings",
        ["visualisation"],
      ),
      region("code:preview", "code_preview", "Preview settings", ["preview"]),
      region("code:network", "code_network_policy", "Network policy", [
        "networkPolicy",
      ]),
      region("code:accessibility", "code_accessibility", "Accessibility", [
        "accessibility",
      ]),
    ];
  },
  whiteboard: (content) => [
    ...rows(record(content).pages).map((page, index) =>
      region(
        `whiteboard:page:${stringValue(page.id, `page-${index + 1}`)}`,
        "canvas_page",
        stringValue(page.name, `Page ${index + 1}`),
        ["pages", index],
      ),
    ),
    ...rows(record(content).layers).map((layer, index) =>
      region(
        `whiteboard:layer:${stringValue(layer.id, `layer-${index + 1}`)}`,
        "canvas_layer",
        stringValue(layer.name, `Layer ${index + 1}`),
        ["layers", index],
        typeof layer.pageId === "string" ? layer.pageId : undefined,
      ),
    ),
    ...rows(record(content).nodes).map((node, index) =>
      region(
        stringValue(node.id, `node-${index + 1}`),
        "canvas_node",
        `Canvas node ${index + 1}`,
        ["nodes", index],
        typeof node.layerId === "string" ? node.layerId : undefined,
      ),
    ),
    ...rows(record(content).edges).map((edge, index) =>
      region(
        stringValue(edge.id, `edge-${index + 1}`),
        "canvas_edge",
        `Connector ${index + 1}`,
        ["edges", index],
      ),
    ),
    ...rows(record(content).sources).map((source, index) =>
      region(
        `whiteboard:source:${stringValue(source.id, `source-${index + 1}`)}`,
        "canvas_source",
        stringValue(source.label, `Source ${index + 1}`),
        ["sources", index],
      ),
    ),
    region("whiteboard:settings", "canvas_settings", "Board settings", [
      "settings",
    ]),
  ],
};

const identity = {
  document: [
    "Document",
    "Structured writing, notes, and authored resources.",
    "writing",
    "FileText",
  ],
  flashcard_deck: [
    "Flashcard deck",
    "Active-recall cards and spaced practice.",
    "practice",
    "GalleryVerticalEnd",
  ],
  quiz: [
    "Quiz",
    "Practice and formative question experiences.",
    "practice",
    "ListChecks",
  ],
  planner_task: [
    "Planner task",
    "Actionable work connected to time and resources.",
    "planning",
    "ListTodo",
  ],
  agent: [
    "Agent",
    "Reusable instructions, skills, tools, and permissioned knowledge.",
    "intelligence",
    "Sparkles",
  ],
  timetable: [
    "Timetable",
    "Layered school, class, task, and personal time.",
    "planning",
    "CalendarDays",
  ],
  presentation: [
    "Presentation",
    "Spectra-native visual storytelling and presenting.",
    "creative",
    "Presentation",
  ],
  sheets: [
    "Sheets",
    "Workbooks, formulas, structured analysis, and charts.",
    "data",
    "Table2",
  ],
  code: [
    "Code",
    "Source code and approachable interactive visualisations.",
    "technical",
    "Code2",
  ],
  whiteboard: [
    "Whiteboard",
    "A collaborative spatial canvas for thinking together.",
    "creative",
    "Workflow",
  ],
} as const;

const imports: Record<ArtifactTypeKey, readonly string[]> = {
  document: ["docx", "odt", "rtf", "markdown", "html", "txt", "pdf"],
  flashcard_deck: [
    "csv",
    "tsv",
    "apkg",
    "quizlet-text",
    "spectra-deck-package",
  ],
  quiz: ["qti-2.x", "moodle-xml", "csv", "tsv", "spectra-json"],
  planner_task: ["ics", "csv", "todoist-csv"],
  agent: ["spectra-agent-json", "markdown-instructions"],
  timetable: ["ics", "csv"],
  presentation: ["pptx", "odp", "pdf", "keynote-export"],
  sheets: ["xlsx", "xls", "ods", "csv", "tsv"],
  code: ["zip", "github-archive", "html", "ipynb", "py"],
  whiteboard: ["svg", "pdf", "png", "excalidraw", "drawio"],
};

const exports: Record<ArtifactTypeKey, readonly string[]> = {
  document: ["docx", "pdf", "markdown", "html"],
  flashcard_deck: ["csv", "tsv", "pdf", "spectra-deck-package"],
  quiz: ["qti-2.2", "pdf", "csv", "spectra-json"],
  planner_task: ["ics", "csv", "pdf"],
  agent: ["spectra-agent-json", "markdown"],
  timetable: ["ics", "csv", "pdf"],
  presentation: ["pdf", "pptx", "png"],
  sheets: ["xlsx", "ods", "csv", "pdf"],
  code: ["zip", "html"],
  whiteboard: ["svg", "pdf", "png"],
};

const operations: Record<ArtifactTypeKey, readonly string[]> = {
  document: [
    "inspect_outline",
    "inspect_blocks",
    "inspect_selection",
    "insert_blocks",
    "rewrite_blocks",
    "move_blocks",
    "split_block",
    "merge_blocks",
    "format_blocks",
    "create_table",
    "edit_table_cell",
    "insert_equation",
    "insert_callout",
    "add_citation",
    "add_embed",
    "summarize",
    "apply_template",
    "check_accessibility",
    "check_sources",
    "check_layout",
    "prepare_export",
    "validate",
  ],
  flashcard_deck: [
    "inspect_cards",
    "add_cards",
    "rewrite_side",
    "create_cloze",
    "set_image_occlusion",
    "set_bidirectional",
    "reorder_cards",
    "set_study_metadata",
    "validate",
  ],
  quiz: [
    "inspect_questions",
    "add_questions",
    "rewrite_field",
    "add_option",
    "mark_correct",
    "configure_matching",
    "configure_pool",
    "write_explanation",
    "write_formative_rubric",
    "check_ambiguity",
    "check_accessibility",
    "check_source_coverage",
    "reorder_questions",
    "publish_practice",
    "validate_formative",
  ],
  planner_task: [
    "inspect_task",
    "create_task",
    "triage",
    "update_field",
    "decompose",
    "estimate",
    "add_subtask",
    "update_subtask",
    "set_reminder",
    "set_recurrence",
    "assign",
    "link_artifact",
    "schedule",
    "reconcile_source",
    "detach_source",
    "validate",
  ],
  agent: [
    "inspect_configuration",
    "inspect_release",
    "inspect_resource_health",
    "inspect_eval_results",
    "update_profile",
    "rewrite_instructions",
    "bind_skill",
    "bind_tool",
    "bind_resource",
    "configure_behavior",
    "configure_routing",
    "add_routing_example",
    "add_evaluation",
    "run_evaluations",
    "check_privacy",
    "check_resource_leakage",
    "compare_release",
    "propose_improvement",
    "evaluate",
    "propose_version",
    "prepare_release",
    "publish_release",
  ],
  timetable: [
    "inspect_range",
    "inspect_constraints",
    "add_event",
    "move_event",
    "resize_event",
    "update_event",
    "set_recurrence",
    "manage_layer",
    "propose_study_blocks",
    "replan",
    "link_materials",
    "reconcile_source",
    "resolve_overlap",
    "explain_tradeoffs",
    "validate",
  ],
  presentation: [
    "inspect_deck",
    "plan_narrative",
    "create_outline",
    "add_slide",
    "apply_master",
    "rewrite_object",
    "create_object",
    "move_object",
    "resize_object",
    "apply_layout",
    "apply_theme",
    "write_speaker_notes",
    "generate_chart",
    "check_overflow",
    "check_contrast",
    "check_reading_order",
    "check_source_coverage",
    "prepare_presenter_output",
  ],
  sheets: [
    "inspect_workbook",
    "inspect_range",
    "inspect_dependencies",
    "create_sheet",
    "rename_sheet",
    "set_cells",
    "set_formula",
    "fill_range",
    "clear_range",
    "format_range",
    "validate_range",
    "create_named_range",
    "insert_structure",
    "create_table",
    "sort_filter",
    "create_chart",
    "edit_chart",
    "analyze",
    "explain_formula",
    "import_data",
    "link_output",
    "validate",
  ],
  code: [
    "inspect_tree",
    "read_file",
    "inspect_symbol",
    "inspect_runtime",
    "inspect_preview",
    "plan_files",
    "patch_lines",
    "create_file",
    "rename_file",
    "delete_file",
    "declare_dependency",
    "bind_resource",
    "run",
    "build",
    "run_tests",
    "debug",
    "verify_output",
    "format_visualisation",
    "check_accessibility",
    "configure_parameters",
    "prepare_publish",
  ],
  whiteboard: [
    "inspect_viewport",
    "inspect_frame",
    "summarize_topology",
    "create_node",
    "rewrite_node",
    "move_nodes",
    "connect_nodes",
    "group",
    "align",
    "distribute",
    "cluster",
    "label",
    "convert_text_to_diagram",
    "organize",
    "propose_layout",
    "check_accessibility",
    "validate",
  ],
};

function loadSkill(typeKey: ArtifactTypeKey): Promise<ArtifactSkill> {
  switch (typeKey) {
    case "document":
      return import("./skills/document").then((module) => module.documentSkill);
    case "flashcard_deck":
      return import("./skills/flashcard-deck").then(
        (module) => module.flashcardDeckSkill,
      );
    case "quiz":
      return import("./skills/quiz").then((module) => module.quizSkill);
    case "planner_task":
      return import("./skills/planner-task").then(
        (module) => module.plannerTaskSkill,
      );
    case "agent":
      return import("./skills/agent").then((module) => module.agentSkill);
    case "timetable":
      return import("./skills/timetable").then(
        (module) => module.timetableSkill,
      );
    case "presentation":
      return import("./skills/presentation").then(
        (module) => module.presentationSkill,
      );
    case "sheets":
      return import("./skills/sheets").then((module) => module.sheetsSkill);
    case "code":
      return import("./skills/code").then((module) => module.codeSkill);
    case "whiteboard":
      return import("./skills/whiteboard").then(
        (module) => module.whiteboardSkill,
      );
  }
}

function manifest(typeKey: ArtifactTypeKey): ArtifactTypeManifest {
  const [displayName, description, category, icon] = identity[typeKey];
  const collaborativePartition =
    typeKey === "sheets"
      ? "sheet"
      : typeKey === "presentation"
        ? "slide"
        : typeKey === "code"
          ? "file"
          : typeKey === "whiteboard"
            ? "viewport"
            : "artifact";
  const large =
    typeKey === "sheets" ||
    typeKey === "presentation" ||
    typeKey === "code" ||
    typeKey === "whiteboard";
  return {
    identity: {
      typeKey,
      displayName,
      description,
      category,
      icon,
      minimumAppVersion: 1,
    },
    schemas: {
      currentVersion:
        typeKey === "document"
          ? 2
          : typeKey === "flashcard_deck" ||
              typeKey === "quiz" ||
              typeKey === "planner_task"
            ? 3
            : 1,
      content: artifactContentSchemas[typeKey],
    },
    renderers: {
      full: `${typeKey}:full`,
      panel: `${typeKey}:panel`,
      compact: `${typeKey}:compact`,
      embedCompact: `${typeKey}:embed-compact`,
      embedExpanded: `${typeKey}:embed-expanded`,
      historical: `${typeKey}:historical`,
      print:
        typeKey === "agent" || typeKey === "code" ? null : `${typeKey}:print`,
    },
    editor: {
      routeSegment: typeKey.replaceAll("_", "-"),
      sync: "yjs",
      validity: "continuous",
      minimumPanelWidth: 320,
    },
    operations: operations[typeKey],
    regions: regionAdapters[typeKey],
    loadSkill: () => loadSkill(typeKey),
    collaboration: {
      roomPartition: collaborativePartition,
      commentAnchors:
        typeKey === "sheets"
          ? ["cell", "range", "chart"]
          : typeKey === "whiteboard"
            ? ["node", "edge", "frame"]
            : ["region", "selection"],
      awareness: ["activeRegion", "selection", "viewport", "cursor"],
    },
    history: {
      snapshot: large
        ? "content-addressed"
        : typeKey === "planner_task" || typeKey === "agent"
          ? "normalized"
          : "yjs-snapshot",
      partialRestore: true,
    },
    capabilities: {
      canPresent: typeKey === "presentation" || typeKey === "whiteboard",
      canExecute: typeKey === "code",
      canAssessFormatively: typeKey === "quiz" || typeKey === "flashcard_deck",
      canEmbedInteractively: [
        "flashcard_deck",
        "quiz",
        "presentation",
        "sheets",
        "code",
        "whiteboard",
        "timetable",
      ].includes(typeKey),
    },
    interoperability: {
      imports: imports[typeKey],
      exports: exports[typeKey],
      quarantinesExecutableContent:
        typeKey === "code" ||
        typeKey === "sheets" ||
        typeKey === "presentation",
    },
    quality: {
      virtualizeAfter:
        typeKey === "sheets"
          ? 500
          : typeKey === "whiteboard"
            ? 300
            : typeKey === "presentation"
              ? 80
              : 200,
      primaryAccessibilityModel:
        typeKey === "sheets"
          ? "ARIA grid with range narration"
          : typeKey === "whiteboard"
            ? "spatial outline and keyboard node traversal"
            : "semantic regions and ordered navigation",
    },
  };
}

export const ARTIFACT_TYPE_MANIFESTS = ARTIFACT_TYPE_KEYS.map(manifest);
const manifestsByKey = new Map(
  ARTIFACT_TYPE_MANIFESTS.map((entry) => [entry.identity.typeKey, entry]),
);

export function isArtifactTypeKey(value: string): value is ArtifactTypeKey {
  return (ARTIFACT_TYPE_KEYS as readonly string[]).includes(value);
}

export function getArtifactTypeManifest(typeKey: string) {
  return isArtifactTypeKey(typeKey) ? manifestsByKey.get(typeKey) : undefined;
}

export function requireArtifactTypeManifest(typeKey: string) {
  const result = getArtifactTypeManifest(typeKey);
  if (!result)
    throw new Error(
      `ARTIFACT_TYPE_UNKNOWN: ${typeKey} is quarantined until a compatible type manifest is installed.`,
    );
  return result;
}

export function validateArtifactContent(typeKey: string, content: unknown) {
  const manifest = requireArtifactTypeManifest(typeKey);
  return manifest.schemas.content.safeParse(content);
}

export function enumerateArtifactRegions(typeKey: string, content: unknown) {
  const manifest = requireArtifactTypeManifest(typeKey);
  const parsed = manifest.schemas.content.parse(content);
  const regions = manifest.regions(parsed);
  const ids = new Set<string>();
  for (const candidate of regions) {
    if (ids.has(candidate.regionId))
      throw new Error(`ARTIFACT_REGION_DUPLICATE: ${candidate.regionId}`);
    ids.add(candidate.regionId);
  }
  return regions;
}

export async function loadArtifactSkill(typeKey: string) {
  return requireArtifactTypeManifest(typeKey).loadSkill();
}

export const artifactTypeKeySchema = z.enum(ARTIFACT_TYPE_KEYS);
