import { randomUUID } from "node:crypto";
import { agentHubTicket } from "../../../../../shared/agent-hub-ticket.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { convexQuery } from "@/lib/convex-server";
import { localBridgeRelay } from "@/lib/local-bridge-relay";
import type { SpectraReasoningProfile } from "../model-config";
import { getSpectraReasoningProfile, getSpectraModelId } from "../model-config";
import type { ModelCaller } from "./loop";
import { jsonSize, traceEvent, traceRaw } from "./run-trace";
import {
  ProviderUnavailableError,
  type HarnessContentPart,
  type HarnessMessage,
  type HarnessToolCall,
  type ModelTurn,
  type ModelUsage,
  type ProviderToolSpec,
} from "./types";

/*
 * Runs Spectra's harness on the user's own logged-in `codex` or `claude` CLI,
 * through the Bridge's stdio relay. The user's own setting selects it, and
 * SPECTRA_AI_RUNTIME overrides that for local tests.
 *
 * Both CLIs own their agent loop, and Spectra's loop expects to own it too. So
 * the caller is inverted: a harness "model call" returns as soon as the CLI
 * asks for a tool, with the CLI's request held open. The next harness call
 * finds the result in the tool messages, answers the held request, and goes
 * back to streaming. The prompt, tools and checkpoints do not change.
 *
 * The transcript is the only thing that crosses between runtimes. Each CLI's
 * thread keeps its own reasoning, encrypted or signed, and that reasoning dies
 * with the thread. A run can leave one runtime for another at any tool boundary,
 * and a thread can move between them from one message to the next, because a new
 * thread on any runtime starts from the same plain transcript.
 *
 * A deployed server reaches the Bridge through the agent hub in the
 * collaboration gateway (SPECTRA_AGENT_HUB_URL), with a ticket that names the
 * account. A server on the same computer reaches it directly with a token file.
 */

export type SubscriptionProvider = "codex" | "claude";

export type DisposableModelCaller = ModelCaller & { dispose?: () => void };

/** Who this runs for, on what. Empty fields take the deployment's defaults. */
export type RuntimeTarget = {
  accountId?: string;
  model?: string;
  reasoning?: SpectraReasoningProfile;
};

export type RuntimeProviderStatus = {
  state: "ready" | "signed-out" | "not-installed" | "no-bridge" | "error";
  account?: string;
  plan?: string;
  models: Array<{ id: string; label: string }>;
};

export type OneShotRequest = RuntimeTarget & {
  messages: HarnessMessage[];
  signal: AbortSignal;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  reasoning?: SpectraReasoningProfile;
  responseFormat?: Record<string, unknown>;
  title?: string;
  purpose?: string;
  /** Bookkeeping such as a title: the subscription's smallest model, not the person's choice. */
  small?: boolean;
};

const RELAY_URL = "ws://127.0.0.1:47615/v1/agent/connect";
const HUB_TICKET_MS = 60_000;
/** Close codes the agent hub uses when it cannot reach the account's Bridge. */
const HUB_NO_BRIDGE = 4404;
const HUB_PIPE_TIMEOUT = 4408;
/** An unused app-server is let go after this long. */
const CONNECTION_IDLE_MS = 5 * 60_000;
/** Through the hub, a connection idle this long may not have survived; a new one is quick. */
const HUB_REUSE_MS = 45_000;
const STATUS_TIMEOUT_MS = 12_000;
/**
 * Nothing at all from the CLI for this long means it has gone away. Twice the
 * longest healthy gap in the launch traces (64 s of Codex reasoning between two
 * items, 2026-11-08), held to the 45–120 s range.
 */
const IDLE_TIMEOUT_MS = 120_000;
/** Starting a thread or a turn is bookkeeping; it should never take long. */
const CONTROL_TIMEOUT_MS = 25_000;
/** A warm app-server is reused for this many threads, then replaced. */
const THREADS_PER_CONNECTION = 40;
/** Parallel tool requests arrive within a moment of each other. */
const TOOL_BATCH_MS = 40;

export function subscriptionProvider(): SubscriptionProvider | null {
  const value = process.env.SPECTRA_AI_RUNTIME?.trim().toLowerCase();
  return value === "codex" || value === "claude" ? value : null;
}

export function subscriptionProviderFrom(preference: unknown): SubscriptionProvider | null {
  return subscriptionProvider() ?? (preference === "codex" || preference === "claude" ? preference : null);
}

const hubUrl = () => process.env.SPECTRA_AGENT_HUB_URL?.trim().replace(/\/$/, "") || null;

async function authenticatedRuntimeAccount() {
  const actor = await convexQuery<Record<string, never>, { accountId: string } | null>("identity:me", {});
  if (!actor?.accountId) throw new ProviderUnavailableError("Spectra Bridge requires an authenticated account.");
  return actor.accountId;
}

async function relayEndpoint(provider: SubscriptionProvider, accountId: string | undefined) {
  const hub = hubUrl();
  const owner = accountId ?? await authenticatedRuntimeAccount();
  if (!hub) {
    try {
      const relay = await localBridgeRelay(owner);
      return { url: `${RELAY_URL}?provider=${provider}&${relay.query}`, protocols: ["spectra-agent", relay.token] };
    } catch (error) {
      throw new ProviderUnavailableError(error instanceof Error ? error.message : "Spectra Bridge can't be reached.");
    }
  }
  const secret = process.env.SPECTRA_COLLAB_TOKEN_SECRET?.trim();
  if (!secret) throw new ProviderUnavailableError("Spectra Bridge can't be reached from this server.");
  return {
    url: `${hub}/_spectra/agent-hub/server?provider=${provider}`,
    protocols: ["spectra-agent", await agentHubTicket(owner, secret, HUB_TICKET_MS)],
  };
}

const PROVIDER_NAME: Record<SubscriptionProvider, string> = { codex: "Codex", claude: "Claude Code" };

function relayErrorMessage(provider: SubscriptionProvider, detail: string) {
  return detail === "not-installed" ? `${PROVIDER_NAME[provider]} isn't installed on this computer.` : detail;
}

function relayCloseMessage(provider: SubscriptionProvider, code: number | undefined) {
  if (code === HUB_NO_BRIDGE) return "Spectra Bridge isn't connected on your computer.";
  if (code === HUB_PIPE_TIMEOUT) return "Spectra Bridge didn't answer.";
  return `Could not reach Spectra Bridge for ${PROVIDER_NAME[provider]}.`;
}

/** Spectra's tools as a minimal MCP server, for one Claude Code session. */
async function answerMcp(
  tools: ProviderToolSpec[],
  call: (name: string, args: unknown) => Promise<string>,
  body: string,
): Promise<string | undefined> {
  const rpc = JSON.parse(body) as { id?: number | string; method?: string; params?: Record<string, unknown> };
  if (rpc.id === undefined) return undefined;
  const result = (value: unknown) => JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: value });
  switch (rpc.method) {
    case "initialize":
      return result({
        protocolVersion: rpc.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "spectra", version: "0.1.0" },
      });
    case "ping":
      return result({});
    case "tools/list":
      return result({
        tools: tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
      });
    case "tools/call":
      return result({
        content: [{ type: "text", text: await call(String(rpc.params?.name), rpc.params?.arguments) }],
      });
    default:
      return JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
  }
}

class RelaySocket {
  private socket?: WebSocket;
  private closed = false;
  onFrame: (frame: Record<string, unknown>) => void = () => undefined;
  onClose: (reason: string) => void = () => undefined;
  /** A line the CLI wrote that is not a JSON frame on its own. */
  onLine: (line: string) => void = () => undefined;
  /** What the Bridge did with a setup request: "opened", "unsupported" or "failed". */
  setupResult?: string;
  /** A request from the CLI to Spectra's tools. */
  onMcp: (body: string) => Promise<string | undefined> = async () => undefined;
  readonly ready: Promise<void>;

  constructor(provider: SubscriptionProvider, start: RelayStart, accountId?: string) {
    this.ready = this.connect(provider, start, accountId);
  }

  private async connect(provider: SubscriptionProvider, start: RelayStart, accountId?: string) {
    const endpoint = await relayEndpoint(provider, accountId);
    if (this.closed) throw new ProviderUnavailableError("The AI session has closed.");
    const socket = this.socket = new WebSocket(endpoint.url, endpoint.protocols);
    return new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify(start));
      });
      socket.addEventListener("message", (event) => {
        const raw = String(event.data);
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          this.onLine(raw);
          return;
        }
        if (typeof frame.relay === "string") {
          if (frame.relay === "mcp") {
            this.answer(frame.id, String(frame.body));
            return;
          }
          traceRaw("relay", frame);
          if (frame.relay === "setup") {
            this.setupResult = String(frame.detail);
            resolve();
          }
          if (frame.relay === "started") resolve();
          if (frame.relay === "error") {
            const message = relayErrorMessage(provider, String(frame.detail));
            reject(new ProviderUnavailableError(message));
            this.handleClose(message);
          }
          if (frame.relay === "exit") this.handleClose(`The ${PROVIDER_NAME[provider]} process ended (${String(frame.detail)}).`);
          return;
        }
        this.onFrame(frame);
      });
      const failed = (event: Event) => {
        const message = relayCloseMessage(provider, (event as CloseEvent).code);
        reject(new ProviderUnavailableError(message));
        this.handleClose(message);
      };
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
  }

  private answer(id: unknown, body: string) {
    this.onMcp(body)
      .catch((error: unknown) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: error instanceof Error ? error.message : "The tool could not run." },
        }),
      )
      .then((reply) => {
        if (this.closed || !this.socket) return;
        // The Bridge reads a reply by these exact first characters.
        this.socket.send(JSON.stringify(reply === undefined ? { relayReply: id } : { relayReply: id, body: reply }));
      });
  }

  private handleClose(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.onClose(reason);
  }

  get isClosed() {
    return this.closed;
  }

  send(frame: unknown) {
    if (this.closed || !this.socket) throw new ProviderUnavailableError("The AI session has closed.");
    this.socket.send(JSON.stringify(frame));
  }

  close() {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      // Already gone.
    }
  }
}

function contentText(content: string | HarnessContentPart[]) {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "image_url") return "[Attached image]";
      return `[Attached file: ${part.file.filename}]`;
    })
    .join("\n");
}

/** A PDF without extracted text: Codex takes only text and images. */
function unreadableFile(content: string | HarnessContentPart[]) {
  return typeof content !== "string" && content.some((part) => part.type === "file");
}

function imageUrls(content: string | HarnessContentPart[]) {
  if (typeof content === "string") return [];
  return content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
}

/** Tool names and instructions a thread was started with; it cannot change them later. */
function threadShape(messages: HarnessMessage[], tools: ProviderToolSpec[]) {
  return `${systemOf(messages)}\n${tools.map((tool) => tool.function.name).join(",")}`;
}

/** Prior messages as one text, for a provider thread that has not seen them. */
function transcriptFor(messages: HarnessMessage[]) {
  if (messages.length === 1 && messages[0]?.role === "user") return contentText(messages[0].content);
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") lines.push(`User:\n${contentText(message.content)}`);
    if (message.role === "assistant") {
      if (message.content) lines.push(`You replied:\n${message.content}`);
      for (const call of message.tool_calls ?? [])
        lines.push(`You called ${call.function.name}(${call.function.arguments})`);
    }
    if (message.role === "tool") lines.push(`Tool result:\n${message.content}`);
  }
  const last = messages[messages.length - 1];
  const closing =
    last?.role === "user"
      ? "The last User message above is the current one. Respond to it."
      : "Continue from here.";
  return `This is the conversation so far.\n\n${lines.join("\n\n")}\n\n${closing}`;
}

function systemOf(messages: HarnessMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => contentText(message.content))
    .join("\n\n");
}

/** Spectra names models as "vendor/model"; the CLI wants the bare name. */
function defaultCodexModel() {
  const configured = process.env.SPECTRA_CODEX_MODEL?.trim();
  if (configured) return configured;
  const id = getSpectraModelId();
  return id.slice(id.indexOf("/") + 1);
}

/** Each account's smallest Codex model, learned when its status is read. */
const smallestCodexModels = new Map<string, string>();

/** The smallest of an account's Codex models: a "nano", else a "mini". */
export function smallestCodexModel(models: ReadonlyArray<{ id: string }>) {
  return models.find((model) => /nano/i.test(model.id))?.id ?? models.find((model) => /mini/i.test(model.id))?.id;
}

function defaultClaudeModel() {
  return process.env.SPECTRA_CLAUDE_MODEL?.trim() || "sonnet";
}

/** Codex accepts medium and high directly; "none" and "minimal" map down to low. */
function codexEffort(profile: SpectraReasoningProfile) {
  return profile === "none" || profile === "minimal" ? "low" : profile;
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/* ------------------------------------------------------------------ Codex */

type CodexListener = {
  onNotification: (method: string, params: Record<string, unknown>) => void;
  onToolCall: (requestId: number | string, params: Record<string, unknown>) => void;
  onConnectionLost: (reason: string) => void;
};

/** One warm `codex app-server`; every thread in this process shares it. */
class CodexConnection {
  private relay: RelaySocket;
  private nextId = 1;
  private waiting = new Map<number, Deferred<Record<string, unknown>>>();
  private threads = new Map<string, CodexListener>();
  readonly ready: Promise<void>;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  lost = false;
  threadsStarted = 0;
  userServers: string[] = [];
  idleSince = Date.now();

  constructor(accountId: string | undefined) {
    this.relay = new RelaySocket("codex", { args: ["app-server"] }, accountId);
    this.relay.onFrame = (frame) => this.handle(frame);
    this.relay.onClose = (reason) => {
      this.lost = true;
      for (const entry of this.waiting.values()) entry.reject(new ProviderUnavailableError(reason));
      this.waiting.clear();
      for (const listener of this.threads.values()) listener.onConnectionLost(reason);
      this.threads.clear();
    };
    this.ready = this.relay.ready.then(async () => {
      const started = Date.now();
      await this.request("initialize", {
        clientInfo: { name: "spectra", title: "Spectra", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      this.relay.send({ method: "initialized" });
      const account = await this.request("account/read", { refreshToken: false });
      if (!account.account)
        throw new ProviderUnavailableError("Log in to Codex on this computer to use it in Spectra.");
      const config = await this.request("config/read", {}).catch(() => ({}) as Record<string, unknown>);
      const servers = (config.config as { mcp_servers?: Record<string, unknown> } | undefined)?.mcp_servers;
      this.userServers = Object.keys(servers ?? {});
      traceEvent("codex.connected", { ms: Date.now() - started, userServers: this.userServers.length });
    });
  }

  listen(threadId: string, listener: CodexListener) {
    clearTimeout(this.idleTimer);
    this.threads.set(threadId, {
      ...listener,
      onNotification: AsyncLocalStorage.bind(listener.onNotification),
    });
  }

  forget(threadId?: string) {
    if (threadId) this.threads.delete(threadId);
    if (!this.idle) return;
    this.idleSince = Date.now();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.idle && !this.lost) this.abandon("Unused for a while.");
    }, CONNECTION_IDLE_MS);
    this.idleTimer.unref?.();
  }

  request(method: string, params: unknown) {
    const id = this.nextId++;
    const entry = deferred<Record<string, unknown>>();
    this.waiting.set(id, entry);
    const timer = setTimeout(() => {
      traceEvent("codex.request_timeout", { method });
      this.abandon(`Codex did not answer ${method} in time.`);
    }, CONTROL_TIMEOUT_MS);
    const settled = () => clearTimeout(timer);
    entry.promise.then(settled, settled);
    // A closed session answers with a failed promise, never a throw: callers
    // tear down with `void request(...).catch()`.
    try {
      this.relay.send({ id, method, params });
    } catch (error) {
      this.waiting.delete(id);
      entry.reject(error instanceof Error ? error : new ProviderUnavailableError("The AI session has closed."));
    }
    return entry.promise;
  }

  /** Stop using this app-server: everything waiting on it fails, and the next run starts another. */
  abandon(reason: string) {
    this.lost = true;
    this.relay.onClose(reason);
    this.relay.close();
  }

  get idle() {
    return this.threads.size === 0;
  }

  respond(id: number | string, result: unknown) {
    if (this.lost || this.relay.isClosed) throw new ProviderUnavailableError("The Codex session ended before the run finished.");
    this.relay.send({ id, result });
  }

  private handle(frame: Record<string, unknown>) {
    const method = typeof frame.method === "string" ? frame.method : null;
    const params = (frame.params ?? {}) as Record<string, unknown>;
    if (!method) {
      const entry = this.waiting.get(frame.id as number);
      if (!entry) return;
      this.waiting.delete(frame.id as number);
      if (frame.error) entry.reject(new Error(JSON.stringify(frame.error).slice(0, 400)));
      else entry.resolve((frame.result ?? {}) as Record<string, unknown>);
      return;
    }
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    const listener = threadId ? this.threads.get(threadId) : null;
    if (frame.id !== undefined) {
      if (method === "item/tool/call" && listener) listener.onToolCall(frame.id as number | string, params);
      else this.relay.send({ id: frame.id, error: { code: -32601, message: `${method} is not available in Spectra.` } });
      return;
    }
    if (!listener && method.includes("arning")) traceRaw("codex.global", { method, params });
    listener?.onNotification(method, params);
  }
}

/** One app-server per account: it runs on that person's computer, on their login. */
const globalStore = globalThis as unknown as { __spectraCodexConnections?: Map<string, CodexConnection> };
function codexConnections() {
  globalStore.__spectraCodexConnections ??= new Map();
  return globalStore.__spectraCodexConnections;
}

async function codexConnection(accountId: string | undefined) {
  const connections = codexConnections();
  const key = accountId ?? await authenticatedRuntimeAccount();
  const existing = connections.get(key);
  // Threads pile up inside a long-lived app-server. Swap it when nothing is using it.
  if (existing && !existing.lost && existing.threadsStarted >= THREADS_PER_CONNECTION && existing.idle) {
    traceEvent("codex.recycled", { threads: existing.threadsStarted });
    existing.abandon("Replaced by a fresh Codex session.");
  }
  if (existing && !existing.lost && existing.idle && hubUrl() && Date.now() - existing.idleSince > HUB_REUSE_MS)
    existing.abandon("Idle through the hub.");
  if (existing && !existing.lost) {
    await existing.ready;
    return existing;
  }
  const connection = new CodexConnection(key);
  connections.set(key, connection);
  try {
    await connection.ready;
  } catch (error) {
    if (connections.get(key) === connection) connections.delete(key);
    throw error;
  }
  return connection;
}

/**
 * Start the person's runtime before they send (LAUNCH-REVIEW A6.4): the
 * composer asks as it takes focus, so the first turn finds Codex connected
 * instead of spending a second and a half starting it. An unused warm
 * connection closes on the usual idle timer. Claude Code starts per run, so
 * there is nothing to warm; a runtime that cannot be reached stays quiet.
 */
export async function warmRuntime(provider: SubscriptionProvider, accountId: string | undefined) {
  if (provider !== "codex") return;
  try {
    const connection = await codexConnection(accountId);
    if (connection.idle) connection.forget();
    traceEvent("codex.warmed", {});
  } catch {
    // The send finds out and follows the person's order.
  }
}

/**
 * Only the model and Spectra's own tools: nothing from the user's Codex setup.
 * An empty `mcp_servers` override does not replace the configured servers, so
 * each one is switched off by name.
 */
function codexIsolation(userServers: string[]) {
  return {
    web_search: "disabled",
    project_doc_max_bytes: 0,
    model_reasoning_summary: "detailed",
    ...Object.fromEntries(
      [
        "shell_tool",
        "apps",
        "memories",
        "browser_use",
        "computer_use",
        "plugins",
        "remote_plugin",
        "multi_agent",
        "skill_search",
        "tool_suggest",
        "image_generation",
        "goals",
        "sleep_tool",
        "unified_exec",
        "view_image",
        "hooks",
        "in_app_browser",
        "code_mode_host",
      ].map((feature) => [`features.${feature}`, false]),
    ),
    ...Object.fromEntries(userServers.map((name) => [`mcp_servers.${name}.enabled`, false])),
  };
}

type TurnEvent =
  | { type: "activity" }
  | { type: "draft"; id: string; name: string; arguments: string }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool"; call: HarnessToolCall }
  | { type: "usage"; usage: ModelUsage }
  | { type: "completed"; error?: string }
  | { type: "lost"; reason: string };

/** Buffers a provider's events so the harness can read them between calls. */
class TurnStream {
  private queue: TurnEvent[] = [];
  private waiter: Deferred<void> | null = null;

  push(event: TurnEvent) {
    this.queue.push(event);
    this.waiter?.resolve();
    this.waiter = null;
  }

  async next(signal: AbortSignal, idleMs = IDLE_TIMEOUT_MS): Promise<TurnEvent | null> {
    if (this.queue.length) return this.queue.shift()!;
    this.waiter = deferred<void>();
    const waiter = this.waiter;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => waiter.reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const idle = new Promise<"idle">((resolve) => {
      timer = setTimeout(() => resolve("idle"), idleMs);
    });
    try {
      const outcome = await Promise.race([waiter.promise, idle]);
      if (outcome === "idle") return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    return this.queue.shift() ?? null;
  }

  drain() {
    return this.queue.shift() ?? null;
  }
}

function codexInput(text: string, images: string[] = []) {
  return [
    { type: "text", text, text_elements: [] },
    ...images.map((url) => ({ type: "image", url })),
  ];
}

function codexUsage(params: Record<string, unknown>): ModelUsage | null {
  const usage = params.tokenUsage as { last?: Record<string, number> } | undefined;
  const last = usage?.last;
  if (!last) return null;
  return {
    promptTokens: last.inputTokens,
    completionTokens: last.outputTokens,
    reasoningTokens: last.reasoningOutputTokens,
    totalTokens: last.totalTokens,
  };
}

function routeCodexNotification(stream: TurnStream, method: string, params: Record<string, unknown>) {
  if (method === "item/agentMessage/delta") stream.push({ type: "text", delta: String(params.delta ?? "") });
  else if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta")
    stream.push({ type: "reasoning", delta: String(params.delta ?? "") });
  else if (method === "thread/tokenUsage/updated") {
    const usage = codexUsage(params);
    if (usage) stream.push({ type: "usage", usage });
  } else if (method === "turn/completed") {
    const turn = params.turn as { status?: string; error?: { message?: string } } | undefined;
    stream.push({
      type: "completed",
      ...(turn?.status === "failed" ? { error: turn.error?.message ?? "The turn failed." } : {}),
    });
  } else if (method === "error") {
    const error = params.error as { message?: string } | undefined;
    if (!params.willRetry) stream.push({ type: "completed", error: error?.message ?? "Codex reported an error." });
    else traceEvent("codex.retrying", { message: error?.message?.slice(0, 200) });
  } else stream.push({ type: "activity" });
}

function toolResultFor(messages: HarnessMessage[], id: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool" && message.tool_call_id === id) return message.content;
  }
  return null;
}

/** Reads one model turn out of the stream, until a tool request or the end. */
async function readTurn(input: {
  stream: TurnStream;
  signal: AbortSignal;
  onText: (delta: string) => void;
  onToolDraft?: (draft: { id: string; name: string; arguments: string }) => void;
  onReasoning?: (delta: string) => void;
  model: string;
  provider: string;
  mark: { firstReasoning?: number; firstText?: number };
}): Promise<{ turn: ModelTurn; finished: boolean }> {
  let text = "";
  let usage: ModelUsage | undefined;
  const toolCalls: HarnessToolCall[] = [];
  const started = Date.now();
  while (true) {
    const event = toolCalls.length
      ? await input.stream.next(input.signal, TOOL_BATCH_MS)
      : await input.stream.next(input.signal);
    if (event?.type === "draft") input.onToolDraft?.({ id: event.id, name: event.name, arguments: event.arguments });
    // While a batch of tool calls gathers, a sign of life must not hold it open.
    if (toolCalls.length && (event?.type === "activity" || event?.type === "draft")) {
      return {
        finished: false,
        turn: { text, toolCalls, finishReason: "tool_calls", model: input.model, provider: input.provider, usage },
      };
    }
    if (!event) {
      if (toolCalls.length) {
        return {
          finished: false,
          turn: { text, toolCalls, finishReason: "tool_calls", model: input.model, provider: input.provider, usage },
        };
      }
      throw new ProviderUnavailableError("The AI session stopped responding.");
    }
    if (event.type === "activity" || event.type === "draft") continue;
    if (event.type === "text") {
      input.mark.firstText ??= Date.now() - started;
      text += event.delta;
      input.onText(event.delta);
    } else if (event.type === "reasoning") {
      input.mark.firstReasoning ??= Date.now() - started;
      traceRaw("reasoning", { delta: event.delta });
      input.onReasoning?.(event.delta);
    } else if (event.type === "usage") {
      usage = event.usage;
    } else if (event.type === "tool") {
      toolCalls.push(event.call);
    } else if (event.type === "completed") {
      if (event.error) throw new ProviderUnavailableError(event.error);
      return {
        finished: true,
        turn: { text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", model: input.model, provider: input.provider, usage },
      };
    } else {
      throw new ProviderUnavailableError(event.reason);
    }
  }
}

function codexModelCaller(target: RuntimeTarget): DisposableModelCaller {
  let connection: CodexConnection | null = null;
  let threadId: string | null = null;
  let turnId: string | null = null;
  let stream = new TurnStream();
  let turnActive = false;
  let conveyed = 0;
  let firstUser = "";
  let shape = "";
  const held = new Map<string, number | string>();
  const handed = new Set<string>();
  const model = target.model || defaultCodexModel();
  const effort = codexEffort(target.reasoning ?? getSpectraReasoningProfile());

  const closeThread = () => {
    if (connection && threadId) {
      const id = threadId;
      const live = connection;
      if (turnActive && turnId)
        void live.request("turn/interrupt", { threadId: id, turnId }).catch(() => undefined);
      live.forget(id);
    }
    threadId = null;
    turnId = null;
    turnActive = false;
    held.clear();
    stream = new TurnStream();
    conveyed = 0;
  };

  const startThread = async (messages: HarnessMessage[], tools: ProviderToolSpec[]) => {
    const started = Date.now();
    const begin = async () => {
      connection = await codexConnection(target.accountId);
      connection.threadsStarted += 1;
      return connection.request("thread/start", {
        model,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: systemOf(messages),
        serviceName: "spectra",
        config: codexIsolation(connection.userServers),
        dynamicTools: tools.map((tool) => ({
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
      });
    };
    // A hung app-server is replaced by the timeout, so one more try is on a fresh one.
    const result = await begin().catch((error: unknown) => {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      traceEvent("codex.thread_retry", { message: error.message.slice(0, 200) });
      return begin();
    });
    const thread = result.thread as { id: string };
    threadId = thread.id;
    const streamRef = stream;
    connection!.listen(thread.id, {
      onNotification: (method, params) => {
        if (method !== "item/agentMessage/delta" && method !== "item/reasoning/summaryTextDelta")
          traceRaw("codex", { method, params: jsonSize(params) > 2_000 ? { size: jsonSize(params) } : params });
        routeCodexNotification(streamRef, method, params);
      },
      onToolCall: (requestId, params) => {
        const call: HarnessToolCall = {
          id: String(params.callId),
          name: String(params.tool),
          arguments: JSON.stringify(params.arguments ?? {}),
        };
        held.set(call.id, requestId);
        streamRef.push({ type: "tool", call });
      },
      onConnectionLost: (reason) => streamRef.push({ type: "lost", reason }),
    });
    traceEvent("codex.thread_started", { ms: Date.now() - started, toolCount: tools.length, systemChars: systemOf(messages).length });
  };

  const startTurn = async (input: Array<Record<string, unknown>>) => {
    const result = await connection!.request("turn/start", { threadId, effort, input });
    const turn = result.turn as { id?: string } | undefined;
    turnId = turn?.id ?? null;
    turnActive = true;
  };

  const caller: DisposableModelCaller = async (input) => {
    const rest = input.messages.filter((message) => message.role !== "system");
    const head = rest[0];
    const headKey = head ? contentText(head.role === "tool" ? head.content : head.content) : "";
    const nextShape = threadShape(input.messages, input.tools);
    const prefixChanged = threadId !== null && (rest.length < conveyed || headKey !== firstUser || nextShape !== shape);
    if (prefixChanged) {
      traceEvent("codex.reseed", { reason: nextShape !== shape ? "tools or instructions changed" : "history replaced", messages: rest.length });
      closeThread();
    }
    try {
      const last = rest[rest.length - 1];
      if (last?.role === "user" && unreadableFile(last.content))
        throw new ProviderUnavailableError("Codex cannot read this attached file.");
      if (!threadId) {
        await startThread(input.messages, input.tools);
        firstUser = headKey;
        shape = nextShape;
        await startTurn(codexInput(transcriptFor(rest), last?.role === "user" ? imageUrls(last.content) : []));
      } else {
        const fresh = rest.slice(conveyed);
        for (const [callId, requestId] of held) {
          const result = toolResultFor(fresh, callId);
          if (result === null) continue;
          connection!.respond(requestId, { contentItems: [{ type: "inputText", text: result }], success: true });
          held.delete(callId);
        }
        // Every call the run was handed needs an answer, or the turn would wait
        // forever. One still on its way to the run gets its answer next time:
        // a CLI sends a turn's calls one at a time, so they arrive in between.
        for (const [callId, requestId] of held) {
          if (!handed.has(callId)) continue;
          connection!.respond(requestId, {
            contentItems: [{ type: "inputText", text: "No more tool calls in this run." }],
            success: false,
          });
          held.delete(callId);
        }
        const newUser = fresh.filter((message) => message.role === "user");
        if (newUser.length) {
          const text = newUser.map((message) => contentText(message.content)).join("\n\n");
          const images = newUser.flatMap((message) => imageUrls(message.content));
          if (turnActive && turnId) {
            await connection!
              .request("turn/steer", { threadId, expectedTurnId: turnId, input: codexInput(text, images) })
              .catch(async (error: unknown) => {
                if (error instanceof ProviderUnavailableError) throw error;
                turnActive = false;
                await startTurn(codexInput(text, images));
              });
          } else {
            await startTurn(codexInput(text, images));
          }
        } else if (!turnActive) {
          throw new ProviderUnavailableError("The AI session ended before the run finished.");
        }
      }
      conveyed = rest.length + 1; // The assistant message this call returns.
      const mark: { firstReasoning?: number; firstText?: number } = {};
      const { turn, finished } = await readTurn({
        stream,
        signal: input.signal,
        onText: input.onText,
        onReasoning: input.onReasoning,
        model,
        provider: "codex",
        mark,
      });
      if (finished) turnActive = false;
      for (const call of turn.toolCalls ?? []) handed.add(call.id);
      traceEvent("codex.turn_marks", { ...mark });
      return turn;
    } catch (error) {
      closeThread();
      throw error;
    }
  };
  caller.dispose = () => closeThread();
  return caller;
}

async function codexOneShot(request: OneShotRequest): Promise<ModelTurn> {
  const connection = await codexConnection(request.accountId);
  const small = request.small ? smallestCodexModels.get(request.accountId ?? "") : undefined;
  const model = small || request.model || process.env.SPECTRA_CODEX_ONESHOT_MODEL?.trim() || defaultCodexModel();
  const effort = codexEffort(request.reasoning ?? getSpectraReasoningProfile());
  const result = await connection.request("thread/start", {
    model,
    ephemeral: true,
    approvalPolicy: "never",
    sandbox: "read-only",
    baseInstructions: systemOf(request.messages),
    serviceName: "spectra",
    config: codexIsolation(connection.userServers),
  });
  const threadId = (result.thread as { id: string }).id;
  const stream = new TurnStream();
  connection.listen(threadId, {
    onNotification: (method, params) => routeCodexNotification(stream, method, params),
    onToolCall: (requestId) =>
      connection.respond(requestId, { contentItems: [{ type: "inputText", text: "No tools here." }], success: false }),
    onConnectionLost: (reason) => stream.push({ type: "lost", reason }),
  });
  const rest = request.messages.filter((message) => message.role !== "system");
  const schema = (request.responseFormat as { json_schema?: { schema?: unknown } } | undefined)?.json_schema?.schema;
  try {
    await connection.request("turn/start", {
      threadId,
      effort,
      input: codexInput(transcriptFor(rest)),
      ...(schema ? { outputSchema: schema } : {}),
    });
    const { turn } = await readTurn({
      stream,
      signal: request.signal,
      onText: (delta) => request.onText?.(delta),
      onReasoning: request.onReasoning,
      model,
      provider: "codex",
      mark: {},
    });
    return turn;
  } finally {
    connection.forget(threadId);
  }
}

/* ----------------------------------------------------------------- Claude */

/** Spectra's reasoning levels as the Claude CLI names them. */
function claudeEffort(profile: SpectraReasoningProfile) {
  return profile === "none" || profile === "minimal" ? "low" : profile;
}

/**
 * What a Claude session is for. The Bridge builds the command line from it and
 * refuses anything else; `args` is kept only for Bridges older than that rule.
 */
type ClaudeIntent = { mode: "prompt"; model: string; tools?: boolean; effort?: string } | { mode: "auth-status" };
type RelayStart = { args: string[]; system?: string; mcp?: boolean; claude?: ClaudeIntent; setup?: RuntimeSetupAction };

function claudeStart(intent: ClaudeIntent, system?: string): RelayStart {
  if (intent.mode === "auth-status") return { args: ["auth", "status"], claude: intent };
  return { args: claudeArgs(intent), system, mcp: intent.tools === true, claude: intent };
}

/** The Bridge fills in {{system}} and {{mcp}}: the prompt's file and its local tool endpoint. */
function claudeArgs(options: { model: string; tools?: boolean; effort?: string }) {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    options.model,
    "--tools",
    "",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--system-prompt-file",
    "{{system}}",
    ...(options.effort ? ["--effort", options.effort] : []),
    ...(options.tools
      ? [
          "--mcp-config",
          JSON.stringify({ mcpServers: { spectra: { type: "http", url: "{{mcp}}" } } }),
          "--allowedTools",
          "mcp__spectra",
        ]
      : []),
  ];
}

/** The tool calls Claude is still writing, by content block, and the ids waiting for their MCP call. */
type ClaudeDrafts = { blocks: Map<number, { id: string; name: string; arguments: string }>; waiting: Map<string, string[]> };

/** Tools reach Claude through MCP, under a prefix the run does not know them by. */
const unprefixedTool = (name: string) => name.replace(/^mcp__.+?__/, "");

function routeClaudeFrame(stream: TurnStream, frame: Record<string, unknown>, drafts: ClaudeDrafts) {
  if (frame.type === "stream_event") {
    const event = frame.event as {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
    };
    const index = event.index ?? 0;
    if (event.type === "message_start") {
      drafts.blocks.clear();
      drafts.waiting.clear();
      stream.push({ type: "activity" });
    } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use" && event.content_block.id && event.content_block.name) {
      const name = unprefixedTool(event.content_block.name);
      drafts.blocks.set(index, { id: event.content_block.id, name, arguments: "" });
      drafts.waiting.set(name, [...(drafts.waiting.get(name) ?? []), event.content_block.id]);
      stream.push({ type: "draft", id: event.content_block.id, name, arguments: "" });
    } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      stream.push({ type: "text", delta: event.delta.text ?? "" });
    } else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
      stream.push({ type: "reasoning", delta: event.delta.thinking ?? "" });
    } else if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const draft = drafts.blocks.get(index);
      if (draft) {
        draft.arguments += event.delta.partial_json ?? "";
        stream.push({ type: "draft", ...draft });
      } else stream.push({ type: "activity" });
    } else {
      // Claude is working: a long tool call must not read as a stalled session.
      stream.push({ type: "activity" });
    }
    return;
  }
  traceRaw("claude", { type: frame.type, subtype: frame.subtype });
  if (frame.type === "result") {
    const usage = frame.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage)
      stream.push({
        type: "usage",
        usage: { promptTokens: usage.input_tokens, completionTokens: usage.output_tokens },
      });
    stream.push({
      type: "completed",
      ...(frame.is_error ? { error: String(frame.result ?? "Claude reported an error.") } : {}),
    });
  }
}

/** Text, and the images and PDFs that Claude can read directly. */
function claudeUserFrame(text: string, content?: string | HarnessContentPart[]) {
  const blocks: Array<Record<string, unknown>> = [{ type: "text", text }];
  if (content && typeof content !== "string") {
    for (const part of content) {
      const url = part.type === "image_url" ? part.image_url.url : part.type === "file" ? part.file.file_data : "";
      const data = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url ?? "");
      if (part.type === "image_url")
        blocks.push({
          type: "image",
          source: data ? { type: "base64", media_type: data[1], data: data[2] } : { type: "url", url },
        });
      else if (part.type === "file" && data)
        blocks.push({ type: "document", source: { type: "base64", media_type: data[1], data: data[2] } });
    }
  }
  return { type: "user", message: { role: "user", content: blocks } };
}

function claudeModelCaller(target: RuntimeTarget): DisposableModelCaller {
  const stream = new TurnStream();
  const held = new Map<string, Deferred<string>>();
  const handed = new Set<string>();
  const drafts: ClaudeDrafts = { blocks: new Map(), waiting: new Map() };
  const model = target.model || defaultClaudeModel();
  let relay: RelaySocket | null = null;
  let conveyed = 0;
  let turnActive = false;
  let firstUser = "";
  let shape = "";

  const closeProcess = () => {
    for (const entry of held.values()) entry.resolve("The run ended.");
    held.clear();
    drafts.blocks.clear();
    drafts.waiting.clear();
    relay?.close();
    relay = null;
    turnActive = false;
    conveyed = 0;
  };

  const caller: DisposableModelCaller = async (input) => {
    const rest = input.messages.filter((message) => message.role !== "system");
    const headKey = rest[0] ? contentText(rest[0].content) : "";
    const nextShape = threadShape(input.messages, input.tools);
    if (relay && (relay.isClosed || rest.length < conveyed || headKey !== firstUser || nextShape !== shape)) {
      traceEvent("claude.reseed", { closed: relay.isClosed, messages: rest.length });
      closeProcess();
    }
    if (!relay) {
      firstUser = headKey;
      shape = nextShape;
      const callTool = (name: string, args: unknown) => {
        // The call keeps the id its draft was shown under, so that step finishes.
        const waiting = drafts.waiting.get(name);
        const id = waiting?.shift() ?? `mcp_${randomUUID()}`;
        const entry = deferred<string>();
        held.set(id, entry);
        stream.push({ type: "tool", call: { id, name, arguments: JSON.stringify(args ?? {}) } });
        return entry.promise;
      };
      relay = new RelaySocket(
        "claude",
        claudeStart(
          { mode: "prompt", model, tools: true, effort: claudeEffort(target.reasoning ?? getSpectraReasoningProfile()) },
          systemOf(input.messages),
        ),
        target.accountId,
      );
      relay.onMcp = (body) => answerMcp(input.tools, callTool, body);
      relay.onFrame = (frame) => routeClaudeFrame(stream, frame, drafts);
      relay.onClose = (reason) => stream.push({ type: "lost", reason });
      await relay.ready;
      const last = rest[rest.length - 1];
      relay.send(claudeUserFrame(transcriptFor(rest), last?.role === "user" ? last.content : undefined));
      turnActive = true;
    } else {
      const fresh = rest.slice(conveyed);
      for (const [id, entry] of held) {
        const result = toolResultFor(fresh, id);
        // A call still on its way to the run gets its answer next time.
        if (result === null && !handed.has(id)) continue;
        entry.resolve(result ?? "No more tool calls in this run.");
        held.delete(id);
      }
      const newUser = fresh.filter((message) => message.role === "user");
      if (newUser.length) {
        for (const message of newUser) relay.send(claudeUserFrame(contentText(message.content), message.content));
        turnActive = true;
      } else if (!turnActive) {
        throw new ProviderUnavailableError("The AI session ended before the run finished.");
      }
    }
    conveyed = rest.length + 1;
    const { turn, finished } = await readTurn({
      stream,
      signal: input.signal,
      onText: input.onText,
      onReasoning: input.onReasoning,
      ...(input.onToolDraft ? { onToolDraft: input.onToolDraft } : {}),
      model,
      provider: "claude",
      mark: {},
    });
    if (finished) turnActive = false;
    for (const call of turn.toolCalls ?? []) handed.add(call.id);
    return turn;
  };
  caller.dispose = () => closeProcess();
  return caller;
}

async function claudeOneShot(request: OneShotRequest): Promise<ModelTurn> {
  const stream = new TurnStream();
  const model = request.small ? "haiku" : request.model || defaultClaudeModel();
  const effort = claudeEffort(request.reasoning ?? getSpectraReasoningProfile());
  const relay = new RelaySocket("claude", claudeStart({ mode: "prompt", model, effort }, systemOf(request.messages)), request.accountId);
  relay.onFrame = (frame) => routeClaudeFrame(stream, frame, { blocks: new Map(), waiting: new Map() });
  relay.onClose = (reason) => stream.push({ type: "lost", reason });
  try {
    await relay.ready;
    relay.send(claudeUserFrame(transcriptFor(request.messages.filter((message) => message.role !== "system"))));
    const { turn } = await readTurn({
      stream,
      signal: request.signal,
      onText: (delta) => request.onText?.(delta),
      onReasoning: request.onReasoning,
      model,
      provider: "claude",
      mark: {},
    });
    return turn;
  } finally {
    relay.close();
  }
}

/* ------------------------------------------------------------ Entry points */

/** The harness caller for one attempt. */
export function subscriptionModelCaller(provider: SubscriptionProvider, target: RuntimeTarget = {}): DisposableModelCaller {
  const runtime = provider === "codex" ? codexModelCaller(target) : claudeModelCaller(target);
  const caller: DisposableModelCaller = (input) => runtime(input.toolChoice === "none" ? { ...input, tools: [] } : input);
  caller.dispose = () => runtime.dispose?.();
  return caller;
}

function statusFromError(error: unknown): RuntimeProviderStatus {
  const message = error instanceof Error ? error.message : "";
  if (/isn't installed/.test(message)) return { state: "not-installed", models: [] };
  if (/bridge/i.test(message)) return { state: "no-bridge", models: [] };
  return { state: "error", models: [] };
}

function withinStatusTime<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Took too long.")), STATUS_TIMEOUT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Only the newest of each model family: GPT-6.1-Sol stands for GPT-6-Sol and
 * GPT-5.6-Sol. A family is the name with its version numbers taken out, and
 * the newest has the highest numbers, read left to right. Order is kept.
 */
export function newestInEachFamily<T extends { id: string }>(models: readonly T[]): T[] {
  const version = (id: string) => (id.match(/\d+(?:\.\d+)*/g) ?? []).flatMap((run) => run.split(".").map(Number));
  const family = (id: string) => id.toLowerCase().replace(/\d+(?:\.\d+)*/g, "#");
  const newer = (a: number[], b: number[]) => {
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] ?? 0) - (b[index] ?? 0);
      if (difference) return difference > 0;
    }
    return false;
  };
  const newest = new Map<string, T>();
  for (const model of models) {
    const kept = newest.get(family(model.id));
    if (!kept || newer(version(model.id), version(kept.id))) newest.set(family(model.id), model);
  }
  const shown = new Set(newest.values());
  return models.filter((model) => shown.has(model));
}

async function codexStatus(accountId: string | undefined): Promise<RuntimeProviderStatus> {
  const relay = new RelaySocket("codex", { args: ["app-server"] }, accountId);
  const waiting = new Map<number, Deferred<Record<string, unknown>>>();
  let nextId = 1;
  relay.onFrame = (frame) => {
    const entry = waiting.get(frame.id as number);
    if (!entry) return;
    if (frame.error) entry.reject(new Error("Codex refused."));
    else entry.resolve((frame.result ?? {}) as Record<string, unknown>);
  };
  relay.onClose = (reason) => {
    for (const entry of waiting.values()) entry.reject(new ProviderUnavailableError(reason));
  };
  const request = (method: string, params: unknown) => {
    const id = nextId++;
    const entry = deferred<Record<string, unknown>>();
    waiting.set(id, entry);
    relay.send({ id, method, params });
    return entry.promise;
  };
  try {
    return await withinStatusTime(
      (async (): Promise<RuntimeProviderStatus> => {
        await relay.ready;
        await request("initialize", { clientInfo: { name: "spectra", title: "Spectra", version: "0.1.0" }, capabilities: { experimentalApi: true } });
        relay.send({ method: "initialized" });
        const read = await request("account/read", { refreshToken: false });
        const account = read.account as { email?: string; planType?: string } | null | undefined;
        if (!account) return { state: "signed-out", models: [] };
        const rows: Array<{ id?: string; model?: string; displayName?: string; hidden?: boolean }> = [];
        let cursor: unknown;
        // The list comes in pages; a model on a later one is still theirs to pick.
        for (let page = 0; page < 6; page += 1) {
          const list = await request("model/list", cursor ? { cursor } : {}).catch(() => ({}) as Record<string, unknown>);
          rows.push(...((list.data ?? []) as typeof rows));
          cursor = list.nextCursor;
          if (!cursor) break;
        }
        const models = newestInEachFamily(
          rows
            .filter((row) => !row.hidden)
            .map((row) => ({ id: String(row.model ?? row.id), label: row.displayName || String(row.model ?? row.id) })),
        );
        const small = smallestCodexModel(models);
        if (small) smallestCodexModels.set(accountId ?? "", small);
        return { state: "ready", account: account.email, plan: account.planType, models };
      })(),
    );
  } catch (error) {
    return statusFromError(error);
  } finally {
    relay.close();
  }
}

/** The CLI's own aliases, so the list follows Claude Code's updates instead of going stale. */
const CLAUDE_MODELS = [
  { id: "fable", label: "Fable" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

async function claudeStatus(accountId: string | undefined): Promise<RuntimeProviderStatus> {
  const relay = new RelaySocket("claude", claudeStart({ mode: "auth-status" }), accountId);
  const lines: string[] = [];
  const ended = deferred<void>();
  relay.onLine = (line) => lines.push(line);
  relay.onFrame = (frame) => lines.push(JSON.stringify(frame));
  relay.onClose = () => ended.resolve();
  try {
    return await withinStatusTime(
      (async (): Promise<RuntimeProviderStatus> => {
        await relay.ready;
        await ended.promise;
        const status = JSON.parse(lines.join("\n")) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
        if (!status.loggedIn) return { state: "signed-out", models: [] };
        return { state: "ready", account: status.email, plan: status.subscriptionType, models: CLAUDE_MODELS };
      })(),
    );
  } catch (error) {
    return statusFromError(error);
  } finally {
    relay.close();
  }
}

/** `install-quiet` runs the installer with no window; Spectra watches for the CLI to appear. */
export type RuntimeSetupAction = "install" | "login" | "install-quiet";
export type RuntimeSetupResult = { opened: true } | { opened: false; reason: "unsupported" | "update-bridge" | "no-bridge" | "failed" };

/**
 * Ask Bridge to open a terminal that installs the CLI with its official installer
 * and logs in, or only logs in. Bridge runs its own fixed commands; this only picks one.
 */
export async function setupRuntime(provider: SubscriptionProvider, action: RuntimeSetupAction, accountId: string | undefined): Promise<RuntimeSetupResult> {
  const relay = new RelaySocket(provider, { args: [], setup: action }, accountId);
  try {
    await withinStatusTime(relay.ready);
    if (relay.setupResult === "opened" || relay.setupResult === "started") return { opened: true };
    if (relay.setupResult === "unsupported") return { opened: false, reason: "unsupported" };
    // An older Bridge ignores the request and starts the CLI instead.
    return { opened: false, reason: relay.setupResult === undefined ? "update-bridge" : "failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Update Spectra/.test(message)) return { opened: false, reason: "update-bridge" };
    return { opened: false, reason: statusFromError(error).state === "no-bridge" ? "no-bridge" : "failed" };
  } finally {
    relay.close();
  }
}

/** What this person's computer offers now: installed, logged in, which models. */
export async function runtimeStatus(accountId: string | undefined) {
  const [codex, claude] = await Promise.all([codexStatus(accountId), claudeStatus(accountId)]);
  return { codex, claude };
}

/** Who can run the work: the person's own CLIs, or Spectra's model. */
export type RuntimeName = SubscriptionProvider | "spectra";

export const RUNTIME_NAMES: Record<RuntimeName, string> = { codex: "Codex", claude: "Claude Code", spectra: "Spectra" };

/** One runtime in the person's order. `make` gives a fresh session. */
export type RuntimeLink = { runtime: RuntimeName; make: () => DisposableModelCaller };

export type RuntimeChainCaller = DisposableModelCaller & {
  /** The runtime that answered last. */
  finishedWith: () => RuntimeName;
};

/** The order ran out; the run ends where it is, keeping what it finished. */
export class RuntimeOrderExhaustedError extends ProviderUnavailableError {
  constructor(reason: string, cause?: unknown) {
    super(`${reason}, and you've chosen not to use anything else. What was done so far is saved.`, cause);
    this.name = "RuntimeOrderExhaustedError";
  }
}

const REFUSED = /log ?in|logged|authenticat|\/login|api key|usage limit|rate limit|quota|too many|cannot read this attached/i;
const UNREACHABLE = /bridge|relay|isn't installed|store unavailable|STORE_UNAVAILABLE|can't be reached|could not reach/i;

/** Why a runtime was left, in words for the hover. */
export function runtimeChainReason(runtime: RuntimeName, reason: string) {
  const name = RUNTIME_NAMES[runtime];
  if (/log ?in|logged|authenticat|\/login|api key/i.test(reason)) return `${name} isn't logged in on this computer`;
  if (/usage limit|rate limit|quota|too many/i.test(reason)) return `${name} hit its usage limit`;
  if (/isn't installed/.test(reason)) return `${name} isn't installed on this computer`;
  if (/cannot read this attached/i.test(reason)) return `${name} can't read the attached file`;
  if (/different Spectra account/i.test(reason)) return "Spectra Bridge on this computer is connected to another account";
  if (/isn't running/i.test(reason)) return "Spectra Bridge isn't running";
  if (/bridge|relay|can't be reached|could not reach/i.test(reason)) return "Spectra Bridge can't be reached";
  return `${name} stopped responding`;
}

/** A runtime the person's computer said it can't reach just now, and why. */
export type UnreachableRuntime = { runtime: SubscriptionProvider; state: "signed-out" | "not-installed" | "no-bridge" | "error" };

const UNREACHABLE_WORDS: Record<UnreachableRuntime["state"], string> = {
  "signed-out": "Log in",
  "not-installed": "isn't installed",
  "no-bridge": "Spectra Bridge isn't running.",
  error: "stopped responding",
};

/**
 * The runtimes a run tries, in order. One this computer already knows it can't
 * reach is left out, so the send starts at the next one without waiting for a
 * failure; the move is still said once. Nothing is left out when that would
 * leave nothing, and a forced runtime runs alone.
 */
export function runtimeOrderFor(
  provider: SubscriptionProvider,
  then: readonly RuntimeName[],
  unreachable: readonly UnreachableRuntime[],
): { order: RuntimeName[]; skipped?: { from: RuntimeName; to: RuntimeName; reason: string } } {
  const full = [...new Set<RuntimeName>([provider, ...(subscriptionProvider() ? [] : then)])];
  const known = new Map(unreachable.map((entry) => [entry.runtime as RuntimeName, entry.state]));
  const order = full.filter((runtime) => !known.has(runtime));
  if (!order.length || order.length === full.length) return { order: full };
  const state = known.get(provider);
  return {
    order,
    ...(state ? { skipped: { from: provider, to: order[0]!, reason: runtimeChainReason(provider, UNREACHABLE_WORDS[state]) } } : {}),
  };
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (!ms || signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * The person's runtime order (D1). Each runtime gets one quiet retry: after a
 * second when it couldn't be reached, at once on a fresh session when it went
 * silent. A refusal (usage limit, signed out) is not retried. Then the next in
 * the order; when the order runs out the run stops with a sentence. Spectra's
 * model runs only when it is in the order. SPECTRA_AI_RUNTIME forces one
 * runtime with no retry and no order.
 *
 * The harness hands every call the whole transcript, so a move at any tool
 * boundary loses only the unfinished turn, whose text is taken back through
 * onRetry before it is answered again.
 */
export function withRuntimeChain(
  links: readonly RuntimeLink[],
  hooks: { onMove: (from: RuntimeName, to: RuntimeName, reason: string) => void; retryDelayMs?: number },
): RuntimeChainCaller {
  const forced = subscriptionProvider();
  let index = 0;
  let current: DisposableModelCaller | null = null;
  const session = () => (current ??= links[index]!.make());
  // A dead session can fail to tear down; that must never stop the order.
  const drop = () => {
    const leaving = current;
    current = null;
    try {
      leaving?.dispose?.();
    } catch (error) {
      traceEvent("runtime.dispose_failed", { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    }
  };
  const caller = (async (input) => {
    if (!links.length) throw new RuntimeOrderExhaustedError("Nothing is set to answer");
    let retried = false;
    for (;;) {
      let streamed = false;
      try {
        return await session()({
          ...input,
          onText: (delta) => {
            streamed = true;
            input.onText(delta);
          },
        });
      } catch (error) {
        if (input.signal.aborted || forced) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const runtime = links[index]!.runtime;
        if (streamed) input.onRetry?.();
        drop();
        if (!retried && !REFUSED.test(message)) {
          retried = true;
          traceEvent("runtime.retry", { runtime, reason: message.slice(0, 300) });
          await pause(UNREACHABLE.test(message) ? (hooks.retryDelayMs ?? 1_000) : 0, input.signal);
          continue;
        }
        const reason = runtimeChainReason(runtime, message);
        traceEvent("runtime.move", { from: runtime, to: links[index + 1]?.runtime ?? null, reason: message.slice(0, 300) });
        if (index + 1 >= links.length) throw new RuntimeOrderExhaustedError(reason, error);
        index += 1;
        retried = false;
        hooks.onMove(runtime, links[index]!.runtime, reason);
      }
    }
  }) as RuntimeChainCaller;
  caller.dispose = drop;
  caller.finishedWith = () => links[index]?.runtime ?? "spectra";
  return caller;
}

/** A single tool-free call: the thread title, compaction, the daily brief. */
export function subscriptionOneShot(provider: SubscriptionProvider, request: OneShotRequest) {
  return provider === "codex" ? codexOneShot(request) : claudeOneShot(request);
}
