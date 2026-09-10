import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ManageBac sync UX honesty", () => {
  it("keeps a single Sync control and clarifies validating", () => {
    const shell = readFileSync(
      resolve(__dirname, "../pages/managebac-integration-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("Validating ManageBac capabilities");
    expect(shell).toContain("integrationStatusLabel");
    expect(shell).toContain('"ManageBac · Personal data"');
    expect(shell).toContain('"Your ManageBac data"');
    expect(shell).toContain("Syncing…");
    expect(shell).toContain("Retry sync");
    expect(shell).toContain("Resolve identity");
    expect(shell).toContain("Keep in Spectra");
    expect(shell).toContain("Archive in Spectra");
    expect(shell).toContain("Checking your school account");
    expect(shell).toContain("Some school data was saved. Retry to fill the gaps.");
    expect(shell).not.toContain("{run.errorSummary}");
    expect(shell).toContain("Every ${integration.syncPolicy.frequencyMinutes} minutes");
    // Header Sync now remains; Quick actions must not duplicate it.
    const quickStart = shell.indexOf('<RightCard title="Quick actions">');
    const quickEnd = shell.indexOf("</RightCard>", quickStart);
    const quick = shell.slice(quickStart, quickEnd);
    expect(quick).not.toContain("Sync now");
    expect(quick).toContain("Review conflicts");
  });
});
