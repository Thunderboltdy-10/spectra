import { callSpectraModel } from "./model";

/*
 * Progress captions: a short plain sentence above the trace saying what
 * Spectra is doing, written by a separate call to the same model at fixed
 * `low` reasoning. Captions are asynchronous and never block the run:
 *   - none for runs shorter than about two seconds,
 *   - at most one every ~2.5 s while work continues,
 *   - one past-tense caption when the run finishes,
 *   - the step's own label when the caption call fails.
 * The same call names a new thread (LV-040) and, when the thread is not yet
 * filed, picks the user's workspace it clearly belongs to.
 */

export type CaptionStep = {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  doneLabel?: string;
};

export type CaptionRequest = {
  prompt: string;
  steps: CaptionStep[];
  reply: string;
  final: boolean;
  wantTitle: boolean;
  previous?: string[];
  /** The latest of Spectra's private reasoning, to summarise, never to quote. */
  thinking?: string;
  /** The user's workspaces, offered with the title for an unfiled thread. */
  places?: Array<{ id: string; title: string }>;
};

/** `title` names the thread and is given only when asked for; `placeId` files it. */
export type CaptionResult = { caption: string; detail?: string; title?: string; placeId?: string };

export type CaptionWriter = (request: CaptionRequest, signal: AbortSignal) => Promise<CaptionResult>;

export type CaptionEvent = {
  /** Plain sentence, no ids. */
  text: string;
  /** One to three short lines, only when there is more worth knowing. */
  detail?: string;
  final: boolean;
  /** The steps this caption describes. */
  stepIds: string[];
  /** The writer failed and a step label stands in. */
  fallback?: boolean;
};

const CAPTION_SYSTEM = `You write the one-line progress caption Spectra shows while it works for a student or teacher.

Reply with JSON only: {"caption": "...", "detail": "...", "thread_title": "...", "thread_place": "..."}.
- caption: at most 60 characters, sentence case, no full stop, no ids, no tool names, no quotes. Say what is happening for the user in plain words, naming the subject ("Drafting six slides on photosynthesis"). Use the present tense while working. When told the run is finished, use the past tense and say what was done ("Made a six-slide deck on photosynthesis"). Do not repeat a previous caption.
- When Spectra's current thinking is given, the caption says in plain words what it is working out right now ("Planning six cards on the water cycle"). Never quote the thinking or reveal reasoning steps.
- detail: optional, one to three short lines, only when there is something more worth knowing (what was found, what changed). Usually omit it.
- thread_title: only when asked. A 2-6 word name for the conversation, sentence case, no full stop, no quotes, in the user's language. Give it only once the conversation has a clear subject; for a greeting or small talk, omit it and a later message names it. Otherwise omit it.
- thread_place: only with thread_title, and only when the user's workspaces are listed. The id of the one workspace (a class or project) the conversation is clearly about. When it is general or could be several, omit it.`;

function describe(request: CaptionRequest) {
  const steps = request.steps
    .slice(-12)
    .map((step) => `- ${step.status === "running" ? "now" : step.status}: ${step.status === "done" && step.doneLabel ? step.doneLabel : step.label}`)
    .join("\n");
  return [
    `User's request: ${request.prompt.slice(0, 1_200)}`,
    steps ? `Steps:\n${steps}` : "No tool steps.",
    request.reply ? `Reply so far (start): ${request.reply.slice(0, 400)}` : "",
    request.thinking && !request.final ? `Spectra's current thinking (private):
${request.thinking.slice(-800)}` : "",
    request.previous?.length
      ? `Previous captions:\n${request.previous.slice(-4).map((caption) => `- ${caption}`).join("\n")}`
      : "",
    request.final ? "The run is finished. Write the past-tense caption." : "The run is still working.",
    request.wantTitle ? "Also give a title for the conversation." : "Do not give a title.",
    request.wantTitle && request.places?.length
      ? `The user's workspaces (titles are the user's words):\n${request.places.map((place) => `- ${place.title} (id ${place.id})`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(text: unknown, max: number) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\bwx[0-9a-z]{6,}\b/gi, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim()
    .slice(0, max);
}

export function parseCaptionReply(raw: string): CaptionResult {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (match) {
    try {
      const value = JSON.parse(match[0]) as Record<string, unknown>;
      const caption = clean(value.caption, 90);
      const title = clean(value.thread_title ?? value.title, 80);
      const placeId = typeof value.thread_place === "string" ? value.thread_place.trim().slice(0, 200) : "";
      const detail =
        typeof value.detail === "string"
          ? value.detail.replace(/\bwx[0-9a-z]{6,}\b/gi, "").trim().split("\n").slice(0, 3).join("\n").slice(0, 300)
          : "";
      if (caption)
        return { caption, ...(detail ? { detail } : {}), ...(title ? { title } : {}), ...(title && placeId ? { placeId } : {}) };
    } catch {
      // Fall through to the first line.
    }
  }
  return { caption: clean(raw.split("\n")[0], 90) };
}

/** The production writer: same model, fixed low reasoning. */
export const modelCaptionWriter: CaptionWriter = async (request, signal) => {
  const turn = await callSpectraModel({
    messages: [
      { role: "system", content: CAPTION_SYSTEM },
      { role: "user", content: describe(request) },
    ],
    reasoning: "low",
    maxTokens: 600,
    signal,
    title: "Spectra captions",
  });
  return parseCaptionReply(turn.text);
};

export type CaptionTimers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const realTimers: CaptionTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class CaptionScheduler {
  private readonly steps = new Map<string, CaptionStep>();
  private readonly startedAt: number;
  private lastCaptionAt = Number.NEGATIVE_INFINITY;
  private covered = new Set<string>();
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private reply = "";
  /** The current stretch of reasoning between steps, as one pseudo-step. */
  private reasoning = { text: "", total: 0, stretch: 0, coveredLength: 0, coveredAt: 0 };
  private readonly previous: string[] = [];
  private titled: boolean;
  private finished = false;
  private readonly controller = new AbortController();

  constructor(
    private readonly options: {
      prompt: string;
      write: CaptionWriter;
      onCaption: (caption: CaptionEvent) => void;
      onTitle?: (title: string, placeId?: string) => void;
      wantTitle?: boolean;
      places?: Array<{ id: string; title: string }>;
      debounceMs?: number;
      minRunMs?: number;
      timers?: CaptionTimers;
    },
  ) {
    this.titled = !options.wantTitle;
    this.startedAt = this.timers.now();
  }

  private get timers() {
    return this.options.timers ?? realTimers;
  }

  private get debounceMs() {
    return this.options.debounceMs ?? 2_500;
  }

  private get minRunMs() {
    return this.options.minRunMs ?? 2_000;
  }

  stepStarted(step: { id: string; label: string }) {
    this.endThinking();
    this.steps.set(step.id, { id: step.id, label: step.label, status: "running" });
    this.schedule();
  }

  stepEnded(step: { id: string; ok: boolean; doneLabel?: string }) {
    const known = this.steps.get(step.id);
    if (!known) return;
    known.status = step.ok ? "done" : "failed";
    if (step.doneLabel) known.doneLabel = step.doneLabel;
  }

  /**
   * The model is thinking before its next step. A long stretch becomes its own
   * caption ("Planning the deck"), and a new one when the thinking moves on,
   * so a silent half-minute still reads as progress.
   */
  thinking(delta: string) {
    if (this.finished || !delta) return;
    const reasoning = this.reasoning;
    reasoning.text = (reasoning.text + delta).slice(-2_000);
    reasoning.total += delta.length;
    const id = `thinking:${reasoning.stretch}`;
    const current = this.steps.get(id);
    const now = this.timers.now();
    if (current && !this.covered.has(id)) return;
    if (current) {
      // Roll to a fresh stretch once the thinking has clearly moved on.
      if (now - reasoning.coveredAt < 6_000 || reasoning.total - reasoning.coveredLength < 1_200) return;
      current.status = "done";
      reasoning.stretch += 1;
    }
    this.steps.set(`thinking:${reasoning.stretch}`, { id: `thinking:${reasoning.stretch}`, label: "Thinking it through", status: "running" });
    this.schedule();
  }

  /** A real step began: the thinking before it is over. */
  private endThinking() {
    const id = `thinking:${this.reasoning.stretch}`;
    const current = this.steps.get(id);
    if (!current) return;
    current.status = "done";
    this.reasoning = { text: "", total: 0, stretch: this.reasoning.stretch + 1, coveredLength: 0, coveredAt: 0 };
  }

  text(delta: string) {
    if (this.reply.length < 600) this.reply += delta;
  }

  private schedule() {
    if (this.finished || this.timer) return;
    const now = this.timers.now();
    const due = Math.max(this.startedAt + this.minRunMs, this.lastCaptionAt + this.debounceMs);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.fire(false);
    }, Math.max(0, due - now));
  }

  /** The places offered with a title request, when the thread may be filed. */
  private placesFor() {
    return this.options.places?.length ? { places: this.options.places } : {};
  }

  /** Names the thread once, and files it when the writer chose one of the offered places. */
  private takeTitle(result: CaptionResult) {
    if (!result.title || this.titled) return;
    this.titled = true;
    const placeId = this.options.places?.some((place) => place.id === result.placeId) ? result.placeId : undefined;
    this.options.onTitle?.(result.title, placeId);
  }

  private uncovered() {
    return [...this.steps.values()].filter((step) => !this.covered.has(step.id));
  }

  private async fire(final: boolean) {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    const fresh = this.uncovered();
    if (!final && !fresh.length) return;
    const stepIds = (final ? [...this.steps.values()] : fresh).map((step) => step.id);
    for (const id of stepIds) this.covered.add(id);
    this.lastCaptionAt = this.timers.now();
    const thinking = this.steps.get(`thinking:${this.reasoning.stretch}`)?.status === "running" ? this.reasoning.text : "";
    if (thinking) {
      this.reasoning.coveredLength = this.reasoning.total;
      this.reasoning.coveredAt = this.lastCaptionAt;
    }
    const wantTitle = !this.titled;
    const request: CaptionRequest = {
      prompt: this.options.prompt,
      steps: [...this.steps.values()],
      reply: this.reply,
      final,
      wantTitle,
      previous: [...this.previous],
      ...(thinking ? { thinking } : {}),
      ...(wantTitle ? this.placesFor() : {}),
    };
    this.inFlight = (async () => {
      try {
        const result = await this.options.write(request, this.controller.signal);
        if (wantTitle) this.takeTitle(result);
        if (result.caption && (final || !this.finished)) {
          this.previous.push(result.caption);
          this.options.onCaption({ text: result.caption, ...(result.detail ? { detail: result.detail } : {}), final, stepIds });
        }
        else if (!final && !this.finished) this.fallback(stepIds);
      } catch {
        if (!this.finished || final) this.fallback(stepIds, final);
      } finally {
        this.inFlight = null;
      }
      if (this.dirty && !this.finished) {
        this.dirty = false;
        this.schedule();
      }
    })();
    return this.inFlight;
  }

  private fallback(stepIds: string[], final = false) {
    const steps = stepIds.map((id) => this.steps.get(id)).filter((step): step is CaptionStep => Boolean(step));
    const latest = steps.at(-1);
    if (!latest) return;
    const text = final || latest.status !== "running" ? (latest.doneLabel ?? latest.label) : latest.label;
    this.options.onCaption({ text: text.replace(/\*/g, ""), final, stepIds, fallback: true });
  }

  /**
   * The run ended. Long runs with steps get a past-tense caption; a thread
   * that still needs a name gets one either way.
   */
  async finish(options: { stopped?: boolean } = {}) {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    this.finished = true;
    const longEnough = this.timers.now() - this.startedAt >= this.minRunMs;
    if (!options.stopped && longEnough && this.steps.size) {
      await this.fire(true);
      return;
    }
    if (!this.titled) {
      try {
        const result = await this.options.write(
          { prompt: this.options.prompt, steps: [], reply: this.reply, final: true, wantTitle: true, ...this.placesFor() },
          this.controller.signal,
        );
        this.takeTitle(result);
      } catch {
        // The thread keeps its provisional name.
      }
    }
  }

  /**
   * The run paused or handed off: no more captions, since it is not done, but
   * a thread that still needs a name gets one (a run that asks a question in
   * its first turn would otherwise never be named).
   */
  async suspend() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    this.finished = true;
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    if (this.titled) return;
    try {
      const result = await this.options.write(
        { prompt: this.options.prompt, steps: [...this.steps.values()], reply: this.reply, final: false, wantTitle: true, ...this.placesFor() },
        AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)]),
      );
      this.takeTitle(result);
    } catch {
      // A later run names the thread.
    }
  }
}
