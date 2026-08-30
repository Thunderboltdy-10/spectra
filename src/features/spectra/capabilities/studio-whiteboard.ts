import { z } from "zod";
import type { CommandParam } from "../commands/types";
import type { WorkCapability } from "../work/registry";
import {
  WHITEBOARD_CONNECTOR_ANCHORS,
  WHITEBOARD_CONNECTOR_CAPS,
  WHITEBOARD_CONNECTOR_ROUTES,
  WHITEBOARD_SHAPE_KINDS,
} from "../whiteboard/model";
import type {
  AuthorityRisk,
  CapabilityDefinition,
  CapabilityDelivery,
} from "./types";

const none = z.null();
const text = z.string().max(20_000);
const id = z.string().trim().min(1).max(180);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const dimension = z.number().min(20).max(100_000);

type WhiteboardSpec = {
  localId: string;
  description: string;
  params?: z.ZodType<CommandParam>;
  requires?: WorkCapability;
  exposed?: boolean;
  risk?: AuthorityRisk;
  delivery?: CapabilityDelivery;
};

const ship = { status: "ship" } as const;
const refuse = (reason: string): CapabilityDelivery => ({
  status: "refuse",
  reason,
});
const defer = (reason: string, owner: string): CapabilityDelivery => ({
  status: "defer",
  reason,
  owner,
});

type NormalizedWhiteboardSpec = WhiteboardSpec & {
  delivery: CapabilityDelivery;
};

const WHITEBOARD_SPECS: readonly NormalizedWhiteboardSpec[] = (
  [
    {
      localId: "undo",
      description: "Undo the last board change.",
      requires: "edit",
    },
    {
      localId: "redo",
      description: "Redo the last undone board change.",
      requires: "edit",
    },
    { localId: "zoom.out", description: "Zoom the board out." },
    { localId: "zoom.in", description: "Zoom the board in." },
    { localId: "fit", description: "Fit the current page to its content." },
    { localId: "pages", description: "Show or hide the page rail." },
    { localId: "tool.select", description: "Select board objects." },
    { localId: "tool.hand", description: "Pan the board." },
    {
      localId: "tool.note",
      description: "Use the sticky-note insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.connector",
      description: "Use the attached connector tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.text",
      description: "Use the text insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.shape",
      description: "Use the shape insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.frame",
      description: "Use the presentation-frame insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.card",
      description: "Use the card insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.table",
      description: "Use the table insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.embed",
      description: "Use the live-work embed insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "add.image",
      description: "Add an image to the current page.",
      requires: "edit",
    },
    {
      localId: "import",
      description: "Import a supported board file.",
      requires: "edit",
    },
    {
      localId: "snap",
      description: "Toggle grid and smart-guide snapping.",
      requires: "edit",
      exposed: true,
    },
    { localId: "panel.layers", description: "Open pages and layers." },
    {
      localId: "panel.templates",
      description: "Open board templates.",
      requires: "edit",
    },
    { localId: "panel.search", description: "Find content on this board." },
    {
      localId: "panel.outline",
      description: "Open the accessible board outline.",
    },
    {
      localId: "present",
      description: "Present this board.",
      requires: "present",
    },
    {
      localId: "export.png",
      description: "Export the current page as PNG.",
      exposed: true,
    },
    {
      localId: "export.svg",
      description: "Export the current page as editable SVG.",
      exposed: true,
    },
    {
      localId: "export.pdf",
      description: "Export the current page as PDF.",
      exposed: true,
    },
    {
      localId: "export.package",
      description: "Export a versioned portable board package.",
      exposed: true,
    },

    {
      localId: "tool.section",
      description: "Use the board-section insertion tool.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "tool.laser",
      description:
        "Use an ephemeral laser pointer without changing board content.",
    },
    {
      localId: "page.add",
      description: "Add a board page.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "page.navigate",
      description: "Navigate to a board page.",
      params: id,
    },
    {
      localId: "layer.add",
      description: "Add a layer to the current page.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "layer.visibility",
      description: "Toggle a layer's visibility.",
      params: id,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "layer.lock",
      description: "Toggle a layer's lock state.",
      params: id,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "grid.show",
      description: "Show or hide the board grid.",
      params: z.boolean(),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "virtualization.threshold",
      description:
        "Set the node count at which viewport virtualization begins.",
      params: z.number().int().min(50).max(100_000),
      requires: "edit",
      exposed: true,
    },

    {
      localId: "selection.all",
      description: "Select every visible object on the current page.",
    },
    {
      localId: "selection.duplicate",
      description: "Duplicate selected objects and their internal connectors.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.delete",
      description: "Delete the selected objects or connector.",
      requires: "edit",
      exposed: true,
      risk: "confirm",
    },
    {
      localId: "selection.lock",
      description: "Lock the selected objects.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.unlock",
      description: "Unlock the selected objects.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.bring.front",
      description: "Bring selected objects to the front.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.send.back",
      description: "Send selected objects to the back.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.group",
      description: "Group selected objects with stable descendant identity.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.ungroup",
      description: "Ungroup selected object groups.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.nudge.x",
      description: "Move selected objects horizontally by an exact amount.",
      params: coordinate,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "selection.nudge.y",
      description: "Move selected objects vertically by an exact amount.",
      params: coordinate,
      requires: "edit",
      exposed: true,
    },

    ...(["left", "center", "right", "top", "middle", "bottom"] as const).map(
      (mode) => ({
        localId: `align.${mode}`,
        description: `Align selected objects ${mode}.`,
        requires: "edit" as const,
        exposed: true,
      }),
    ),
    {
      localId: "distribute.horizontal",
      description: "Distribute selected objects horizontally.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "distribute.vertical",
      description: "Distribute selected objects vertically.",
      requires: "edit",
      exposed: true,
    },

    {
      localId: "shape.kind",
      description: "Change the selected shape to a supported shape kind.",
      params: z.enum(WHITEBOARD_SHAPE_KINDS),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "vote.adjust",
      description: "Adjust the selected sticky note or card vote tally.",
      params: z.number().int().min(-100_000).max(100_000),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "vote.clear",
      description: "Clear the selected sticky note or card vote tally.",
      requires: "edit",
      exposed: true,
    },

    {
      localId: "connector.reverse",
      description: "Reverse the selected connector direction.",
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.delete",
      description: "Delete the selected connector.",
      requires: "edit",
      exposed: true,
      risk: "confirm",
    },
    {
      localId: "connector.label",
      description: "Set the selected connector label.",
      params: z.string().max(500),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.route",
      description: "Set the selected connector route.",
      params: z.enum(WHITEBOARD_CONNECTOR_ROUTES),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.from.anchor",
      description: "Set the selected connector start anchor.",
      params: z.enum(WHITEBOARD_CONNECTOR_ANCHORS),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.to.anchor",
      description: "Set the selected connector end anchor.",
      params: z.enum(WHITEBOARD_CONNECTOR_ANCHORS),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.start.cap",
      description: "Set the selected connector start cap.",
      params: z.enum(WHITEBOARD_CONNECTOR_CAPS),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.end.cap",
      description: "Set the selected connector end cap.",
      params: z.enum(WHITEBOARD_CONNECTOR_CAPS),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "connector.layer",
      description:
        "Move the selected connector to a layer on the current page.",
      params: id,
      requires: "edit",
      exposed: true,
    },

    {
      localId: "node.text",
      description: "Rewrite the selected object's text.",
      params: text,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.content",
      description:
        "Merge a JSON object into the selected object's structured content.",
      params: text,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.label",
      description: "Set the selected object's semantic label.",
      params: z.string().max(500),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.x",
      description: "Set the selected object's horizontal position.",
      params: coordinate,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.y",
      description: "Set the selected object's vertical position.",
      params: coordinate,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.width",
      description: "Set the selected object's width.",
      params: dimension,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.height",
      description: "Set the selected object's height.",
      params: dimension,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.layer",
      description: "Move the selected object to a layer on the current page.",
      params: id,
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.fill",
      description: "Set the selected object's fill colour.",
      params: z.string().max(100),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.stroke",
      description: "Set the selected object's border colour.",
      params: z.string().max(100),
      requires: "edit",
      exposed: true,
    },
    {
      localId: "node.embed.source",
      description: "Link the selected embed object to accessible work.",
      params: id,
      requires: "edit",
      exposed: true,
    },

    ...(["concept", "study", "retro", "brainwriting"] as const).map(
      (template) => ({
        localId: `template.${template}`,
        description: `Apply the ${template} board template.`,
        requires: "edit" as const,
        exposed: true,
      }),
    ),
    {
      localId: "export.frame.png",
      description: "Export the selected frame as PNG.",
      exposed: true,
    },
    {
      localId: "export.frame.svg",
      description: "Export the selected frame as SVG.",
      exposed: true,
    },

    {
      localId: "tool.freehand",
      description:
        "Freehand ink is not available yet. Use shapes, connectors, text, or the laser pointer.",
      requires: "edit",
      exposed: true,
      delivery: refuse(
        "Freehand ink is not available yet. Use shapes, connectors, text, or the laser pointer.",
      ),
    },
    {
      localId: "connector.auto.route",
      description:
        "Automatic obstacle-avoiding routes are not available yet. Choose straight, elbow, or curved routing.",
      requires: "edit",
      exposed: true,
      delivery: refuse(
        "Automatic obstacle-avoiding routes are not available yet. Choose straight, elbow, or curved routing.",
      ),
    },
    {
      localId: "voting.session",
      description:
        "Timed or anonymous voting sessions are not available. This board keeps a visible tally on each note.",
      requires: "edit",
      exposed: true,
      delivery: refuse(
        "Timed or anonymous voting sessions are not available. This board keeps a visible tally on each note.",
      ),
    },
    {
      localId: "import.miro",
      description:
        "Miro and FigJam board files cannot be imported directly. Export SVG or PDF first.",
      requires: "edit",
      exposed: true,
      delivery: refuse(
        "Miro and FigJam board files cannot be imported directly. Export SVG or PDF first.",
      ),
    },
    {
      localId: "facilitation.widgets",
      description:
        "Shared timers, music, and reaction widgets belong to the later studio-facilitation unit.",
      exposed: true,
      delivery: defer(
        "Shared timers, music, and reaction widgets are not part of this board yet.",
        "P12.I6",
      ),
    },
  ] satisfies readonly WhiteboardSpec[]
).map((spec) => ({
  ...spec,
  delivery: "delivery" in spec && spec.delivery ? spec.delivery : ship,
}));

export const WHITEBOARD_CAPABILITIES: readonly CapabilityDefinition<"whiteboard">[] =
  WHITEBOARD_SPECS.map((spec) => {
    const capabilityId = `whiteboard.${spec.localId}` as const;
    const unavailable =
      spec.delivery.status === "ship" ? undefined : spec.delivery.reason;
    return {
      id: capabilityId,
      params: spec.params ?? none,
      scope: "artifact",
      availability: (ctx) => {
        if (spec.requires && !ctx.can(spec.requires))
          return { state: "hidden" as const };
        if (unavailable)
          return { state: "disabled" as const, reason: unavailable };
        return { state: "enabled" as const };
      },
      execute: { editor: capabilityId },
      ai: {
        exposed: spec.exposed ?? false,
        description: spec.description,
        riskClass: spec.risk ?? "safe",
      },
      choreography: { target: "whiteboard", region: capabilityId },
      ...(spec.requires ? { requires: spec.requires } : {}),
      ...(spec.exposed ? { manifestOperation: capabilityId } : {}),
      delivery: spec.delivery,
    } satisfies CapabilityDefinition<"whiteboard">;
  });

export const WHITEBOARD_MANIFEST_OPERATIONS = WHITEBOARD_CAPABILITIES.filter(
  (definition) => definition.ai.exposed,
).map((definition) => definition.id.slice("whiteboard.".length));
