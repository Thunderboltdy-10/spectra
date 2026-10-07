import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const convexDir = resolve(__dirname);

/** Every local module the schema loads, following relative imports. */
function schemaModules() {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm)) {
      const base = join(dirname(file), match[1]!);
      const next = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find((candidate) => existsSync(candidate) && candidate.match(/\.tsx?$/));
      if (next) visit(next);
    }
  };
  visit(join(convexDir, "schema.ts"));
  return [...seen];
}

describe("the schema", () => {
  // Convex evaluates the schema where environment variables are unsupported: one read at load fails every push.
  it("never loads a module that reads the environment", () => {
    const readers = schemaModules().filter((file) => /process\.env/.test(readFileSync(file, "utf8")));
    expect(readers).toEqual([]);
  });
});
