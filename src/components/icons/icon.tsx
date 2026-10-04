import { useId, type CSSProperties, type SVGProps } from "react";
import { spectrumCss } from "@/features/spectra/life/spectrum";
import { GLYPHS, type IconName } from "./glyphs";

/** The continuous spectrum, sampled once for Spectra's own details (an agent's visor). */
const SPECTRUM_STOPS = Array.from({ length: 7 }, (_, index) => ({ offset: index / 6, colour: spectrumCss(index / 6) }));

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  /** CSS pixels. Glyphs are drawn for 16 and 20 (24 in a few places). */
  size?: number;
  /** The accent detail's colour: a type hue or a state hue. Defaults to currentColor. */
  accent?: string;
  /**
   * Plays the glyph's micro animation: once for a change, continuously for
   * a running state (syncing, saving). Without it the glyph still animates
   * when the control it sits in is hovered.
   */
  animate?: boolean;
  /** Accessible name. Without it the icon is decorative. */
  label?: string;
};

/** A Spectra glyph (docs/design/ICONS.md). */
export function Icon({ name, size = 16, accent, animate, label, className, style, ...props }: IconProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const spectrum = `${id}-spectrum`;
  const glyph = GLYPHS[name];
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
      data-animate={animate ? "true" : undefined}
      className={["spectra-icon", className].filter(Boolean).join(" ")}
      style={accent ? ({ ...style, "--icon-accent": accent } as CSSProperties) : style}
      {...props}
    >
      {name === "agent" || name === "agents" || name === "undoSpectra" ? (
        <defs>
          <linearGradient id={spectrum} x1="0" y1="0" x2="1" y2="0">
            {SPECTRUM_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.colour} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      {glyph({ spectrum, id })}
    </svg>
  );
}
