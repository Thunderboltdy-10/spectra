/**
 * Where a folder brought in by the Bridge lands in the Library. A folder named
 * for a class ("Physics", "Maths") goes into that class ("Physics HL",
 * "Mathematics"), whether it is the folder the person chose or one directly
 * inside it. Anything ambiguous stays where it was chosen.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** Words that name a level, year or programme rather than the subject. */
const NOISE = new Set([
  "ib", "dp", "ibdp", "myp", "hl", "sl", "hs", "y1", "y2", "year", "grade", "class", "classes", "of", "the", "and", "notes", "course",
]);

/** Short names students use for a subject, mapped to one canonical word. */
const ALIASES: Record<string, string> = {
  math: "mathematics",
  maths: "mathematics",
  mathematic: "mathematics",
  cs: "computer",
  compsci: "computer",
  econ: "economics",
  eco: "economics",
  eng: "english",
  bio: "biology",
  chem: "chemistry",
  phys: "physics",
  tok: "theory",
};

/** Words that only follow another subject word ("Computer Science"). */
const TRAILING = new Set(["science", "knowledge"]);

export function subjectWords(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !NOISE.has(word) && !/^\d+$/.test(word))
    .map((word) => ALIASES[word] ?? word);
  return new Set(words.filter((word, index) => !(TRAILING.has(word) && index > 0)));
}

/**
 * The one class a folder name refers to, or null. A class matches when every
 * subject word of the folder is in the class name (or the other way round);
 * among matches the class with the fewest extra words wins, and a tie is no
 * match at all.
 */
export function matchClass<T extends { name: string }>(folderName: string, classes: readonly T[]): T | null {
  const folder = subjectWords(folderName);
  if (folder.size === 0) return null;
  let best: T | null = null;
  let bestExtra = Infinity;
  let tied = false;
  for (const candidate of classes) {
    const words = subjectWords(candidate.name);
    if (words.size === 0) continue;
    const covers = [...folder].every((word) => words.has(word)) || [...words].every((word) => folder.has(word));
    if (!covers) continue;
    const extra = Math.abs(words.size - folder.size);
    if (extra < bestExtra) {
      best = candidate;
      bestExtra = extra;
      tied = false;
    } else if (extra === bestExtra) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** The account's class workspaces, as Library nodes. */
export async function classWorkspaceNodes(ctx: MutationCtx, accountId: Id<"accounts">): Promise<Doc<"orgNodes">[]> {
  const nodes = await ctx.db
    .query("orgNodes")
    .withIndex("by_account_kind_source", (q) => q.eq("accountId", accountId).eq("kind", "workspace"))
    .take(300);
  return nodes.filter((node) => node.deletedAt === undefined);
}

/**
 * The parent for a path inside a mount: a top-level subfolder named for a
 * class goes into that class when the chosen folder itself is not in one.
 */
export async function mountPathBase(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  rootId: Id<"orgNodes">,
  segments: readonly string[],
): Promise<Id<"orgNodes">> {
  if (segments.length === 0) return rootId;
  const root = await ctx.db.get(rootId);
  if (!root || root.workspaceContextId !== undefined) return rootId;
  const match = matchClass(segments[0], await classWorkspaceNodes(ctx, accountId));
  return match?._id ?? rootId;
}
