import type { Metadata } from "next";
import { DocumentLab } from "@/features/spectra/document-lab/document-lab";

export const metadata: Metadata = { title: "Fidelity lab · Spectra" };

/** A Word file as Spectra shows it, beside the PDF Word printed of it. */
export default function DocumentLabPage() {
  return <DocumentLab />;
}
