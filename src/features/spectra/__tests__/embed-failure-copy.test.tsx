// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const convexFrame = new Error(
  "[CONVEX M(artifactEmbeds:remove)] [Request ID: 5c2b1e0f9a] Server Error\n  Called by client",
);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("convex/react", () => ({
  useQuery: () => ({ embedId: "embed-1" }),
  useMutation: () => vi.fn().mockRejectedValue(convexFrame),
}));
vi.mock("../components/artifact-embed", () => ({
  ArtifactEmbed: ({ onRemove }: { onRemove?: () => void }) => (
    <button type="button" onClick={onRemove}>
      Remove reference
    </button>
  ),
}));

import { ArtifactEmbedById } from "../components/artifact-embed-host";

afterEach(() => {
  cleanup();
  toastError.mockClear();
});

describe("live reference failures", () => {
  it("shows the plain sentence, never the Convex request frame", async () => {
    render(<ArtifactEmbedById embedId="embed-1" onRemove={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove reference" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const shown = String(toastError.mock.calls[0]?.[0]);
    expect(shown).toBe("The reference could not be removed.");
    expect(shown).not.toMatch(/CONVEX|Request ID|Server Error/);
  });
});
