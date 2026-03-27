"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  useEditor,
  useValue,
} from "tldraw";
import {
  getZoomLevel,
  getZoomBreakpoints,
  getWorkstreamColor,
  DEFAULT_WORKSTREAM_SIZE,
  type ZoomLevel,
} from "../zoom-helpers";
import { useWorkspaceStore } from "@/stores/workspace-store";

export type WorkstreamShapeProps = {
  w: number;
  h: number;
  title: string;
  emoji: string;
  description: string;
  workstreamType: string;
  color: string;
  status: string;
  artifactCount: number;
  threadCount: number;
  lastActivityAt: number;
  workstreamId: string;
  dueDate: string;
};

export type WorkstreamShape = TLBaseShape<"workstream", WorkstreamShapeProps>;

// Utility: convert a shape's page bounds to screen/container coords
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

function WorkstreamShapeComponent({ shape }: { shape: WorkstreamShape }) {
  const editor = useEditor();
  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const level = getZoomLevel(zoom);
  const bp = getZoomBreakpoints(zoom);
  const c = getWorkstreamColor(shape.props.color);
  const isCompleted = shape.props.status === "completed";
  const isArchived = shape.props.status === "archived";
  const faded = isCompleted || isArchived;

  // Direct store access — more reliable than DOM events across tldraw's React boundary
  const { focusWorkstream } = useWorkspaceStore();

  const typeLabel =
    shape.props.workstreamType === "subject"
      ? "Subject"
      : shape.props.workstreamType === "project"
        ? "Project"
        : "General";

  const activityAge = shape.props.lastActivityAt
    ? Date.now() - shape.props.lastActivityAt
    : Infinity;
  const isActive = activityAge < 86400000;
  const activityLabel =
    activityAge < 3600000
      ? "Active now"
      : activityAge < 86400000
        ? "Today"
        : activityAge < 604800000
          ? "This week"
          : "Older";

  const handleEnter = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    const screenBounds = getScreenBounds(editor, shape.id);
    if (!screenBounds) return;
    focusWorkstream(shape.props.workstreamId, screenBounds);
  };

  // Glow ring when recently active
  const glowColor = isActive ? `${c.value}40` : "transparent";

  return (
    <HTMLContainer>
      <div
        style={{
          width: "100%",
          height: "100%",
          opacity: faded ? 0.3 : 1,
          transition:
            "opacity 280ms cubic-bezier(0.22,1,0.36,1)",
          pointerEvents: "all",
        }}
      >
        {/* Outer glow ring for active workstreams */}
        {!faded && isActive && (
          <div
            style={{
              position: "absolute",
              inset: -3,
              borderRadius: 21,
              border: `2px solid ${c.value}`,
              opacity: 0.2,
              pointerEvents: "none",
            }}
          />
        )}

        <div
          className="ws-island"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 18,
            border: `1.5px solid ${c.border}`,
            background: `linear-gradient(145deg, ${c.bg} 0%, var(--bg-elevated, #211e2e) 60%)`,
            backdropFilter: "blur(12px)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "var(--font-manrope, 'Manrope', -apple-system, sans-serif)",
            cursor: "pointer",
            boxShadow: `0 8px 24px -12px rgba(7,20,35,0.16), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 0 ${glowColor}`,
            transition:
              "box-shadow 280ms cubic-bezier(0.22,1,0.36,1)",
            position: "relative",
          }}
          onClick={handleEnter}
        >
          {/* Color accent bar at top */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, ${c.value}, ${c.value}80)`,
              opacity: bp.badgeScale,
              transition: "opacity 220ms cubic-bezier(0.22,1,0.36,1)",
            }}
          />

          {/* Header area */}
          <div
            style={{
              padding:
                level === "overview"
                  ? "10px 12px 8px"
                  : level === "summary"
                    ? "16px 16px 10px"
                    : "18px 20px 12px",
              display: "flex",
              alignItems: "flex-start",
              gap: level === "overview" ? 6 : 10,
              transition: "padding 280ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {/* Emoji */}
            <div
              style={{
                fontSize:
                  level === "overview" ? 16 : level === "summary" ? 22 : 26,
                lineHeight: 1,
                flexShrink: 0,
                transition: "font-size 280ms cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              {shape.props.emoji || "📚"}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Title — counter-scaled to stay readable */}
              <div
                style={{
                  fontSize:
                    level === "overview"
                      ? 11
                      : level === "summary"
                        ? 14
                        : 16,
                  fontWeight: 700,
                  color: "var(--text-primary, #e8e4de)",
                  lineHeight: 1.25,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: level === "overview" ? "nowrap" : "normal",
                  maxHeight:
                    level === "overview"
                      ? "1.25em"
                      : "none",
                  transition:
                    "font-size 280ms cubic-bezier(0.22,1,0.36,1), max-height 280ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                {shape.props.title}
              </div>

              {/* Type badge row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 5,
                  opacity: bp.badgeScale,
                  transform: `translateY(${(1 - bp.badgeScale) * -4}px)`,
                  transition:
                    "opacity 220ms cubic-bezier(0.22,1,0.36,1), transform 220ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: c.value,
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    padding: "2px 7px",
                    borderRadius: 6,
                  }}
                >
                  {typeLabel}
                </span>
                {shape.props.artifactCount > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text-tertiary, #6b6478)",
                    }}
                  >
                    {shape.props.artifactCount} artifact{shape.props.artifactCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>

            {/* Activity indicator */}
            {level !== "overview" && (
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: isActive
                    ? c.value
                    : activityAge < 604800000
                      ? "var(--warning, #b67616)"
                      : "var(--text-tertiary, #6b6478)",
                  flexShrink: 0,
                  marginTop: 6,
                  opacity: bp.badgeScale,
                  boxShadow: isActive ? `0 0 6px ${c.value}60` : "none",
                  transition: "opacity 220ms cubic-bezier(0.22,1,0.36,1)",
                }}
                title={activityLabel}
              />
            )}
          </div>

          {/* Description (standard+) */}
          <div
            style={{
              padding: "0 20px",
              opacity: bp.descOpacity,
              maxHeight: bp.descOpacity > 0.01 ? 54 : 0,
              overflow: "hidden",
              transition:
                "opacity 240ms cubic-bezier(0.22,1,0.36,1), max-height 240ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {shape.props.description && (
              <p
                style={{
                  fontSize: 11,
                  lineHeight: 1.55,
                  color: "var(--text-secondary, #a09598)",
                  margin: 0,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {shape.props.description}
              </p>
            )}
          </div>

          {/* Stats row (standard+) */}
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "8px 20px",
              opacity: bp.detailPanelOpacity,
              transform: `translateY(${(1 - bp.detailPanelOpacity) * 8}px)`,
              transition:
                "opacity 240ms cubic-bezier(0.22,1,0.36,1), transform 240ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {shape.props.threadCount > 0 && (
              <StatChip icon="💬" label={`${shape.props.threadCount} thread${shape.props.threadCount !== 1 ? "s" : ""}`} color={c.value} />
            )}
            {shape.props.dueDate && (
              <StatChip icon="⏱" label={`Due ${shape.props.dueDate}`} color="var(--warning, #b67616)" />
            )}
            {!shape.props.threadCount && !shape.props.dueDate && (
              <StatChip icon="✨" label={activityLabel} color="var(--text-tertiary, #6b6478)" />
            )}
          </div>

          {/* Enter prompt — appears near detail zoom */}
          <div
            style={{
              position: "absolute",
              bottom: 12,
              right: 14,
              opacity: bp.actionsOpacity,
              transition: "opacity 220ms cubic-bezier(0.22,1,0.36,1)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                fontWeight: 600,
                color: c.value,
              }}
            >
              <span>Open workspace</span>
              <span style={{ fontSize: 11 }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

function StatChip({
  icon,
  label,
  color,
}: {
  icon: string;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        color: "var(--text-secondary, #a09598)",
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

export class WorkstreamShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = "workstream" as const;

  static override props: Record<
    keyof WorkstreamShapeProps,
    T.Validatable<unknown>
  > = {
    w: T.number,
    h: T.number,
    title: T.string,
    emoji: T.string,
    description: T.string,
    workstreamType: T.string,
    color: T.string,
    status: T.string,
    artifactCount: T.number,
    threadCount: T.number,
    lastActivityAt: T.number,
    workstreamId: T.string,
    dueDate: T.string,
  };

  getDefaultProps(): WorkstreamShapeProps {
    return {
      w: DEFAULT_WORKSTREAM_SIZE.w,
      h: DEFAULT_WORKSTREAM_SIZE.h,
      title: "New Workstream",
      emoji: "📚",
      description: "",
      workstreamType: "general",
      color: "#0e8ee8",
      status: "active",
      artifactCount: 0,
      threadCount: 0,
      lastActivityAt: Date.now(),
      workstreamId: "",
      dueDate: "",
    };
  }

  component(shape: WorkstreamShape) {
    return <WorkstreamShapeComponent shape={shape} />;
  }

  indicator(shape: WorkstreamShape) {
    const c = getWorkstreamColor(shape.props.color);
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={18}
        ry={18}
        fill="none"
        stroke={c.value}
        strokeWidth={1.5}
        strokeOpacity={0.5}
      />
    );
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return false;
  }

  // Prevent tldraw's default double-click behavior (which would try to enter text edit)
  override onDoubleClick() {
    return;
  }
}
