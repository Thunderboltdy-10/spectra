import type { ArtifactTypeKey } from "../../artifacts/types";
import { artifactTypeLabel } from "../../../../../shared/semantic-chunks";
import { resolveArtifactWriteInput } from "../../operations/artifact-write-content";
import type {
  ArtifactSnapshot,
  CommandRequest,
  CommandResult,
  HarnessBackend,
  LibraryItem,
  SearchHit,
  SearchKind,
  SearchRequest,
  SearchResponse,
  ThreadReadRequest,
  WebResult,
} from "./backend";

/*
 * An in-memory Spectra for the evals and tests. Writes go through the same
 * normalisation and canonical projection as the real AI write path, so what a
 * test reads back is what a collaborator would see.
 */

export type MemoryArtifact = ArtifactSnapshot & { createdBy: "ai" | "seed"; revisions: number };

export type MemoryBackendOptions = {
  timeZone?: string;
  prompt?: string;
  artifacts?: Array<{ id?: string; type: ArtifactTypeKey; title: string; content: unknown; canEdit?: boolean; location?: string }>;
  thread?: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  calendar?: Array<{ id: string; title: string; start: number; end?: number; kind: string }>;
  webSearch?: (query: string) => Promise<WebResult[]>;
  /** Simulate the semantic layer answering with words only, or with a degraded index. */
  searchMode?: SearchResponse["mode"];
  searchDegraded?: SearchResponse["degraded"];
  /** The id of the conversation in `thread`. */
  threadId?: string;
};

export class MemoryBackend implements HarnessBackend {
  readonly timeZone: string;
  readonly artifacts = new Map<string, MemoryArtifact>();
  readonly commands: CommandRequest[] = [];
  readonly settings: Record<string, Record<string, unknown>> = {};
  readonly memories: string[] = [];
  private sequence = 0;
  private readonly prompt: string;
  private readonly threadId: string;

  constructor(private readonly options: MemoryBackendOptions = {}) {
    this.timeZone = options.timeZone ?? "Europe/Madrid";
    this.prompt = options.prompt ?? "";
    this.threadId = options.threadId ?? "thread-1";
    for (const seed of options.artifacts ?? []) {
      const id = seed.id ?? this.nextId();
      this.artifacts.set(id, {
        id,
        type: seed.type,
        title: seed.title,
        content: resolveArtifactWriteInput(seed.type, null, { content: seed.content }, "").content,
        canEdit: seed.canEdit ?? true,
        location: seed.location,
        updatedAt: Date.now(),
        createdBy: "seed",
        revisions: 0,
      });
    }
  }

  private nextId() {
    this.sequence += 1;
    return `wx${String(this.sequence).padStart(24, "0")}`;
  }

  async getArtifact(id: string): Promise<ArtifactSnapshot | null> {
    const found = this.artifacts.get(id);
    return found ? structuredClone(found) : null;
  }

  async createArtifact(input: Parameters<HarnessBackend["createArtifact"]>[0]) {
    const id = this.nextId();
    this.artifacts.set(id, {
      id,
      type: input.type,
      title: input.title,
      summary: input.summary,
      content: resolveArtifactWriteInput(input.type, null, { content: input.content }, this.prompt).content,
      canEdit: true,
      updatedAt: Date.now(),
      createdBy: "ai",
      revisions: 1,
    });
    return { id, title: input.title };
  }

  async updateArtifact(input: Parameters<HarnessBackend["updateArtifact"]>[0]) {
    const current = this.artifacts.get(input.id);
    if (!current) throw new Error("The artifact no longer exists.");
    current.content = resolveArtifactWriteInput(input.type, current.content, { content: input.content }, this.prompt).content;
    if (input.title) current.title = input.title;
    current.revisions += 1;
    current.updatedAt = Date.now();
  }

  async listLibrary(input: { query?: string; type?: string; limit: number }): Promise<LibraryItem[]> {
    const query = input.query?.toLowerCase();
    return [...this.artifacts.values()]
      .filter((artifact) => (!query || artifact.title.toLowerCase().includes(query)) && (!input.type || artifact.type === input.type))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, input.limit)
      .map((artifact) => ({ id: artifact.id, artifactId: artifact.id, kind: "work", type: artifact.type, title: artifact.title, location: artifact.location }));
  }

  async search(input: SearchRequest): Promise<SearchResponse> {
    const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const wanted = (kind: SearchKind) => !input.kinds?.length || input.kinds.includes(kind);
    const hits: SearchHit[] = [];
    if (wanted("artifact"))
      for (const artifact of this.artifacts.values()) {
        const haystack = `${artifact.title} ${JSON.stringify(artifact.content)}`.toLowerCase();
        if (words.some((word) => haystack.includes(word)))
          hits.push({ kind: "artifact", id: artifact.id, title: artifact.title, typeLabel: artifactTypeLabel(artifact.type), subtype: artifact.type });
      }
    if (wanted("thread"))
      for (const message of this.options.thread ?? [])
        if (words.some((word) => message.content.toLowerCase().includes(word)))
          hits.push({
            kind: "thread",
            id: this.threadId,
            title: "This conversation",
            typeLabel: "Chat",
            messageId: message.id,
            snippet: message.content.slice(0, 200),
          });
    if (wanted("event"))
      for (const item of this.options.calendar ?? [])
        if (words.some((word) => item.title.toLowerCase().includes(word)))
          hits.push({ kind: "event", id: item.id, title: item.title, typeLabel: "Calendar event", subtype: item.kind, timeAt: item.start });
    if (wanted("memory"))
      this.memories.forEach((memory, index) => {
        if (words.some((word) => memory.toLowerCase().includes(word)))
          hits.push({ kind: "memory", id: `memory-${index + 1}`, title: memory.slice(0, 60), typeLabel: "Memory", snippet: memory });
      });
    return {
      hits: hits.slice(0, input.limit),
      mode: this.options.searchMode ?? "hybrid",
      ...(this.options.searchDegraded ? { degraded: this.options.searchDegraded } : {}),
    };
  }

  async readThread(input: ThreadReadRequest) {
    const thread = this.options.thread ?? [];
    if (input.messageId) {
      const message = thread.find((entry) => entry.id === input.messageId);
      return message ? `[${message.id}] ${message.role}: ${message.content}` : "That message is not in this conversation.";
    }
    if (input.after) {
      const start = thread.findIndex((entry) => entry.id === input.after);
      const later = start < 0 ? [] : thread.slice(start + 1, start + 1 + (input.limit ?? 20));
      if (!later.length) return "No later messages.";
      return later.map((message) => `[${message.id}] ${message.role}: ${message.content}`).join("\n");
    }
    const end = input.before ? thread.findIndex((entry) => entry.id === input.before) : thread.length;
    const messages = thread
      .slice(0, end < 0 ? thread.length : end)
      .filter((message) => !input.query || message.content.toLowerCase().includes(input.query.toLowerCase()));
    if (!messages.length) return input.query ? `Nothing in this conversation matches "${input.query}".` : "No earlier messages.";
    return messages
      .slice(-(input.limit ?? 20))
      .map((message) => `[${message.id}] ${message.role}: ${message.content}`)
      .join("\n");
  }

  async webSearch(input: { query: string }) {
    return this.options.webSearch ? this.options.webSearch(input.query) : [];
  }

  async readCalendar(input: { from: number; to: number }) {
    const items = (this.options.calendar ?? []).filter((item) => item.start >= input.from && item.start < input.to);
    if (!items.length) return "Nothing on the calendar in that range.";
    return items.map((item) => `- ${item.title} (${item.kind}, id ${item.id}) ${new Date(item.start).toISOString()}`).join("\n");
  }

  async readSchoolData() {
    return "ManageBac is not connected for this account.";
  }

  async runCommand(request: CommandRequest): Promise<CommandResult> {
    this.commands.push(structuredClone(request));
    if (request.command === "change_spectra_settings") {
      const patch = request.args.patch as Record<string, Record<string, unknown>>;
      for (const [section, values] of Object.entries(patch)) this.settings[section] = { ...this.settings[section], ...values };
      return { ok: true, content: "Settings saved.", uiEvents: [{ key: "settings_changed", payload: { targetId: Object.keys(patch)[0] } }] };
    }
    if (request.command === "write_memory") {
      this.memories.push(String(request.args.content));
      return { ok: true, content: "Saved to memory." };
    }
    if (request.command === "navigate_spectra")
      return { ok: true, content: "Opened.", uiEvents: [{ key: "navigate", payload: request.args }] };
    return { ok: true, content: `${request.command} done.` };
  }
}
