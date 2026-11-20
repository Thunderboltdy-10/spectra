import { NextResponse } from "next/server";
import { latestRelease, releasePage } from "@/lib/desktop-releases";

/**
 * The Spectra for desktop installer for one platform, from the latest release.
 * Macs get the Apple silicon build unless `?arch=x64` asks for Intel: a browser
 * cannot tell the two apart.
 */

/** Which installer each platform gets, by the file name tauri-action gives it. */
const INSTALLERS: Record<string, (name: string) => boolean> = {
  windows: (name) => /-setup\.exe$/i.test(name),
  "macos-arm64": (name) => /aarch64\.dmg$/i.test(name),
  "macos-x64": (name) => /x64\.dmg$/i.test(name),
};

export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const arch = new URL(request.url).searchParams.get("arch") === "x64" ? "x64" : "arm64";
  const key = platform === "macos" ? `macos-${arch}` : platform;
  const matches = INSTALLERS[key];
  if (!matches) return NextResponse.redirect(releasePage());
  const release = await latestRelease();
  const asset = release?.assets?.find((candidate) => matches(candidate.name));
  if (asset) return NextResponse.redirect(asset.browser_download_url);
  // The release page still lists every installer.
  return NextResponse.redirect(releasePage(release?.repo));
}
