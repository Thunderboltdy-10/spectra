"use client";

import { Toaster } from "sonner";
import { CookieConsentManager } from "@/components/cookie-consent-manager";
import { CommandPaletteProvider } from "@/components/command-palette";
import { GlobalSettingsDrawer } from "@/components/global-settings-drawer";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/context/sidebar-context";
import { PanelProvider } from "@/context/panel-context";
import { DynamicFavicon } from "@/components/spectra-logo";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { SpectraSessionProvider } from "@/context/spectra-session-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GlobalErrorBoundary>
    <ThemeProvider>
      <SidebarProvider>
        <PanelProvider>
          <SpectraSessionProvider>
          <CommandPaletteProvider>
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
          </CommandPaletteProvider>
          </SpectraSessionProvider>
        </PanelProvider>
      </SidebarProvider>
    </ThemeProvider>
    </GlobalErrorBoundary>
  );
}
