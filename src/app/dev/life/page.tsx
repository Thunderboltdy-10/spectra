import type { Metadata } from "next";
import { LifeLab } from "@/features/spectra/life/lab/life-lab";

export const metadata: Metadata = { title: "Life lab · Spectra" };

/** Every choreography of LIFE.md, playable on the real field. */
export default function LifeLabPage() {
  return <LifeLab />;
}
