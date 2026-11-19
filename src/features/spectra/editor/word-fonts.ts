import { Arimo, Caladea, Carlito, Cousine, Tinos } from "next/font/google";

/**
 * Open fonts drawn to the same measurements as Word's own, served from
 * Spectra. A page asks for Word's font first (a writer who has Calibri sees
 * Calibri) and falls to its twin, so lines break where Word breaks them.
 * Nothing is preloaded: a font downloads only when a document uses it.
 */
// next/font reads these options at build time, so each is written out in full.
const carlito = Carlito({ variable: "--word-font-carlito", display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"] });
const caladea = Caladea({ variable: "--word-font-caladea", display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"] });
const tinos = Tinos({ variable: "--word-font-tinos", display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"] });
const arimo = Arimo({ variable: "--word-font-arimo", display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"] });
const cousine = Cousine({ variable: "--word-font-cousine", display: "swap", preload: false, weight: ["400", "700"], style: ["normal", "italic"] });

/** Class names that define the twin fonts' variables on a document page. */
export const wordFontVariables = [carlito, caladea, tinos, arimo, cousine].map((font) => font.variable).join(" ");
