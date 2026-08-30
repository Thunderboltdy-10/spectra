"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Cable,
  Cloud,
  FileText,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BridgeSettings } from "../../bridge/bridge-settings";
import {
  getProviderDescriptor,
  presentConnectionHealth,
  type ConnectionAuthKind,
  type ConnectionStatus,
  type ConnectorFamily,
} from "../../connectors/core";

type ConnectionRow = {
  connectionId: string;
  scopeKind: "account" | "school";
  provider: string;
  providerAccountId?: string;
  displayLabel?: string;
  family: ConnectorFamily;
  authKind: ConnectionAuthKind;
  status: ConnectionStatus;
  grantedScopes: string[];
  errorCode?: string;
  retryAt?: number;
  expiresAt?: number;
  lastHealthAt?: number;
  connectedAt?: number;
  revokedAt?: number;
  remoteRevocationConfirmed?: boolean;
  updatedAt: number;
};

type ConnectionsOverview = {
  connections: ConnectionRow[];
  bridge: {
    devices: Array<{
      deviceId: string;
      name: string;
      platform: string;
      appVersion: string;
      protocolVersion: string;
      pairedAt: number;
      lastSeenAt: number;
      mountCount: number;
    }>;
    mountCount: number;
  };
  manageBac: null | {
    configured: boolean;
    status: ConnectionStatus;
    errorCode?: string;
    lastHealthAt?: number;
    connectedAt?: number;
    updatedAt?: number;
    canManage: boolean;
  };
};

const ICONS: Record<
  "device" | "school" | "cloud" | "calendar" | "file",
  LucideIcon
> = {
  device: Cable,
  school: GraduationCap,
  cloud: Cloud,
  calendar: CalendarDays,
  file: FileText,
};

function connectionTime(value?: number) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function ConnectionSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <header className="pt-2">
        <h2 className="font-display text-subhead font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">
          {description}
        </p>
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ConnectionCard({
  name,
  description,
  icon: Icon,
  status,
  errorCode,
  retryAt,
  lastHealthAt,
  detail,
  actions,
}: {
  name: string;
  description: string;
  icon: LucideIcon;
  status: ConnectionStatus;
  errorCode?: string;
  retryAt?: number;
  lastHealthAt?: number;
  detail?: string;
  actions?: ReactNode;
}) {
  const health = presentConnectionHealth({ status, errorCode, retryAt });
  const checked = connectionTime(lastHealthAt);
  return (
    <article className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-control bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
          <Icon aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-caption font-semibold text-[var(--text-primary)]">
                {name}
              </h3>
              <p className="mt-0.5 text-micro leading-5 text-[var(--text-secondary)]">
                {description}
              </p>
            </div>
            <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
          </div>
          <p className="mt-3 text-micro leading-5 text-[var(--text-secondary)]">
            {health.sentence}
          </p>
          {detail ? (
            <p className="mt-1 text-micro leading-5 text-[var(--text-tertiary)]">
              {detail}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-micro text-[var(--text-tertiary)]">
              {checked ? `Last checked ${checked}` : "Not checked yet"}
            </span>
            {actions ? (
              <div className="flex items-center gap-2">{actions}</div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function OAuthConnectionCard({
  connection,
  onRevoke,
}: {
  connection: ConnectionRow;
  onRevoke: (connection: ConnectionRow) => void;
}) {
  const descriptor = getProviderDescriptor(connection.provider);
  const icon = descriptor ? ICONS[descriptor.display.icon] : Cloud;
  const health = presentConnectionHealth({
    status: connection.status,
    errorCode: connection.errorCode,
    retryAt: connection.retryAt,
  });
  const reconnectUrl = `/api/spectra/connectors/${connection.provider}/authorize`;
  return (
    <ConnectionCard
      name={
        connection.displayLabel ??
        descriptor?.display.name ??
        connection.provider
      }
      description={
        descriptor?.display.description ??
        "A provider connection available to this account."
      }
      icon={icon}
      status={connection.status}
      errorCode={connection.errorCode}
      retryAt={connection.retryAt}
      lastHealthAt={connection.lastHealthAt}
      detail={
        connection.grantedScopes.length
          ? `${connection.grantedScopes.length} provider permission${connection.grantedScopes.length === 1 ? "" : "s"} granted.`
          : "No provider permissions are recorded."
      }
      actions={
        <>
          {health.action !== "none" && descriptor?.auth.kind === "oauth" ? (
            <Button asChild size="sm" variant="secondary">
              <a href={reconnectUrl}>Reconnect</a>
            </Button>
          ) : null}
          {connection.status !== "revoked" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRevoke(connection)}
            >
              Disconnect
            </Button>
          ) : null}
        </>
      }
    />
  );
}

export function ConnectionsHub() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const overview = useQuery(
    api.connections.overview,
    isAuthenticated ? {} : "skip",
  ) as ConnectionsOverview | null | undefined;
  const [pendingRevoke, setPendingRevoke] = useState<ConnectionRow | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("connection");
    if (result === "connected") toast.success("Connection added.");
    if (result === "error")
      toast.error("The connection could not be completed. Try again.");
    if (result) {
      url.searchParams.delete("connection");
      url.searchParams.delete("provider");
      url.searchParams.delete("reason");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  const providerConnections = useMemo(
    () =>
      (overview?.connections ?? []).filter(
        (connection) =>
          connection.provider !== "managebac" &&
          connection.provider !== "spectra-bridge",
      ),
    [overview?.connections],
  );

  async function revokeConnection() {
    if (!pendingRevoke) return;
    setRevoking(true);
    setActionError(undefined);
    try {
      const response = await fetch(
        `/api/spectra/connectors/${pendingRevoke.provider}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId: pendingRevoke.connectionId }),
        },
      );
      if (!response.ok)
        throw new Error("The provider could not be disconnected.");
      setPendingRevoke(null);
      toast.success("Connection disconnected.");
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The provider could not be disconnected.",
      );
    } finally {
      setRevoking(false);
    }
  }

  if (isLoading || (isAuthenticated && overview === undefined)) {
    return (
      <div className="grid gap-3" aria-label="Loading connections">
        <Skeleton className="h-28 w-full rounded-card" />
        <Skeleton className="h-28 w-full rounded-card" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <p
        className="py-6 text-caption text-[var(--text-secondary)]"
        role="status"
      >
        Sign in to manage connections. Files already on this PC stay unchanged.
      </p>
    );
  }

  return (
    <div className="grid gap-8">
      <BridgeSettings />
      <ConnectionSection
        title="School and cloud connections"
        description="Provider access stays separate by account or school. Spectra never stores tokens on a connection row."
      >
        {overview?.manageBac ? (
          <ConnectionCard
            name="ManageBac"
            description="School-managed access to classes, deadlines, timetable data, and CAS records."
            icon={GraduationCap}
            status={overview.manageBac.status}
            errorCode={overview.manageBac.errorCode}
            lastHealthAt={overview.manageBac.lastHealthAt}
            detail={
              overview.manageBac.canManage
                ? "Your school administrator role can manage this connection."
                : "This connection is managed by a school administrator."
            }
            actions={
              <Button asChild size="sm" variant="secondary">
                <a href="/managebac">
                  {overview.manageBac.canManage ? "Manage" : "View"}
                </a>
              </Button>
            }
          />
        ) : null}
        {providerConnections.map((connection) => (
          <OAuthConnectionCard
            key={connection.connectionId}
            connection={connection}
            onRevoke={setPendingRevoke}
          />
        ))}
        {overview && !overview.manageBac && providerConnections.length === 0 ? (
          <div className="rounded-card border border-dashed border-[var(--border-default)] p-5 text-caption text-[var(--text-secondary)]">
            No school or cloud connections are available for this account yet.
          </div>
        ) : null}
        {actionError ? (
          <p className="text-micro text-[var(--danger)]" role="alert">
            {actionError}
          </p>
        ) : null}
      </ConnectionSection>
      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && !revoking && setPendingRevoke(null)}
      >
        <DialogContent layer="modal" className="max-w-[460px]">
          <DialogTitle>Disconnect this provider?</DialogTitle>
          <DialogDescription className="mt-1.5">
            Spectra will remove its stored access token and stop using this
            connection. Your work in the provider stays unchanged.
          </DialogDescription>
          <DialogFooter className="mt-5">
            <Button
              variant="ghost"
              disabled={revoking}
              onClick={() => setPendingRevoke(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revoking}
              onClick={() => void revokeConnection()}
            >
              {revoking ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
