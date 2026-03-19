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
        <linearGradient id="spectra-logo-grad" x1="30" y1="10" x2="70" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--brand-primary, #0e8ee8)" />
          <stop offset="45%" stopColor="var(--brand-accent, #20b8b2)" />
          <stop offset="100%" stopColor="#ff8751" />
        </linearGradient>
      </defs>
      <path
        d="M 30 27 C 30 10, 70 10, 70 38 C 70 50, 30 50, 30 62 C 30 90, 70 90, 70 73"
        stroke="url(#spectra-logo-grad)"
        strokeWidth="13"
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

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="fg" x1="9.6" y1="3" x2="22.4" y2="29" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${primary}"/><stop offset="45%" stop-color="${accent}"/><stop offset="100%" stop-color="#ff8751"/></linearGradient></defs><path d="M 9.6 8.6 C 9.6 3.2, 22.4 3.2, 22.4 12.2 C 22.4 16, 9.6 16, 9.6 19.8 C 9.6 28.8, 22.4 28.8, 22.4 23.4" stroke="url(#fg)" stroke-width="4.2" stroke-linecap="round"/></svg>`;

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
