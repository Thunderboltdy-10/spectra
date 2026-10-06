import type { ArtifactTypeKey } from "../../artifacts/types";
import type { CommentRow } from "./comments";
import type { EmbedRow } from "./embeds";
import type { VersionRow } from "./versions";
import type { ToolOutcome } from "./types";

/*
 * The harness talks to Spectra only through this port. The run runtime binds
 * it to Convex and the collaboration rooms; the evals and tests bind it to
 * an in-memory store. Every method is scoped to one user and one run.
 */

export type ArtifactSnapshot = {
  id: string;
  type: ArtifactTypeKey;
  title: string;
  /** Current content: the live collaborative state when available. */
  content: unknown;
  summary?: string;
  canEdit: boolean;
  /** "Biology / Unit 2", for listings. */
  location?: string;
  updatedAt?: number;
};

export type LibraryItem = {
  id: string;
  kind: "work" | "folder" | "workspace";
  /** Artifact type for work items. */
  type?: string;
  title: string;
  /** The artifact id for work items (what create/edit/read take). */
  artifactId?: string;
  location?: string;
  updatedAt?: number;
};

/** What a search hit is: a piece of work, a chat, a calendar item, a school record or a memory. */
export type SearchKind = "artifact" | "thread" | "event" | "school" | "memory";

export type SearchHit = {
  kind: SearchKind;
  /** The item id: an artifact id, thread id, calendar item id, school record id or memory id. */
  id: string;
  title: string;
  /** "Slides", "Document", "Chat", "Calendar event", "School assignment", "Memory". */
  typeLabel: string;
  /** Artifact type (document, presentation, ...), calendar kind or school record type. */
  subtype?: string;
  /** The best matching passage. */
  snippet?: string;
  /** Where the passage is: "Slide 3: Results", "Heading: Methods", "Sheet1 A1:D20". */
  location?: string;
  /** The block, slide, range or card the passage is in. */
  regionId?: string;
  /** Chats: the best matching message. */
  messageId?: string;
  /** The workspace the item lives in, when the user can open it. */
  workspace?: string;
  ownership?: "mine" | "shared" | "school";
  updatedAt?: number;
  /** When it happens: an event start or a due date. */
  timeAt?: number;
};

export type SearchRequest = {
  query: string;
  /** Leave out to search everything, memory included. */
  kinds?: SearchKind[];
  limit: number;
};

export type SearchResponse = {
  hits: SearchHit[];
  /** words_only: the query could not be embedded, so only matching words were found. */
  mode: "hybrid" | "words_only";
  /** Why the results may be incomplete. */
  degraded?: "embeddings_not_configured" | "embeddings_unavailable" | "query_too_large" | "index_partial";
};

export type WebResult = { title: string; url: string; snippet: string; publishedAt?: string };

export type CommandRequest = {
  /** A registered application command, e.g. change_spectra_settings. */
  command: string;
  args: Record<string, unknown>;
  toolCallId: string;
  /** The user (or their stored choice) approved this exact call. */
  approved: boolean;
};

export type CommandResult = {
  ok: boolean;
  /** Plain result for the model. */
  content: string;
  uiEvents?: ToolOutcome["uiEvents"];
  /** The command discovered an effect that needs approval (desktop files). */
  pause?: ToolOutcome["pause"];
};

export type ThreadReadRequest = {
  threadId?: string;
  query?: string;
  /** Read one whole message (from a search hit). */
  messageId?: string;
  /** Read messages older than this message id. */
  before?: string;
  /** Read messages newer than this message id: page on from a passage. */
  after?: string;
  limit?: number;
};

export interface HarnessBackend {
  /** The user's IANA time zone. */
  readonly timeZone: string;
  getArtifact(id: string, signal: AbortSignal): Promise<ArtifactSnapshot | null>;
  createArtifact(
    input: {
      type: ArtifactTypeKey;
      title: string;
      content: Record<string, unknown>;
      summary: string;
      workspaceId?: string;
      toolCallId: string;
    },
    signal: AbortSignal,
  ): Promise<{ id: string; title: string }>;
  updateArtifact(
    input: {
      id: string;
      type: ArtifactTypeKey;
      title?: string;
      content: Record<string, unknown>;
      toolCallId: string;
      approved: boolean;
    },
    signal: AbortSignal,
  ): Promise<void>;
  listLibrary(
    input: { query?: string; type?: string; folderId?: string; limit: number },
    signal: AbortSignal,
  ): Promise<LibraryItem[]>;
  /** Search by meaning and words across everything the user can open. */
  search(input: SearchRequest, signal: AbortSignal): Promise<SearchResponse>;
  readThread(input: ThreadReadRequest, signal: AbortSignal): Promise<string>;
  webSearch(input: { query: string; deep?: boolean }, signal: AbortSignal): Promise<WebResult[]>;
  readCalendar(input: { from: number; to: number; title?: string }, signal: AbortSignal): Promise<string>;
  /** A work's comments, resolved ones too when asked; null when the user cannot open the work. */
  readComments(input: { artifactId: string; includeResolved?: boolean }, signal: AbortSignal): Promise<CommentRow[] | null>;
  /** A work's saved versions, newest first, and whether older ones exist; null when the user cannot open the work. */
  readVersions(input: { artifactId: string; limit: number }, signal: AbortSignal): Promise<{ versions: VersionRow[]; more: boolean } | null>;
  /** The live embeds inside a work, and whether the user can change them; null when the user cannot open the work. */
  readEmbeds(input: { artifactId: string }, signal: AbortSignal): Promise<{ embeds: EmbedRow[]; canConfigure: boolean } | null>;
  /** School records: deadlines, resources, timetable, classes, past tasks, grades, CAS, or one task or CAS experience by recordId. */
  readSchoolData(input: { purpose: string; classId?: string; recordId?: string }, signal: AbortSignal): Promise<string>;
  runCommand(request: CommandRequest, signal: AbortSignal): Promise<CommandResult>;
  /**
   * Record a command before the run pauses to ask, so the user's approval
   * binds to exactly this change. Optional: the in-memory backend needs none.
   */
  stageCommand?(request: CommandRequest, signal: AbortSignal): Promise<void>;
  /**
   * Hand the rest of this run to one of the user's agents: returns its
   * instructions, or null when it is unavailable. Optional.
   */
  useAgent?(agentId: string, signal: AbortSignal): Promise<{ title: string; instructions: string } | null>;
  /** Record an edit that needs approval (removing everything) before asking. */
  stageArtifactUpdate?(
    input: { id: string; type: ArtifactTypeKey; title?: string; content: Record<string, unknown>; toolCallId: string },
    signal: AbortSignal,
  ): Promise<void>;
}
