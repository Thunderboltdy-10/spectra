import type { ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared secondary column for contextual information. It owns its width so the
 * primary layout can use `grid-template-columns: minmax(0, 1fr) auto` and the
 * collapsed state genuinely returns space instead of leaving an empty column.
 */
export function AuxiliaryRail({
  label,
  children,
  onClose,
  navigation,
  className,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  navigation?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "h-full min-h-full w-full overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] lg:w-[300px]",
        className,
      )}
    >
      <div className="flex h-11 items-center gap-2 px-3">
        {navigation ? (
          <div className="min-w-0 flex-1">{navigation}</div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-secondary)]">{label}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Hide ${label}`}
          title={`Hide ${label}`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--text-tertiary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="h-[calc(100%-2.75rem)] min-h-0 overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}

export function AuxiliaryRailTrigger({
  label,
  onOpen,
  className,
}: {
  label: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show ${label}`}
      title={`Show ${label}`}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        className,
      )}
    >
      <PanelRightOpen size={14} />
    </button>
  );
}
