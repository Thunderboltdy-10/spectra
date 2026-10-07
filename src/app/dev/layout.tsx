import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/** The labs are for building Spectra; a production deployment does not serve them. */
export default function DevLabsLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
