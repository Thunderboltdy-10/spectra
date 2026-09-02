"use client";

import { useId } from "react";
import { PrismCore } from "@/components/spectra-mark";

export type PrismOptics = "dormant" | "working" | "waiting" | "completed" | "failed";

export function PrismLoader({
  size = 28,
  optics = "working",
  className,
  label,
}: {
  size?: number;
  optics?: PrismOptics;
  className?: string;
  label?: string;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className ? `spectra-prism-optic ${className}` : "spectra-prism-optic"}
      data-optics={optics}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "block", flexShrink: 0 }}
    >
      <PrismCore id={id} size={size} dim={optics === "dormant" || optics === "waiting"} animated />
    </svg>
  );
}

export function PrismRunMark({
  size = 18,
  optics = "working",
  slot,
}: {
  size?: number;
  optics?: PrismOptics;
  slot?: string;
}) {
  return (
    <span
      className="spectra-prism-slot"
      data-prism-slot={slot ?? "live-dock"}
      data-optics={optics}
      style={{ width: size, height: size }}
    >
      <PrismLoader size={size} optics={optics} />
    </span>
  );
}
