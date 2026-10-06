import type { ReactNode } from "react";
import type { IconName } from "@/components/icons";
import type { GlyphIcon } from "@/components/icons/glyph-icons";
import { EmptyState, ProblemState } from "@/components/ui/page-state";

/* The kit's page states under the names product code already uses. */

export function ProductEmptyState({ icon, title, detail, action, className }: { icon: IconName | GlyphIcon; title: string; detail: string; action?: ReactNode; className?: string }) {
  return <EmptyState icon={icon} title={title} detail={detail} action={action} className={className} />;
}

export function ProductErrorState({ title, detail, action, className }: { title: string; detail: string; action?: ReactNode; className?: string }) {
  return <ProblemState title={title} detail={detail} action={action} className={className} />;
}
