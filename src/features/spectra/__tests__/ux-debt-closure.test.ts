import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactIdFromSpectraPath,
  spectraShellHref,
  workspaceIdFromSpectraPath,
} from "../pages/shell-location";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("P6.I1 UX debt closure", () => {
  it("builds reload-stable shell URLs for work and workspace navigation", () => {
    expect(spectraShellHref({ surface: "library" })).toBe("/library");
    expect(
      spectraShellHref({
        surface: "workspace",
        workspaceId: "course work",
        artifactId: "draft/one",
      }),
    ).toBe("/workspace/course%20work?artifactId=draft%2Fone");
    expect(spectraShellHref({ surface: "library", artifactId: "work-1" })).toBe(
      "/library?artifactId=work-1",
    );
  });

  it("reads direct links defensively and ignores malformed path encoding", () => {
    expect(workspaceIdFromSpectraPath("/workspace/physics%202")).toBe(
      "physics 2",
    );
    expect(artifactIdFromSpectraPath("/library/essay%2Ffinal")).toBe(
      "essay/final",
    );
    expect(artifactIdFromSpectraPath("/library/%E0%A4%A")).toBeUndefined();
  });

  it("uses browser history for user navigation and strips closed or invalid work", () => {
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(shell).toContain('historyMode: "push" | "replace" | "none"');
    expect(shell).toContain("window.history[`${mode}State`]");
    expect(shell).toContain("previousRequestedArtifactIdRef.current");
    expect(shell).toContain("function closeActiveStudio()");
    expect(shell).toContain("replaceWorkspaceLocation(selectedWorkspaceId)");
    expect(shell).toContain('openArtifactPanel(artifact, "replace")');
  });

  it("keeps narrow chrome, retries, board movement, and first-run exits reachable", () => {
    const library = read(
      "src/features/spectra/organization/library-organizer.tsx",
    );
    const board = read("src/features/spectra/organization/work-board.tsx");
    const dock = read("src/features/spectra/components/live-dock.tsx");
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(library).toContain("flex-wrap items-center");
    expect(library).toContain('label: "Retry"');
    expect(library).toContain("Delete forever");
    expect(library).toContain("Empty Trash");
    expect(library).toContain("TrashPurgeDialog");
    expect(board).toContain("aria-label={`Move ${node.name}`}");
    expect(board).toContain("data-drop-node");
    expect(dock).toContain("outsideCurrentWorkspace");
    expect(dock).toContain("Running in ${workspaceLabel}");
    expect(shell).toContain("<SheetContent");
    expect(shell).toContain("<OverviewLoadFailure");
    expect(shell).toContain("<ProductErrorState");
    expect(shell).not.toContain("Unexpected server error");
  });

  it("maps load failures through ProductErrorState without server jargon", () => {
    const school = read("src/features/spectra/pages/school-data-shell.tsx");
    const calendar = read(
      "src/features/spectra/calendar/ui/calendar-application.tsx",
    );
    const routes = read("src/lib/route-handler.ts");
    expect(school).toContain("<ProductErrorState");
    expect(school).toContain("describeFailure");
    expect(school).toContain("School records could not be read just now.");
    expect(school).not.toContain("Unexpected server error");
    expect(calendar).toContain("<ProductErrorState");
    expect(calendar).toContain("describeFailure");
    expect(calendar).toContain("Plans could not be read just now.");
    expect(calendar).not.toContain("Unexpected server error");
    expect(routes).toContain("PUBLIC_SERVER_FAILURE");
    expect(routes).toContain(
      "Spectra could not finish this request. Check your connection, then try again.",
    );
  });

  it("advertises only registered shortcuts and keeps navigation client-side", () => {
    const shortcuts = read("src/components/keyboard-shortcuts.tsx");
    const appShell = read("src/components/layout/app-shell.tsx");
    expect(shortcuts).toContain("export const SHORTCUTS");
    expect(shortcuts).toContain("<Dialog open={open}");
    expect(shortcuts).not.toContain("Toggle orchestration panel");
    expect(shortcuts).not.toContain("Export as markdown");
    expect(appShell).not.toContain("window.location.assign");
    expect(appShell).not.toContain("window.location.href");
    expect(appShell).toContain("<SignedInContinue");
    expect(appShell).toContain('data-sidebar-recents=""');
    expect(appShell).toContain("prefetch={false}");
    expect(appShell).toContain("window.addEventListener(\"focus\", refresh)");
    expect(appShell).toContain("void refreshWorkspaces(true)");
    expect(appShell).not.toContain(
      "const refresh = () => void refreshWorkspaces(true)",
    );
  });
});
