export const CURRENT_WORKSPACE_VIEWS = ["cards", "library"] as const;
export type WorkspaceView = (typeof CURRENT_WORKSPACE_VIEWS)[number];

/**
 * D30 retired Canvas and Timeline as workspace organization modes. Historical
 * rows and manifests remain readable, but every current projection converges
 * them onto the Library view and no current writer accepts them.
 */
export function normalizeWorkspaceView(value: unknown): WorkspaceView {
  return value === "cards" ? "cards" : "library";
}
