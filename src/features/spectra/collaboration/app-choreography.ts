export type AppSurface =
  "library" | "workspace" | "settings" | "calendar" | "artifact" | "none";

export type AppViewportSnapshot = {
  visibleSurfaces: readonly AppSurface[];
  focusedSurface?: AppSurface;
  recentSurface?: AppSurface;
  followingActor: boolean;
};

export type AppChoreographyDecision = {
  surface: AppSurface;
  navigate: boolean;
  animate: boolean;
  reason: string;
};

/** Pure arbitration for non-artifact operations. The semantic operation is
 * independent; this only chooses whether a performer gets a body. */
export function arbitrateAppSurface(
  target: AppSurface,
  viewport: AppViewportSnapshot,
): AppChoreographyDecision {
  if (viewport.visibleSurfaces.includes(target))
    return {
      surface: target,
      navigate: false,
      animate: true,
      reason: "The target is already visible.",
    };
  if (
    viewport.focusedSurface &&
    viewport.visibleSurfaces.includes(viewport.focusedSurface) &&
    viewport.focusedSurface === target
  )
    return {
      surface: target,
      navigate: false,
      animate: true,
      reason: "The target owns the current focus.",
    };
  if (
    viewport.recentSurface &&
    viewport.recentSurface === target &&
    viewport.followingActor
  )
    return {
      surface: target,
      navigate: true,
      animate: true,
      reason:
        "Follow AI permits a deliberate route change to the recent target.",
    };
  if (viewport.followingActor)
    return {
      surface: target,
      navigate: true,
      animate: true,
      reason: "Follow AI permits navigation to the target.",
    };
  return {
    surface: "none",
    navigate: false,
    animate: false,
    reason: "The actor is not followed and the target is off-screen.",
  };
}

export function choreographyDisabledResult<T>(operation: () => T): T {
  return operation();
}
