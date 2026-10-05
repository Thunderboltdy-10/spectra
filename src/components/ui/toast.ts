"use client";

import type { MouseEvent, ReactNode } from "react";
import { toast as sonner } from "sonner";

/*
 * A short word to the user. In the app it reaches them through the island
 * (SHELL.md: notifications reach the user through the island): the word forms
 * out of the prism's light, in the colour of what happened. Pages without the
 * island (sign-in, onboarding) fall back to a plain toast.
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

export type ToastWord = Omit<ToastOptions, "id"> & { id: string | number; tone: ToastTone; message: ReactNode };

export type ToastSink = {
  show: (word: ToastWord) => void;
  dismiss: (id?: string | number) => void;
};

let sink: ToastSink | null = null;
let counter = 0;

/** The island takes the words while it is mounted. Returns the release. */
export function setToastSink(next: ToastSink) {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

function say(tone: ToastTone, message: ReactNode, options?: ToastOptions): string | number {
  if (!sink) {
    // Exactly what the caller said, so the plain toast behaves as it always did.
    const args = (options ? [message, options] : [message]) as Parameters<typeof sonner.message>;
    if (tone === "success") return sonner.success(...args);
    if (tone === "error") return sonner.error(...args);
    if (tone === "warning") return sonner.warning(...args);
    return sonner.message(...args);
  }
  const id = options?.id ?? `word-${++counter}`;
  sink.show({ ...options, id, tone, message });
  return id;
}

export const toast = Object.assign((message: ReactNode, options?: ToastOptions) => say("info", message, options), {
  success: (message: ReactNode, options?: ToastOptions) => say("success", message, options),
  error: (message: ReactNode, options?: ToastOptions) => say("error", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => say("warning", message, options),
  info: (message: ReactNode, options?: ToastOptions) => say("info", message, options),
  message: (message: ReactNode, options?: ToastOptions) => say("info", message, options),
  dismiss: (id?: string | number) => {
    sink?.dismiss(id);
    sonner.dismiss(id);
  },
  /** A whole surface of its own: always a plain toast. */
  custom: sonner.custom,
});
