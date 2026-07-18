import type { Metadata } from "next";
import { PublicShareShell } from "@/features/spectra/pages/public-share-shell";

export const metadata: Metadata = {
  title: "Shared in Spectra",
  description: "A read-only artifact shared through Spectra.",
  robots: { index: false, follow: false, nocache: true },
};

export default function PublicSharePage() {
  return <PublicShareShell />;
}
