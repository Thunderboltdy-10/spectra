// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster, toast } from "sonner";
import { showRetryToast } from "@/components/ui/retry-toast";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

it("keeps separate operations distinct while a failed retry updates its own notice", async () => {
  render(<Toaster />);
  const retryRestore = (id: string | number) => {
    showRetryToast("This device is offline.", retryRestore, { id, label: "Retry restore" });
  };
  const restoreId = showRetryToast("This device is offline.", retryRestore, { label: "Retry restore" });
  const moveId = showRetryToast("This device is offline.", () => {}, { label: "Retry move" });
  expect(restoreId).not.toBe(moveId);
  await screen.findByRole("button", { name: "Retry restore" });
  fireEvent.click(screen.getByRole("button", { name: "Retry restore" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Retry restore" })).toHaveLength(1));
  expect(screen.getAllByRole("button", { name: "Retry move" })).toHaveLength(1);
  expect(toast.getToasts().filter((notice) => notice.id === restoreId || notice.id === moveId)).toHaveLength(2);
});

it("does not submit a second retry while the first is still pending", async () => {
  render(<Toaster />);
  let finish!: () => void;
  const retry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  showRetryToast("Try again when connected.", retry);
  const button = await screen.findByRole("button", { name: "Retry" });
  try {
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    finish();
  }
});

it("lets a person explicitly dismiss an unfinished recovery notice", async () => {
  render(<Toaster />);
  const retry = vi.fn();
  showRetryToast("Try again when connected.", retry);
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Close toast" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  expect(retry).not.toHaveBeenCalled();
});
