"use client";

import { useProductOnline } from "./use-product-online";

/**
 * One product-wide offline sentence (UX-3, R16). Lives in AppShell chrome so
 * Settings, Library, and the composer share the same truth — not an artifact
 * secret and not a workbench-only strip.
 */
export function ProductOfflineBanner() {
  const online = useProductOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="shrink-0 border-b border-[color-mix(in_oklab,var(--warning)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--warning)_8%,var(--bg-primary))] px-4 py-1.5 text-caption text-[var(--text-secondary)]"
    >
      This device is offline. You can keep working; Spectra will send changes when you reconnect.
    </div>
  );
}
