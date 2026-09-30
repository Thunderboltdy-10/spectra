"use client";

import { toast } from "sonner";

type RetryToastOptions = {
  id?: string | number;
  description?: string;
  label?: string;
};

/** A failed retry updates the same notice; success is dismissed by its caller. */
export function showRetryToast(
  message: string,
  retry: (id: string | number) => void | Promise<void>,
  { label = "Retry", ...options }: RetryToastOptions = {},
) {
  let retrying = false;
  const id: string | number = toast.error(message, {
    ...options,
    action: {
      label,
      onClick: async (event) => {
        // Sonner otherwise animates this notice out while the next failure
        // creates another. Keep it mounted until the operation settles.
        event.preventDefault();
        if (retrying) return;
        retrying = true;
        try {
          await retry(id);
        } finally {
          retrying = false;
        }
      },
    },
  });
  return id;
}
