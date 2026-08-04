"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArchiveX,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Feather,
  FileClock,
  Filter,
  Globe2,
  History,
  LoaderCircle,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  School,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommandBar } from "@/features/spectra/components/command-bar";
import {
  clearSpectraMemory,
  correctSpectraMemory,
  disputeSpectraMemory,
  exportSpectraMemory,
  forgetSpectraMemory,
  getSpectraMemory,
  getSpectraWorkspaces,
  rememberSpectraMemory,
  updateSpectraMemoryPreferences,
  type SpectraMemoryCategories,
  type SpectraMemoryClaim,
  type SpectraMemoryClaimType,
  type SpectraMemoryPreferences,
  type SpectraMemoryScope,
  type SpectraWorkspace,
} from "@/features/spectra/data/api";

type StatusFilter = "current" | SpectraMemoryClaim["status"];

const categoryOptions: Array<{
  key: keyof SpectraMemoryCategories;
  label: string;
  description: string;
  claimTypes: SpectraMemoryClaimType[];
}> = [
  {
    key: "declaredFacts",
    label: "Facts you share",
    description: "Stable details you explicitly ask Spectra to retain.",
    claimTypes: ["declared_fact", "correction"],
  },
  {
    key: "preferences",
    label: "Preferences",
    description:
      "How you like information, artifacts, and collaboration handled.",
    claimTypes: ["inferred_preference"],
  },
  {
    key: "decisions",
    label: "Decisions",
    description: "Durable choices that should shape later work.",
    claimTypes: ["decision"],
  },
  {
    key: "workflows",
    label: "Ways of working",
    description: "Repeated workflows and mistakes Spectra should avoid.",
    claimTypes: ["recurring_workflow", "mistake_avoidance"],
  },
  {
    key: "commitments",
    label: "Commitments",
    description: "Long-lived commitments and deadlines you state.",
    claimTypes: ["commitment"],
  },
  {
    key: "learningSignals",
    label: "Learning signals",
    description: "Useful, non-sensitive expertise and learning patterns.",
    claimTypes: ["learning_signal"],
  },
  {
    key: "relationships",
    label: "Visible relationships",
    description:
      "People and resources already visible within your permission scope.",
    claimTypes: ["relationship"],
  },
  {
    key: "workspaceConventions",
    label: "Workspace conventions",
    description: "Shared ways of working for workspaces you can modify.",
    claimTypes: ["workspace_convention"],
  },
];

const claimTypeLabels: Record<SpectraMemoryClaimType, string> = {
  declared_fact: "Fact you shared",
  inferred_preference: "Preference",
  correction: "Correction",
  decision: "Decision",
  recurring_workflow: "Way of working",
  commitment: "Commitment",
  mistake_avoidance: "Avoid next time",
  learning_signal: "Learning signal",
  relationship: "Relationship",
  workspace_convention: "Workspace convention",
};

const scopeLabels: Record<SpectraMemoryScope, string> = {
  private_global: "Private across Spectra",
  private_school: "Private in this school",
  workspace: "Workspace convention",
  shared_artifact: "Artifact convention",
  system: "Product preference",
};

function relativeDate(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function ScopeIcon({
  scope,
  size,
}: {
  scope: SpectraMemoryScope;
  size: number;
}) {
  if (scope === "private_global" || scope === "system")
    return <Globe2 size={size} />;
  if (scope === "private_school") return <School size={size} />;
  if (scope === "workspace") return <Users size={size} />;
  return <ShieldCheck size={size} />;
}

function downloadJson(value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `spectra-memory-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
        checked
          ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]"
          : "border-[var(--border-default)] bg-[var(--bg-secondary)]",
        disabled && "cursor-not-allowed opacity-45",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 grid size-5 place-items-center rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[19px]" : "translate-x-0.5",
        )}
      >
        {checked ? (
          <Check className="size-3 text-[var(--brand-primary)]" />
        ) : null}
      </span>
    </button>
  );
}

function MemoryCard({
  claim,
  busy,
  onCorrect,
  onDispute,
  onForget,
}: {
  claim: SpectraMemoryClaim;
  busy: string | null;
  onCorrect: (claim: SpectraMemoryClaim, proposition: string) => Promise<void>;
  onDispute: (claim: SpectraMemoryClaim) => Promise<void>;
  onForget: (claim: SpectraMemoryClaim) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(claim.proposition);
  const activeBusy = busy === claim._id;
  const confidence =
    claim.assertion === "asserted"
      ? "You told Spectra"
      : claim.confidence >= 0.86
        ? "High confidence"
        : claim.confidence >= 0.65
          ? "Medium confidence"
          : "Needs confirmation";

  return (
    <article
      className={cn(
        "group rounded-[18px] border bg-[var(--bg-elevated)] transition-[border-color,box-shadow,transform]",
        open
          ? "border-[color-mix(in_oklab,var(--brand-primary)_38%,var(--border-default))] shadow-[0_16px_45px_-32px_rgba(44,96,142,.48)]"
          : "border-[var(--border-subtle)] hover:-translate-y-px hover:border-[var(--border-default)] hover:shadow-[0_12px_35px_-30px_rgba(22,31,44,.45)]",
        claim.status === "disputed" &&
          "border-[color-mix(in_oklab,var(--warning)_36%,var(--border-default))]",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[12px] bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-secondary))] text-[var(--brand-primary)]">
          <Feather size={16} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span className="font-semibold text-[var(--text-secondary)]">
              {claimTypeLabels[claim.claimType]}
            </span>
            <span aria-hidden="true">·</span>
            <span>{relativeDate(claim.updatedAt)}</span>
            {claim.status !== "active" ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-semibold",
                  claim.status === "disputed"
                    ? "bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[var(--warning)]"
                    : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
                )}
              >
                {claim.status.replaceAll("_", " ")}
              </span>
            ) : null}
          </span>
          <span className="block text-[14px] font-medium leading-6 text-[var(--text-primary)]">
            {claim.proposition}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-3 text-micro text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <ScopeIcon scope={claim.scope} size={12} />
              {scopeLabels[claim.scope]}
            </span>
            <span>{confidence}</span>
          </span>
        </span>
        {open ? (
          <ChevronDown className="mt-2 size-4 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="mt-2 size-4 shrink-0 text-[var(--text-tertiary)]" />
        )}
      </button>

      {open ? (
        <div className="border-t border-[var(--border-subtle)] px-5 pb-5 pt-4">
          {editing ? (
            <div>
              <label
                htmlFor={`memory-${claim._id}`}
                className="mb-2 block text-[12px] font-semibold text-[var(--text-secondary)]"
              >
                What should Spectra remember instead?
              </label>
              <textarea
                id={`memory-${claim._id}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-y rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3.5 py-3 text-[13px] leading-5 text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand-primary)_14%,transparent)]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(claim.proposition);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={
                    activeBusy ||
                    draft.trim().length < 12 ||
                    draft.trim() === claim.proposition
                  }
                  onClick={() =>
                    void onCorrect(claim, draft.trim()).then(() =>
                      setEditing(false),
                    )
                  }
                >
                  Save correction
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
                    Why this is remembered
                  </h3>
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]">
                    {claim.evidence[0]?.captureReason ??
                      "This was retained from a high-confidence signal you can control."}
                  </p>
                </div>
                <div>
                  <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
                    Scope and confidence
                  </h3>
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]">
                    {scopeLabels[claim.scope]}. {confidence}. It cannot grant
                    access to its original source.
                  </p>
                </div>
              </div>

              {claim.evidence.length > 0 ? (
                <div className="mt-4 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-primary)]">
                    <FileClock
                      size={14}
                      className="text-[var(--brand-primary)]"
                    />
                    Evidence
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {claim.evidence.slice(0, 3).map((evidence) => (
                      <div
                        key={evidence._id}
                        className="flex items-start justify-between gap-4 text-micro leading-4 text-[var(--text-tertiary)]"
                      >
                        <span>
                          {evidence.sourceType.replaceAll("_", " ")}
                          {evidence.excerptPreview
                            ? ` · “${evidence.excerptPreview}”`
                            : ""}
                        </span>
                        <span className="shrink-0">
                          {relativeDate(evidence.observedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={activeBusy}
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={13} />
                  Correct
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={activeBusy}
                  onClick={() => void onDispute(claim)}
                >
                  <CircleHelp size={13} />
                  {claim.status === "disputed" ? "Mark accurate" : "Dispute"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={activeBusy}
                  className="text-[var(--danger)] hover:text-[var(--danger)]"
                  onClick={() => void onForget(claim)}
                >
                  <Trash2 size={13} />
                  Forget
                </Button>
                {activeBusy ? (
                  <LoaderCircle className="ml-1 size-4 animate-spin text-[var(--text-tertiary)]" />
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function AddMemoryPanel({
  workspaces,
  onClose,
  onCreated,
}: {
  workspaces: SpectraWorkspace[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [proposition, setProposition] = useState("");
  const [claimType, setClaimType] =
    useState<SpectraMemoryClaimType>("declared_fact");
  const [scope, setScope] = useState<SpectraMemoryScope>("private_global");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?._id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await rememberSpectraMemory({
        proposition: proposition.trim(),
        claimType: scope === "workspace" ? "workspace_convention" : claimType,
        scope,
        workspaceId: scope === "workspace" ? workspaceId : undefined,
      });
      await onCreated();
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Memory could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[96] grid place-items-center bg-[rgba(18,27,38,.28)] p-4 backdrop-blur-[2px]">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close memory editor"
      />
      <section className="relative w-full max-w-[590px] rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_30px_90px_-35px_rgba(14,28,46,.55)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[22px] font-semibold text-[var(--text-primary)]">
              Add a memory
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
              Add something durable and useful. Spectra will keep its source,
              scope, and your controls attached.
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} />
          </Button>
        </div>

        <label className="mt-5 block text-[12px] font-semibold text-[var(--text-primary)]">
          What should Spectra remember?
          <textarea
            value={proposition}
            onChange={(event) => setProposition(event.target.value)}
            rows={4}
            placeholder="For example: I prefer concise feedback that starts with the most important change."
            className="mt-2 w-full resize-y rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3.5 py-3 text-[13px] font-normal leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand-primary)_14%,transparent)]"
          />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-[var(--text-primary)]">
            Scope
            <span className="relative mt-2 block">
              <select
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value as SpectraMemoryScope)
                }
                className="h-10 w-full appearance-none rounded-[11px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 pr-9 text-[12px] font-normal text-[var(--text-primary)] outline-none"
              >
                <option value="private_global">Private across Spectra</option>
                <option value="private_school">Private in this school</option>
                <option value="workspace">Workspace convention</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            </span>
          </label>

          {scope === "workspace" ? (
            <label className="text-[12px] font-semibold text-[var(--text-primary)]">
              Workspace
              <span className="relative mt-2 block">
                <select
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  className="h-10 w-full appearance-none rounded-[11px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 pr-9 text-[12px] font-normal text-[var(--text-primary)] outline-none"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace._id} value={workspace._id}>
                      {workspace.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              </span>
            </label>
          ) : (
            <label className="text-[12px] font-semibold text-[var(--text-primary)]">
              Category
              <span className="relative mt-2 block">
                <select
                  value={claimType}
                  onChange={(event) =>
                    setClaimType(event.target.value as SpectraMemoryClaimType)
                  }
                  className="h-10 w-full appearance-none rounded-[11px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 pr-9 text-[12px] font-normal text-[var(--text-primary)] outline-none"
                >
                  {Object.entries(claimTypeLabels)
                    .filter(([key]) => key !== "workspace_convention")
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              </span>
            </label>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-[12px] bg-[color-mix(in_oklab,var(--brand-primary)_7%,var(--bg-primary))] px-3.5 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--brand-primary)]" />
          This memory remains permission-bound. It cannot expose a source you
          can no longer access, and school-scoped information does not travel to
          another school.
        </div>

        {error ? (
          <p className="mt-3 text-[11px] text-[var(--danger)]">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              proposition.trim().length < 12 ||
              (scope === "workspace" && !workspaceId)
            }
            onClick={() => void submit()}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus size={15} />
            )}
            Remember
          </Button>
        </div>
      </section>
    </div>
  );
}

export function MemoryShell() {
  const router = useRouter();
  const [preferences, setPreferences] =
    useState<SpectraMemoryPreferences | null>(null);
  const [claims, setClaims] = useState<SpectraMemoryClaim[]>([]);
  const [workspaces, setWorkspaces] = useState<SpectraWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("current");
  const [scope, setScope] = useState<SpectraMemoryScope | "all">("all");
  const [category, setCategory] = useState<
    keyof SpectraMemoryCategories | "all"
  >("all");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [memory, nextWorkspaces] = await Promise.all([
        getSpectraMemory({ limit: 200 }),
        getSpectraWorkspaces(),
      ]);
      setPreferences(memory.preferences);
      setClaims(memory.claims);
      setWorkspaces(
        nextWorkspaces.filter((workspace) => workspace.status === "active"),
      );
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Memory could not be loaded.",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const categoryTypes =
      category === "all"
        ? null
        : categoryOptions.find((option) => option.key === category)?.claimTypes;
    return claims.filter((claim) => {
      if (
        status === "current"
          ? !["active", "proposed", "disputed"].includes(claim.status)
          : claim.status !== status
      )
        return false;
      if (scope !== "all" && claim.scope !== scope) return false;
      if (categoryTypes && !categoryTypes.includes(claim.claimType))
        return false;
      return (
        !needle ||
        claim.proposition.toLowerCase().includes(needle) ||
        claimTypeLabels[claim.claimType].toLowerCase().includes(needle)
      );
    });
  }, [category, claims, scope, search, status]);

  const counts = useMemo(
    () => ({
      current: claims.filter((claim) =>
        ["active", "proposed", "disputed"].includes(claim.status),
      ).length,
      disputed: claims.filter((claim) => claim.status === "disputed").length,
      history: claims.filter((claim) =>
        ["superseded", "expired"].includes(claim.status),
      ).length,
    }),
    [claims],
  );

  async function patchPreferences(
    patch: Partial<
      Pick<
        SpectraMemoryPreferences,
        "enabled" | "capturePaused" | "categoryControls" | "capsuleTargetTokens"
      >
    >,
  ) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, ...patch });
    try {
      const next = await updateSpectraMemoryPreferences(patch);
      setPreferences(next);
    } catch (error) {
      setPreferences(previous);
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Memory preferences could not be updated.",
      });
    }
  }

  async function mutateClaim(
    claim: SpectraMemoryClaim,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(claim._id);
    try {
      await action();
      await load(true);
      setNotice({ kind: "success", text: success });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The memory could not be updated.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function exportMemory() {
    setBusy("export");
    try {
      downloadJson(await exportSpectraMemory());
      setNotice({
        kind: "success",
        text: "Your private memory export is ready.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Memory could not be exported.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    setBusy("clear");
    try {
      const result = await clearSpectraMemory(clearText);
      setClearOpen(false);
      setClearText("");
      await load(true);
      setNotice({
        kind: "success",
        text: `${result.forgottenCount} ${result.forgottenCount === 1 ? "memory was" : "memories were"} removed from retrieval.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Memory could not be cleared.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="spectra-wave-y min-h-dvh bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_90%,var(--bg-primary))]">
        <div className="flex flex-col gap-5 px-6 py-7 sm:px-9 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-[12px] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-secondary))] text-[var(--brand-primary)]">
                <Brain size={20} strokeWidth={1.75} />
              </span>
              <h1 className="font-display text-[32px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                Memory & personalization
              </h1>
            </div>
            <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
              Spectra remembers a small set of useful, permission-bound details
              so work can continue naturally. You can inspect, correct, pause,
              export, or forget any of them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void exportMemory()}
              disabled={busy === "export"}
            >
              {busy === "export" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Export
            </Button>
            <Button
              variant="secondary"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-expanded={settingsOpen}
            >
              <Filter size={15} />
              Controls
            </Button>
            <Button
              onClick={() => setAddOpen(true)}
              disabled={!preferences?.enabled}
            >
              <Plus size={15} />
              Add memory
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 sm:px-9 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Memory
                </h2>
                <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                  Enabled by default. Turning it off also pauses retrieval.
                </p>
              </div>
              <Switch
                checked={preferences?.enabled ?? true}
                disabled={!preferences}
                label="Enable memory"
                onChange={(enabled) =>
                  void patchPreferences({
                    enabled,
                    capturePaused: enabled
                      ? (preferences?.capturePaused ?? false)
                      : true,
                  })
                }
              />
            </div>
            <button
              type="button"
              disabled={!preferences?.enabled}
              onClick={() =>
                void patchPreferences({
                  capturePaused: !preferences?.capturePaused,
                })
              }
              className="mt-4 flex w-full items-center justify-between rounded-[11px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2.5 text-left disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-[11px] font-medium text-[var(--text-secondary)]">
                {preferences?.capturePaused ? (
                  <Pause size={14} className="text-[var(--warning)]" />
                ) : (
                  <Sparkles size={14} className="text-[var(--brand-primary)]" />
                )}
                {preferences?.capturePaused
                  ? "Capture paused"
                  : "Background capture on"}
              </span>
              <span className="text-micro text-[var(--text-tertiary)]">
                {preferences?.capturePaused ? "Resume" : "Pause"}
              </span>
            </button>
          </section>

          <nav
            aria-label="Memory collections"
            className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
          >
            {[
              {
                id: "current" as const,
                label: "Current",
                icon: Sparkles,
                count: counts.current,
              },
              {
                id: "disputed" as const,
                label: "Needs attention",
                icon: CircleHelp,
                count: counts.disputed,
              },
              {
                id: "superseded" as const,
                label: "History",
                icon: History,
                count: counts.history,
              },
            ].map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatus(id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-[11px] font-medium",
                  status === id
                    ? "bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-secondary))] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                )}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{label}</span>
                <span className="text-micro text-[var(--text-tertiary)]">
                  {count}
                </span>
              </button>
            ))}
          </nav>

          <section className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--brand-primary)]" />
              <p className="text-micro leading-5 text-[var(--text-tertiary)]">
                Your memory is private. Teachers, school admins, and platform
                operators cannot read it. Shared conventions are separate from
                private personal memory.
              </p>
            </div>
          </section>
        </aside>

        <main className="min-w-0">
          {notice ? (
            <div
              role="status"
              className={cn(
                "mb-4 flex items-start justify-between gap-4 rounded-[13px] border px-4 py-3 text-[11px]",
                notice.kind === "error"
                  ? "border-[color-mix(in_oklab,var(--danger)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_5%,var(--bg-elevated))] text-[var(--danger)]"
                  : "border-[color-mix(in_oklab,var(--success)_22%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_5%,var(--bg-elevated))] text-[var(--text-secondary)]",
              )}
            >
              <span>{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}

          {settingsOpen && preferences ? (
            <section className="mb-5 rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_18px_50px_-38px_rgba(15,27,42,.5)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
                    What Spectra may remember
                  </h2>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                    Category controls affect future capture and retrieval.
                    Existing memories stay visible so you can correct or remove
                    them.
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close controls"
                >
                  <X size={16} />
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {categoryOptions.map((option) => (
                  <div
                    key={option.key}
                    className="flex items-start justify-between gap-3 rounded-[13px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5"
                  >
                    <div>
                      <h3 className="text-[11px] font-semibold text-[var(--text-primary)]">
                        {option.label}
                      </h3>
                      <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                        {option.description}
                      </p>
                    </div>
                    <Switch
                      checked={preferences.categoryControls[option.key]}
                      disabled={!preferences.enabled}
                      label={`Allow ${option.label}`}
                      onChange={(checked) =>
                        void patchPreferences({
                          categoryControls: {
                            ...preferences.categoryControls,
                            [option.key]: checked,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-[13px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-semibold text-[var(--text-primary)]">
                    Initial memory context
                  </h3>
                  <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                    A relevance target, not a hard ceiling. Spectra may retrieve
                    more when a task genuinely needs it.
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-micro text-[var(--text-secondary)]">
                  <input
                    type="range"
                    min={500}
                    max={1800}
                    step={100}
                    value={preferences.capsuleTargetTokens}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        capsuleTargetTokens: Number(event.target.value),
                      })
                    }
                    onPointerUp={() =>
                      void patchPreferences({
                        capsuleTargetTokens: preferences.capsuleTargetTokens,
                      })
                    }
                    className="accent-[var(--brand-primary)]"
                  />
                  <span className="w-20 text-right">
                    ≈ {preferences.capsuleTargetTokens.toLocaleString()} tokens
                  </span>
                </label>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="ghost"
                  className="text-[var(--danger)] hover:text-[var(--danger)]"
                  onClick={() => setClearOpen(true)}
                >
                  <ArchiveX size={14} />
                  Forget everything
                </Button>
              </div>
            </section>
          ) : null}

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your memories"
                className="h-11 w-full rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-10 pr-4 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand-primary)]"
              />
            </label>
            <div className="flex gap-2">
              <label className="relative min-w-[148px] flex-1 sm:flex-none">
                <select
                  value={scope}
                  onChange={(event) =>
                    setScope(event.target.value as SpectraMemoryScope | "all")
                  }
                  className="h-11 w-full appearance-none rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 pr-9 text-[11px] text-[var(--text-secondary)] outline-none"
                  aria-label="Filter by scope"
                >
                  <option value="all">All scopes</option>
                  <option value="private_global">Across Spectra</option>
                  <option value="private_school">This school</option>
                  <option value="workspace">Workspaces</option>
                  <option value="shared_artifact">Artifacts</option>
                  <option value="system">Product preferences</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              </label>
              <label className="relative min-w-[150px] flex-1 sm:flex-none">
                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(
                      event.target.value as
                        keyof SpectraMemoryCategories | "all",
                    )
                  }
                  className="h-11 w-full appearance-none rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 pr-9 text-[11px] text-[var(--text-secondary)] outline-none"
                  aria-label="Filter by category"
                >
                  <option value="all">All categories</option>
                  {categoryOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              </label>
              <Button
                size="icon"
                variant="secondary"
                onClick={() => void load(true)}
                disabled={refreshing}
                aria-label="Refresh memories"
              >
                <RefreshCw
                  size={15}
                  className={refreshing ? "animate-spin" : undefined}
                />
              </Button>
            </div>
          </div>

          {!preferences?.enabled && !loading ? (
            <section className="mb-4 rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
              <div className="flex items-start gap-3">
                <Pause className="mt-0.5 size-5 text-[var(--text-tertiary)]" />
                <div>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    Memory is off
                  </h2>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                    Spectra will not retrieve or capture memory. Existing
                    entries remain here until you forget them.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {loading ? (
            <div className="grid place-items-center rounded-[20px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] py-24">
              <LoaderCircle className="size-6 animate-spin text-[var(--brand-primary)]" />
              <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
                Loading your private memory
              </p>
            </div>
          ) : filtered.length > 0 ? (
            <div className="space-y-3">
              {filtered.map((claim) => (
                <MemoryCard
                  key={claim._id}
                  claim={claim}
                  busy={busy}
                  onCorrect={(target, proposition) =>
                    mutateClaim(
                      target,
                      () => correctSpectraMemory(target._id, proposition),
                      "The correction is active; the previous memory remains in history.",
                    )
                  }
                  onDispute={(target) =>
                    mutateClaim(
                      target,
                      () =>
                        disputeSpectraMemory(
                          target._id,
                          target.status !== "disputed",
                        ),
                      target.status === "disputed"
                        ? "The memory is active again."
                        : "The memory is excluded from retrieval while disputed.",
                    )
                  }
                  onForget={(target) =>
                    mutateClaim(
                      target,
                      () => forgetSpectraMemory(target._id),
                      "The memory was immediately removed from retrieval.",
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <div className="grid place-items-center rounded-[20px] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] px-6 py-20 text-center">
              <span className="grid size-12 place-items-center rounded-[16px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
                <Brain size={22} strokeWidth={1.6} />
              </span>
              <h2 className="mt-4 font-display text-[18px] font-semibold text-[var(--text-primary)]">
                {claims.length === 0
                  ? "Nothing remembered yet"
                  : "No memories match"}
              </h2>
              <p className="mt-1 max-w-sm text-[11px] leading-5 text-[var(--text-secondary)]">
                {claims.length === 0
                  ? "Useful details will appear after you explicitly ask Spectra to remember them or establish a durable way of working."
                  : "Try a different search, scope, category, or collection."}
              </p>
              {claims.length === 0 && preferences?.enabled ? (
                <Button className="mt-4" onClick={() => setAddOpen(true)}>
                  <Plus size={15} />
                  Add the first memory
                </Button>
              ) : null}
            </div>
          )}
        </main>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 md:left-[76px]">
        <div className="pointer-events-auto w-full max-w-[760px]">
          <CommandBar
            className="w-full"
            placeholder="Ask Spectra to remember, correct, or use something…"
            onSubmit={(prompt) => {
              router.push(
                `/chat?prompt=${encodeURIComponent(
                  `About my private Spectra memory, ${prompt}`,
                )}`,
              );
              return true;
            }}
            context={
              <span className="flex h-full min-w-[88px] items-center gap-2 px-3 text-[11px] font-semibold text-[var(--text-primary)]">
                <Brain className="size-3.5 shrink-0 text-[var(--brand-primary)]" />
                Memory
              </span>
            }
          />
        </div>
      </div>

      {addOpen ? (
        <AddMemoryPanel
          workspaces={workspaces}
          onClose={() => setAddOpen(false)}
          onCreated={() => load(true)}
        />
      ) : null}

      {clearOpen ? (
        <div className="fixed inset-0 z-[97] grid place-items-center bg-[rgba(18,27,38,.32)] p-4 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setClearOpen(false)}
            aria-label="Close confirmation"
          />
          <section className="relative w-full max-w-[460px] rounded-[21px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[0_30px_90px_-35px_rgba(14,28,46,.62)]">
            <span className="grid size-10 place-items-center rounded-[13px] bg-[color-mix(in_oklab,var(--danger)_9%,var(--bg-secondary))] text-[var(--danger)]">
              <AlertTriangle size={19} />
            </span>
            <h2 className="mt-4 font-display text-[21px] font-semibold text-[var(--text-primary)]">
              Forget everything?
            </h2>
            <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
              All active, proposed, and disputed memories will be excluded
              immediately and their derived evidence will be scheduled for
              deletion. Source artifacts and immutable audit events are not
              changed.
            </p>
            <label className="mt-4 block text-[11px] font-semibold text-[var(--text-primary)]">
              Type <span className="font-mono">FORGET ALL</span> to continue
              <input
                value={clearText}
                onChange={(event) => setClearText(event.target.value)}
                className="mt-2 h-10 w-full rounded-[11px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] font-normal text-[var(--text-primary)] outline-none focus:border-[var(--danger)]"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setClearOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={
                  clearText.trim().toUpperCase() !== "FORGET ALL" ||
                  busy === "clear"
                }
                onClick={() => void clearAll()}
              >
                {busy === "clear" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Forget everything
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
