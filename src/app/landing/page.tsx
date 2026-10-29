import type { Metadata } from "next";
import { LandingClient } from "./landing-client";

export const metadata: Metadata = {
  title: "Spectra landing (preview)",
  description:
    "Public marketing landing for Spectra. Signed-in users can open this route to review the landing shell without leaving the product.",
};

/**
 * Explicit landing preview. `/` still sends signed-in users to `/workspace`
 * (product home). `/landing` stays available so admins and record demos can
 * review `.landing-shell` without signing out.
 */
export default function LandingPage() {
  return <LandingClient />;
}
