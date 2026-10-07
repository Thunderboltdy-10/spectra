"use client";

/**
 * The agent bench (EDITORS.md, "Agents (user-built)"): the creator asks the
 * draft what students will ask it, reads the answer beside the one before it,
 * adjusts the instructions in place and runs again, and keeps any question as
 * a test that "Run checks" includes from then on.
 *
 * State lives in `useAgentBench`, so the editor's bar can run (and stop) every
 * prompt and the checks and release views can count the saved tests.
 * `AgentBench` is the section itself. The draft can be compared with any of
 * its releases, and the model can suggest edits to an answer's instructions,
 * which the creator applies to the draft one at a time.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  applyBenchEdits,
  applyBenchInstructions,
  applySuggestion,
  BENCH_LENGTH_LABELS,
  BENCH_TONE_LABELS,
  describeBenchEdit,
  benchChecksEmpty,
  benchEntries,
  benchPair,
  benchPromptKey,
  BENCH_LIMITS,
  compareBenchOutputs,
  describeComparison,
  describeInstructionChanges,
  gradeBenchChecks,
  parseCheckLines,
  readBenchInstructions,
  samplePrompts,
  suggestAdjustments,
  type AgentFoundryContent,
  type BenchCase,
  type BenchCompareMode,
  type BenchEntry,
  type BenchInstructions,
  type BenchModelSuggestion,
  type BenchRun,
  type BenchSuggestion,
  type BenchTarget,
  type SkillEvaluationCase,
} from "../agents/foundry";
import {
  benchErrorMessage,
  getAgentBench,
  removeAgentBenchCase,
  saveAgentBenchCase,
  streamAgentBench,
  suggestBenchImprovements,
  type BenchRelease,
  type BenchReleaseOption,
} from "../data/agent-bench";
import { spectraBus } from "../events";
import { useLifeArrival, useLifeDeparture, useLifeGlow, useWritingFront } from "../life/use-life";
import { SpectraRichContent } from "./spectra-rich-content";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

type LiveAnswers = Partial<Record<BenchTarget, string>>;

function withoutKey<T>(current: Record<string, T>, key: string): Record<string, T> {
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

/** A release as the picker names it: its number, and what became of it. */
export function benchReleaseLabel(release: Pick<BenchReleaseOption, "releaseNumber" | "status" | "rollout">) {
  const state =
    release.status === "suspended"
      ? ", suspended"
      : release.status === "deprecated"
        ? ", retired"
        : release.rollout === "internal_test"
          ? ", private"
          : "";
  return `Release ${release.releaseNumber}${state}`;
}

export type AgentBenchController = ReturnType<typeof useAgentBench>;

export function useAgentBench({
  agentId,
  enabled,
  content,
}: {
  agentId: string;
  /** Only people who can edit the agent have a bench. */
  enabled: boolean;
  /** The editor's newest draft: a rerun after an edit answers with it. */
  content: AgentFoundryContent;
}) {
  const [cases, setCases] = useState<BenchCase[]>([]);
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [release, setRelease] = useState<BenchRelease | null>(null);
  const [releases, setReleases] = useState<BenchReleaseOption[]>([]);
  const [pickedRelease, setPickedRelease] = useState<number | undefined>(undefined);
  const [stopped, setStopped] = useState<Record<string, true>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [live, setLive] = useState<Record<string, LiveAnswers>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState<BenchCompareMode>("previous");
  const [runningAll, setRunningAll] = useState(false);
  const contentRef = useRef(content);
  const releaseRef = useRef(release);
  const runsRef = useRef(runs);
  /** Each open answer, by the prompt it answers, so one can be stopped. */
  const controllers = useRef(new Map<AbortController, string>());
  const stopAllRef = useRef(false);

  /** The release the draft is compared with: the one picked, or the newest. */
  const compareRelease = pickedRelease ?? release?.releaseNumber ?? releases[0]?.releaseNumber;
  const compareReleaseRef = useRef(compareRelease);

  useEffect(() => {
    contentRef.current = content;
    releaseRef.current = release;
    runsRef.current = runs;
    compareReleaseRef.current = compareRelease;
  });

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const state = await getAgentBench(agentId);
      setCases(state.cases);
      setRuns(state.runs);
      setRelease(state.release);
      setReleases(state.releases ?? []);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, [agentId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // Spectra can ask this agent questions and keep or remove its tests; show what it did.
  useEffect(() => {
    if (!enabled) return;
    return spectraBus.on("agent.benchChanged", (detail) => {
      if (detail.agentId === agentId) void load();
    });
  }, [agentId, enabled, load]);

  useEffect(() => {
    const open = controllers.current;
    return () => {
      for (const controller of open.keys()) controller.abort();
    };
  }, []);

  const entries = useMemo(
    () => benchEntries({ cases, runs, added, removed }),
    [added, cases, removed, runs],
  );

  const running = useCallback(
    (key: string) => Object.keys(live[key] ?? {}).length > 0,
    [live],
  );

  /** Asks one target and keeps its answer; never throws. */
  const ask = useCallback(
    async (prompt: string, target: BenchTarget, draft?: AgentFoundryContent, releaseNumber?: number) => {
      const key = benchPromptKey(prompt);
      const controller = new AbortController();
      controllers.current.set(controller, key);
      setLive((current) => ({ ...current, [key]: { ...current[key], [target]: "" } }));
      const asked = target === "release" ? (releaseNumber ?? releaseRef.current?.releaseNumber) : undefined;
      let written = "";
      try {
        const run = await streamAgentBench({
          agentId,
          prompt,
          target,
          content: target === "draft" ? (draft ?? contentRef.current) : undefined,
          // The newest release is the route's default, so only an older one is named.
          ...(target === "release" &&
          releaseNumber !== undefined &&
          releaseNumber !== releaseRef.current?.releaseNumber
            ? { releaseNumber }
            : {}),
          signal: controller.signal,
          onText: (text) => {
            written = text;
            setLive((current) => ({ ...current, [key]: { ...current[key], [target]: text } }));
          },
        });
        setRuns((current) => [run, ...current]);
      } catch (error) {
        if (controller.signal.aborted) {
          setStopped((current) => ({ ...current, [key]: true }));
          // What it wrote before Stop stays, marked stopped; the route keeps it too.
          const partial = written.trim();
          if (partial)
            setRuns((current) => [
              {
                id: `stopped-${Date.now()}`,
                prompt,
                target,
                ...(asked !== undefined ? { releaseNumber: asked } : {}),
                output: partial,
                createdAt: Date.now(),
                stopped: true,
              },
              ...current,
            ]);
          return;
        }
        setProblems((current) => ({
          ...current,
          [key]: benchErrorMessage(error, "This answer did not finish. Run it again."),
        }));
      } finally {
        controllers.current.delete(controller);
        setLive((current) => {
          const next = { ...current[key] };
          delete next[target];
          const rest = { ...current };
          if (Object.keys(next).length) rest[key] = next;
          else delete rest[key];
          return rest;
        });
      }
    },
    [agentId],
  );

  /**
   * Runs the draft on one prompt, and the compared release too when the draft
   * is compared with one and that release has not answered this prompt yet.
   */
  const runPrompt = useCallback(
    async (prompt: string, draft?: AgentFoundryContent) => {
      const text = prompt.trim();
      if (!text) return;
      const key = benchPromptKey(text);
      setProblems((current) => withoutKey(current, key));
      setStopped((current) => withoutKey(current, key));
      const targets: BenchTarget[] = ["draft"];
      const releaseNumber = compareReleaseRef.current;
      if (compare === "release" && releaseNumber !== undefined) {
        const answered = runsRef.current.filter((run) => benchPromptKey(run.prompt) === key);
        // A release answer that was stopped is asked again.
        const { baseline } = benchPair(answered, "release", releaseNumber);
        if (!baseline || baseline.stopped) targets.push("release");
      }
      await Promise.all(
        targets.map((target) => ask(text, target, draft, target === "release" ? releaseNumber : undefined)),
      );
    },
    [ask, compare],
  );

  const runAll = useCallback(
    async (draft?: AgentFoundryContent) => {
      stopAllRef.current = false;
      setRunningAll(true);
      try {
        for (const entry of entries) {
          if (stopAllRef.current) break;
          await runPrompt(entry.prompt, draft);
        }
      } finally {
        setRunningAll(false);
      }
    },
    [entries, runPrompt],
  );

  /** Stops the answers running for one prompt; the question stays on the bench. */
  const stopPrompt = useCallback((key: string) => {
    for (const [controller, owner] of controllers.current) if (owner === key) controller.abort();
  }, []);

  /** Stops every running answer, and Run all before its next prompt. */
  const stopAll = useCallback(() => {
    stopAllRef.current = true;
    for (const controller of controllers.current.keys()) controller.abort();
  }, []);

  const addPrompt = useCallback((prompt: string) => {
    const text = prompt.trim().slice(0, BENCH_LIMITS.prompt);
    if (!text) return;
    const key = benchPromptKey(text);
    setRemoved((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setAdded((current) =>
      current.some((entry) => benchPromptKey(entry) === key) ? current : [...current, text],
    );
  }, []);

  const dropPrompt = useCallback((prompt: string) => {
    const key = benchPromptKey(prompt);
    setAdded((current) => current.filter((entry) => benchPromptKey(entry) !== key));
    setRemoved((current) => new Set(current).add(key));
  }, []);

  const saveCase = useCallback(
    async (input: { prompt: string; caseId?: string; checks: BenchCase["checks"]; required: boolean }) => {
      try {
        const saved = await saveAgentBenchCase({
          agentId,
          caseId: input.caseId,
          prompt: input.prompt,
          mustInclude: input.checks.mustInclude,
          mustNotInclude: input.checks.mustNotInclude,
          rubric: input.checks.rubric,
          required: input.required,
        });
        const now = Date.now();
        setCases((current) => {
          const existing = current.find((entry) => entry.id === saved.caseId);
          const next: BenchCase = {
            id: saved.caseId,
            prompt: input.prompt.trim(),
            checks: input.checks,
            required: input.required,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          return existing
            ? current.map((entry) => (entry.id === saved.caseId ? next : entry))
            : [...current, next];
        });
        toast.success(saved.created ? "Saved as a test. Run checks includes it now." : "Test updated.");
        return true;
      } catch (error) {
        toast.error(benchErrorMessage(error, "The test was not saved. Try again."));
        return false;
      }
    },
    [agentId],
  );

  const removeCase = useCallback(
    async (entry: BenchCase) => {
      try {
        await removeAgentBenchCase(agentId, entry.id);
        setCases((current) => current.filter((item) => item.id !== entry.id));
        setAdded((current) =>
          current.some((item) => benchPromptKey(item) === benchPromptKey(entry.prompt))
            ? current
            : [...current, entry.prompt],
        );
        toast.success("Test removed. The question stays on the bench.");
      } catch (error) {
        toast.error(benchErrorMessage(error, "The test was not removed. Try again."));
      }
    },
    [agentId],
  );

  return {
    agentId,
    status,
    cases,
    runs,
    release,
    releases,
    compareRelease,
    setCompareRelease: setPickedRelease,
    entries,
    live,
    problems,
    stopped,
    compare,
    setCompare,
    runningAll,
    running,
    reload: load,
    runPrompt,
    runAll,
    stopPrompt,
    stopAll,
    addPrompt,
    dropPrompt,
    saveCase,
    removeCase,
  };
}

/**
 * The editor bar's main action on the bench: Run all, or Stop while any
 * answer is still being written (Stop also ends Run all before its next
 * question).
 */
export function benchBarAction(
  bench: Pick<AgentBenchController, "runningAll" | "live" | "entries" | "runAll" | "stopAll">,
  canEdit: boolean,
) {
  const running = bench.runningAll || Object.keys(bench.live).length > 0;
  return running
    ? { label: "Stop", stops: true, disabled: !canEdit, onSelect: () => bench.stopAll() }
    : {
        label: "Run all",
        stops: false,
        disabled: !canEdit || bench.entries.length === 0,
        onSelect: () => void bench.runAll(),
      };
}

/* ------------------------------------------------------------------ */
/* One answer                                                          */
/* ------------------------------------------------------------------ */

function BenchAnswer({
  label,
  text,
  streaming,
  stopped = false,
  empty,
}: {
  label: string;
  text?: string;
  streaming: boolean;
  /** Stopped before it finished: the text is what it had written. */
  stopped?: boolean;
  empty: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeGlow(ref, streaming);
  useWritingFront(ref, streaming);
  return (
    <div
      ref={ref}
      className={`agent-bench-answer${streaming ? " is-streaming" : ""}`}
      data-ai-region={streaming ? "true" : undefined}
      aria-busy={streaming || undefined}
    >
      <p className="agent-bench-label">
        {label}
        {stopped && !streaming && <span className="agent-bench-tag">Stopped</span>}
      </p>
      {text ? (
        <SpectraRichContent content={text} className="agent-bench-rich" />
      ) : (
        <p className="foundry-empty">{streaming ? "Answering" : empty}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Saving a case as a test                                             */
/* ------------------------------------------------------------------ */

function BenchCaseForm({
  entry,
  disabled,
  onSave,
  onRemove,
  onClose,
}: {
  entry: BenchEntry;
  disabled: boolean;
  onSave: (checks: BenchCase["checks"], required: boolean) => Promise<boolean>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const saved = entry.saved;
  const [include, setInclude] = useState(saved?.checks.mustInclude.join("\n") ?? "");
  const [exclude, setExclude] = useState(saved?.checks.mustNotInclude.join("\n") ?? "");
  const [rubric, setRubric] = useState(saved?.checks.rubric ?? "");
  const [required, setRequired] = useState(saved?.required ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checks: BenchCase["checks"] = {
      mustInclude: parseCheckLines(include),
      mustNotInclude: parseCheckLines(exclude),
      ...(rubric.trim() ? { rubric: rubric.trim().slice(0, BENCH_LIMITS.rubric) } : {}),
    };
    if (benchChecksEmpty(checks)) {
      setError("Say at least one thing a good answer must or must not do.");
      return;
    }
    setError("");
    setSaving(true);
    const done = await onSave(checks, required);
    setSaving(false);
    if (done) onClose();
  }

  return (
    <form className="agent-bench-form" onSubmit={(event) => void submit(event)} aria-label="Save as a test">
      <label className="agent-bench-field">
        <span>A good answer includes</span>
        <Textarea
          rows={3}
          value={include}
          onChange={(event) => setInclude(event.target.value)}
          placeholder="One phrase per line"
        />
      </label>
      <label className="agent-bench-field">
        <span>A good answer leaves out</span>
        <Textarea
          rows={2}
          value={exclude}
          onChange={(event) => setExclude(event.target.value)}
          placeholder="One phrase per line"
        />
      </label>
      <label className="agent-bench-field">
        <span>What a good answer does, in your words (optional)</span>
        <Textarea
          rows={2}
          value={rubric}
          onChange={(event) => setRubric(event.target.value)}
          placeholder="Names one concrete fix and stays kind"
        />
      </label>
      <label className="agent-bench-switch">
        <Switch checked={required} onCheckedChange={setRequired} aria-label="Must pass before publishing" />
        <span>Must pass before publishing</span>
      </label>
      {error && (
        <p className="agent-bench-problem" role="alert">
          {error}
        </p>
      )}
      <div className="agent-bench-form-actions">
        <Button type="submit" variant="primary" size="sm" disabled={disabled || saving}>
          {saving ? "Saving" : saved ? "Update test" : "Save test"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {saved && (
          <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={onRemove}>
            Remove test
          </Button>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Suggestions the model writes                                        */
/* ------------------------------------------------------------------ */

function BenchIdea({
  lifeKey,
  suggestion,
  applied,
  onApply,
}: {
  lifeKey: string;
  suggestion: BenchModelSuggestion;
  applied: boolean;
  onApply: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // A suggestion is Spectra's: it arrives from the prism.
  useLifeArrival(ref, lifeKey, "ai");
  return (
    <li ref={ref}>
      <div className="agent-bench-idea">
        {suggestion.reason && <p>{suggestion.reason}</p>}
        <ul>
          {suggestion.edits.map((edit) => (
            <li key={describeBenchEdit(edit)}>{describeBenchEdit(edit)}</li>
          ))}
        </ul>
      </div>
      {applied ? (
        <span className="agent-bench-tag">Applied</span>
      ) : (
        <Button size="sm" variant="ghost" onClick={onApply}>
          Apply to the draft
        </Button>
      )}
    </li>
  );
}

type IdeasState = {
  /** The answer they are about; a newer answer needs new suggestions. */
  runId: string;
  status: "loading" | "ready" | "failed";
  items: BenchModelSuggestion[];
  applied: string[];
  message?: string;
};

function BenchIdeas({
  agentId,
  entry,
  answer,
  content,
  onApply,
}: {
  agentId: string;
  entry: BenchEntry;
  answer: BenchRun;
  content: AgentFoundryContent;
  onApply: (suggestion: BenchModelSuggestion) => void;
}) {
  const [state, setState] = useState<IdeasState | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const ideas = state?.runId === answer.id ? state : null;

  async function ask() {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({ runId: answer.id, status: "loading", items: [], applied: [] });
    try {
      const items = await suggestBenchImprovements({
        agentId,
        prompt: entry.prompt,
        output: answer.output,
        ...(entry.saved ? { checks: entry.saved.checks } : {}),
        content,
        signal: next.signal,
      });
      if (next.signal.aborted) return;
      setState({ runId: answer.id, status: "ready", items, applied: [] });
    } catch (error) {
      if (next.signal.aborted) return;
      setState({
        runId: answer.id,
        status: "failed",
        items: [],
        applied: [],
        message: benchErrorMessage(error, "Spectra could not suggest changes this time. Try again."),
      });
    }
  }

  function stop() {
    controller.current?.abort();
    setState(null);
  }

  function apply(suggestion: BenchModelSuggestion) {
    onApply(suggestion);
    setState((current) => (current ? { ...current, applied: [...current.applied, suggestion.key] } : current));
  }

  return (
    <div className="agent-bench-ideas">
      {ideas?.status === "loading" ? (
        <p className="foundry-empty" aria-live="polite">
          Spectra is reading the answer.{" "}
          <button type="button" className="foundry-text-button" onClick={stop}>
            <Icon name="stop" size={14} />
            Stop
          </button>
        </p>
      ) : (
        <button type="button" className="foundry-text-button" onClick={() => void ask()}>
          <Icon name="target" size={14} />
          {ideas?.status === "ready" ? "Suggest again" : "Suggest improvements"}
        </button>
      )}
      {ideas?.status === "failed" && (
        <p className="agent-bench-problem" role="alert">
          {ideas.message}
        </p>
      )}
      {ideas?.status === "ready" && ideas.items.length === 0 && (
        <p className="foundry-empty">Spectra has nothing to change for this answer.</p>
      )}
      {ideas?.status === "ready" && ideas.items.length > 0 && (
        <ul className="agent-bench-suggestions" aria-label="Spectra's suggestions">
          {ideas.items.map((suggestion) => (
            <BenchIdea
              key={suggestion.key}
              lifeKey={`bench-idea:${agentId}:${entry.key}:${answer.id}:${suggestion.key}`}
              suggestion={suggestion}
              applied={ideas.applied.includes(suggestion.key)}
              onApply={() => apply(suggestion)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One prompt on the bench                                             */
/* ------------------------------------------------------------------ */

function BenchCard({
  bench,
  entry,
  content,
  canEdit,
  onApplySuggestion,
  onApplyIdea,
}: {
  bench: AgentBenchController;
  entry: BenchEntry;
  content: AgentFoundryContent;
  canEdit: boolean;
  onApplySuggestion: (suggestion: BenchSuggestion) => void;
  onApplyIdea: (suggestion: BenchModelSuggestion) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useLifeArrival(ref, `bench:${bench.agentId}:${entry.key}`, "human");
  useLifeDeparture(ref);
  const [formOpen, setFormOpen] = useState(false);

  const live = bench.live[entry.key] ?? {};
  const isRunning = bench.running(entry.key);
  const releaseNumber = bench.compareRelease;
  const { baseline, current } = benchPair(
    entry.runs,
    bench.compare,
    bench.compare === "release" ? releaseNumber : undefined,
  );
  const draftText = live.draft ?? current?.output;
  const baselineText =
    bench.compare === "release" && live.release !== undefined ? live.release : baseline?.output;
  const baselineLabel =
    bench.compare === "release"
      ? releaseNumber !== undefined
        ? `Release ${releaseNumber}`
        : "Last release"
      : "Its answer before";
  const settled = live.draft === undefined && live.release === undefined;
  // A stopped answer is shown as it stood, but it is not graded or compared.
  const finished = current && !current.stopped ? current : undefined;

  const comparison = useMemo(
    () =>
      settled && baseline && !baseline.stopped && finished
        ? compareBenchOutputs(baseline.output, finished.output)
        : null,
    [baseline, finished, settled],
  );
  const grade = useMemo(
    () => (entry.saved && finished && settled ? gradeBenchChecks(entry.saved.checks, finished.output) : null),
    [entry.saved, finished, settled],
  );
  const suggestions = useMemo(
    () => (grade ? suggestAdjustments(entry.prompt, grade, content.foundry.skills) : []),
    [content.foundry.skills, entry.prompt, grade],
  );
  const problem = bench.problems[entry.key];
  const answered = Boolean(draftText !== undefined || baselineText !== undefined || isRunning);

  return (
    <li ref={ref} className="agent-bench-case" data-bench-prompt={entry.key}>
      <div className="agent-bench-case-head">
        <p className="agent-bench-prompt">{entry.prompt}</p>
        <div className="agent-bench-case-actions">
          {entry.saved && (
            <span className="agent-bench-tag">{entry.saved.required ? "Test" : "Test, optional"}</span>
          )}
          {isRunning ? (
            <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => bench.stopPrompt(entry.key)}>
              <Icon name="stop" size={14} />
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => void bench.runPrompt(entry.prompt)}>
              <Icon name="play" size={14} />
              {current ? "Run again" : "Run"}
            </Button>
          )}
          {!entry.saved && (
            <IconButton
              icon="close"
              size="compact"
              label="Take off the bench"
              disabled={isRunning}
              onClick={() => bench.dropPrompt(entry.prompt)}
            />
          )}
        </div>
      </div>

      {problem && (
        <p className="agent-bench-problem" role="alert">
          {problem}
        </p>
      )}
      {bench.stopped[entry.key] && !isRunning && !problem && (
        <p className="foundry-empty" aria-live="polite">
          Stopped before the answer finished. Run it again when you are ready.
        </p>
      )}

      {answered && (
        <div className="agent-bench-answers">
          <BenchAnswer
            label={baselineLabel}
            text={baselineText}
            streaming={live.release !== undefined}
            stopped={live.release === undefined && Boolean(baseline?.stopped)}
            empty={
              bench.compare === "release"
                ? releaseNumber !== undefined
                  ? "Run it to see how the release answers."
                  : "Nothing is released yet."
                : "Run it again to compare."
            }
          />
          <BenchAnswer
            label="This draft"
            text={draftText}
            streaming={live.draft !== undefined}
            stopped={live.draft === undefined && Boolean(current?.stopped)}
            empty="Run it to see the draft's answer."
          />
        </div>
      )}

      {comparison && (
        <div className="agent-bench-changes">
          <p className="agent-bench-label">What changed</p>
          <ul className="agent-bench-chips">
            {describeComparison(comparison).map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
          {(comparison.added.length > 0 || comparison.removed.length > 0) && (
            <ul className="agent-bench-points">
              {comparison.added.slice(0, 3).map((point) => (
                <li key={`new:${point}`} className="is-new">
                  <span>New</span> {point}
                </li>
              ))}
              {comparison.removed.slice(0, 3).map((point) => (
                <li key={`gone:${point}`} className="is-gone">
                  <span>Dropped</span> {point}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {grade && entry.saved && (
        <div className="agent-bench-checks">
          <p className="agent-bench-label">
            {grade.total === 0
              ? "Your test"
              : grade.allPassed
                ? `Every check holds (${grade.passed} of ${grade.total})`
                : `${grade.passed} of ${grade.total} checks hold`}
          </p>
          <ul>
            {grade.results.map((result) => (
              <li key={`${result.kind}:${result.value}`} className={result.passed ? "is-passed" : "is-failed"}>
                <Icon name={result.passed ? "check" : "close"} size={14} />
                {result.kind === "include" ? "Includes" : "Leaves out"} &ldquo;{result.value}&rdquo;
              </li>
            ))}
          </ul>
          {entry.saved.checks.rubric && (
            <p className="foundry-skill-contract">
              Run checks also judges it against: {entry.saved.checks.rubric}
            </p>
          )}
        </div>
      )}

      {suggestions.length > 0 && canEdit && (
        <ul className="agent-bench-suggestions" aria-label="Suggested adjustments">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.kind}:${suggestion.value}`}>
              <span>
                {suggestion.skillName} {suggestion.kind === "include" ? "should include" : "should leave out"}{" "}
                &ldquo;{suggestion.value}&rdquo;
              </span>
              <Button size="sm" variant="ghost" onClick={() => onApplySuggestion(suggestion)}>
                Add to the skill
              </Button>
            </li>
          ))}
        </ul>
      )}

      {canEdit && settled && finished && content.foundry.foundationEstablished && (
        <BenchIdeas
          agentId={bench.agentId}
          entry={entry}
          answer={finished}
          content={content}
          onApply={onApplyIdea}
        />
      )}

      {canEdit &&
        (formOpen ? (
          <BenchCaseForm
            entry={entry}
            disabled={!canEdit}
            onClose={() => setFormOpen(false)}
            onSave={(checks, required) =>
              bench.saveCase({ prompt: entry.prompt, caseId: entry.saved?.id, checks, required })
            }
            onRemove={() => {
              if (entry.saved) void bench.removeCase(entry.saved);
              setFormOpen(false);
            }}
          />
        ) : (
          <button type="button" className="foundry-text-button" onClick={() => setFormOpen(true)}>
            <Icon name={entry.saved ? "edit" : "saved"} size={14} />
            {entry.saved ? "Edit the test" : "Save as test"}
          </button>
        ))}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Adjusting the instructions                                          */
/* ------------------------------------------------------------------ */

const TONES = (Object.keys(BENCH_TONE_LABELS) as Array<BenchInstructions["tone"]>).map((value) => ({
  value,
  label: BENCH_TONE_LABELS[value],
}));

const LENGTHS = (Object.keys(BENCH_LENGTH_LABELS) as Array<BenchInstructions["responseLength"]>).map((value) => ({
  value,
  label: BENCH_LENGTH_LABELS[value],
}));

const lines = (values: string[]) => values.join("\n");
const unlines = (text: string) => text.split(/\r?\n/);

function InstructionsPanel({
  content,
  canEdit,
  busy,
  onApply,
}: {
  content: AgentFoundryContent;
  canEdit: boolean;
  busy: boolean;
  onApply: (next: AgentFoundryContent, rerun: boolean) => void;
}) {
  const base = useMemo(() => readBenchInstructions(content), [content]);
  const [draft, setDraft] = useState<BenchInstructions | null>(null);
  const editing = draft ?? base;
  const changes = draft ? describeInstructionChanges(base, draft) : [];

  function patch(next: Partial<BenchInstructions>) {
    setDraft({ ...editing, ...next });
  }

  function patchSkill(id: string, next: Partial<BenchInstructions["skills"][number]>) {
    setDraft({
      ...editing,
      skills: editing.skills.map((skill) => (skill.id === id ? { ...skill, ...next } : skill)),
    });
  }

  function apply(rerun: boolean) {
    if (!draft) return;
    onApply(applyBenchInstructions(content, draft, Date.now()), rerun);
    setDraft(null);
  }

  return (
    <section className="foundry-block agent-bench-instructions">
      <div className="foundry-block-head">
        <h3>Instructions</h3>
        <span className="foundry-block-count">
          {changes.length ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}` : "as saved"}
        </span>
      </div>
      <p className="foundry-block-lede">
        What the agent is told comes from these. Change them here, then run the bench again to see what the change did.
      </p>
      <label className="agent-bench-field">
        <span>Objective</span>
        <Textarea
          rows={3}
          disabled={!canEdit}
          value={editing.objective}
          onChange={(event) => patch({ objective: event.target.value })}
        />
      </label>
      <div className="agent-bench-row">
        <SelectField
          label="Tone"
          value={editing.tone}
          disabled={!canEdit}
          options={TONES}
          onChange={(value) => patch({ tone: value as BenchInstructions["tone"] })}
        />
        <SelectField
          label="Length"
          value={editing.responseLength}
          disabled={!canEdit}
          options={LENGTHS}
          onChange={(value) => patch({ responseLength: value as BenchInstructions["responseLength"] })}
        />
      </div>
      <label className="agent-bench-field">
        <span>What it must not do, one per line</span>
        <Textarea
          rows={2}
          disabled={!canEdit}
          value={lines(editing.exclusions)}
          onChange={(event) => patch({ exclusions: unlines(event.target.value) })}
        />
      </label>
      {editing.skills.map((skill) => (
        <fieldset key={skill.id} className="agent-bench-skill" disabled={!canEdit}>
          <legend>{skill.name}</legend>
          <label className="agent-bench-field">
            <span>What it is for</span>
            <Textarea rows={2} value={skill.purpose} onChange={(event) => patchSkill(skill.id, { purpose: event.target.value })} />
          </label>
          <label className="agent-bench-field">
            <span>Steps, one per line</span>
            <Textarea
              rows={Math.min(8, Math.max(2, skill.steps.length + 1))}
              value={lines(skill.steps)}
              onChange={(event) => patchSkill(skill.id, { steps: unlines(event.target.value) })}
            />
          </label>
          <div className="agent-bench-row">
            <label className="agent-bench-field">
              <span>Its answers include</span>
              <Textarea
                rows={2}
                value={lines(skill.mustInclude)}
                onChange={(event) => patchSkill(skill.id, { mustInclude: unlines(event.target.value) })}
              />
            </label>
            <label className="agent-bench-field">
              <span>Its answers leave out</span>
              <Textarea
                rows={2}
                value={lines(skill.mustNotInclude)}
                onChange={(event) => patchSkill(skill.id, { mustNotInclude: unlines(event.target.value) })}
              />
            </label>
          </div>
        </fieldset>
      ))}
      {changes.length > 0 && (
        <p className="foundry-skill-contract" aria-live="polite">
          Changed: {changes.join(", ")}
        </p>
      )}
      {canEdit && (
        <div className="agent-bench-form-actions">
          <Button variant="primary" size="sm" disabled={!changes.length || busy} onClick={() => apply(true)}>
            Apply and run again
          </Button>
          <Button variant="secondary" size="sm" disabled={!changes.length} onClick={() => apply(false)}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" disabled={!draft} onClick={() => setDraft(null)}>
            Discard
          </Button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The section                                                         */
/* ------------------------------------------------------------------ */

export function AgentBench({
  bench,
  content,
  suite,
  canEdit,
  onApply,
}: {
  bench: AgentBenchController;
  content: AgentFoundryContent;
  suite: readonly SkillEvaluationCase[];
  canEdit: boolean;
  /** Commits a changed draft through the editor, as any edit is. */
  onApply: (next: AgentFoundryContent) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const samples = useMemo(
    () => samplePrompts(content, suite, bench.entries.map((entry) => entry.prompt)),
    [bench.entries, content, suite],
  );
  const anyRunning = bench.runningAll || Object.keys(bench.live).length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    bench.addPrompt(text);
    setPrompt("");
    void bench.runPrompt(text);
  }

  function applySuggestionToDraft(suggestion: BenchSuggestion) {
    onApply(applySuggestion(content, suggestion, Date.now()));
    toast.success(`${suggestion.skillName} updated. Run it again to see the difference.`);
  }

  function applyIdeaToDraft(suggestion: BenchModelSuggestion) {
    onApply(applyBenchEdits(content, suggestion.edits, Date.now()));
    toast.success("Applied to the draft. Run it again to see the difference.");
  }

  function applyInstructions(next: AgentFoundryContent, rerun: boolean) {
    onApply(next);
    if (rerun) void bench.runAll(next);
  }

  if (!canEdit)
    return (
      <section className="foundry-block">
        <p className="foundry-empty">The bench is for people who can edit this agent.</p>
      </section>
    );

  return (
    <div className="agent-bench">
      <section className="foundry-block">
        <div className="foundry-block-head">
          <h3>Try it</h3>
          <span className="foundry-block-count">
            {bench.entries.length} question{bench.entries.length === 1 ? "" : "s"}
            {bench.cases.length ? ` · ${bench.cases.length} saved as test${bench.cases.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <p className="foundry-block-lede">
          Ask the draft what students will ask it. Each answer sits beside the one before it, so you can see what an
          edit changed.
        </p>
        <form className="agent-bench-ask" onSubmit={submit}>
          <Textarea
            rows={2}
            value={prompt}
            maxLength={BENCH_LIMITS.prompt}
            aria-label="A question for the agent"
            placeholder="Ask what a student would ask"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
            }}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!prompt.trim()}>
            <Icon name="play" size={14} />
            Run
          </Button>
        </form>
        {samples.length > 0 && (
          <div className="agent-bench-samples">
            <span className="agent-bench-label">From its examples</span>
            {samples.map((sample) => (
              <button key={sample} type="button" className="foundry-chip" onClick={() => bench.addPrompt(sample)}>
                <Icon name="add" size={13} />
                {sample}
              </button>
            ))}
          </div>
        )}
        <div className="agent-bench-compare" role="radiogroup" aria-label="Compare each answer with">
          <span className="agent-bench-label">Compare with</span>
          <button
            type="button"
            role="radio"
            aria-checked={bench.compare === "previous"}
            className="agent-bench-choice"
            onClick={() => bench.setCompare("previous")}
          >
            Its answer before
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={bench.compare === "release"}
            className="agent-bench-choice"
            disabled={bench.compareRelease === undefined}
            title={bench.compareRelease === undefined ? "Nothing is released yet" : undefined}
            onClick={() => bench.setCompare("release")}
          >
            {bench.releases.length > 1
              ? "A release"
              : bench.compareRelease !== undefined
                ? `Release ${bench.compareRelease}`
                : "Last release"}
          </button>
          {bench.compare === "release" && bench.releases.length > 1 && bench.compareRelease !== undefined && (
            <SelectField
              ariaLabel="Which release"
              size="sm"
              value={String(bench.compareRelease)}
              options={bench.releases.map((release) => ({
                value: String(release.releaseNumber),
                label: benchReleaseLabel(release),
              }))}
              onChange={(value) => bench.setCompareRelease(Number(value))}
            />
          )}
        </div>
      </section>

      {bench.status === "loading" && bench.entries.length === 0 ? (
        <p className="foundry-empty">Reading the bench.</p>
      ) : bench.status === "failed" ? (
        <p className="agent-bench-problem" role="alert">
          The saved tests and answers did not load.{" "}
          <button type="button" className="foundry-text-button" onClick={() => void bench.reload()}>
            Try again
          </button>
        </p>
      ) : bench.entries.length === 0 ? (
        <p className="foundry-empty">
          Nothing on the bench yet. Ask a question above, or pick one from its examples.
        </p>
      ) : (
        <ol className="agent-bench-list">
          {bench.entries.map((entry) => (
            <BenchCard
              key={entry.key}
              bench={bench}
              entry={entry}
              content={content}
              canEdit={canEdit}
              onApplySuggestion={applySuggestionToDraft}
              onApplyIdea={applyIdeaToDraft}
            />
          ))}
        </ol>
      )}

      {content.foundry.foundationEstablished && (
        <InstructionsPanel content={content} canEdit={canEdit} busy={anyRunning} onApply={applyInstructions} />
      )}
    </div>
  );
}
