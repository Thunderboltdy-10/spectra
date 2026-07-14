"use client";

import { Check, ChevronDown, Link2, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraArtifactEmbeds,
  getSpectraArtifactVersions,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactEmbed,
  type SpectraArtifactVersion,
} from "../data/api";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";
import { ArtifactEmbed } from "./artifact-embed";
import { blueprintMeta } from "./artifact-card";

type Interaction = "read" | "interact" | "edit";

export function ArtifactEmbedsPanel({
  open,
  containerType = "artifact",
  containerId,
  containerTitle,
  artifacts,
  regions,
  onOpenSource,
  onClose,
}: {
  open: boolean;
  containerType?: "artifact" | "thread";
  containerId: string;
  containerTitle: string;
  artifacts: SpectraArtifact[];
  regions: readonly ArtifactCommentRegion[];
  onOpenSource?: (artifactId: string) => void;
  onClose: () => void;
}) {
  const [embeds, setEmbeds] = useState<SpectraArtifactEmbed[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceArtifactId, setSourceArtifactId] = useState("");
  const [containerRegionId, setContainerRegionId] = useState("");
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const [interaction, setInteraction] = useState<Interaction>("read");
  const [versionPolicy, setVersionPolicy] = useState<"live" | "pinned">("live");
  const [pinnedVersionId, setPinnedVersionId] = useState("");
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpectraArtifactEmbeds(containerType, containerId);
      setEmbeds(result.embeds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load embedded artifacts.");
    } finally {
      setLoading(false);
    }
  }, [containerId, containerType]);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setSearch("");
    setSourceArtifactId("");
    setContainerRegionId(regions[0]?.regionId ?? "artifact:structure");
    setMode("compact");
    setInteraction("read");
    setVersionPolicy("live");
    setPinnedVersionId("");
    setVersions([]);
    void refresh();
  }, [open, refresh, regions]);

  useEffect(() => {
    if (!open || !sourceArtifactId || versionPolicy !== "pinned") return;
    void getSpectraArtifactVersions(sourceArtifactId, 60).then((result) => {
      setVersions(result.versions);
      setPinnedVersionId((current) => current || result.versions[0]?._id || "");
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not load source versions."));
  }, [open, sourceArtifactId, versionPolicy]);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return artifacts.filter((artifact) => artifact._id !== containerId && artifact.status !== "deleted" && (!needle || `${artifact.title} ${artifact.summary ?? ""} ${artifact.blueprintKey}`.toLowerCase().includes(needle))).slice(0, 40);
  }, [artifacts, containerId, search]);

  async function createEmbed() {
    if (!sourceArtifactId || !containerRegionId || (versionPolicy === "pinned" && !pinnedVersionId)) return;
    setBusy("create");
    try {
      await postSpectra({
        action: "createArtifactEmbed",
        containerType,
        containerId,
        containerRegionId,
        sourceArtifactId,
        mode,
        interaction,
        versionPolicy,
        pinnedVersionId: versionPolicy === "pinned" ? pinnedVersionId : undefined,
        contextPolicy: "summary",
      });
      setCreating(false);
      setSourceArtifactId("");
      setSearch("");
      await refresh();
      toast.success("Artifact embedded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not embed this artifact.");
    } finally {
      setBusy(null);
    }
  }

  async function changeMode(embed: SpectraArtifactEmbed, nextMode: "compact" | "expanded") {
    setBusy(`mode:${embed.embedId}`);
    try {
      await postSpectra({ action: "updateArtifactEmbed", embedId: embed.embedId, mode: nextMode });
      setEmbeds((current) => current.map((entry) => entry.embedId === embed.embedId ? { ...entry, mode: nextMode } : entry));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resize this embed.");
    } finally {
      setBusy(null);
    }
  }

  async function removeEmbed(embed: SpectraArtifactEmbed) {
    setBusy(`remove:${embed.embedId}`);
    try {
      await postSpectra({ action: "removeArtifactEmbed", embedId: embed.embedId });
      setEmbeds((current) => current.filter((entry) => entry.embedId !== embed.embedId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove this embed.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[72] flex justify-end bg-[color-mix(in_oklab,var(--text-primary)_12%,transparent)] backdrop-blur-[1px]" onPointerDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="artifact-embeds-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[-20px_0_60px_rgba(27,20,12,0.12)]" onPointerDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-[var(--border-default)] px-5 py-4"><div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,#8b6ff0_9%,var(--bg-secondary))] text-[#765bd8]"><Link2 className="h-4 w-4" /></span><div className="min-w-0"><h2 id="artifact-embeds-title" className="font-display text-[18px] font-semibold text-[var(--text-primary)]">Embedded artifacts</h2><p className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">Live projections inside {containerTitle}</p></div></div><div className="flex gap-1"><button type="button" onClick={() => setCreating((value) => !value)} className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-2.5 text-[10px] font-semibold text-[var(--bg-primary)]"><Plus className="h-3.5 w-3.5" />Add</button><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Close embedded artifacts"><X className="h-4 w-4" /></button></div></header>

        {creating ? <section className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-5 py-4"><div className="grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-[9px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">Source artifact</span><div className="relative mt-1.5"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accessible artifacts" className="h-9 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-9 pr-3 text-[11px] text-[var(--text-primary)] outline-none" /></div></label><div className="sm:col-span-2 max-h-32 overflow-y-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">{candidates.map((artifact) => { const meta = blueprintMeta[artifact.blueprintKey]; const Icon = meta.icon; return <button type="button" key={artifact._id} onClick={() => { setSourceArtifactId(artifact._id); setVersions([]); setPinnedVersionId(""); }} className={`flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left ${sourceArtifactId === artifact._id ? "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-hover))]" : "hover:bg-[var(--bg-hover)]"}`}><Icon className="h-3.5 w-3.5" style={{ color: meta.color }} /><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">{artifact.title}</span>{sourceArtifactId === artifact._id ? <Check className="h-3.5 w-3.5 text-[var(--accent-cyan)]" /> : null}</button>; })}{candidates.length === 0 ? <p className="px-3 py-4 text-center text-[10px] text-[var(--text-tertiary)]">No accessible artifact matches.</p> : null}</div>
          <SelectField label="Anchor" value={containerRegionId} onChange={setContainerRegionId} options={regions.map((region) => ({ value: region.regionId, label: region.label }))} />
          <SelectField label="Layout" value={mode} onChange={(value) => setMode(value as typeof mode)} options={[{ value: "compact", label: "Compact" }, { value: "expanded", label: "Expanded" }]} />
          <SelectField label="Interaction" value={interaction} onChange={(value) => setInteraction(value as Interaction)} options={[{ value: "read", label: "Read" }, { value: "interact", label: "Interact" }, { value: "edit", label: "Edit source" }]} />
          <SelectField label="Version" value={versionPolicy} onChange={(value) => setVersionPolicy(value as typeof versionPolicy)} options={[{ value: "live", label: "Live source" }, { value: "pinned", label: "Pinned version" }]} />
          {versionPolicy === "pinned" ? <div className="sm:col-span-2"><SelectField label="Pinned version" value={pinnedVersionId} onChange={setPinnedVersionId} options={versions.map((version) => ({ value: version._id, label: `${version.name || version.summary || "Saved version"} · ${new Date(version.createdAt).toLocaleString()}` }))} /></div> : null}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="h-8 rounded-[7px] px-3 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button><button type="button" disabled={!sourceArtifactId || !containerRegionId || (versionPolicy === "pinned" && !pinnedVersionId) || busy === "create"} onClick={() => void createEmbed()} className="flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-[10px] font-semibold text-[var(--bg-primary)] disabled:opacity-35">{busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Embed artifact</button></div></section> : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div> : embeds.length === 0 ? <div className="mx-auto flex max-w-[300px] flex-col items-center py-16 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)]"><Link2 className="h-4 w-4" /></span><h3 className="mt-4 text-[13px] font-semibold text-[var(--text-primary)]">Compose with live artifacts</h3><p className="mt-1.5 text-[10px] leading-5 text-[var(--text-secondary)]">Embed a source without copying it or changing who can access it. Live embeds update with their source; pinned embeds stay on a chosen version.</p></div> : <div className="space-y-4">{embeds.map((embed) => <div key={embed.embedId} className="group relative"><ArtifactEmbed embed={embed} onOpenSource={onOpenSource} onRetry={() => void refresh()} onModeChange={(nextMode) => void changeMode(embed, nextMode)} /><button type="button" disabled={busy === `remove:${embed.embedId}`} onClick={() => void removeEmbed(embed)} className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-[6px] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] text-[var(--text-tertiary)] opacity-0 shadow-sm transition hover:text-[var(--danger)] group-hover:opacity-100 focus:opacity-100" aria-label="Remove embed">{busy === `remove:${embed.embedId}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}</button></div>)}</div>}</div>
      </aside>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label><span className="text-[9px] font-semibold uppercase tracking-[.09em] text-[var(--text-tertiary)]">{label}</span><span className="relative mt-1.5 block"><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full appearance-none rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 pr-7 text-[10px] text-[var(--text-primary)] outline-none">{options.length ? options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value="">No options available</option>}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]" /></span></label>;
}
