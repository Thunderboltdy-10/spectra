"use client";

import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { spectrumCss } from "@/features/spectra/life/spectrum";

/*
 * What the page lies on: a sheet of warm paper with its fibre, and light
 * that has come through a prism somewhere above it. The light falls as a few
 * long ribbons of spectrum, the way a window throws colour across a desk
 * late in the day; they slide a little as the page scrolls, and nothing else
 * moves.
 */

const RIBBONS = [
  { d: "M -200 260 C 260 120, 620 420, 1040 250 S 1640 120, 1900 300", from: 0.02, to: 0.5, width: 120, y: [-40, 160], opacity: 0.28 },
  { d: "M -200 720 C 340 560, 760 860, 1180 700 S 1680 600, 1900 760", from: 0.42, to: 0.96, width: 90, y: [80, -220], opacity: 0.2 },
  { d: "M -200 1040 C 220 980, 640 1140, 980 1060 S 1560 940, 1900 1020", from: 0.6, to: 1.1, width: 70, y: [160, -120], opacity: 0.16 },
];

export function Backdrop() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 24, mass: 0.6 });
  const drift = [
    useTransform(progress, [0, 1], RIBBONS[0].y),
    useTransform(progress, [0, 1], RIBBONS[1].y),
    useTransform(progress, [0, 1], RIBBONS[2].y),
  ];
  const sweep = useTransform(progress, [0, 1], [-60, 60]);
  return (
    <div className="sp-backdrop" aria-hidden>
      <motion.svg className="sp-backdrop-light" viewBox="0 0 1700 1200" preserveAspectRatio="xMidYMid slice" style={{ x: sweep }}>
        <defs>
          {RIBBONS.map((ribbon, index) => (
            <linearGradient key={index} id={`sp-ribbon-${index}`} x1="0" x2="1" y1="0" y2="0">
              {Array.from({ length: 7 }, (_, stop) => {
                const t = ribbon.from + ((ribbon.to - ribbon.from) * stop) / 6;
                return <stop key={stop} offset={`${(stop / 6) * 100}%`} stopColor={spectrumCss(t % 1)} stopOpacity={stop === 0 || stop === 6 ? 0 : 1} />;
              })}
            </linearGradient>
          ))}
        </defs>
        {RIBBONS.map((ribbon, index) => (
          <motion.path
            key={index}
            d={ribbon.d}
            stroke={`url(#sp-ribbon-${index})`}
            strokeWidth={ribbon.width}
            strokeLinecap="round"
            fill="none"
            opacity={ribbon.opacity}
            style={{ y: drift[index] }}
            className="sp-backdrop-ribbon"
            data-ribbon={index}
          />
        ))}
      </motion.svg>
      <div className="sp-backdrop-grain" />
    </div>
  );
}
