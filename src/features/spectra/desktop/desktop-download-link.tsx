"use client";

import { useEffect, useState } from "react";
import { bridgeDownloadUrl, bridgePlatform, type BridgePlatform } from "../bridge/client";
import { spectraDesktop } from "./desktop";

/**
 * "Get Spectra for Windows": the installer for the computer this page is open
 * on. Nothing on phones, and nothing inside the app itself.
 */
export function DesktopDownloadLink({ className }: { className?: string }) {
  const [platform, setPlatform] = useState<BridgePlatform | "app">("other");
  useEffect(() => setPlatform(spectraDesktop() ? "app" : bridgePlatform()), []);
  if (platform === "app" || platform === "other") return null;
  const href = bridgeDownloadUrl(platform);
  if (!href) return null;
  return (
    <a className={className} href={href} rel="noopener">
      Get Spectra for {platform === "macos" ? "Mac" : "Windows"}
    </a>
  );
}
