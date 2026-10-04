import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { appIconSvg, encodeIco, trayFileName, traySvg, trayVariants } from "./bridge-tray-icons";

/*
 * Writes the Spectra Bridge icons from the prism renderer:
 *   icons/tray/<theme>-<dot>-<size>.png  the tray, per taskbar theme, state dot and size
 *   icons/app-icon.svg, icons/app-icon.png the source for `cargo tauri icon`
 *   icons/icon.ico                       the Windows executable icon
 *
 *   npm run icons:bridge
 *
 * The output is committed; run this again whenever the prism changes.
 */

const ICONS = path.join(process.cwd(), "bridge", "bridge-app", "icons");
/** Rendered larger, then reduced, so small sizes stay crisp and smooth. */
const OVERSAMPLE = 8;

async function rasterise(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 * OVERSAMPLE })
    .resize(size, size, { kernel: "lanczos3", fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  rmSync(path.join(ICONS, "tray"), { recursive: true, force: true });
  mkdirSync(path.join(ICONS, "tray"), { recursive: true });
  for (const variant of trayVariants()) {
    writeFileSync(path.join(ICONS, trayFileName(variant)), await rasterise(traySvg(variant), variant.size));
  }
  const app = appIconSvg(1024);
  writeFileSync(path.join(ICONS, "app-icon.svg"), app);
  writeFileSync(
    path.join(ICONS, "app-icon.png"),
    await sharp(Buffer.from(app)).resize(1024, 1024).png({ compressionLevel: 9 }).toBuffer(),
  );
  const icoSizes = [16, 20, 24, 32, 48, 64, 256];
  const icoImages = [];
  for (const size of icoSizes) {
    const svg = size <= 32 ? traySvg({ theme: "dark", dot: "none", size }) : appIconSvg(size);
    icoImages.push({ size, png: await rasterise(svg, size) });
  }
  writeFileSync(path.join(ICONS, "icon.ico"), encodeIco(icoImages));
  console.log(`Wrote ${trayVariants().length} tray icons, the app icon and icon.ico to ${ICONS}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
