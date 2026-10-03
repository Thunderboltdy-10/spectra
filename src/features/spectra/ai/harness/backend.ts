import type { ArtifactTypeKey } from "../../artifacts/types";
import type { ToolOutcome } from "./types";

/*
 * The harness talks to Spectra only through this port. The run runtime binds
 * it to Convex and the collaboration rooms; the smoke run and tests bind it to
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

export type SearchHit = {
  kind: "artifact" | "thread" | "message" | "memory";
  id: string;
  title: string;
  type?: string;
  snippet?: string;
  threadId?: string;
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
  /** Read messages older than this message id. */
  before?: string;
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
  search(
    input: { query: string; scope: "library" | "conversations" | "memory" | "all"; limit: number },
    signal: AbortSignal,
  ): Promise<SearchHit[]>;
  readThread(input: ThreadReadRequest, signal: AbortSignal): Promise<string>;
  webSearch(input: { query: string; deep?: boolean }, signal: AbortSignal): Promise<WebResult[]>;
  readCalendar(input: { from: number; to: number; title?: string }, signal: AbortSignal): Promise<string>;
  readSchoolData(input: { purpose: string; classId?: string }, signal: AbortSignal): Promise<string>;
  runCommand(request: CommandRequest, signal: AbortSignal): Promise<CommandResult>;
  /**
   * Record a command before the run pauses to ask, so the user's approval
   * binds to exactly this change. Optional: the in-memory backend needs none.
   */
  stageCommand?(request: CommandRequest, signal: AbortSignal): Promise<void>;
  /** Record an edit that needs approval (removing everything) before asking. */
  stageArtifactUpdate?(
    input: { id: string; type: ArtifactTypeKey; title?: string; content: Record<string, unknown>; toolCallId: string },
    signal: AbortSignal,
  ): Promise<void>;
}
