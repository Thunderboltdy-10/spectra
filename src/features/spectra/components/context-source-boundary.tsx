"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ContextSourceRegistration } from "../context";
import { contextSourceRegistry } from "../context";

export function ContextSourceBoundary({ registration, children, className }: { registration: Omit<ContextSourceRegistration, "element">; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => contextSourceRegistry.register({ ...registration, element: () => ref.current }), [registration]);
  return <div ref={ref} data-context-source={registration.id} className={className}>{children}</div>;
}
