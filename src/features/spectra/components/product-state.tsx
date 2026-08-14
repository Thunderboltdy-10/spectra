import { AlertCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ProductEmptyState({ icon: Icon, title, detail, action, className }: { icon: LucideIcon; title: string; detail: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-52 flex-col items-center justify-center px-6 text-center", className)}>
      <span className="grid size-10 place-items-center rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]"><Icon size={17} /></span>
      <strong className="mt-3 font-display text-[17px] font-semibold text-[var(--text-primary)]">{title}</strong>
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-[var(--text-secondary)]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ProductErrorState({ title, detail, action, className }: { title: string; detail: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-52 flex-col items-center justify-center px-6 text-center", className)}>
      <span className="grid size-10 place-items-center rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--bg-primary))] text-[var(--danger)]"><AlertCircle size={18} /></span>
      <strong className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">{title}</strong>
      <p className="mt-1 max-w-md text-[12px] leading-5 text-[var(--text-secondary)]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
