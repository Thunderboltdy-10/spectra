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
  it("keeps quiz editor actions above the floating composer dock", () => {
    const quiz = read("src/features/spectra/components/quiz-studio.tsx");
    const appCss = read("src/styles/spectra-app.css");
    expect(quiz).toContain(
      '<div className="spectra-editor-body spectra-composer-clearance">',
    );
    expect(appCss).toContain(".spectra-composer-clearance {");
    expect(appCss).toContain(
      "padding-bottom: calc(var(--spectra-composer-safe-area, 0px) + 16px);",
    );
  });

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
    // Route-driven opens are fenced by the shared open request and replace history.
    expect(shell).toContain('requestArtifactOpen(routeArtifactId, "replace")');
  });

  it("keeps narrow chrome, retries, board movement, and first-run exits reachable", () => {
    const library = read(
      "src/features/spectra/organization/library-organizer.tsx",
    );
    const board = read("src/features/spectra/organization/work-board.tsx");
    const dock = read("src/features/spectra/components/live-dock.tsx");
    const shell = read("src/features/spectra/pages/spectra-shell.tsx");
    expect(library).toContain("flex-wrap items-center");
    expect(library).toContain("showRetryToast(");
    expect(read("src/components/ui/retry-toast.ts")).toContain('label = "Retry"');
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

  it("offers no calendar button that does nothing when pressed", () => {
    const calendar = read(
      "src/features/spectra/calendar/ui/calendar-application.tsx",
    );
    const inert: string[] = [];
    for (const match of calendar.matchAll(/<button\b/g)) {
      let end = match.index + match[0].length;
      let depth = 0;
      for (; end < calendar.length; end += 1) {
        const char = calendar[end];
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0 && calendar[end - 1] !== "=") break;
      }
      const tag = calendar.slice(match.index, end + 1);
      const before = calendar.slice(Math.max(0, match.index - 40), match.index);
      const acts =
        tag.includes("onClick=") ||
        tag.includes('type="submit"') ||
        tag.includes("{...") ||
        /asChild>\s*$/.test(before);
      if (!acts) inert.push(tag.replace(/\s+/g, " ").slice(0, 120));
    }
    expect(inert).toEqual([]);
  });

  it("maps load failures through ProductErrorState without server jargon", () => {
    const school = read("src/features/spectra/school/school-page.tsx");
    const calendar = read(
      "src/features/spectra/calendar/ui/calendar-application.tsx",
    );
    const routes = read("src/lib/route-handler.ts");
    expect(school).toContain("<ProblemState");
    expect(school).toContain("describeFailure");
    expect(school).toContain("Try again");
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
    const rail = read("src/components/layout/rail.tsx");
    expect(shortcuts).toContain("export const SHORTCUTS");
    expect(shortcuts).toContain("<Dialog open={open}");
    expect(shortcuts).not.toContain("Toggle orchestration panel");
    expect(shortcuts).not.toContain("Export as markdown");
    expect(appShell).not.toContain("window.location.assign");
    expect(appShell).not.toContain("window.location.href");
    expect(appShell).toContain("<SignedInContinue");
    expect(rail).not.toContain("window.location");
    expect(rail).toContain('data-sidebar-recents=""');
    expect(rail).toContain("prefetch={false}");
    // Workspace discovery moved to the shared paged catalog: focus reuses a
    // warm page while a workspace change forces a fresh traversal.
    const catalog = read("src/features/spectra/data/use-catalog-pages.ts");
    expect(rail).toContain("useWorkspaceCatalog(selectedWorkspaceId)");
    expect(catalog).toContain("window.addEventListener(\"focus\", onFocus)");
    expect(catalog).toContain("const onFocus = () => { void refresh(); };");
    expect(catalog).toContain("void refresh(true)");
  });
});
