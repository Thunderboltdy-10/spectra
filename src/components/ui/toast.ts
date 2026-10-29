"use client";

import type { MouseEvent, ReactNode } from "react";
import { toast as sonner } from "sonner";

/*
 * A short word to the user, in the toaster at the right of the screen
 * (providers.tsx). The island only lights in the colour of what happened;
 * the words themselves are always here.
 */

export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastAction = {
  label: ReactNode;
  /** Prevent the event's default to keep the word up (a retry that may fail again). */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
};

export type ToastOptions = {
  /** The same id updates the word already shown. */
  id?: string | number;
  description?: ReactNode;
  action?: ToastAction;
  /** In milliseconds; `Infinity` keeps it until dismissed. */
  duration?: number;
  closeButton?: boolean;
  onDismiss?: () => void;
};

function say(tone: ToastTone, message: ReactNode, options?: ToastOptions): string | number {
  const args = (options ? [message, options] : [message]) as Parameters<typeof sonner.message>;
  if (tone === "success") return sonner.success(...args);
  if (tone === "error") return sonner.error(...args);
  if (tone === "warning") return sonner.warning(...args);
  return sonner.message(...args);
}

export const toast = Object.assign((message: ReactNode, options?: ToastOptions) => say("info", message, options), {
  success: (message: ReactNode, options?: ToastOptions) => say("success", message, options),
  error: (message: ReactNode, options?: ToastOptions) => say("error", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => say("warning", message, options),
  info: (message: ReactNode, options?: ToastOptions) => say("info", message, options),
  message: (message: ReactNode, options?: ToastOptions) => say("info", message, options),
  dismiss: (id?: string | number) => sonner.dismiss(id),
  /** A whole surface of its own. */
  custom: sonner.custom,
});
