import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_WORKSPACE_VIEWS,
  normalizeWorkspaceView,
} from "../../../../shared/workspace-view";
import {
  clozeAnswer,
  clozePrompt,
  quizSettingsFromContent,
} from "../components/artifact-content-model";

const root = process.cwd();

describe("P6 structural-debt boundaries", () => {
  it("keeps abolished workspace views read-compatible but never current", () => {
    expect(CURRENT_WORKSPACE_VIEWS).toEqual(["cards", "library"]);
    expect(normalizeWorkspaceView("cards")).toBe("cards");
    expect(normalizeWorkspaceView("canvas")).toBe("library");
    expect(normalizeWorkspaceView("timeline")).toBe("library");
    expect(normalizeWorkspaceView(undefined)).toBe("library");
  });

  it("keeps extracted artifact content normalization behavior", () => {
    expect(clozePrompt("Mass is {{c1::inertia::the hint}}.")).toBe(
      "Mass is [the hint].",
    );
    expect(clozeAnswer("Mass is {{c1::inertia::the hint}}.")).toBe(
      "Mass is inertia.",
    );
    expect(
      quizSettingsFromContent({
        settings: { targetScore: 85, timed: true, timeLimitSeconds: 600 },
      }),
    ).toMatchObject({ targetScore: 85, timed: true });
  });

  it("has no semantic window-event bus or deleted Convex logger target", () => {
    const architecture = readFileSync(
      join(root, "scripts/check-spectra-architecture.mjs"),
      "utf8",
    );
    const logging = readFileSync(join(root, "src/lib/logging.ts"), "utf8");
    expect(architecture).toContain("must use spectraBus");
    expect(logging).not.toContain('convexMutation("errorEvents:log"');
  });

  it("removes unused barrels and keeps the copy gate on mounted surfaces", () => {
    for (const path of [
      "src/features/spectra/index.ts",
      "src/features/spectra/lenses/index.ts",
      "src/features/spectra/tools/index.ts",
    ])
      expect(existsSync(join(root, path)), path).toBe(false);

    const copyGate = readFileSync(
      join(root, "scripts/check-user-facing-copy.mjs"),
      "utf8",
    );
    expect(copyGate).toContain("pages/spectra-shell.tsx");
    expect(copyGate).toContain("components/artifact-studio.tsx");
    expect(copyGate).not.toContain("pages/artifacts-shell.tsx");
  });
});
