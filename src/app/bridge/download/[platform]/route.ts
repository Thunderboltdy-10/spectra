import { NextResponse } from "next/server";

/**
 * The Bridge download for one platform. Releases are published by
 * .github/workflows/bridge-release.yml to a public releases repository; this
 * route sends the browser to the installer of the latest one.
 */
const RELEASES_REPO = process.env.SPECTRA_BRIDGE_RELEASES_REPO || "Thunderboltdy-10/spectra-bridge";

type Asset = { name: string; browser_download_url: string };

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
  const releases = `https://github.com/${RELEASES_REPO}/releases/latest`;
  if (!matches) return NextResponse.redirect(releases);
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });
    if (response.ok) {
      const release = (await response.json()) as { assets?: Asset[] };
      const asset = release.assets?.find((candidate) => matches(candidate.name));
      if (asset) return NextResponse.redirect(asset.browser_download_url);
    }
  } catch {
    // The release page below still lists every installer.
  }
  return NextResponse.redirect(releases);
}
