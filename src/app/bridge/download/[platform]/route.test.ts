import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/* The asset names tauri-action gives a release, as the Bridge workflow publishes it. */
const RELEASE = {
  assets: [
    { name: "Spectra.Bridge_0.1.1_x64-setup.exe", browser_download_url: "https://example.test/win-setup.exe" },
    { name: "Spectra.Bridge_0.1.1_x64-setup.exe.sig", browser_download_url: "https://example.test/win-setup.exe.sig" },
    { name: "Spectra.Bridge_0.1.1_aarch64.dmg", browser_download_url: "https://example.test/mac-arm.dmg" },
    { name: "Spectra.Bridge_0.1.1_x64.dmg", browser_download_url: "https://example.test/mac-x64.dmg" },
    { name: "latest.json", browser_download_url: "https://example.test/latest.json" },
  ],
};

async function download(platform: string, query = "", release: unknown = RELEASE, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(release), { status: ok ? 200 : 404 })));
  const response = await GET(new Request(`http://localhost:3000/bridge/download/${platform}${query}`), { params: Promise.resolve({ platform }) });
  return { status: response.status, location: response.headers.get("location") };
}

afterEach(() => vi.unstubAllGlobals());

describe("Bridge download", () => {
  it("sends each computer to its own installer from the latest release", async () => {
    expect(await download("windows")).toEqual({ status: 307, location: "https://example.test/win-setup.exe" });
    expect((await download("macos")).location).toBe("https://example.test/mac-arm.dmg");
    expect((await download("macos", "?arch=x64")).location).toBe("https://example.test/mac-x64.dmg");
  });

  it("falls back to the release page when there is no release or no matching file", async () => {
    expect((await download("windows", "", {}, false)).location).toMatch(/\/releases\/latest$/);
    expect((await download("windows", "", { assets: [] })).location).toMatch(/\/releases\/latest$/);
    expect((await download("linux")).location).toMatch(/\/releases\/latest$/);
  });
});
