export const WORKSPACE_SHELLS = [
  "constellations",
  "magnetic",
  "lenses",
] as const;

export type WorkspaceShellMode = (typeof WORKSPACE_SHELLS)[number];

export const WORKSPACE_SHELL_META: Record<WorkspaceShellMode, {
  shortLabel: "A" | "B" | "C";
  label: string;
  description: string;
}> = {
  constellations: {
    shortLabel: "A",
    label: "Constellations",
    description: "Atmospheric clusters and relationship-heavy overview.",
  },
  magnetic: {
    shortLabel: "B",
    label: "Magnetic Surface",
    description: "Tactile active field with edge-driven utilities.",
  },
  lenses: {
    shortLabel: "C",
    label: "Focal Lenses",
    description: "Cinematic focus and guided visual hierarchy.",
  },
};

