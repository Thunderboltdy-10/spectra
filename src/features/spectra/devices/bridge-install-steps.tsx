import type { BridgePlatform } from "../bridge/client";

/*
 * What happens after the download, in order. Said wherever Bridge is fetched
 * (Devices, the pairing card, setup), because the browser's permission
 * question is easy to dismiss and nothing works without it.
 */
export function BridgeInstallSteps({ platform }: { platform: BridgePlatform }) {
  const mac = platform === "macos";
  return (
    <ol className="bridge-install-steps">
      <li>
        <strong>Open the file you downloaded</strong>
        <span>{mac ? "Drag Spectra Bridge into Applications, then open it." : "It installs and opens Spectra Bridge in a few seconds."}</span>
      </li>
      <li>
        <strong>Allow the browser to talk to it</strong>
        <span>Your browser asks to let this page reach apps on this device. Choose Allow, or Spectra can&apos;t see Bridge.</span>
      </li>
      <li>
        <strong>That&apos;s it from then on</strong>
        <span>Bridge starts by itself whenever this computer turns on, and updates itself.</span>
      </li>
    </ol>
  );
}
