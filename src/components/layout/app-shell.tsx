"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { useAccountStorageReady } from "../account-storage-boundary";
import { AccountConnectionState } from "../account-connection-state";
import { captureSpectraNavigation, useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { SignedInContinue } from "@/components/signed-in-continue";
import { UniversalKBar } from "@/features/spectra/components/universal-kbar";
import { ViewportReadinessMount } from "@/features/spectra/components/viewport-readiness-mount";
import { cn } from "@/lib/utils";
import { KeyboardShortcutsHelp, KeyboardShortcutsRegistrar } from "@/components/keyboard-shortcuts";
import { RouteSidePanelHost } from "@/features/spectra/components/route-side-panel-host";
import { ViewportReferencePicker } from "@/features/spectra/components/viewport-reference-picker";
import { IslandHost } from "@/features/spectra/island/island-host";
import { spectraObjectKey, useSpectraContextStore } from "@/stores/spectra-context-store";
import { artifactIdFromSpectraLocation } from "@/features/spectra/pages/shell-location";
import { ProductOfflineBanner } from "@/features/spectra/bridge/product-offline-banner";
import { BridgeDiscoveryMount } from "@/features/spectra/bridge/bridge-discovery-mount";
import { LivePulseMount } from "@/features/spectra/threads/live-pulse-mount";
import { TourMount } from "@/features/spectra/onboarding/tour";
import { FirstTipsMount } from "@/features/spectra/onboarding/first-tips";
import { AppChoreographyMount } from "@/features/spectra/collaboration/app-choreography-host";
import { spectraBus } from "@/features/spectra/events";
import { Rail } from "./rail";

type AppShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  noScroll?: boolean;
  contentClassName?: string;
  /** The page keeps open works as tabs (the Library and its workspaces). */
  workTabs?: boolean;
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
  workTabs = false,
}: AppShellProps) {
  const router = useRouter();

  useLayoutEffect(() => {
    // The persisted work session is deliberately restored after mount. This
    // keeps SSR and the first client tree identical while still restoring tabs
    // before the browser paints the settled shell.
    void useSpectraContextStore.persist.rehydrate();
    settleRestoredWorkToAddress();
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
          "spectra-sheet relative flex min-h-0 flex-col",
          noScroll && "overflow-hidden",
        )}
      >
        {workTabs ? (
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
        <BridgeDiscoveryMount />
        <LivePulseMount />
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
        <IslandHost />
        <TourMount />
        <FirstTipsMount />
      </main>
    </div>
  );
}

/**
 * The address decides what is in front. A reload or a typed /library brings
 * back the works that were open, as tabs, but the one in front is the one the
 * address names; with none named, the page itself is, not whichever work
 * happened to be in front last time.
 */
function settleRestoredWorkToAddress() {
  const store = useSpectraContextStore.getState();
  const active = store.activeOpenObjectKey;
  if (!active?.startsWith("artifact:")) return;
  const named = artifactIdFromSpectraLocation(window.location.pathname, window.location.search);
  if (active !== (named ? spectraObjectKey({ type: "artifact", id: named }) : undefined))
    store.deactivateObject();
}
