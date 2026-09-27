import type { CatalogSnapshot } from "../data/catalog-page-cache";

export function CatalogProgress({ catalog, label = "workspaces" }: {
  catalog: CatalogSnapshot<{ _id: string }> & { more: () => Promise<void>; refresh: (force?: boolean) => Promise<void>; unavailable?: boolean };
  label?: string;
}) {
  if (catalog.unavailable) return <p role="status" className="text-micro text-[var(--text-secondary)]">Join a school to load {label}.</p>;
  if (catalog.status === "error") return <button type="button" onClick={() => void catalog.refresh(true)} className="text-micro text-[var(--text-secondary)]">Could not load {label}. Retry</button>;
  if (catalog.status === "idle" || catalog.status === "loading") return <p role="status" className="text-micro text-[var(--text-secondary)]">Loading {label}…</p>;
  if (!catalog.isDone) return <button type="button" onClick={() => void catalog.more()} className="text-micro text-[var(--text-secondary)]">Load more {label}</button>;
  return null;
}
