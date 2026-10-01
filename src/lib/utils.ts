import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Spectra's semantic type sizes must merge separately from text colours.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "caption", "ui", "body", "subhead", "editor", "title", "heading", "metric", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrencyMicros(value?: number) {
  if (value === undefined) return "-";
  return `$${value.toFixed(4)}`;
}

export function shortDate(ts: number) {
  return new Date(ts).toLocaleString();
}

export function firstLine(value: string) {
  return value.split("\n")[0] ?? value;
}
