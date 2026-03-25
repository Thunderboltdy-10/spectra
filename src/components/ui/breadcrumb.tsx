"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1">
          {index > 0 && <ChevronRight size={14} className="text-[var(--text-tertiary)]" />}
          {item.href ? (
            <Link
              href={item.href}
              className="text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-[var(--text-primary)]">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
