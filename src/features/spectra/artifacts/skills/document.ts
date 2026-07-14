import { defineArtifactSkill } from "../types";
export const documentSkill = defineArtifactSkill({
  typeKey: "document", purpose: "Author structured long-form material whose blocks remain editable, citeable, and reusable.",
  createWhen: ["The output is primarily prose, notes, explanation, or a reusable written resource."],
  inspect: ["Read the outline first, then request only the blocks needed for the operation."], regions: ["block", "selection", "table cell", "equation", "callout"],
  operations: ["Insert, rewrite, move, format, summarize, cite, validate, and partially restore stable blocks."],
  preservationRules: ["Preserve unaffected blocks, marks, citations, anchors, embeds, and accessible structure."],
  validation: ["Check schema, heading order, broken references, table structure, and layout overflow."], approvals: ["Preview broad rewrites, destructive removal, publishing, and source-detaching changes."],
  connections: ["Documents can source quizzes and decks, embed Sheets charts, and provide permissioned agent knowledge."], workingEffects: ["Text forms or morphs in the targeted block; independent blocks may animate concurrently."],
});
