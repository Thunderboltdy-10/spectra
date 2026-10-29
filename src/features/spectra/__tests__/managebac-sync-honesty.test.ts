import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../..");

function source(relative: string) {
  return readFileSync(resolve(root, relative), "utf8");
}

describe("ManageBac sync UX honesty", () => {
  it("keeps a single Sync control and clarifies validating", () => {
    const shell = source(
      "src/features/spectra/pages/managebac-integration-shell.tsx",
    );
    expect(shell).toContain("Spectra is checking what it can read from ManageBac. Syncing starts once that is done.");
    expect(shell).toContain("integrationStatusLabel");
    expect(shell).toContain('"ManageBac connection"');
    expect(shell).toContain('"Your ManageBac data"');
    expect(shell).toContain("Syncing…");
    expect(shell).toContain("Retry sync");
    expect(shell).toContain("Resolve identity");
    expect(shell).toContain('label: "Keep mine"');
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

  it("humanizes selection-change and lease fencing stages", () => {
    const shell = source(
      "src/features/spectra/pages/managebac-integration-shell.tsx",
    );
    expect(shell).toContain('case "selection_changed"');
    expect(shell).toContain("Class choices changed");
    expect(shell).toContain('case "lease_expired"');
    expect(shell).toContain("Sync timed out");
    expect(shell).toContain('case "INTEGRATION_SELECTION_CHANGED"');
    expect(shell).toContain("Class choices changed; this sync was stopped.");
    expect(shell).toContain('case "INTEGRATION_SYNC_FENCED"');
    expect(shell).toContain("A newer sync already replaced this one.");
    expect(shell).toContain('case "INTEGRATION_WORKER_LEASE_EXPIRED"');
    expect(shell).toContain(
      "This sync timed out and was stopped. Retry if you still need school updates.",
    );
  });

  it("does not call empty selection a missing membership", () => {
    const route = source("src/app/api/spectra/managebac/route.ts");
    expect(route).toContain("selectedClassIds.size === 0");
    expect(route).toContain(
      "No classes selected yet. Choose classes to follow before class-scoped school updates can run.",
    );
    expect(route).toContain(
      "No verified class membership targets this route.",
    );
  });

  it("keeps school API-token connection copy distinct from login", () => {
    const shell = source(
      "src/features/spectra/pages/managebac-integration-shell.tsx",
    );
    const compact = shell.replace(/\s+/g, " ");
    expect(shell).toContain('autoComplete="off"');
    expect(shell).toContain('name="managebac-school-api-token"');
    expect(compact).toContain("how the school API token is sent");
    expect(compact).toContain("email already on your Spectra account");
    expect(compact).toContain("You do not need to sign in again.");
    expect(compact).toContain("This is not a separate login.");
    expect(compact).not.toContain("auth header format");
    expect(compact).not.toContain("authenticated school email");
    expect(shell).not.toContain('autoComplete="new-password"');
  });
});

  it("keeps class-shelf identity copy distinct from ManageBac login", () => {
    const picker = source(
      "src/features/spectra/components/class-shelf-picker.tsx",
    );
    const compact = picker.replace(/\s+/g, " ");
    expect(compact).toContain("email on your Spectra account");
    expect(compact).toContain("school connection");
    expect(compact).not.toContain("signed-in school email");
  });

