import type { Metadata } from "next";
import { ContactClient } from "./contact-client";

export const metadata: Metadata = {
  title: "Talk to us · Spectra",
  description: "Ask for a walkthrough of Spectra with your own classes, or pass it to a teacher.",
};

export default function ContactPage() {
  return <ContactClient />;
}
