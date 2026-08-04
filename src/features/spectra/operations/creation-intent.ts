import type { WorkTypeKey } from "../artifacts/types";

export type SpectraCreationIntent = {
  blueprintKey: WorkTypeKey;
  label: string;
};

/**
 * Real-user shorthand often skips explicit create verbs ("quiz me on X",
 * "whiteboard map of …", "code a tiny …"). Match those before falling back to
 * verb+object parsing so single-creation stays on the forced create_* path.
 */
export function matchSpectraCreationShorthand(
  prompt: string,
): SpectraCreationIntent | null {
  const requestShape = prompt
    .trim()
    .replace(
      /\b(?:do not|don't|dont|without)\s+(?:change|edit|update|modify|rewrite|replace)[^.?!]*(?:[.?!]|$)/gi,
      " ",
    );
  const shorthand: Array<{
    pattern: RegExp;
    blueprintKey: WorkTypeKey;
    label: string;
  }> = [
    {
      pattern:
        /\b(?:quiz|test)\s+me\b|\b(?:a|one)?\s*quick\s+quiz\b|\bgive\s+me\s+(?:a|one)\s+quiz\b/i,
      blueprintKey: "quiz",
      label: "Quiz",
    },
    {
      pattern:
        /\b(?:flashcards?|deck)\s+(?:on|for|about)\b|\b(?:make|need)\s+(?:some\s+)?flashcards?\b/i,
      blueprintKey: "flashcard_deck",
      label: "Flashcard deck",
    },
    {
      pattern:
        /\b(?:notes?|summary|one-?pager)\s+(?:on|for|about)\b|\bwrite\s+(?:me\s+)?(?:some\s+)?notes?\b/i,
      blueprintKey: "document",
      label: "Document",
    },
    {
      pattern:
        /\bwhiteboard\s+(?:map|of|for|about|on)\b|\bmind\s*map\b|\bcanvas\s+(?:of|for|about|on|map)\b/i,
      blueprintKey: "whiteboard",
      label: "Whiteboard",
    },
    {
      pattern:
        /\bcode\s+(?:a|an|me|the|this|tiny|small|simple|quick)\b|\b(?:tiny|small|simple|quick)\s+(?:code|sketch|diagram)\b/i,
      blueprintKey: "code",
      label: "Code",
    },
    {
      pattern:
        /\b(?:spreadsheet|workbook)\b|\bsheets?\s+(?:of|for|about|on|with|comparing|showing|listing)\b|\b(?:a|an|one|small|tiny|quick|simple)\s+sheets?\b|\bsheet\s+(?:comparing|showing|listing)\b/i,
      blueprintKey: "sheets",
      label: "Sheets",
    },
    {
      pattern:
        /\bpresentation\b|\bslide\s*deck\b|\bslides?\s+(?:on|for|about|introducing)\b/i,
      blueprintKey: "presentation",
      label: "Presentation",
    },
    {
      pattern:
        /\b(?:draft|make|create|build)\s+(?:a|an|me\s+a|an?)?\s*(?:subject\s+)?(?:tutor\s+)?agent\b|\bagent\s+(?:for|that|to)\b|\btutor\s+agent\b/i,
      blueprintKey: "agent",
      label: "Agent",
    },
  ];
  for (const candidate of shorthand) {
    if (
      candidate.pattern.test(requestShape) &&
      !/\b(?:and|plus|alongside)\b[\s\S]{0,48}\b(?:quiz|deck|flashcards?|notes?|document|task|whiteboard|canvas|mind\s*map|presentation|slides?|sheet|spreadsheet|code)\b/i.test(
        requestShape,
      ) &&
      !/\b(?:edit|update|revise|rewrite|rename|improve|change|set|fix|correct|replace)\b/i.test(
        requestShape,
      ) &&
      // "add a validation column…" / "rewrite section 2" are edits of an open
      // object, never shorthand for creating a different blueprint family.
      !/\b(?:add|append|insert|remove|delete|flag)\b[\s\S]{0,80}\b(?:column|cell|row|sheet|section|paragraph|heading|block|question|card|hint|subtask|slide|validation)\b/i.test(
        requestShape,
      )
    ) {
      return {
        blueprintKey: candidate.blueprintKey,
        label: candidate.label,
      };
    }
  }
  return null;
}
