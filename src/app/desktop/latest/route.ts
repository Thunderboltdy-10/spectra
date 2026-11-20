import { NextResponse } from "next/server";
import { latestRelease } from "@/lib/desktop-releases";

/**
 * The newest published Spectra for desktop version, so the Devices page can
 * say when a computer runs an older one. Kept for ten minutes.
 */
export async function GET() {
  const release = await latestRelease();
  const version = release?.tag_name?.replace(/^bridge-v/, "").replace(/^v/, "");
  if (version && /^\d+\.\d+\.\d+/.test(version)) {
    return NextResponse.json({ version }, { headers: { "cache-control": "public, max-age=600" } });
  }
  // Unknown is said as unknown: the page then just doesn't compare.
  return NextResponse.json({ version: null });
}
