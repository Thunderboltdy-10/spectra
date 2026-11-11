// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicShareShell } from "../pages/public-share-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../components/published-code-runtime", () => ({
  PublishedCodeRuntime: () => null,
}));

const token = "b".repeat(40);
const workspaceProjection = {
  resourceType: "workspace",
  level: "read",
  workspace: {
    workspaceId: "ws-1",
    title: "Biology HL",
    defaultView: "grid",
    updatedAt: 1,
  },
  artifacts: [
    {
      artifactId: "doc-1",
      title: "Cell membranes",
      summary: "Transport across membranes",
      blueprintKey: "document",
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Diffusion moves particles down a gradient." }],
      },
      updatedAt: 1,
    },
  ],
};
const answer = (projection: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ projection }),
});

beforeEach(() => {
  window.history.replaceState(null, "", "/public#" + token);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public shared workspace", () => {
  it("names the artifact by its type and says plainly when a shared space is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ ...workspaceProjection, artifacts: [] })));
    render(<PublicShareShell />);
    expect(await screen.findByRole("heading", { level: 1, name: "Biology HL" })).toBeTruthy();
    expect(screen.getByText("Nothing shared here yet")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/blueprint|public workspace view/i);
  });

  it("opens an artifact from the shared workspace and returns to the list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer(workspaceProjection)));
    render(<PublicShareShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Cell membranes/ }));
    expect(await screen.findByText("Diffusion moves particles down a gradient.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Biology HL" }));
    expect(screen.getByRole("button", { name: /Cell membranes/ })).toBeTruthy();
    expect(screen.queryByText("Diffusion moves particles down a gradient.")).toBeNull();
  });

  it("keeps showing the artifact when a background refresh cannot reach the server", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => answer(workspaceProjection))
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicShareShell />);
    await screen.findByRole("button", { name: /Cell membranes/ });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Cell membranes/ })).toBeTruthy();
    expect(screen.queryByText("Shared view unavailable")).toBeNull();
  });

  it("offers a retry when the first load cannot reach the server", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => answer(workspaceProjection));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicShareShell />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Cell membranes/ })).toBeTruthy();
  });

  it("does not offer a retry for a link that no longer exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: "Shared view expired" }),
    }));
    render(<PublicShareShell />);
    await screen.findByText("Shared view expired");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
