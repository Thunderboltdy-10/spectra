import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The route splits "CODE: sentence" into a code and the sentence a student
 * reads. A bare code has no sentence, so the toast printed the code itself
 * ("CALENDAR_PLAN_NOT_FOUND" after dropping a deleted plan on a day).
 */
describe("Calendar failures a student can read", () => {
  it.each([
    "convex/calendar.ts",
    "src/features/spectra/calendar/domain/command.ts",
  ])("every Calendar code thrown in %s carries a plain sentence", (file) => {
    const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
    const bare = [...source.matchAll(/new Error\(\s*"(CALENDAR_[A-Z_]+)"\s*\)/g)].map(
      (match) => match[1],
    );
    expect(bare).toEqual([]);
  });
});
