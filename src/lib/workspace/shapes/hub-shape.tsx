"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  useEditor,
  useValue,
} from "tldraw";
import { getZoomLevel, getZoomBreakpoints, HUB_SIZE } from "../zoom-helpers";
import { useWorkspaceStore } from "@/stores/workspace-store";

export type HubShapeProps = {
  w: number;
  h: number;
  userName: string;
  userAvatar: string;
  upcomingDeadlines: number;
  recentNotes: number;
  totalWorkstreams: number;
};

export type HubShape = TLBaseShape<"hub", HubShapeProps>;

function getScreenBounds(editor: ReturnType<typeof useEditor>, shapeId: string) {
  const bounds = editor.getShapePageBounds(shapeId as any);
  if (!bounds) return null;
  const zoom = editor.getZoomLevel();
  const camera = editor.getCamera();
  return {
    x: (bounds.x + camera.x) * zoom,
    y: (bounds.y + camera.y) * zoom,
    w: bounds.w * zoom,
    h: bounds.h * zoom,
  };
}

function HubShapeComponent({ shape }: { shape: HubShape }) {
  const editor = useEditor();
  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const level = getZoomLevel(zoom);
  const bp = getZoomBreakpoints(zoom);

  // Direct store access for reliable click handling
  const { focusHub } = useWorkspaceStore();

  const isExpanded = level === "standard" || level === "detail";
  const isSummary = level === "summary";

  // Hub circle sizes — must fit within HUB_SIZE (260×260)
  const circleSize = isExpanded ? 220 : isSummary ? 170 : 120;
  const avatarSize = isExpanded ? 52 : isSummary ? 40 : 32;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const screenBounds = getScreenBounds(editor, shape.id);
    if (!screenBounds) return;
    focusHub(screenBounds);
  };

  return (
    <HTMLContainer>
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          pointerEvents: "all",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Outer pulse ring — always visible, signals the hub */}
        <div
          style={{
            position: "absolute",
            width: circleSize + 24,
            height: circleSize + 24,
            borderRadius: "50%",
            border: "1px solid var(--accent-cyan, #0e8ee8)",
            opacity: 0.12 * bp.badgeScale,
            transition: "all 320ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: "none",
          }}
        />

        {/* The hub circle */}
        <div
          onClick={handleClick}
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: "50%",
            background:
              "linear-gradient(145deg, var(--bg-elevated, #211e2e), var(--bg-secondary, #1e1b2b))",
            border: "1.5px solid var(--border-default, #3a3448)",
            boxShadow: isExpanded
              ? "0 24px 48px -16px rgba(7,20,35,0.32), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 4px var(--accent-cyan, #0e8ee8)20"
              : "0 12px 24px -12px rgba(7,20,35,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: isExpanded ? 10 : isSummary ? 7 : 5,
            overflow: "hidden",
            transition: "all 320ms cubic-bezier(0.22,1,0.36,1)",
            fontFamily:
              "var(--font-manrope, 'Manrope', -apple-system, sans-serif)",
            cursor: "pointer",
            position: "relative",
          }}
        >
          {/* Subtle top accent for hub */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "25%",
              right: "25%",
              height: 2,
              background: "linear-gradient(90deg, transparent, var(--accent-cyan, #0e8ee8), transparent)",
              opacity: 0.4 * bp.badgeScale,
              borderRadius: 2,
            }}
          />

          {/* Avatar */}
          {shape.props.userAvatar ? (
            <img
              src={shape.props.userAvatar}
              alt=""
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: "50%",
                objectFit: "cover",
                border: "2px solid var(--accent-cyan, #0e8ee8)40",
                boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                transition: "all 320ms cubic-bezier(0.22,1,0.36,1)",
              }}
            />
          ) : (
            <div
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: "50%",
                background:
                  "var(--gradient-brand, linear-gradient(132deg, #0e8ee8, #20b8b2))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isExpanded ? 20 : isSummary ? 15 : 12,
                fontWeight: 700,
                color: "#fff",
                border: "2px solid rgba(255,255,255,0.15)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                transition: "all 320ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              {(shape.props.userName || "?")[0]?.toUpperCase()}
            </div>
          )}

          {/* Name (summary+) */}
          <div
            style={{
              fontSize: isExpanded ? 13 : 11,
              fontWeight: 700,
              color: "var(--text-primary, #e8e4de)",
              textAlign: "center",
              opacity: bp.badgeScale,
              lineHeight: 1.2,
              maxWidth: "75%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              transition:
                "opacity 220ms cubic-bezier(0.22,1,0.36,1), font-size 280ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {shape.props.userName || "You"}
          </div>

          {/* Stats (standard+) */}
          {isExpanded && (
            <div
              style={{
                display: "flex",
                gap: 12,
                opacity: bp.descOpacity,
                transform: `translateY(${(1 - bp.descOpacity) * 6}px)`,
                transition:
                  "opacity 280ms cubic-bezier(0.22,1,0.36,1), transform 280ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              <HubStat value={shape.props.totalWorkstreams} label="streams" accent="var(--accent-cyan, #0e8ee8)" />
              <HubStat value={shape.props.upcomingDeadlines} label="due" accent="var(--warning, #b67616)" />
              <HubStat value={shape.props.recentNotes} label="notes" accent="var(--accent-mint, #20b8b2)" />
            </div>
          )}

          {/* Open prompt */}
          {isExpanded && (
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--accent-cyan, #0e8ee8)",
                opacity: bp.actionsOpacity * 0.7,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                transition: "opacity 220ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              View hub
            </div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

function HubStat({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        fontSize: 10,
        color: "var(--text-tertiary, #6b6478)",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 14,
          color: accent,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 9 }}>{label}</span>
    </div>
  );
}

export class HubShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = "hub" as const;

  static override props: Record<
    keyof HubShapeProps,
    T.Validatable<unknown>
  > = {
    w: T.number,
    h: T.number,
    userName: T.string,
    userAvatar: T.string,
    upcomingDeadlines: T.number,
    recentNotes: T.number,
    totalWorkstreams: T.number,
  };

  getDefaultProps(): HubShapeProps {
    return {
      w: HUB_SIZE.w,
      h: HUB_SIZE.h,
      userName: "",
      userAvatar: "",
      upcomingDeadlines: 0,
      recentNotes: 0,
      totalWorkstreams: 0,
    };
  }

  component(shape: HubShape) {
    return <HubShapeComponent shape={shape} />;
  }

  indicator(_shape: HubShape) {
    // No selection indicator — hub manages its own visual identity
    return null;
  }

  override canResize() {
    return false;
  }

  override canEdit() {
    return false;
  }

  // Hide the selection rectangle around the hub
  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override onDoubleClick() {
    return;
  }
}
