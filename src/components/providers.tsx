"use client";

import { Toaster } from "sonner";
import { CookieConsentManager } from "@/components/cookie-consent-manager";
import { ThemeProvider } from "@/components/theme-provider";
import { DynamicFavicon } from "@/components/spectra-logo";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { useRecoverableClerkAuth } from "./use-recoverable-clerk-auth";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { LocalComputeCacheController } from "@/features/spectra/compute/cache/local-compute-cache-controller";
import { SpectraMotionConfig } from "@/features/spectra/motion/motion-primitives";
import { AccountStorageBoundary } from "./account-storage-boundary";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

function LiveDataProvider({ children }: { children: React.ReactNode }) {
  if (!convexClient) throw new Error("NEXT_PUBLIC_CONVEX_URL is required.");
  return <ConvexProviderWithClerk client={convexClient} useAuth={useRecoverableClerkAuth}><AccountStorageBoundary>{children}</AccountStorageBoundary></ConvexProviderWithClerk>;
}

function PathScopedErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <GlobalErrorBoundary resetKey={pathname}>{children}</GlobalErrorBoundary>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const content = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <LiveDataProvider>{children}</LiveDataProvider>
    : children;
  return (
    <PathScopedErrorBoundary>
      <ThemeProvider>
        <SpectraMotionConfig>{content}</SpectraMotionConfig>
        <DynamicFavicon />
        <LocalComputeCacheController />
        <CookieConsentManager />
        <Toaster
          theme="system"
          position="top-right"
          richColors
          visibleToasts={3}
          expand
          toastOptions={{
            className: "!rounded-xl !border-[var(--border-default)] !bg-[var(--bg-elevated)] !text-[var(--text-primary)] !shadow-[var(--shadow-soft)]",
            descriptionClassName: "!text-[var(--text-secondary)]",
          }}
        />
      </ThemeProvider>
    </PathScopedErrorBoundary>
  );
}
