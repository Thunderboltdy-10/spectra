import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { BrowserHandOff } from "@/features/spectra/desktop/browser-hand-off";

export const metadata: Metadata = {
  title: "Sign in Spectra for desktop",
  robots: { index: false },
};

export default function DesktopSignInPage() {
  return (
    <AuthShell home="student">
      <BrowserHandOff />
    </AuthShell>
  );
}
