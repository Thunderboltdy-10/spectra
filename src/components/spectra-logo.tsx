"use client";

import { useEffect } from "react";

type SpectraLogoProps = {
  size?: number;
  className?: string;
};

export function SpectraLogo({ size = 32, className }: SpectraLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-label="Spectra"
      role="img"
    >
      <defs>
        <linearGradient id="spectra-front" x1="30" y1="10" x2="70" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--brand-primary, #0e8ee8)" />
          <stop offset="50%" stopColor="var(--brand-accent, #20b8b2)" />
          <stop offset="100%" stopColor="#ff8751" />
        </linearGradient>
        <linearGradient id="spectra-shadow" x1="35" y1="20" x2="65" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--brand-primary, #0e8ee8)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--brand-accent, #20b8b2)" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Shadow/depth ribbon — offset slightly to create folded depth */}
      <path
        d="M 64 14 C 40 14, 24 25, 24 39 C 24 52, 76 48, 76 61 C 76 75, 60 86, 36 86"
        stroke="url(#spectra-shadow)"
        strokeWidth="16"
        strokeLinecap="round"
      />

      {/* Main ribbon S — wide, clean, standard S direction */}
      <path
        d="M 66 16 C 42 16, 26 26, 26 38 C 26 50, 74 50, 74 62 C 74 74, 58 84, 34 84"
        stroke="url(#spectra-front)"
        strokeWidth="14"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Dynamically updates the favicon to reflect the school's brand colors.
 * Reads --brand-primary and --brand-accent CSS variables and generates
 * an SVG favicon. Include once in the authenticated app shell.
 */
export function DynamicFavicon() {
  useEffect(() => {
    function updateFavicon() {
      const styles = getComputedStyle(document.documentElement);
      const primary = styles.getPropertyValue("--brand-primary").trim() || "#0e8ee8";
      const accent = styles.getPropertyValue("--brand-accent").trim() || "#20b8b2";

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="f" x1="9.6" y1="3" x2="22.4" y2="29" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${primary}"/><stop offset="50%" stop-color="${accent}"/><stop offset="100%" stop-color="#ff8751"/></linearGradient></defs><path d="M 21 5 C 13.5 5, 8.3 8.2, 8.3 12.2 C 8.3 16, 23.7 16, 23.7 19.8 C 23.7 23.8, 18.5 27, 11 27" stroke="url(#f)" stroke-width="4.5" stroke-linecap="round"/></svg>`;

      const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        document.head.appendChild(link);
      }
      link.href = url;
    }

    updateFavicon();

    // Re-generate when theme/palette changes (custom school colors)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && (m.attributeName === "style" || m.attributeName === "data-theme-palette")) {
          updateFavicon();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
