import { describe, expect, it } from "vitest";

describe("ghost regeneration constants", () => {
  it("uses the cheap background lane model for generated ghosts", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../ghosts.ts", import.meta.url), "utf8"),
    );

    expect(source).toContain('const GHOST_GENERATION_MODEL = "openai/gpt-5.4-nano"');
    expect(source).toContain('const GHOST_MODEL_LANE = "cheap_background"');
  });

  it("schedules recurring ghost regeneration in crons", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../crons.ts", import.meta.url), "utf8"),
    );

    expect(source).toContain('"regenerate-workspace-ghosts"');
    expect(source).toContain("internal.ghosts.runScheduledRegenerationSweep");
  });
});
