"use client";

import { useState, useEffect } from "react";
import { Wifi, WifiOff, Shield, AlertCircle } from "lucide-react";

export function ConnectionStatus() {
  const [status, setStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch("/api/bootstrap", { 
          method: "HEAD",
          cache: "no-store"
        });
        setStatus(response.ok ? "connected" : "disconnected");
      } catch {
        setStatus("disconnected");
      }
      setLastChecked(new Date());
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000); // Check every 30s

    return () => clearInterval(interval);
  }, []);

  if (status === "checking") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--text-secondary)]" />
        <span>Connecting...</span>
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
        <WifiOff className="h-3.5 w-3.5" />
        <span>Offline</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--success)]" title={`Last checked: ${lastChecked.toLocaleTimeString()}`}>
      <Wifi className="h-3.5 w-3.5" />
      <span>Online</span>
    </div>
  );
}

export function EnvironmentBadge() {
  const isLocal = !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  
  if (!isLocal) return null;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--warning)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_10%,var(--bg-secondary))] px-2.5 py-1 text-[11px] font-medium text-[var(--warning)]">
      <Shield className="h-3 w-3" />
      <span>Demo Mode</span>
    </div>
  );
}

export function ErrorToast({ code, message, requestId }: { code: string; message: string; requestId?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[color-mix(in_oklab,var(--danger)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-secondary))] p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{message}</p>
          {requestId && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {expanded ? "Hide" : "Show"} details
            </button>
          )}
          {expanded && requestId && (
            <div className="mt-2 rounded border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 font-mono text-[10px] text-[var(--text-secondary)]">
              <div>Code: {code}</div>
              <div>Request ID: {requestId}</div>
              <div className="mt-1 text-[var(--text-secondary)] opacity-70">
                Share this ID with support for debugging
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
