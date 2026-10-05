"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { useAccountStorageReady } from "../account-storage-boundary";
import { AccountConnectionState } from "../account-connection-state";
import { usePathname } from "next/navigation";
import { captureSpectraNavigation, useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { SignedInContinue } from "@/components/signed-in-continue";
import { UniversalKBar } from "@/features/spectra/components/universal-kbar";
import { ViewportReadinessMount } from "@/features/spectra/components/viewport-readiness-mount";
import { cn } from "@/lib/utils";
import { KeyboardShortcutsHelp, KeyboardShortcutsRegistrar } from "@/components/keyboard-shortcuts";
import { RouteSidePanelHost } from "@/features/spectra/components/route-side-panel-host";
import { ViewportReferencePicker } from "@/features/spectra/components/viewport-reference-picker";
import { IslandHost } from "@/features/spectra/island/island-host";
import { ThreadsViewHost } from "@/features/spectra/threads/threads-view";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { ProductOfflineBanner } from "@/features/spectra/bridge/product-offline-banner";
import { AppChoreographyMount } from "@/features/spectra/collaboration/app-choreography-host";
import { spectraBus } from "@/features/spectra/events";
import { Rail } from "./rail";

type AppShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  noScroll?: boolean;
  contentClassName?: string;
};

export function AppShell(props: AppShellProps) {
  const ready = useAccountStorageReady();
  return ready ? <AppShellContent {...props} /> : <AccountConnectionState />;
}

function AppShellContent({
  children,
  fullBleed = false,
  noScroll = false,
  contentClassName,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const showTabRail =
    pathname === "/workspace" ||
    pathname.startsWith("/workspace/") ||
    pathname === "/library" ||
    pathname.startsWith("/library/");

  useLayoutEffect(() => {
    // The persisted work session is deliberately restored after mount. This
    // keeps SSR and the first client tree identical while still restoring tabs
    // before the browser paints the settled shell.
    void useSpectraContextStore.persist.rehydrate();
  }, []);

  /* The stage starts where the rail ends: both read --spectra-rail-width
     (spectra-field.css), so they agree before and after hydration. */
  return (
    <div
      onClickCapture={captureSpectraNavigation}
      style={{
        minHeight: "100dvh",
        ...(noScroll ? { height: "100dvh", overflow: "hidden" } : {}),
      }}
      className="spectra-app-shell min-h-dvh pl-[var(--spectra-rail-width,232px)] text-[var(--text-primary)] transition-[padding] duration-[var(--motion-base)] ease-standard"
    >
      <KeyboardShortcutsRegistrar
        onNewChat={() => spectraBus.emit("island.compose", { fresh: true })}
        onOpenSettings={() => router.push("/settings")}
        onFocusComposer={() => spectraBus.emit("island.compose", {})}
        onFocusSearch={() => spectraBus.emit("threads.open", {})}
      />
      <KeyboardShortcutsHelp />
      <SignedInContinue />
      <UniversalKBar />
      <Rail />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "relative flex h-dvh min-h-0 flex-col",
          noScroll && "overflow-hidden",
        )}
      >
        {showTabRail ? (
          <header className="spectra-shell-tab-header flex h-[44px] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
            <div
              className="flex min-w-0 flex-1 items-center overflow-hidden"
              id="spectra-shell-tab-slot"
            />
          </header>
        ) : (
          <div id="spectra-shell-tab-slot" className="hidden" />
        )}
        <ProductOfflineBanner />
        <AppChoreographyMount />
        <ViewportReadinessMount />
        <div
          style={{ minHeight: 0 }}
          className={cn(
            "spectra-global-stage flex min-h-0 flex-1 overflow-hidden",
            !fullBleed && "px-8 py-6",
            contentClassName,
          )}
        >
          <div className="relative min-h-0 min-w-0 flex-1" data-spectra-app-surface="true">
            {children}
          </div>
          <RouteSidePanelHost />
          <ViewportReferencePicker />
        </div>
        <ThreadsViewHost />
        <IslandHost />
      </main>
    </div>
  );
}
