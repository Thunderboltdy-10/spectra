export type RunPresentationPolicy = "live_dock" | "in_surface" | "hidden_internal";

export type InternalRunDescriptor = {
  runId: string;
  ownerSurface: string;
  presentation: "in_surface" | "hidden_internal";
  statusLabel: string;
  durable: true;
};

export function createInternalRun(input: Omit<InternalRunDescriptor, "durable">): InternalRunDescriptor {
  if (input.presentation === "in_surface" && !input.ownerSurface.trim())
    throw new Error("INTERNAL_RUN_SURFACE_REQUIRED");
  return { ...input, durable: true };
}

export function shouldShowInLiveDock(policy: RunPresentationPolicy) {
  return policy === "live_dock";
}
