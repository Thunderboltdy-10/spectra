import type {
  SpectraArtifact,
  SpectraArtifactComment,
  SpectraMessage,
  SpectraResultCard,
  SpectraRun,
  SpectraRunTab,
  SpectraThread,
  SpectraWorkspace,
} from "@/features/spectra/data/api";
import { invalidateSpectraCache } from "@/features/spectra/data/api";
import { spectraBus } from "@/features/spectra/events";
import { fn, type ShowcaseWorld } from "@/features/spectra/showcase/showcase-provider";
import type { ShowcaseRequest } from "@/features/spectra/showcase/showcase-transport";
import { ndjsonStream } from "@/features/spectra/showcase/showcase-transport";
import { zonedDay } from "@/features/spectra/today/daily-brief";
import { PAGE_BOARD, SUPERCHARGE } from "./board";
import { CLASS_WORKS, PAST_TASKS, SOURCE_PACK, classOfFolder, classOfProvider, inClass, treeNode } from "./classes";
import { replyFor, type Reply } from "./replies";
import { DEADLINES, LAB_BLOCK, PLAN_BLOCKS, SCHOOL_CLASSES, ZONE, initialCalendar, morningBrief, schoolTask, type WireItem } from "./school";
import { STORY, TODAY } from "./story";
import { ALL_WORKS, CLASSES, WORKS, type ClassKey } from "./works";

/*
 * Henry's Spectra, held in memory for one visit. Every route the real app
 * calls is answered from here, and what a visitor does (asks, plans, moves a
 * block, adds an event) changes it the way it would change Henry's. The page's
 * scenes listen to it too: when a run plans the source analysis, the calendar
 * scene has the blocks because the store has them.
 */

export type WorldEvent =
  | { type: "run_started"; reply: Reply; prompt: string; runId: string; threadId: string; quiet: boolean }
  | { type: "run_finished"; reply: Reply; runId: string; threadId: string }
  | { type: "reading"; workId: string | null }
  | { type: "calendar" };

type Trace = { run: SpectraRun; card: SpectraResultCard; artifacts: SpectraArtifact[] };
type CardView = {
  id: string;
  runId: string;
  status: SpectraResultCard["status"];
  title: string;
  variant: SpectraResultCard["variant"];
  actions: SpectraResultCard["actions"];
  provenance?: SpectraResultCard["provenance"];
  updatedAt: number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Text arrives a few words at a time, as a model writes it. */
function chunks(text: string) {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let index = 0; index < words.length; index += 3) out.push(words.slice(index, index + 3).join(""));
  return out;
}

function workspace(key: ClassKey): SpectraWorkspace {
  const place = CLASSES[key];
  const at = TODAY - 40 * 86_400_000;
  return {
    _id: place.workspaceId,
    title: place.title,
    description: place.teacher,
    status: "active",
    defaultView: "library",
    createdAt: at,
    updatedAt: STORY.evening,
    lastActivityAt: STORY.evening,
    ownership: "owned",
    accessLevel: "modify",
    capabilities: ["read", "modify", "share", "use", "comment"],
  };
}

/** Henry's IA is shared with his teacher through the linked History HL class. */
function sharedWith(artifactId: string) {
  const henry = { accountId: "henry", name: "Henry", role: "owner" as const, edited: true };
  if (artifactId !== "work-ia") return { people: [henry], schoolWide: null, shared: false, isOwner: true, canShare: true, myLevel: "modify" };
  return {
    people: [henry, { accountId: "gonzalez", name: "Ms Gonzalez", role: "edit" as const, through: "History HL", edited: true }],
    schoolWide: null,
    shared: true,
    isOwner: true,
    canShare: true,
    myLevel: "modify",
  };
}

export class StoryWorld {
  calendar: WireItem[] = initialCalendar();
  works = new Map<string, SpectraArtifact>([...ALL_WORKS, ...CLASS_WORKS].map((work) => [work._id, work]));
  threads = new Map<string, SpectraThread>();
  messages = new Map<string, SpectraMessage[]>();
  traces = new Map<string, Trace[]>();
  /** Runs still working, by run. */
  private live = new Map<string, { run: SpectraRun; card: SpectraResultCard; thread: SpectraThread }>();
  /** ManageBac's state as the calendar sees it; "stale" makes it sync. */
  sourceStale = false;
  /** Works that open by id but are not Henry's, so no list of his shows them. */
  private outside = new Map<string, SpectraArtifact>([
    [PAGE_BOARD._id, PAGE_BOARD],
    [SOURCE_PACK._id, SOURCE_PACK],
  ]);
  comments: SpectraArtifactComment[] = [
    {
      _id: "comment-supercharge",
      artifactId: PAGE_BOARD._id,
      authorAccountId: "henry",
      author: { accountId: "henry", name: "Henry", kind: "human" },
      body: "no",
      anchor: { regionId: SUPERCHARGE, fallbackExcerpt: "Supercharge your learning" },
      mentionedAccountIds: [],
      mentions: [],
      status: "open",
      createdAt: STORY.evening - 4 * 86_400_000,
      updatedAt: STORY.evening - 4 * 86_400_000,
    },
    {
      _id: "comment-ia-source",
      artifactId: WORKS.ia._id,
      authorAccountId: "gonzalez",
      author: { accountId: "gonzalez", name: "Ms Gonzalez", kind: "human" },
      body: "Good choice of source. Give it a date and say who Wels was speaking to: that is where its value comes from.",
      anchor: { regionId: "ia-a2", fallbackExcerpt: "The second source is a speech by Otto Wels" },
      mentionedAccountIds: [],
      mentions: [],
      status: "open",
      createdAt: STORY.evening - 26 * 3_600_000,
      updatedAt: STORY.evening - 26 * 3_600_000,
    },
  ];
  /** Runs streaming now. */
  active = 0;
  /** How fast the next run plays: a scene's run is quicker than a visitor's own question. */
  pace = 1;
  /** The next run is a scene's own: it stays a tab on the island while the scene shows what it did. */
  quiet = false;
  /** The next run starts a thread of its own (a new question, not a follow-up to the last one). */
  fresh = false;
  private count = 0;
  private listeners = new Set<(event: WorldEvent) => void>();
  private queryListeners = new Set<() => void>();

  on(listener: (event: WorldEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(event: WorldEvent) {
    if (event.type === "calendar") this.touched();
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Resolves once no run is streaming, so a scene never talks over another's run. */
  whenIdle() {
    if (!this.active) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        stop();
        window.clearTimeout(timer);
        resolve();
      };
      const stop = this.on((event) => {
        if (event.type === "run_finished" && !this.active) done();
      });
      // A run the visitor stopped never finishes; it does not hold the page up.
      const timer = window.setTimeout(() => {
        this.active = 0;
        done();
      }, 20_000);
    });
  }

  /** Convex queries read again. */
  private touched() {
    for (const listener of [...this.queryListeners]) listener();
  }

  private id(prefix: string) {
    this.count += 1;
    return `${prefix}-${this.count}`;
  }

  /** What a teacher has posted in ManageBac that Spectra has not synced yet. */
  private posted: WireItem[] = [];

  /** A teacher posts a task: ManageBac has it, the calendar sees it is behind and syncs it in. */
  post(item: WireItem) {
    if (this.calendar.some((entry) => entry.id === item.id) || this.posted.some((entry) => entry.id === item.id)) return;
    this.posted.push(item);
    this.sourceStale = true;
    spectraBus.emit("calendar.changed", {});
  }

  /** Ms Gonzalez posts the source analysis. */
  postSourceAnalysis() {
    this.post(DEADLINES.sourceAnalysis);
  }

  private syncSchool() {
    this.sourceStale = false;
    for (const item of this.posted) if (!this.calendar.some((entry) => entry.id === item.id)) this.calendar.push(item);
    this.posted = [];
    this.emit({ type: "calendar" });
  }

  /** By midnight the night's work is done, whether or not the visitor asked for it. */
  catchUp() {
    const missing = [DEADLINES.sourceAnalysis, ...PLAN_BLOCKS].filter((item) => !this.calendar.some((entry) => entry.id === item.id));
    this.sourceStale = false;
    if (!missing.length) return;
    this.calendar.push(...missing);
    this.emit({ type: "calendar" });
  }

  /** Something a scene files: it is on the calendar from now on, until the scene takes it back. */
  place(item: WireItem) {
    if (this.calendar.some((entry) => entry.id === item.id)) return;
    this.calendar.push(item);
    this.emit({ type: "calendar" });
    spectraBus.emit("calendar.changed", {});
  }

  /** ManageBac moved something: it keeps its length and lands `by` milliseconds later (or earlier). */
  shift(id: string, by: number) {
    const index = this.calendar.findIndex((entry) => entry.id === id);
    const item = this.calendar[index];
    if (!item) return;
    this.calendar[index] = {
      ...item,
      startAt: item.startAt === undefined ? item.startAt : item.startAt + by,
      endAt: item.endAt === undefined ? item.endAt : item.endAt + by,
      revision: item.revision + 1,
    };
    this.emit({ type: "calendar" });
    spectraBus.emit("calendar.changed", {});
  }

  unplace(...ids: string[]) {
    const before = this.calendar.length;
    this.calendar = this.calendar.filter((entry) => !ids.includes(entry.id));
    if (this.calendar.length === before) return;
    this.emit({ type: "calendar" });
    spectraBus.emit("calendar.changed", {});
  }

  /** A work a scene files, or takes back. */
  file(work: SpectraArtifact) {
    this.works.set(work._id, work);
    // Home keeps the overview for a while; a work filed on the page is there at once.
    invalidateSpectraCache();
    this.touched();
  }

  unfile(...ids: string[]) {
    let changed = false;
    for (const id of ids) changed = this.works.delete(id) || changed;
    if (!changed) return;
    invalidateSpectraCache();
    this.touched();
  }

  private plan(blocks: WireItem[]) {
    for (const block of blocks) if (!this.calendar.some((item) => item.id === block.id)) this.calendar.push(block);
    this.emit({ type: "calendar" });
  }

  /* ---- runs ---- */

  private runStream(request: ShowcaseRequest) {
    const body = request.body ?? {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (body.action !== "run" || !prompt) return json(409, { error: "This run has finished." });
    const reply = replyFor(prompt);
    const runId = this.id("run");
    const fresh = this.fresh;
    this.fresh = false;
    const threadId = !fresh && typeof body.threadId === "string" && this.threads.has(body.threadId) ? body.threadId : this.id("thread");
    const started = Date.now();
    const cardView = (status: SpectraResultCard["status"]) => ({
      id: `card-${runId}`,
      runId,
      status,
      title: reply.title,
      variant: (reply.touched?.length ? "artifact" : "thread") as "artifact" | "thread",
      actions:
        status === "completed" && reply.touched?.length
          ? [{ key: "open", label: "Open", targetType: "artifact" as const, targetId: reply.touched[0]!.id }]
          : [],
      provenance: { threadId, ...(reply.touched?.length ? { artifactIds: reply.touched.map((work) => work.id), artifactTitles: reply.touched.map((work) => work.title) } : {}) },
      updatedAt: Date.now(),
    });
    this.active += 1;
    const quiet = this.quiet;
    this.quiet = false;
    this.emit({ type: "run_started", reply, prompt, runId, threadId, quiet });

    const events: Array<{ wait?: number; event: Record<string, unknown>; before?: () => void }> = [
      { event: { type: "run_created", runId, card: cardView("running") } },
      {
        wait: 120,
        event: { type: "thread_ready", runId, threadId },
        // The island keeps a working run as a tab from the start, so its card can open over it.
        before: () => this.begin({ runId, threadId, prompt, reply, started, card: cardView("running") }),
      },
    ];
    reply.steps.forEach((step, index) => {
      const id = `${runId}-step-${index}`;
      events.push({
        wait: 260,
        event: { type: "step", runId, id, label: step.label, status: "running", ...(step.work ? { work: step.work } : {}) },
        before: () => this.emit({ type: "reading", workId: step.work ?? null }),
      });
      events.push({ wait: 900, event: { type: "step", runId, id, label: step.label, status: "done", durationMs: 900 } });
    });
    if (reply.sources?.length) events.push({ wait: 80, event: { type: "sources", runId, sources: reply.sources } });
    for (const touched of reply.touched ?? []) events.push({ wait: 260, event: { type: "artifact_touched", runId, artifact: touched } });
    if (!this.threads.has(threadId)) events.push({ wait: 60, event: { type: "thread_title", runId, title: reply.title } });
    for (const piece of chunks(reply.text)) events.push({ wait: 42, event: { type: "text_delta", runId, content: piece } });
    events.push({
      wait: 240,
      event: { type: "final", runId, summary: reply.text, card: cardView("completed") },
      // Saved before the island reads the thread back.
      before: () => {
        if (reply.effect === "planned") this.plan(PLAN_BLOCKS);
        if (reply.effect === "planned-lab") this.plan([LAB_BLOCK]);
        this.live.delete(runId);
        this.record({ runId, threadId, prompt, reply, started, card: cardView("completed") });
        this.active = Math.max(0, this.active - 1);
        this.emit({ type: "run_finished", reply, runId, threadId });
      },
    });
    const pace = this.pace;
    this.pace = 1;
    return ndjsonStream(
      events.map((entry) => (entry.wait ? { ...entry, wait: Math.round(entry.wait * pace) } : entry)),
      request.signal,
    );
  }

  /** A run still working, as the island's tab for it. */
  private begin(input: { runId: string; threadId: string; prompt: string; reply: Reply; started: number; card: CardView }) {
    const { runId, threadId, prompt, reply, started } = input;
    const thread: SpectraThread = this.threads.get(threadId) ?? { _id: threadId, title: reply.title, origin: "chat", status: "active", createdAt: started, updatedAt: started };
    const run: SpectraRun = { _id: runId, status: "running", phase: "reading", sourceSurface: "chat", threadId, userPrompt: prompt, createdAt: started, updatedAt: Date.now() };
    const card: SpectraResultCard = { ...this.cardOf(input.card), run, createdAt: started, updatedAt: Date.now() };
    this.live.set(runId, { run, card, thread });
    // The thread is there while it works: the island reads it back to show what was asked.
    this.threads.set(threadId, { ...thread, updatedAt: Date.now(), lastRunId: runId });
    const messages = this.messages.get(threadId) ?? [];
    if (!messages.some((message) => message._id === `${runId}-ask`)) messages.push({ _id: `${runId}-ask`, threadId, role: "user", content: prompt, runId, createdAt: started });
    this.messages.set(threadId, messages);
  }

  private record(input: { runId: string; threadId: string; prompt: string; reply: Reply; started: number; card: CardView }) {
    const { runId, threadId, prompt, reply, started } = input;
    const now = Date.now();
    const thread: SpectraThread = this.threads.get(threadId) ?? {
      _id: threadId,
      title: reply.title,
      origin: "chat",
      status: "active",
      createdAt: started,
      updatedAt: now,
    };
    const messages = this.messages.get(threadId) ?? [];
    if (!messages.some((message) => message._id === `${runId}-ask`)) messages.push({ _id: `${runId}-ask`, threadId, role: "user", content: prompt, runId, createdAt: started });
    messages.push({ _id: `${runId}-answer`, threadId, role: "assistant", content: reply.text, runId, createdAt: now });
    this.messages.set(threadId, messages);
    this.threads.set(threadId, {
      ...thread,
      updatedAt: now,
      lastMessageAt: now,
      lastRunId: runId,
      messageCount: messages.length,
      previewText: reply.text.slice(0, 140),
    });
    const run: SpectraRun = {
      _id: runId,
      status: "completed",
      outcome: reply.touched?.length ? "canonical_saved" : "answer_only",
      phase: "completed",
      sourceSurface: "chat",
      threadId,
      userPrompt: prompt,
      finalSummary: reply.text,
      createdAt: started,
      updatedAt: now,
    };
    const card: SpectraResultCard = { ...this.cardOf(input.card), run, createdAt: started, updatedAt: now };
    const artifacts = (reply.touched ?? []).map((touched) => this.works.get(touched.id)).filter((work): work is SpectraArtifact => Boolean(work));
    this.traces.set(threadId, [...(this.traces.get(threadId) ?? []), { run, card, artifacts }]);
  }

  private cardOf(view: CardView) {
    return { _id: view.id, runId: view.runId, status: view.status, variant: view.variant, title: view.title, actions: view.actions, provenance: view.provenance, createdAt: view.updatedAt, updatedAt: view.updatedAt };
  }

  private allTraces() {
    return [...this.traces.values()].flat().sort((a, b) => b.run.updatedAt - a.run.updatedAt);
  }

  private runTabs(): SpectraRunTab[] {
    const working = [...this.live.values()].map(({ run, card, thread }) => ({
      _id: `tab-${run._id}`,
      runId: run._id,
      threadId: run.threadId!,
      surface: "chat",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      run,
      thread,
      card,
      context: null,
    }) as unknown as SpectraRunTab);
    return [...working, ...this.allTraces().map((trace) => ({
      _id: `tab-${trace.run._id}`,
      runId: trace.run._id,
      threadId: trace.run.threadId!,
      surface: "chat",
      createdAt: trace.run.createdAt,
      updatedAt: trace.run.updatedAt,
      run: trace.run,
      thread: this.threads.get(trace.run.threadId!)!,
      card: trace.card,
      context: null,
    }) as unknown as SpectraRunTab)];
  }

  /* ---- routes ---- */

  private spectraGet(action: string, params: URLSearchParams): unknown {
    const works = [...this.works.values()];
    switch (action) {
      case "overview":
        return { workspaces: (Object.keys(CLASSES) as ClassKey[]).map(workspace), workspace: null, artifacts: works, runs: this.allTraces().map((trace) => trace.run), resultCards: this.allTraces().map((trace) => trace.card) };
      case "workspaceGraphPage":
        return { items: (Object.keys(CLASSES) as ClassKey[]).map(workspace), isDone: true, continueCursor: null };
      case "agentGraphPage":
        return { items: [], isDone: true, continueCursor: null };
      case "workspaceMetadata": {
        const key = (Object.keys(CLASSES) as ClassKey[]).find((entry) => CLASSES[entry].workspaceId === params.get("workspaceId"));
        return { workspace: key ? workspace(key) : null };
      }
      case "artifacts":
        return { artifacts: works };
      case "artifact": {
        const id = params.get("artifactId") ?? "";
        const work = this.works.get(id) ?? this.outside.get(id);
        return work ? { artifact: work } : json(404, { error: "This work is not in the story." });
      }
      case "search": {
        const query = (params.get("search") ?? "").toLowerCase();
        return { artifacts: works.filter((work) => work.title.toLowerCase().includes(query)), workspaces: [] };
      }
      case "runTabs":
        return { runTabs: this.runTabs() };
      case "resultCards":
        return { resultCards: this.allTraces().map((trace) => trace.card) };
      case "runDetail": {
        const trace = this.allTraces().find((entry) => entry.run._id === params.get("runId"));
        return trace ? { run: trace.run, cards: [trace.card], operations: [] } : json(404, { error: "No such run." });
      }
      case "threads":
        return { threads: [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt), hasMore: false, nextCursor: null };
      case "thread": {
        const thread = this.threads.get(params.get("threadId") ?? "");
        if (!thread) return json(404, { error: "No such conversation." });
        return {
          thread,
          messages: this.messages.get(thread._id) ?? [],
          traces: (this.traces.get(thread._id) ?? []).map((trace) => ({ run: trace.run, operations: [], cards: [trace.card], artifacts: trace.artifacts })),
          viewerName: "Henry",
          messagePage: { hasOlder: false },
          activeExecution: null,
        };
      }
      case "threadMessages":
        return { messages: this.messages.get(params.get("threadId") ?? "") ?? [], hasOlder: false };
      case "threadRunTrace": {
        const trace = (this.traces.get(params.get("threadId") ?? "") ?? []).find((entry) => entry.run._id === params.get("runId"));
        return trace ? { run: trace.run, operations: [], cards: [trace.card], events: [], artifacts: trace.artifacts } : json(404, { error: "No such run." });
      }
      case "runEvents":
        return { events: [] };
      case "installedAgents":
      case "publicAgents":
        return { agents: [] };
      case "shareInvitations":
        return { invitations: [] };
      case "notificationCenter":
        return { comments: [], planner: [], timetable: [], invitations: [] };
      case "artifactUserState":
        return { state: null };
      case "artifactComments":
        return { comments: this.comments.filter((comment) => comment.artifactId === params.get("artifactId")) };
      case "artifactLinks":
        return { links: [] };
      default:
        return undefined;
    }
  }

  private calendarGet(params: URLSearchParams) {
    const from = Number(params.get("from"));
    const to = Number(params.get("to"));
    const items = this.calendar.filter((item) => (item.endAt ?? item.startAt ?? 0) >= from && (item.startAt ?? 0) <= to);
    return {
      data: {
        items,
        unscheduledTasks: [],
        partialTimeItems: [],
        timezone: ZONE,
        sourceState: this.sourceStale
          ? { kind: "stale", updatedAt: STORY.evening - 3_600_000, reason: "ManageBac has something new." }
          : { kind: "available", updatedAt: STORY.evening },
        lastUpdatedAt: STORY.evening,
        migration: { complete: true, pageComplete: true, migratedArtifacts: 0, migratedEvents: 0, skippedEvents: 0 },
        pagination: { visible: null, unscheduled: null, planner: null, partial: null, migration: null },
      },
    };
  }

  private calendarPost(body: Record<string, unknown>) {
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
    switch (body.action) {
      case "ensureMigration":
        return { data: { complete: true } };
      case "createPersonalItem": {
        const kind = (typeof body.kind === "string" ? body.kind : "personal_event") as WireItem["kind"];
        const item: WireItem = {
          id: this.id("mine"),
          kind,
          title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "New event",
          startAt: number(body.startAt),
          endAt: number(body.endAt) ?? number(body.startAt),
          allDay: body.allDay === true,
          timezone: ZONE,
          status: "active",
          sourceLocked: false,
          linkedWorkIds: [],
          revision: 1,
        };
        this.calendar.push(item);
        this.emit({ type: "calendar" });
        return { data: item };
      }
      case "scheduleTask": {
        const task = this.calendar.find((item) => item.id === body.taskItemId);
        const item: WireItem = {
          id: this.id("block"),
          kind: "scheduled_work_block",
          title: task ? `Work on ${task.title}` : "Work block",
          startAt: number(body.startAt),
          endAt: number(body.endAt),
          timezone: ZONE,
          status: "active",
          sourceLocked: false,
          classId: task?.classId,
          taskItemId: task?.id,
          linkedWorkIds: [],
          revision: 1,
        };
        this.calendar.push(item);
        this.emit({ type: "calendar" });
        return { data: item };
      }
      case "moveWorkBlock":
      case "updatePersonalItem": {
        const index = this.calendar.findIndex((item) => item.id === body.itemId);
        if (index < 0) return json(404, { error: { message: "That block is no longer here." } });
        const item = { ...this.calendar[index]!, ...(typeof body.title === "string" ? { title: body.title } : {}), startAt: number(body.startAt) ?? this.calendar[index]!.startAt, endAt: number(body.endAt) ?? this.calendar[index]!.endAt, revision: this.calendar[index]!.revision + 1 };
        this.calendar[index] = item;
        this.emit({ type: "calendar" });
        return { data: item };
      }
      case "removePersonalItem": {
        this.calendar = this.calendar.filter((item) => item.id !== body.itemId);
        this.emit({ type: "calendar" });
        return { data: { removed: true } };
      }
      default:
        return { data: null };
    }
  }

  route = (request: ShowcaseRequest): unknown => {
    const { url, method, body } = request;
    switch (url.pathname) {
      case "/api/spectra":
        if (method === "GET") return this.spectraGet(url.searchParams.get("action") ?? "", url.searchParams);
        // Writes the story does not act on succeed quietly.
        return { ok: true };
      case "/api/spectra/run":
        return this.runStream(request);
      case "/api/spectra/calendar":
        return method === "GET" ? this.calendarGet(url.searchParams) : this.calendarPost(body ?? {});
      case "/api/spectra/managebac":
        if (method === "POST" && body?.action === "sync") {
          this.syncSchool();
          return { ok: true, changed: 1 };
        }
        return { connected: true, state: { kind: "available" } };
      case "/api/spectra/administration":
        return { account: { name: "Henry", accountId: "henry" }, membership: { role: "student", schoolName: "Your school" } };
      case "/api/spectra/brief":
        return { ok: true };
      case "/api/spectra/runtime/build": {
        // The story's simulations are one self-contained page; they run as written.
        const files = (body?.files ?? []) as Array<{ source?: string }>;
        const bytes = files.reduce((sum, file) => sum + (file.source?.length ?? 0), 0);
        return { build: { files, sourceBytes: bytes, outputBytes: bytes } };
      }
      case "/api/spectra/runtime/publish":
        // Nothing in the story has been published; the simulation runs from its source.
        return method === "GET" ? { ok: true, build: null, sourceMatchesCurrent: false } : json(400, { error: "Publishing is not part of the story." });
      case "/api/spectra/assets":
        // Nothing is uploaded in the story; an image dropped on a work stays on the page.
        return method === "GET" ? { ok: true, assets: [] } : json(400, { error: "Uploads are not part of the story." });
      default:
        return undefined;
    }
  };

  /** What Convex answers inside the story. */
  queries(): ShowcaseWorld["queries"] {
    const morningDay = zonedDay(STORY.morning, ZONE);
    return {
      [fn("catalogGraph", "identity")]: () => ({ accountId: "henry", schoolId: "school", membershipId: "membership-henry" }),
      [fn("school", "classes")]: () => ({ classes: SCHOOL_CLASSES }),
      [fn("school", "tasks")]: (args) => {
        const due = this.calendar.filter((item) => item.kind === "official_deadline");
        // A class's own page asks for its whole term: what is due and what is past.
        if (typeof args.providerClassId !== "string") return { tasks: due.map(schoolTask) };
        return { tasks: [...due, ...PAST_TASKS].filter((item) => item.classId === args.providerClassId).map(schoolTask) };
      },
      [fn("orgTree", "listChildren")]: (args) => {
        const parentId = String(args.parentId ?? "");
        const key = classOfFolder(parentId);
        // One page, as Convex pages a list: the whole class fits on it.
        const page = key ? [...this.works.values()].filter((work) => inClass(work, key)).map((work) => treeNode(work, parentId)) : [];
        return { page, isDone: true, continueCursor: "end" };
      },
      [fn("workspaceSharing", "sharedWorks")]: (args) => {
        const key = classOfProvider(`mb-${String(args.workspaceId ?? "").replace(/^ws-/, "")}`);
        if (key !== "history") return [];
        return [
          {
            workspaceId: "ws-gonzalez-history",
            title: CLASSES.history.title,
            author: CLASSES.history.teacher,
            level: "read",
            works: [{ ...treeNode(SOURCE_PACK, "ws-gonzalez-history"), author: CLASSES.history.teacher, accessLevel: "read" }],
          },
        ];
      },
      [fn("workStacks", "members")]: () => [],
      [fn("dailyBriefs", "today")]: (args) =>
        args.day === morningDay ? { state: "ready", day: morningDay, ...morningBrief() } : null,
      [fn("bridge", "hasDevice")]: () => true,
      [fn("spectraThreads", "pulse")]: () => null,
      [fn("platformControls", "status")]: () => ({ stopped: false }),
      [fn("accountPreferences", "layers")]: () => [],
      [fn("replicas", "forWork")]: () => ({ replicas: [], conflicts: [], openConflictCount: 0, pendingCount: 0, recentOperations: [] }),
      [fn("syncPolicy", "effective")]: () => null,
      [fn("bridge", "activeMounts")]: () => [],
      [fn("sharingPeople", "forArtifact")]: (args) => sharedWith(String(args.artifactId ?? "")),
    };
  }

  /** The world as the showcase provider takes it. */
  showcase(): ShowcaseWorld & { subscribe: (listener: () => void) => () => void } {
    return {
      queries: this.queries(),
      route: this.route,
      subscribe: (listener) => {
        this.queryListeners.add(listener);
        return () => void this.queryListeners.delete(listener);
      },
    };
  }

  /** Works Spectra has made in the story so far, newest first. */
  get madeWorks() {
    return [WORKS.quiz, WORKS.cards, WORKS.deck];
  }
}
