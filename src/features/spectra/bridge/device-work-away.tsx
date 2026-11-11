"use client";

import Link from "next/link";
import { bridgeUnavailableReason, useBridgeAvailability } from "./availability";
import { useDeviceState } from "./device-works";

type Placed = { storageHome?: "device"; storageStoreId?: string };

/** Why a work kept on a computer can't open here, or nothing when it can. */
export function useDeviceWorkAway(artifact: Placed) {
  const availability = useBridgeAvailability();
  const { storeId } = useDeviceState();
  if (artifact.storageHome !== "device") return null;
  if (availability === "checking") return "checking" as const;
  if (availability !== "ready") return bridgeUnavailableReason(availability);
  if (!storeId) return "checking" as const;
  if (artifact.storageStoreId !== storeId)
    return "This work is kept on another of your computers. Open it there, or move it to the cloud from that computer.";
  return null;
}

/** For a row in a list: the reason it can't open here, once that's actually known. */
export function useDeviceWorkAwayNote(artifact: Placed | undefined) {
  const away = useDeviceWorkAway(artifact ?? {});
  return away === "checking" ? null : away;
}

export function DeviceWorkAway({ title, reason }: { title: string; reason: string | "checking" }) {
  if (reason === "checking")
    return <div className="flex h-full min-h-[240px] items-center justify-center text-[var(--text-tertiary)]">Opening {title}…</div>;
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[length:var(--text-title)] font-medium text-[var(--text-primary)]">{title} is on your computer</p>
      <p className="max-w-[44ch] text-[var(--text-secondary)]">{reason}</p>
      <Link
        href="/devices"
        className="rounded-control border border-[var(--border-default)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
      >
        Go to Devices
      </Link>
    </div>
  );
}
