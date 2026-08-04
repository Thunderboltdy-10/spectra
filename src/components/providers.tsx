"use client";

import { Toaster } from "sonner";
import { CookieConsentManager } from "@/components/cookie-consent-manager";
import { GlobalSettingsDrawer } from "@/components/global-settings-drawer";
import { ThemeProvider } from "@/components/theme-provider";
import { DynamicFavicon } from "@/components/spectra-logo";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { LocalComputeCacheController } from "@/features/spectra/compute/cache/local-compute-cache-controller";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

function LiveDataProvider({ children }: { children: React.ReactNode }) {
  if (!convexClient) throw new Error("NEXT_PUBLIC_CONVEX_URL is required.");
  return <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>{children}</ConvexProviderWithClerk>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const content = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <LiveDataProvider>{children}</LiveDataProvider>
    : children;
  return (
    <GlobalErrorBoundary>
      <ThemeProvider>
        {content}
        <DynamicFavicon />
        <GlobalSettingsDrawer />
        <LocalComputeCacheController />
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
