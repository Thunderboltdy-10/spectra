import type { z } from "zod";
import type {
  DocxOperation,
  PptxOperation,
  XlsxOperation,
} from "../lenses/projection-contracts";
import type {
  CommandAvailability,
  CommandContext,
  FidelityRegionKey,
} from "../commands/types";
import type { WorkCapability, WorkType } from "../work/registry";
import type { ArtifactEmbedInteraction } from "../../../../shared/artifact-embed";

export type CapabilityScope = "artifact" | "application";
export type AuthorityRisk =
  "safe" | "confirm" | "always-confirm" | "destructive";
export type HandlerRef = string;
export type OperationRef = string;
export type OfficeWorkType = "document" | "sheets" | "presentation";
export type CapabilityOwner = WorkType | "app";

export type OfficeLensDeltaKind<T extends OfficeWorkType> = T extends "document"
  ? DocxOperation["kind"]
  : T extends "sheets"
    ? XlsxOperation["kind"]
    : PptxOperation["kind"];

export type ChoreographyPrimitive = {
  target: string;
  region?: string;
};

export type EmbedCapability = {
  /** Embed interaction levels at which this exact operation is available. */
  levels: readonly ArtifactEmbedInteraction[];
};

export type NativeCapability<T extends OfficeWorkType = OfficeWorkType> = {
  /** Regions this operation can change in a linked native package. */
  touches: readonly FidelityRegionKey[];
  /**
   * The real lens operation that materializes the change. Its absence is an
   * explicit refusal in strict-native mode, never an optimistic capability.
   */
  delta?: OfficeLensDeltaKind<T>;
  /** Required when `delta` is absent, and shown unchanged on every surface. */
  unavailableReason?: string;
};

export type ConnectorNativeMapping = {
  /** Provider/resource native format resolved through the formal lens registry. */
  nativeFormat: string;
  /** Format-specific semantic delta implemented by that registered lens. */
  delta: string;
};

/**
 * The single capability source described by Reformation R6.
 *
 * UI placement is deliberately absent. Tabs, icons and control geometry are a
 * presentation projection; parameters, availability, native reach, authority
 * and execution identity are capability truth.
 */
export type CapabilityDefinition<
  T extends CapabilityOwner = CapabilityOwner,
  P = unknown,
> = {
  id: `${T}.${string}`;
  params: z.ZodType<P>;
  scope: CapabilityScope;
  availability: (ctx: CommandContext) => CommandAvailability;
  native?: T extends OfficeWorkType ? NativeCapability<T> : never;
  /** Connector-backed paths are cross-checked against the lens registry. */
  connectorNative?: T extends OfficeWorkType
    ? readonly ConnectorNativeMapping[]
    : never;
  execute: {
    editor?: HandlerRef;
    server?: OperationRef;
  };
  ai: {
    exposed: boolean;
    description: string;
    riskClass: AuthorityRisk;
  };
  choreography?: ChoreographyPrimitive;
  embed?: EmbedCapability;
  requires?: WorkCapability;
  /**
   * The existing artifact-manifest verb this capability specializes. During
   * the incremental P3 migration it keeps old plan consumers honest without
   * making the UI binding a second source of capability metadata.
   */
  manifestOperation?: string;
};
