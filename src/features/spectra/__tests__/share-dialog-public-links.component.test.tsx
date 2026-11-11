// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  postSpectra: vi.fn(),
  links: [] as Array<Record<string, unknown>>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/components/ui/toast", () => ({ toast }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(), useQuery: () => undefined }));
vi.mock("../data/api", () => ({
  getSpectraShareState: vi.fn(async () => ({ shares: [] })),
  getSpectraPublicLinks: vi.fn(async () => ({ publicLinks: api.links })),
  getSpectraInheritedAudience: vi.fn(async () => ({ audience: [] })),
  getSpectraArtifactAccessRequests: vi.fn(async () => ({ requests: [] })),
  searchSpectraSchoolMembers: vi.fn(async () => ({ members: [] })),
  postSpectra: api.postSpectra,
}));

import { ShareDialog } from "../components/share-dialog";

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  api.postSpectra.mockReset();
  writeText.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(cleanup);

function renderDialog() {
  return render(<ShareDialog open resourceType="artifact" resourceId="art-1" title="Essay" onClose={() => {}} />);
}

describe("Share dialog public links", () => {
  it("copies a link Spectra made in the user's run, fetched again from the server", async () => {
    api.links = [
      { linkId: "link-ai", level: "read", createdAt: 1, madeBySpectra: { runId: "run-1", operationId: "op-1" } },
      { linkId: "link-user", level: "read", createdAt: 2 },
    ];
    api.postSpectra.mockResolvedValue({ linkId: "link-ai", url: "/public#secret" });
    renderDialog();
    expect(await screen.findByText(/Made by Spectra/)).toBeTruthy();
    // A link the user made shows its address only once, when made.
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/public#secret`));
    expect(api.postSpectra).toHaveBeenCalledWith({ action: "revealAiPublicLink", runId: "run-1", operationId: "op-1" });
    expect(toast.success).toHaveBeenCalledWith("Public link copied.");
  });

  it("says so when the link can no longer be copied", async () => {
    api.links = [{ linkId: "link-ai", level: "read", createdAt: 1, madeBySpectra: { runId: "run-1", operationId: "op-1" } }];
    api.postSpectra.mockRejectedValue(new Error("That public link was turned off or has expired. Make a new one from Share."));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That public link was turned off or has expired. Make a new one from Share."));
    expect(writeText).not.toHaveBeenCalled();
  });
});

/* F18: opening Share on a work kept on this computer moved it online at once. */
describe("sharing an artifact kept on this computer (F18)", () => {
  it("says it will move online, and moves it only when a link is made", async () => {
    api.links = [];
    api.postSpectra.mockResolvedValue({ url: "/public#new" });
    const beforeShare = vi.fn(async () => undefined);
    render(<ShareDialog open resourceType="artifact" resourceId="art-1" title="Draft" onClose={() => {}} beforeShare={beforeShare} />);
    expect(await screen.findByText(/kept on this computer now/)).toBeTruthy();
    expect(beforeShare).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Make a link" }));
    await waitFor(() => expect(api.postSpectra).toHaveBeenCalledWith(expect.objectContaining({ action: "createPublicLink" })));
    expect(beforeShare).toHaveBeenCalledTimes(1);
    expect(beforeShare.mock.invocationCallOrder[0]!).toBeLessThan(api.postSpectra.mock.invocationCallOrder[0]!);
  });
});
