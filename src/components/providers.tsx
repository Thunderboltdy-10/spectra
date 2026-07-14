"use client";

import { Toaster } from "sonner";
import { CookieConsentManager } from "@/components/cookie-consent-manager";
import { GlobalSettingsDrawer } from "@/components/global-settings-drawer";
import { ThemeProvider } from "@/components/theme-provider";
import { DynamicFavicon } from "@/components/spectra-logo";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GlobalErrorBoundary>
      <ThemeProvider>
        {children}
        <DynamicFavicon />
        <GlobalSettingsDrawer />
        <CookieConsentManager />
        <Toaster
          theme="system"
          position="top-right"
          richColors
          visibleToasts={3}
          toastOptions={{
            className: "!rounded-xl !border-[var(--border-default)] !bg-[var(--bg-elevated)] !text-[var(--text-primary)] !shadow-[var(--shadow-soft)]",
            descriptionClassName: "!text-[var(--text-secondary)]",
          }}
        />
      </ThemeProvider>
    </GlobalErrorBoundary>
  );
}
