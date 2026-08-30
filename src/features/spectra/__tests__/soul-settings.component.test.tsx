// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoulSettings } from "@/features/spectra/settings/ui/soul-settings";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  soul: {
    text: "My name is Pablo.",
    tokenCount: 5,
    maxTokens: 350,
    userEdited: false,
    updatedAt: 1,
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => mocks.save,
  useQuery: () => mocks.soul,
}));

beforeEach(() => {
  mocks.save.mockReset();
  mocks.save.mockImplementation(async ({ text }: { text: string }) => ({
    ...mocks.soul,
    text,
    userEdited: true,
  }));
});

afterEach(cleanup);

describe("Soul settings", () => {
  it("uses plain words and saves the textarea through the memory mutation", async () => {
    render(<SoulSettings />);
    const textarea = screen.getByRole("textbox", {
      name: "What should Spectra keep in mind?",
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("My name is Pablo.");
    expect(screen.queryByText(/capsule|claims|retrieval/i)).toBeNull();

    fireEvent.change(textarea, {
      target: { value: "My name is Pablo. Keep explanations concise." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        text: "My name is Pablo. Keep explanations concise.",
      }),
    );
    expect(
      await screen.findByText("Saved. New conversations will use this version."),
    ).toBeTruthy();
  });

  it("shows a plain inline refusal when protected text is rejected", async () => {
    mocks.save.mockRejectedValueOnce(
      new Error("MEMORY_CAPTURE_REJECTED: sensitive_or_secret"),
    );
    render(<SoulSettings />);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "What should Spectra keep in mind?",
      }),
      { target: { value: "My password is should-not-be-stored" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        "Remove secrets or sensitive personal information before saving.",
      ),
    ).toBeTruthy();
  });
});
