declare module "pptxgenjs";
declare module "docx";
declare module "jspdf";

declare module "@xyflow/react" {
  import type { CSSProperties, FC, HTMLAttributes, ReactNode } from "react";

  export type Viewport = {
    x: number;
    y: number;
    zoom: number;
  };

  export type Edge = {
    id: string;
    source: string;
    target: string;
    [key: string]: unknown;
  };

  export type Node<T = unknown> = {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data?: T;
    draggable?: boolean;
    selectable?: boolean;
    style?: CSSProperties & Record<string, unknown>;
    [key: string]: unknown;
  };

  export type NodeProps<T extends Node = Node> = {
    data: T extends Node<infer D> ? D : unknown;
  };

  export type ReactFlowInstance<N extends Node = Node, E extends Edge = Edge> = {
    setViewport: (viewport: Viewport, options?: { duration?: number }) => void;
    zoomTo: (zoom: number, options?: { duration?: number }) => void;
    setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
    getNode: (id: string) => N | undefined;
    getEdge?: (id: string) => E | undefined;
  };

  export const Position: {
    Left: string;
    Right: string;
    Top: string;
    Bottom: string;
  };

  export const MarkerType: {
    ArrowClosed: string;
  };

  export const BackgroundVariant: {
    Dots: string;
    Lines: string;
  };

  export const ReactFlowProvider: FC<{ children?: ReactNode }>;
  export const ReactFlow: FC<Record<string, unknown>>;
  export const Background: FC<Record<string, unknown>>;
  export const Controls: FC<Record<string, unknown>>;
  export const ControlButton: FC<HTMLAttributes<HTMLButtonElement>>;
  export const Handle: FC<Record<string, unknown>>;
}
