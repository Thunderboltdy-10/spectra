import { describe, expect, it } from "vitest";
import { STATUS_COLOURS } from "../src/features/spectra/life/prism";
import { appIconSvg, encodeIco, trayFileName, trayPose, traySvg, trayVariants } from "./bridge-tray-icons";

describe("Bridge tray icons", () => {
  it("covers every theme, state dot and tray size the Bridge embeds", () => {
    const names = trayVariants().map(trayFileName);
    expect(names).toHaveLength(2 * 4 * 4);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("tray/light-none-16.png");
    expect(names).toContain("tray/dark-red-32.png");
  });

  it("draws the prism mark, with a dot only when the state has one", () => {
    expect(trayPose("none").status).toBeUndefined();
    expect(trayPose("grey").status?.rgb).toEqual(STATUS_COLOURS.offline);
    expect(trayPose("orange").status?.rgb).toEqual(STATUS_COLOURS.needs);
    expect(trayPose("red").status?.rgb).toEqual(STATUS_COLOURS.problem);
    const plain = traySvg({ theme: "dark", dot: "none", size: 16 });
    const dotted = traySvg({ theme: "dark", dot: "red", size: 16 });
    expect(plain).toContain('viewBox="0 0 16 16"');
    expect(plain).not.toContain("<circle");
    expect(dotted).toContain("<circle");
    expect(appIconSvg(1024)).toContain('viewBox="0 0 1024 1024"');
  });

  it("packs PNG images into an ICO directory", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const ico = encodeIco([
      { size: 16, png },
      { size: 256, png },
    ]);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0);
    const firstOffset = view.getUint32(6 + 12, true);
    expect(firstOffset).toBe(6 + 16 * 2);
    expect(Array.from(ico.slice(firstOffset, firstOffset + 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(() => encodeIco([{ size: 512, png }])).toThrow();
  });
});
