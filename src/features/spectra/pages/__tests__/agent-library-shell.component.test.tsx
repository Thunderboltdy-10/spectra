// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { AgentLibraryShell } from "../agent-library-shell";

const now = Date.now();
const owner = { name: "Ana Ruiz" };
function publicAgent(agentId: string, title: string) {
  return { agentId, title, summary: `${title} summary`, tags: ["Biology"], purpose: "", audienceIntent: "", routingDescription: "", skills: ["Quiz"], owner, releaseNumber: 2, publishedAt: now - 60_000, rating: 4.5, ratingCount: 3 };
}
function agentArtifact(_id: string, title: string, ownership: "owned" | "shared" = "owned") {
  return { _id, title, summary: `${title} summary`, tags: ["Chemistry"], ownership, owner: ownership === "shared" ? owner : undefined, updatedAt: now - 120_000, blueprintKey: "agent" };
}

const seams = vi.hoisted(() => ({
  catalog: { items: [] as unknown[], key: "scope/" as string | null, status: "ready", isDone: true, error: null, unavailable: false, refresh: vi.fn(async () => {}), more: vi.fn() },
  publicAgents: vi.fn(),
  installedAgents: vi.fn(),
  addPublic: vi.fn(async () => ({})),
  setInstalled: vi.fn(async () => ({})),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/toast", () => ({ toast: seams.toast }));
vi.mock("@/components/ui/page-header", () => ({
  PageBody: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, commands }: { title: ReactNode; commands: { id: string; label: string; onSelect: () => void }[] }) => (
    <header>
      <h1>{title}</h1>
      {commands.map((command) => (
        <Button key={command.id} onClick={command.onSelect}>
          {command.label}
        </Button>
      ))}
    </header>
  ),
}));
vi.mock("../../data/use-catalog-pages", () => ({
  useAgentCatalog: () => seams.catalog,
  useWorkspaceCatalog: () => ({ items: [], status: "idle", isDone: false, refresh: vi.fn() }),
}));
vi.mock("../../data/api", () => ({
  getSpectraPublicAgents: seams.publicAgents,
  getSpectraInstalledAgents: seams.installedAgents,
  addSpectraPublicAgent: seams.addPublic,
  setSpectraAgentInstalled: seams.setInstalled,
  getSpectraArtifact: vi.fn(),
  postSpectra: vi.fn(),
}));
vi.mock("../../components/artifact-studio-shell", () => ({
  StudioSplitPlaceholder: () => null,
  useArtifactStudioState: () => ({ mode: "closed", activeArtifact: null, tabs: [], dirtyIds: new Set(), openSplit: vi.fn(), openTab: vi.fn(), closeStudio: vi.fn(), closeTab: vi.fn(), activateTab: vi.fn(), setDirty: vi.fn() }),
}));
vi.mock("../../components/artifact-blueprint-sheet", () => ({ createDefaultArtifactPayload: () => ({ title: "New agent", summary: "", content: {}, tags: [] }) }));
vi.mock("../../components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("../../components/catalog-progress", () => ({ CatalogProgress: () => null }));
vi.mock("../../ai/use-spectra-run", () => ({ useSpectraRun: () => ({}) }));
vi.mock("../../island/engine", () => ({ useProvideIslandEngine: () => {} }));
vi.mock("@/stores/spectra-context-store", () => ({ useSpectraContextStore: (select: (state: { openObjects: unknown[] }) => unknown) => select({ openObjects: [] }) }));

beforeEach(() => {
  seams.catalog.items = [agentArtifact("mine", "Lab partner"), agentArtifact("theirs", "Essay coach", "shared")];
  seams.publicAgents.mockResolvedValue({ agents: [publicAgent("pub", "Cell tutor"), publicAgent("kept", "Revision buddy")] });
  seams.installedAgents.mockResolvedValue({ agents: [{ ...publicAgent("kept", "Revision buddy"), installedAt: now - 30_000, ownedByViewer: false }] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage() {
  await act(async () => {
    render(<AgentLibraryShell />);
  });
}
function section(name: string) {
  return screen.getByRole("region", { name });
}

it("lays the agents out once each, under Discover, Installed, Yours and Shared", async () => {
  await renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
  expect(within(section("Discover")).getByText("Cell tutor")).toBeTruthy();
  // Installed from Discover: it shows under Installed, not again under Discover.
  expect(within(section("Discover")).queryByText("Revision buddy")).toBeNull();
  expect(within(section("Installed")).getByText("Revision buddy")).toBeTruthy();
  expect(within(section("Yours")).getByText("Lab partner")).toBeTruthy();
  expect(within(section("Shared")).getByText("Essay coach")).toBeTruthy();
  expect(within(section("Discover")).getByRole("button", { name: "Install" })).toBeTruthy();
  expect(within(section("Installed")).getByRole("button", { name: "Uninstall" })).toBeTruthy();
});

it("installs a published agent by reference and says so", async () => {
  await renderPage();
  await act(async () => {
    fireEvent.click(within(section("Discover")).getByRole("button", { name: "Install" }));
  });
  expect(seams.addPublic).toHaveBeenCalledWith("pub");
  expect(seams.setInstalled).toHaveBeenCalledWith("pub", true);
  expect(seams.toast.success).toHaveBeenCalledWith("Cell tutor is installed.");
});

it("uninstalls an installed agent", async () => {
  await renderPage();
  await act(async () => {
    fireEvent.click(within(section("Installed")).getByRole("button", { name: "Uninstall" }));
  });
  expect(seams.setInstalled).toHaveBeenCalledWith("kept", false);
  expect(seams.addPublic).not.toHaveBeenCalled();
  expect(seams.toast.success).toHaveBeenCalledWith("Revision buddy is uninstalled.");
});

it("keeps your own agents when published agents fail to load, with a way to try again", async () => {
  seams.publicAgents.mockRejectedValueOnce(new Error("Spectra could not reach the server. Check your connection, then try again."));
  await renderPage();
  expect(screen.getByRole("alert").textContent).toContain("Published agents couldn't load");
  expect(within(section("Yours")).getByText("Lab partner")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  });
  expect(seams.publicAgents).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(section("Discover")).getByText("Cell tutor")).toBeTruthy();
});

it("narrows by search, and says when nothing matches", async () => {
  await renderPage();
  const search = screen.getByPlaceholderText(/Search agents by name/);
  fireEvent.change(search, { target: { value: "essay" } });
  expect(within(section("Shared")).getByText("Essay coach")).toBeTruthy();
  expect(screen.queryByText("Lab partner")).toBeNull();
  fireEvent.change(search, { target: { value: "astrophysics" } });
  expect(screen.getByText("No agents match")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByText("Lab partner")).toBeTruthy();
});

it("opens a published agent's preview from its card before installing", async () => {
  await renderPage();
  fireEvent.click(within(section("Discover")).getByText("Cell tutor"));
  const preview = await screen.findByRole("dialog");
  expect(within(preview).getByText("Published release 2 by Ana Ruiz")).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(preview).getByRole("button", { name: "Install agent" }));
  });
  expect(seams.setInstalled).toHaveBeenCalledWith("pub", true);
});
