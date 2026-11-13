"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAccountStorageReady } from "../account-storage-boundary";
import { AccountConnectionState } from "../account-connection-state";
import { AccountGate } from "../account-gate";
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
import { BridgeConnection, BridgeDiscoveryMount } from "@/features/spectra/bridge/bridge-discovery-mount";
import { LivePulseMount } from "@/features/spectra/threads/live-pulse-mount";
import { TourMount } from "@/features/spectra/onboarding/tour";
import { SchoolSetupMount } from "@/features/spectra/school/school-setup-mount";
import { useStartPage } from "@/features/spectra/settings/use-start-page";
import { FirstTipsMount } from "@/features/spectra/onboarding/first-tips";
import { SetupMount } from "@/features/spectra/onboarding/setup";
import { AppChoreographyMount } from "@/features/spectra/collaboration/app-choreography-host";
import { spectraBus } from "@/features/spectra/events";
import { Rail, rememberLibraryPlace } from "./rail";

const under = (pathname: string, roots: readonly string[]) =>
  roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

/** Pages that manage their own scrolling. */
const FIXED_PAGES = ["/agents", "/calendar", "/home", "/library", "/workspace"];
/** Pages that keep open works as tabs. */
const TABBED_PAGES = ["/library", "/workspace"];

export function AppShell({ children }: { children: ReactNode }) {
  const ready = useAccountStorageReady();
  return ready ? (
    <AccountGate bare={<main id="main-content" className="min-h-dvh overflow-y-auto bg-[var(--bg-primary)]">{children}</main>}>
      <AppShellContent>{children}</AppShellContent>
    </AccountGate>
  ) : (
    <AccountConnectionState />
  );
}

function AppShellContent({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const noScroll = under(pathname, FIXED_PAGES);
  const workTabs = under(pathname, TABBED_PAGES);
  useStartPage();

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
      onClickCapture={(event) => {
        rememberLibraryPlace();
        captureSpectraNavigation(event);
      }}
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
        <BridgeConnection />
        <LivePulseMount />
        <AppChoreographyMount />
        <ViewportReadinessMount />
        <div style={{ minHeight: 0 }} className="spectra-global-stage flex min-h-0 flex-1 overflow-hidden">
          <div className="relative min-h-0 min-w-0 flex-1" data-spectra-app-surface="true">
            {children}
          </div>
          <RouteSidePanelHost />
          <ViewportReferencePicker />
        </div>
        <IslandHost />
        <SchoolSetupMount />
        <TourMount />
        <FirstTipsMount />
        <SetupMount />
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
