/*
 * The Spectra AI harness: one model <-> tools loop, the way Claude Code works.
 * These types are shared by the loop, the tools, the permission policy, the
 * caption writer, compaction and the run runtime. Nothing here talks to
 * Convex or a provider directly; those arrive as injected ports.
 */

/** What a tool does to the world. The permission policy reads only this. */
export type ToolEffect = "read" | "write" | "irreversible" | "settings";

/**
 * Categories the user can "Always allow". Only effects that ask (irreversible
 * and settings) carry a category.
 */
export {
  PERMISSION_CATEGORIES,
  type PermissionCategory,
} from "@/features/spectra/settings/schema/ai-permissions";
import type { PermissionCategory } from "@/features/spectra/settings/schema/ai-permissions";
import type { RunSource } from "./sources";

export type JsonSchema = Record<string, unknown>;

export type HarnessToolCall = { id: string; name: string; arguments: string };

export type HarnessContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type HarnessMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | HarnessContentPart[] }
  | {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** A message the user sent while the run worked or waited, with any files. */
export type Steer = { text: string; parts?: HarnessContentPart[] };

/** An artifact a tool created, edited or explicitly pointed the user to. */
export type ArtifactTouch = {
  id: string;
  type: string;
  title: string;
  action: "created" | "edited" | "referenced";
  /** "Added 3 slides". Never an id. */
  change?: string;
};

export type InputOption = { key: string; label: string; description?: string };

/** A durable pause: a question for the user or an approval. */
export type PendingInput = {
  kind: "question" | "approval";
  toolCallId: string;
  toolName: string;
  /** Plain words, no ids: "Delete *Old notes* permanently?" */
  question: string;
  options?: InputOption[];
  /** A short free-text answer is accepted. */
  allowText?: boolean;
  category?: PermissionCategory;
};

export type InputAnswer =
  | { kind: "question"; choiceKey?: string; choiceLabel?: string; text?: string }
  | { kind: "approval"; allowed: boolean; alwaysAllow?: boolean };

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type WidgetOutput = { title: string; html: string };

/** A widget the run showed, kept so the saved reply can show it again. */
export type ShownWidget = WidgetOutput & { id: string };

/** What a tool returns. `content` is the only part the model sees. */
export type ToolOutcome = {
  ok: boolean;
  content: string;
  artifacts?: ArtifactTouch[];
  /** What this step read that the reply may cite. */
  sources?: RunSource[];
  /** Pause the run for the user (ask_user). */
  pause?: Omit<PendingInput, "toolCallId" | "toolName">;
  /** Client UI events (navigation, follow mode). */
  uiEvents?: Array<{ key: string; payload?: Record<string, unknown> }>;
  todos?: TodoItem[];
  widget?: WidgetOutput;
  /** Shown in the trace when the step completes ("Added 3 slides"). */
  doneLabel?: string;
};

export type ToolContext = {
  signal: AbortSignal;
  runId: string;
  toolCallId: string;
  /** The user (or their stored choice) approved this call. */
  approved?: boolean;
};

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export type HarnessTool<A = Record<string, unknown>> = {
  name: string;
  /** Prose guidance for the model. */
  description: string;
  /** A small JSON schema. */
  parameters: JsonSchema;
  effect: ToolEffect | ((args: A) => ToolEffect);
  /** Required when the effect can be irreversible or settings. */
  category?: (args: A) => PermissionCategory | undefined;
  /** A short human phrase, present tense, no ids: "Creating *Photosynthesis*". */
  label: (args: A) => string;
  /**
   * Harness plumbing with nothing true to tell the user (loading a skill): no
   * step in the trace and nothing for the captions to describe.
   */
  quiet?: boolean;
  /** The approval question, in plain words, when the effect asks. */
  question?: (args: A) => string;
  /**
   * Artifact ids this call writes. Calls that share a target run in order;
   * every other call runs in parallel.
   */
  targets?: (args: A) => string[];
  /** The artifact the step works in, which a view following the run opens while it does. */
  shows?: (args: A) => string | undefined;
  /** Validate and normalise raw JSON arguments. Throw ToolInputError. */
  parse?: (raw: Record<string, unknown>) => A;
  execute: (args: A, ctx: ToolContext) => Promise<ToolOutcome>;
  /**
   * Record what the call will do before the run pauses to ask, so the
   * approval binds to that exact change. Throwing turns the call into an
   * error for the model instead of a question.
   */
  stage?: (args: A, ctx: ToolContext) => Promise<void>;
  /** Turns a user's answer into the tool result (ask_user). */
  answer?: (args: A, answer: InputAnswer) => ToolOutcome;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHarnessTool = HarnessTool<any>;

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type ModelTurn = {
  text: string;
  toolCalls: HarnessToolCall[];
  finishReason?: string;
  model?: string;
  provider?: string;
  usage?: ModelUsage;
};

/** The provider could not be reached after every retry and fallback. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export type ProviderToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

export function toolEffect<A>(tool: HarnessTool<A>, args: A): ToolEffect {
  return typeof tool.effect === "function" ? tool.effect(args) : tool.effect;
}

export function providerToolSpec(tool: AnyHarnessTool): ProviderToolSpec {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
