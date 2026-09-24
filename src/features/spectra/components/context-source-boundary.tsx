"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ContextSourceRegistration } from "../context";
import { contextSourceRegistry } from "../context";

export function ContextSourceBoundary({ registration, children, className }: { registration: Omit<ContextSourceRegistration, "element">; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const unregister = contextSourceRegistry.register({
      ...registration,
      element: () => ref.current,
    });
    return () => unregister();
  }, [registration]);
  return <div ref={ref} data-context-source={registration.id} className={className}>{children}</div>;
}
