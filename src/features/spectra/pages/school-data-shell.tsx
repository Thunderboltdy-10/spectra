"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  LoaderCircle,
  RefreshCw,
  School,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ClassCandidate = {
  recordId: string;
  title: string;
  program: string;
  grade: string;
  description: string;
  workspaceId: string | null;
  fetchedAt?: number;
};

type MyClassesPayload = {
  integration: { status?: string } | null;
  classes: ClassCandidate[];
  lastSyncAt?: number;
  nextSyncAt?: number;
};

async function postManageBac(body: Record<string, unknown>) {
  const response = await fetch("/api/spectra/managebac", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      "ManageBac action failed.";
    throw new Error(message);
  }
  return payload;
}

export function SchoolDataShell() {
  const [data, setData] = useState<MyClassesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/spectra/managebac?action=myClasses",
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload?.error?.message || "Could not load school data.",
        );
      setData((payload?.data ?? null) as MyClassesPayload | null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load school data.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const classes = useMemo(() => {
    const list = data?.classes ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((item) =>
      [item.title, item.program, item.grade, item.description]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [data?.classes, filter]);

  const selectable = classes.filter((item) => !item.workspaceId);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await action();
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The school-data action failed.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="spectra-wave-y mx-auto flex h-full max-w-[1200px] flex-col gap-5 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)]">
            SCHOOL DATA
          </p>
          <h1 className="mt-1 font-display text-[32px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Your ManageBac classes
          </h1>
          <p className="mt-2 max-w-[640px] text-[13px] leading-5 text-[var(--text-secondary)]">
            Synced class records stay inert until you choose which ones become
            Spectra workspaces. School administrators configure the API on the{" "}
            <Link
              href="/managebac"
              className="font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
            >
              ManageBac setup
            </Link>{" "}
            page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refresh", async () => {
                const payload = await postManageBac({
                  action: "resolveIdentity",
                  bootstrap: true,
                });
                const result = payload?.data ?? payload;
                if (result?.skipped) {
                  if (result.reason === "fresh") {
                    const waitMs = Math.max(
                      0,
                      Number(result.nextEligibleAt ?? 0) - Date.now(),
                    );
                    const mins = Math.ceil(waitMs / 60_000);
                    throw new Error(
                      mins > 0
                        ? `Sync cooldown active. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`
                        : "Sync cooldown active. Try again shortly.",
                    );
                  }
                  if (result.reason === "already_running")
                    throw new Error("A ManageBac sync is already running.");
                  if (result.reason === "not_connected")
                    throw new Error(
                      "ManageBac is not connected for this school yet.",
                    );
                  if (result.reason === "identity_required")
                    throw new Error(
                      "Resolve your ManageBac identity on the setup page before syncing personal data.",
                    );
                }
              })
            }
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border-default)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {busy === "refresh" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sync now
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || selected.size === 0}
            onClick={() =>
              void run("create", async () => {
                await postManageBac({
                  action: "materializeClasses",
                  recordIds: [...selected],
                });
                setSelected(new Set());
              })
            }
            className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-3 text-[12px] font-semibold text-[var(--bg-primary)] disabled:opacity-40"
          >
            {busy === "create" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" />
            )}
            Create {selected.size || ""} workspace
            {selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-[9px] border border-[color-mix(in_oklab,var(--danger)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-elevated))] px-4 py-3 text-[12px] text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <section className="grid gap-3 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Connection
          </p>
          <p className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
            {data?.integration?.status ?? "not connected"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Classes available
          </p>
          <p className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
            {data?.classes?.length ?? 0}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Already created
          </p>
          <p className="mt-1 text-[14px] font-semibold text-[var(--text-primary)]">
            {(data?.classes ?? []).filter((item) => item.workspaceId).length}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter classes…"
          className="h-9 min-w-[220px] flex-1 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] outline-none focus:border-[var(--brand-primary)]"
        />
        <button
          type="button"
          className="h-9 rounded-[8px] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          onClick={() =>
            setSelected(new Set(selectable.map((item) => item.recordId)))
          }
        >
          Select available
        </button>
        <button
          type="button"
          className="h-9 rounded-[8px] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          onClick={() => setSelected(new Set())}
        >
          Clear
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("purge", async () => {
              await postManageBac({
                action: "purgeAutoClassWorkspaces",
                confirmation: "Remove auto-created ManageBac workspaces",
              });
            })
          }
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--danger)_30%,var(--border-default))] px-3 text-[12px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-elevated))] disabled:opacity-50"
        >
          {busy === "purge" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Remove auto-created workspaces
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-[12px] border border-[var(--border-default)]">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center text-[12px] text-[var(--text-tertiary)]">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            Loading class records…
          </div>
        ) : !data?.integration ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center">
            <School className="h-5 w-5 text-[var(--text-tertiary)]" />
            <p className="text-[13px] font-medium text-[var(--text-primary)]">
              ManageBac is not connected for this school yet
            </p>
            <p className="max-w-sm text-[12px] text-[var(--text-secondary)]">
              Ask a school administrator to connect the school-wide API key on
              the setup page, then refresh here.
            </p>
          </div>
        ) : classes.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-[12px] text-[var(--text-tertiary)]">
            No class records are available yet. Trigger a refresh after the
            school connection syncs.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {classes.map((item) => {
              const checked = selected.has(item.recordId);
              const created = Boolean(item.workspaceId);
              return (
                <li key={item.recordId}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[var(--bg-hover)]",
                      created && "cursor-default opacity-70",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={created}
                      checked={created || checked}
                      onChange={() => {
                        if (created) return;
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(item.recordId)) next.delete(item.recordId);
                          else next.add(item.recordId);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--text-tertiary)]">
                        {[item.program, item.grade].filter(Boolean).join(" · ") ||
                          "Class record"}
                        {created ? " · workspace created" : ""}
                      </span>
                      {item.description ? (
                        <span className="mt-1 line-clamp-2 block text-[11px] text-[var(--text-secondary)]">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
