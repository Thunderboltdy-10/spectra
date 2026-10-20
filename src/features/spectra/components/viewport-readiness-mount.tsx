"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { acknowledgeViewportReady, type ViewportView } from "../viewport-readiness";
import { isHomePath } from "../chat/home-routes";

function mountedSurface(pathname: string, searchParams: URLSearchParams): { view: ViewportView; targetId: string } | null {
  if (isHomePath(pathname)) {
    // A thread route can be present before its detail has loaded. ChatShell
    // acknowledges a specific thread only after that conversation mounts;
    // the generic chat target is reserved for opening the blank surface.
    return { view: "conversation", targetId: "chat" };
  }
  if (pathname.startsWith("/settings")) {
    return { view: "settings", targetId: searchParams.get("section") ?? "settings" };
  }
  if (pathname.startsWith("/calendar")) return { view: "calendar", targetId: "calendar" };
  const segments = pathname.split("/").filter(Boolean);
  if (pathname.startsWith("/workspace")) {
    return segments[1] ? null : { view: "workspace", targetId: "workspace" };
  }
  if (pathname.startsWith("/library/") || pathname.startsWith("/artifacts/")) {
    // The detail is ready only after the actual ArtifactStudio mounts.
    return null;
  }
  // A workspace is a place in the Library; the shell says when it is ready.
  if (pathname.startsWith("/library")) return searchParams.get("workspaceId") ? null : { view: "library", targetId: "library" };
  return { view: "workspace", targetId: pathname || "workspace" };
}

export function ViewportReadinessMount() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    const target = mountedSurface(pathname, new URLSearchParams(searchParams.toString()));
    if (!target) return;
    const frame = requestAnimationFrame(() => acknowledgeViewportReady(target));
    return () => cancelAnimationFrame(frame);
  }, [pathname, searchParams]);
  return null;
}
