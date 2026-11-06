import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const checkedRoots = [
  join(root, "src/features/spectra"),
  join(root, "src/app/(app)/workspace/page.tsx"),
  join(root, "src/app/artifacts/page.tsx"),
];

const forbiddenImportFragments = [
  "components/workspace-v2",
  "components/workspace/",
  "artifact-ai-surface",
  "api/workspace-data",
  "lib/orchestrator",
  "lib/routing",
];

function filesUnder(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const next = join(path, entry);
    if (next.includes(`${join("src", "features", "spectra", "__tests__")}`)) return [];
    return filesUnder(next);
  });
}

describe("Spectra legacy import boundary", () => {
  it("keeps new Wave 0 code disconnected from legacy active paths", () => {
    const offenders = checkedRoots
      .flatMap(filesUnder)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return forbiddenImportFragments
          .filter((fragment) => text.includes(fragment))
          .map((fragment) => `${file.replace(`${root}/`, "")}: ${fragment}`);
      });

    expect(offenders).toEqual([]);
  });
});

