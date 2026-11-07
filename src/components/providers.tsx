"use client";

import { Toaster } from "sonner";
import { CookieConsentManager } from "@/components/cookie-consent-manager";
import { KeyboardModality } from "@/components/keyboard-modality";
import { ThemeProvider } from "@/components/theme-provider";
import { DynamicFavicon } from "@/components/spectra-logo";
import { GlobalErrorBoundary } from "@/components/global-error-boundary";
import { useRecoverableClerkAuth } from "./use-recoverable-clerk-auth";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { LocalComputeCacheController } from "@/features/spectra/compute/cache/local-compute-cache-controller";
import { SpectraMotionConfig } from "@/features/spectra/motion/motion-primitives";
import { LifeField } from "@/features/spectra/life/life-field";
import { SchoolLoginSync } from "@/features/spectra/school/school-login-sync";
import { AccountStorageBoundary } from "./account-storage-boundary";
import { setKeptQueryClient } from "@/features/spectra/data/use-kept-query";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
setKeptQueryClient(convexClient);

function LiveDataProvider({ children }: { children: React.ReactNode }) {
  if (!convexClient) throw new Error("NEXT_PUBLIC_CONVEX_URL is required.");
  return <ConvexProviderWithClerk client={convexClient} useAuth={useRecoverableClerkAuth}><AccountStorageBoundary><SchoolLoginSync />{children}</AccountStorageBoundary></ConvexProviderWithClerk>;
}

/** The life field under and over every page, except the landing page, which has its own. */
function AppLifeField() {
  const pathname = usePathname();
  if (pathname === "/" || pathname?.startsWith("/landing")) return null;
  return <LifeField />;
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
        <SpectraMotionConfig>
          {content}
          <AppLifeField />
        </SpectraMotionConfig>
        <DynamicFavicon />
        <LocalComputeCacheController />
        <CookieConsentManager />
        <KeyboardModality />
        <Toaster
          theme="system"
          position="bottom-right"
          offset={{ bottom: 104, right: 20 }}
          closeButton
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
