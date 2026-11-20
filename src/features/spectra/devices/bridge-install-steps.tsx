import type { BridgePlatform } from "../bridge/client";

/*
 * What happens after the download, in order. Said wherever Spectra for desktop is fetched
 * (Devices, the pairing card, setup), because the browser's permission
 * question is easy to dismiss and nothing works without it.
 */
export function BridgeInstallSteps({ platform }: { platform: BridgePlatform }) {
  const mac = platform === "macos";
  return (
    <ol className="bridge-install-steps">
      <li>
        <strong>Open the file you downloaded</strong>
        <span>{mac ? "Drag Spectra into Applications, then open it." : "It installs and opens Spectra in a few seconds."}</span>
      </li>
      <li>
        <strong>Allow the browser to talk to it</strong>
        <span>Your browser asks to let this page reach apps on this device. Choose Allow, or this page can&apos;t reach the app.</span>
      </li>
      <li>
        <strong>That&apos;s it from then on</strong>
        <span>Spectra starts by itself whenever this computer turns on, keeps Bridge syncing in the background, and updates itself.</span>
      </li>
    </ol>
  );
}

/**
 * A browser can't tell an Intel Mac from an Apple silicon one, so the Mac
 * download is the Apple silicon build and Intel Macs get theirs here.
 */
export function IntelMacLink({ href, platform }: { href: string | null | undefined; platform: BridgePlatform }) {
  if (platform !== "macos" || !href) return null;
  return (
    <a className="text-caption text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]" href={`${href}?arch=x64`} rel="noopener">
      Intel Mac?
    </a>
  );
}
