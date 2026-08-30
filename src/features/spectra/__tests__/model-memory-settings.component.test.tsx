// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelMemorySettings } from "@/features/spectra/settings/ui/model-memory-settings";

const mocks = vi.hoisted(() => ({
  forget: vi.fn(),
  result: {
    claims: [
      {
        _id: "claim-user",
        createdBy: "user",
        claimType: "declared_fact",
        proposition:
          "This user-authored item stays in the general memory view.",
      },
      {
        _id: "claim-model",
        createdBy: "model",
        claimType: "mistake_avoidance",
        proposition:
          "Do not round intermediate calculations before the final result.",
      },
    ],
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => mocks.forget,
  useQuery: () => mocks.result,
}));

beforeEach(() => {
  mocks.forget.mockReset();
  mocks.forget.mockResolvedValue({ forgotten: true });
});

afterEach(cleanup);

describe("Things Spectra noticed", () => {
  it("shows only model-authored items and forgets one in a single action", async () => {
    render(<ModelMemorySettings />);

    expect(screen.getByText("Things Spectra noticed")).toBeTruthy();
    expect(
      screen.getByText(
        "Do not round intermediate calculations before the final result.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "This user-authored item stays in the general memory view.",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Forget: Do not round intermediate calculations before the final result.",
      }),
    );
    await waitFor(() =>
      expect(mocks.forget).toHaveBeenCalledWith({ claimId: "claim-model" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Do not round intermediate calculations before the final result.",
        ),
      ).toBeNull(),
    );
  });

  it("keeps the item visible and explains when forgetting fails", async () => {
    mocks.forget.mockRejectedValueOnce(new Error("network unavailable"));
    render(<ModelMemorySettings />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forget: Do not round intermediate calculations before the final result.",
      }),
    );

    expect(
      await screen.findByText(
        "This could not be forgotten. It is still available to Spectra.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Do not round intermediate calculations before the final result.",
      ),
    ).toBeTruthy();
  });
});
