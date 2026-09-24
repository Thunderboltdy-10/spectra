import { z } from "zod";
import { Replace, Search } from "lucide-react";
import type { CommandBinding } from "../types";

/**
 * One find/replace vocabulary for every artifact type.
 *
 * Document scanned its TipTap doc, Sheets scanned its grid, and each had its
 * own idea of what "scope" meant. The query shape is shared here so a person
 * (and the AI) can say the same thing to any editor, and each type only decides
 * how to walk its own content.
 */
export const findReplaceQuerySchema = z.object({
  query: z.string().min(1),
  replace: z.string().optional(),
  scope: z.enum(["selection", "sheet", "document", "workbook", "deck"]).default("document"),
  matchCase: z.boolean().default(false),
  wholeCell: z.boolean().default(false),
  regex: z.boolean().default(false),
});

export type FindReplaceQuery = z.infer<typeof findReplaceQuerySchema>;

export type FindAdapter = {
  /** Opens (or closes) the type's find surface. */
  toggle: () => void;
  open?: boolean;
  /** Present when the type can replace as well as find. */
  toggleReplace?: () => void;
  replaceOpen?: boolean;
  /** Replace every current match. Same command as toggleReplace, with `true`. */
  replaceAll?: () => void | boolean;
  /** Live match count for the honest hint. */
  matchCount?: number;
  matchNoun?: string;
};

export function findBindings(adapter: FindAdapter): CommandBinding[] {
  const noun = adapter.matchNoun ?? "match";
  const bindings: CommandBinding[] = [
    {
      id: "navigate.find",
      label: "Find",
      icon: Search,
      priority: "essential",
      general: true,
      shortcut: "Mod+F",
      active: adapter.open,
      hint: adapter.matchCount === undefined
        ? "Search this artifact"
        : `${adapter.matchCount} ${adapter.matchCount === 1 ? noun : `${noun}es`}`,
      onSelect: () => adapter.toggle(),
    },
  ];
  if (adapter.toggleReplace) {
    bindings.push({
      id: "navigate.replace",
      label: "Replace",
      icon: Replace,
      priority: "secondary",
      general: false,
      requires: "edit",
      shortcut: "Mod+H",
      active: adapter.replaceOpen,
      hint: "Find and replace text",
      onSelect: (params) => {
        if (params === true) {
          return adapter.replaceAll?.() ?? false;
        }
        adapter.toggleReplace?.();
      },
    });
  }
  return bindings;
}
