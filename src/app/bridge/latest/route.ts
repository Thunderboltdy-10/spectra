import { NextResponse } from "next/server";

/**
 * The newest published Spectra Bridge version, so the Devices page can say
 * when a computer runs an older one. Read from the public releases repository
 * that bridge-release.yml publishes to, kept for ten minutes.
 */
const RELEASES_REPO = process.env.SPECTRA_BRIDGE_RELEASES_REPO || "Thunderboltdy-10/spectra-bridge";

export async function GET() {
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });
    if (response.ok) {
      const release = (await response.json()) as { tag_name?: string };
      const version = release.tag_name?.replace(/^bridge-v/, "").replace(/^v/, "");
      if (version && /^\d+\.\d+\.\d+/.test(version))
        return NextResponse.json({ version }, { headers: { "cache-control": "public, max-age=600" } });
    }
  } catch {
    // Unknown is said as unknown: the page then just doesn't compare.
  }
  return NextResponse.json({ version: null });
}
