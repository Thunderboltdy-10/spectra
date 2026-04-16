"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CalendarClock, Megaphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TimetableEntry = {
  id: string;
  title: string;
  course?: string;
  room?: string;
  teacher?: string;
  startTime?: string;
  endTime?: string;
};

type CasEntry = {
  id: string;
  title: string;
  strand?: string;
  dueDate?: string;
  status?: string;
};

type AnnouncementEntry = {
  id: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  url?: string;
};

type ManagebacPayload = {
  configured?: boolean;
  available?: boolean;
  resolutionStatus?: string;
  message?: string;
  student?: {
    id?: string;
    name?: string;
    gradeLevel?: string;
    email?: string;
  };
  workstreams?: TimetableEntry[];
  plannerItems?: CasEntry[];
  announcements?: AnnouncementEntry[];
  lastHydratedAt?: number;
  lastHydrationError?: string;
};

function formatDateLabel(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

type TimetableWidgetProps = {
  className?: string;
};

export function TimetableWidget({ className }: TimetableWidgetProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ManagebacPayload | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/managebac${background ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as ManagebacPayload;
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load ManageBac data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const timetableItems = useMemo(() => (data?.workstreams ?? []).slice(0, 4), [data?.workstreams]);
  const casItems = useMemo(() => (data?.plannerItems ?? []).slice(0, 2), [data?.plannerItems]);
  const announcementItems = useMemo(
    () => (data?.announcements ?? []).slice(0, 2),
    [data?.announcements],
  );

  return (
    <section className={cn("rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">ManageBac</p>
          <h2 className="font-display text-xl leading-tight">Timetable Snapshot</h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Live sync for timetable, CAS, and announcements.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => void load(true)}
          disabled={refreshing || loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {!loading && !error && data?.configured === false ? (
        <p className="rounded-xl border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
          {data.message ?? "ManageBac integration is deferred until credentials are configured."}
        </p>
      ) : null}

      {!loading && !error && data?.configured !== false && data?.available === false ? (
        <p className="rounded-xl border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
          {data.message ?? "ManageBac is unavailable for this account."}
        </p>
      ) : null}

      {!loading && !error && data?.configured !== false && data?.available !== false ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <p className="mb-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              <CalendarClock className="h-3.5 w-3.5" />
              Today
            </p>
            <div className="space-y-1.5">
              {timetableItems.length > 0 ? (
                timetableItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2">
                    <p className="text-xs font-medium text-[var(--text-primary)]">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {[formatTime(item.startTime), formatTime(item.endTime)].filter(Boolean).join(" - ") || "Time TBD"}
                      {item.room ? ` · ${item.room}` : ""}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">No timetable entries found.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <p className="mb-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              <BookOpenCheck className="h-3.5 w-3.5" />
              CAS
            </p>
            <div className="space-y-1.5">
              {casItems.length > 0 ? (
                casItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2">
                    <p className="text-xs font-medium text-[var(--text-primary)]">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {[item.status, item.strand, formatDateLabel(item.dueDate)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">No CAS items found.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <p className="mb-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              <Megaphone className="h-3.5 w-3.5" />
              Updates
            </p>
            <div className="space-y-1.5">
              {announcementItems.length > 0 ? (
                announcementItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url || "#"}
                    target={item.url ? "_blank" : undefined}
                    rel={item.url ? "noreferrer" : undefined}
                    className="block rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2 transition hover:bg-[var(--bg-hover)]"
                  >
                    <p className="text-xs font-medium text-[var(--text-primary)]">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {item.summary?.slice(0, 84) || "School announcement"}
                    </p>
                  </a>
                ))
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">No announcements found.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {data?.lastHydrationError ? (
        <p className="mt-3 text-[11px] text-[var(--text-secondary)]">Sync note: {data.lastHydrationError}</p>
      ) : null}
      {data?.lastHydratedAt ? (
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Last update: {new Date(data.lastHydratedAt).toLocaleTimeString()}
        </p>
      ) : null}
    </section>
  );
}
