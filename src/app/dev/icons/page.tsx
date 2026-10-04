import type { Metadata } from "next";
import { IconLab } from "@/components/icons/icon-lab";

export const metadata: Metadata = { title: "Icon lab · Spectra" };

/** Every Spectra glyph at 16 and 20 px, on both themes, at rest and animating. */
export default function IconLabPage() {
  return <IconLab />;
}
