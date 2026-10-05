import { AlertCircle, type GlyphIcon } from "@/components/icons/glyph-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ProductEmptyState({ icon: Icon, title, detail, action, className }: { icon: GlyphIcon; title: string; detail: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-52 flex-col items-center justify-center px-6 text-center", className)}>
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]"><Icon size={17} /></span>
      <strong className="mt-3 font-display text-title font-semibold text-[var(--text-primary)]">{title}</strong>
      <p className="mt-1 max-w-sm text-caption leading-5 text-[var(--text-secondary)]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ProductErrorState({ title, detail, action, className }: { title: string; detail: string; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex min-h-52 flex-col items-center justify-center px-6 text-center", className)}>
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-card border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] text-[var(--danger)]"><AlertCircle size={18} /></span>
      <strong className="mt-3 text-body font-semibold text-[var(--text-primary)]">{title}</strong>
      <p className="mt-1 max-w-md text-caption leading-5 text-[var(--text-secondary)]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
