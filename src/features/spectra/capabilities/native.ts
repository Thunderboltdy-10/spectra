import { preservedRegionRefusal, regionBlockedBy } from "../commands/registry";
import type { CommandAvailability, CommandContext } from "../commands/types";
import type { WorkCapability } from "../work/registry";
import type { NativeCapability, OfficeWorkType } from "./types";

/**
 * One availability function for Office capabilities. Human workbar, shortcut,
 * and AI proposal all call this; a missing lens delta is a refusal, never an
 * optimistic enable on a fully native linked file.
 */
export function availabilityFor(
  native: NativeCapability<OfficeWorkType> | undefined,
  requires: WorkCapability | undefined = "edit",
) {
  return (ctx: CommandContext): CommandAvailability => {
    if (requires && !ctx.can(requires)) return { state: "hidden" };
    if (!native) return { state: "enabled" };
    if (ctx.compatibilityProfile !== "strict-native") {
      return { state: "enabled" };
    }
    if (!native.delta) {
      const blocked = regionBlockedBy(ctx.fidelity, native.touches);
      return {
        state: "disabled",
        reason: blocked
          ? preservedRegionRefusal(blocked.region)
          : (native.unavailableReason ??
            "This change cannot be written safely to the linked native file."),
      };
    }
    const blocked = regionBlockedBy(ctx.fidelity, native.touches);
    return blocked
      ? {
          state: "disabled",
          reason: preservedRegionRefusal(blocked.region),
        }
      : { state: "enabled" };
  };
}
