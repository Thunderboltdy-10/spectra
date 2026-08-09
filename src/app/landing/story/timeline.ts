/**
 * The tall canvas, and how the camera moves down it.
 *
 * The landing is one work surface roughly 1040 logical px wide and ten
 * thousand tall. Scenes are regions of that surface, not separate pages. The
 * camera travels down it, holds still while a staged sequence plays, and at
 * the very end pulls back far enough to reveal what the surface has been
 * sitting inside all along.
 *
 * Everything here is a pure function of one number: how far the visitor has
 * scrolled. That is what makes the whole story reversible.
 */

export const LANDING_WIDTH = 1040;

export type SceneMode = "travel" | "stage" | "hybrid";

export type SceneId =
  | "wake"
  | "hero"
  | "prepare"
  | "transform"
  | "living"
  | "contention"
  | "dock"
  | "workbench"
  | "references"
  | "calendar"
  | "foundry"
  | "scale"
  | "reveal";

export type Scene = {
  id: SceneId;
  mode: SceneMode;
  /** Where this scene's content sits on the tall canvas. */
  top: number;
  height: number;
  /** How much scrolling the scene consumes, in viewport heights. */
  length: number;
  /**
   * Canvas Y held at the centre of the frame, at the scene's start and end.
   * A `stage` scene reaches its end value early and then holds, so entering it
   * is an arrival rather than a stop.
   */
  camera: [number, number];
  /**
   * Camera scale multiplier at start and end. 1 means "the canvas fills the
   * frame". The final two scenes are the only ones that leave 1.
   */
  zoom?: [number, number];
};

/** How much of a staged scene is spent arriving at its composition. */
const STAGE_ARRIVAL = 0.2;

/**
 * The scenes, in order.
 *
 * Stage scenes are deliberately generous: a six-second sequence costs roughly
 * one and a half screens of scrolling, never a dozen. Camera values are
 * continuous across boundaries, so there is never a cut.
 */
export const SCENES: Scene[] = [
  {
    id: "wake",
    mode: "travel",
    top: 0,
    height: 200,
    length: 0.5,
    camera: [100, 400],
  },
  {
    id: "hero",
    mode: "travel",
    top: 200,
    height: 840,
    length: 2.2,
    camera: [400, 900],
  },
  {
    id: "prepare",
    mode: "stage",
    top: 1040,
    height: 440,
    length: 1.2,
    camera: [900, 1260],
  },
  {
    id: "transform",
    mode: "stage",
    top: 1480,
    height: 1160,
    length: 2.8,
    camera: [1260, 2060],
  },
  {
    id: "living",
    mode: "hybrid",
    top: 2640,
    height: 980,
    length: 2.1,
    camera: [2060, 3130],
  },
  {
    id: "contention",
    mode: "stage",
    top: 3620,
    height: 860,
    length: 1.8,
    camera: [3130, 4050],
  },
  {
    id: "dock",
    mode: "hybrid",
    top: 4480,
    height: 700,
    length: 1.6,
    camera: [4050, 4830],
  },
  {
    id: "workbench",
    mode: "stage",
    top: 5180,
    height: 1080,
    length: 2.6,
    camera: [4830, 5720],
  },
  {
    id: "references",
    mode: "hybrid",
    top: 6260,
    height: 940,
    length: 2.0,
    camera: [5720, 6730],
  },
  {
    id: "calendar",
    mode: "stage",
    top: 7200,
    height: 960,
    length: 2.0,
    camera: [6730, 7680],
  },
  {
    id: "foundry",
    mode: "hybrid",
    top: 8160,
    height: 1000,
    length: 2.1,
    camera: [7680, 8660],
  },
  {
    id: "scale",
    mode: "travel",
    top: 9160,
    height: 880,
    length: 1.9,
    camera: [8660, 9600],
    zoom: [1, 0.72],
  },
  {
    /* The longest scene on the page, because four things happen in it and
       rushing any of them would make the last one read as a trick: the closing
       lines are written, the box contracts into a panel, the product resolves
       around it, and then the page proves how tall it really is. The end zoom
       is nominal — `revealZoom` corrects it to whatever makes 1040 canvas px
       measure exactly one panel at this window size. */
    id: "reveal",
    mode: "stage",
    top: 10040,
    height: 760,
    length: 4.6,
    camera: [9600, 10380],
    zoom: [0.72, 0.42],
  },
];

/** Total logical height of the authored surface. */
export const CANVAS_HEIGHT =
  SCENES[SCENES.length - 1]!.top + SCENES[SCENES.length - 1]!.height + 240;

export const SCENE_BY_ID = new Map(SCENES.map((scene) => [scene.id, scene]));

export type CameraState = {
  /** Canvas Y held at the centre of the frame. */
  y: number;
  /** Scale multiplier on top of the fit-to-width scale. */
  zoom: number;
  scene: SceneId;
  /** Progress through the current scene, 0..1. */
  t: number;
  /** Index of the current scene. */
  index: number;
  /** Overall progress through the whole story, 0..1. */
  overall: number;
};

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function smooth(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** Smoothed progress through a named window of a scene. */
function band(t: number, from: number, to: number): number {
  return smooth((t - from) / (to - from));
}

/**
 * The reveal, movement by movement.
 *
 * Six overlapping windows, written down once so the clip box, the camera, the
 * zoom and the shell furniture cannot disagree about when anything happens.
 * Every consumer reads these; none of them holds its own copy.
 */
const REVEAL = {
  /** A small symmetric inset: enough to see an edge, not enough to relocate. */
  margin: [0.3, 0.44],
  /** The box contracts to panel width. This is the movement. */
  narrow: [0.44, 0.62],
  /** The product's own furniture arrives around the finished panel. */
  shell: [0.54, 0.7],
  /** The proof pass: the page scrolls inside the panel, up and back. */
  up: [0.72, 0.805],
  hold: [0.805, 0.835],
  down: [0.835, 0.9],
  /** Canvas Y the proof pass travels to. The hero, recognisably. */
  restY: 620,
} as const;

/**
 * The proof pass (§27, Stage I).
 *
 * A panel that claims to hold a tall page has to show it. Once the panel
 * exists, the camera runs back up the surface it just came down, pauses on the
 * hero long enough to be recognised, and returns. Nothing is faked and nothing
 * is replayed: it is the same camera reading the same canvas, and every scene
 * it passes is in the finished state the visitor left it in.
 */
function proofPass(t: number, rest: number): number {
  if (t <= REVEAL.up[0] || t >= REVEAL.down[1]) return rest;
  if (t < REVEAL.hold[0]) {
    return rest + (REVEAL.restY - rest) * band(t, REVEAL.up[0], REVEAL.up[1]);
  }
  if (t < REVEAL.down[0]) return REVEAL.restY;
  return (
    REVEAL.restY +
    (rest - REVEAL.restY) * band(t, REVEAL.down[0], REVEAL.down[1])
  );
}

/**
 * Scroll length of the whole page, in px, for a given viewport height.
 *
 * Scene lengths are expressed in viewport heights so the page costs the same
 * number of gestures on a laptop and on a tall monitor.
 */
export function totalScroll(viewportHeight: number): number {
  const units = SCENES.reduce((sum, scene) => sum + scene.length, 0);
  return Math.round(units * viewportHeight);
}

/**
 * Resolve scroll position into camera state.
 *
 * Pure, monotonic and exactly invertible in intent: scrolling up recomputes
 * the same values it produced on the way down, which is why no scene needs to
 * "rewind" anything.
 */
export function cameraFor(
  scrollY: number,
  viewportHeight: number,
): CameraState {
  const total = totalScroll(viewportHeight);
  const clamped = Math.max(0, Math.min(total, scrollY));
  let cursor = 0;
  for (let index = 0; index < SCENES.length; index += 1) {
    const scene = SCENES[index]!;
    const span = scene.length * viewportHeight;
    const last = index === SCENES.length - 1;
    if (clamped < cursor + span || last) {
      const raw = span > 0 ? (clamped - cursor) / span : 1;
      const t = Math.max(0, Math.min(1, raw));
      /* Travel is linear so it feels like ordinary scrolling. A staged scene
         arrives at its composition in the first fifth and then holds, so the
         viewport settles rather than stopping dead. Hybrid keeps moving. */
      const curve =
        scene.mode === "travel"
          ? t
          : scene.mode === "hybrid"
            ? easeInOut(t)
            : easeInOut(Math.min(1, t / STAGE_ARRIVAL));
      const zoom = scene.zoom ?? [1, 1];
      const held =
        scene.camera[0] + (scene.camera[1] - scene.camera[0]) * curve;
      return {
        y: scene.id === "reveal" ? proofPass(t, held) : held,
        zoom: zoom[0] + (zoom[1] - zoom[0]) * easeInOut(t),
        scene: scene.id,
        t,
        index,
        overall: total > 0 ? clamped / total : 0,
      };
    }
    cursor += span;
  }
  const scene = SCENES[0]!;
  return {
    y: scene.camera[0],
    zoom: 1,
    scene: scene.id,
    t: 0,
    index: 0,
    overall: 0,
  };
}

/**
 * The prism's optical progress at a point in the story.
 *
 * The glass has its own arc: dormant through the hero, charging as it is
 * prepared, igniting as work is fed into it, alive while the work is alive,
 * and resolving as the page completes. It is deliberately not a linear map of
 * scroll, because the prism is doing something specific in each scene.
 */
const OPTICS: Record<SceneId, [number, number]> = {
  wake: [0.02, 0.03],
  hero: [0.03, 0.07],
  prepare: [0.07, 0.16],
  transform: [0.16, 0.62],
  living: [0.62, 0.7],
  contention: [0.7, 0.72],
  dock: [0.72, 0.76],
  workbench: [0.76, 0.8],
  references: [0.8, 0.83],
  calendar: [0.83, 0.86],
  foundry: [0.86, 0.9],
  scale: [0.9, 0.95],
  reveal: [0.95, 1],
};

export function opticsFor(camera: CameraState): number {
  const band = OPTICS[camera.scene];
  return band[0] + (band[1] - band[0]) * camera.t;
}

/* ------------------------------------------------------------------ *
 * The channel
 *
 * For twelve scenes the canvas is clipped by the whole viewport, which is
 * indistinguishable from not being clipped at all. In the last scene that box
 * contracts into a panel — and because the canvas is centred *inside* the box,
 * narrowing the box is what carries the page into place. There is no second
 * animation, and no moment where a copy of the page takes over.
 * ------------------------------------------------------------------ */

/** The product shell's real dimensions, from the app's own layout tokens. */
export const SHELL = {
  sidebar: 232,
  rail: 44,
  dock: 112,
  gap: 16,
} as const;

export type Viewport = { width: number; height: number };

export type Channel = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** How resolved the surrounding product is, 0..1. */
  open: number;
  /** How much of the shell's own furniture has arrived, 0..1. */
  shell: number;
  /** How far into the proof pass the panel is, 0..1. */
  proof: number;
};

const CLOSED: Channel = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  open: 0,
  shell: 0,
  proof: 0,
};

/** How wide the landing panel reads in the finished product. */
export function channelWidth(viewport: Viewport): number {
  return Math.max(360, Math.min(560, viewport.width * 0.34));
}

/**
 * The zoom that makes the canvas measure exactly one panel.
 *
 * The authored surface is 1040 canvas px wide. At the end of the reveal it has
 * to be a panel of `channelWidth` px, and `fit` has already scaled it to the
 * window. So the zoom the last scene is reaching for is not a number anyone
 * chooses — it is the ratio those two facts leave over, and computing it is why
 * the panel edge and the clip edge land on the same pixel at any window size.
 */
export function revealZoom(viewport: Viewport, fit: number): number {
  const inner = channelWidth(viewport) - 2;
  return Math.max(0.16, Math.min(0.8, inner / (LANDING_WIDTH * fit)));
}

/**
 * The zoom actually applied, once the window is known.
 *
 * Every scene but the last uses the authored value. The last one is aiming at
 * a measurement rather than a number, so its end point is replaced by the zoom
 * that makes the surface exactly one panel wide. The camera and the clip then
 * arrive together by construction rather than by tuning.
 */
export function zoomFor(
  camera: CameraState,
  viewport: Viewport,
  fit: number,
): number {
  if (camera.scene !== "reveal") return camera.zoom;
  const start = SCENE_BY_ID.get("reveal")!.zoom![0];
  return start + (revealZoom(viewport, fit) - start) * easeInOut(camera.t);
}

/**
 * Resolve the clip box for a frame.
 *
 * Four overlapping movements, all from the one `REVEAL` table: a margin appears
 * (so the visitor understands they were zoomed in), the box contracts to panel
 * width (so it reads as one surface among several), the shell's furniture
 * resolves around it, and then the panel proves its own height.
 */
export function channelFor(camera: CameraState, viewport: Viewport): Channel {
  if (camera.scene !== "reveal") return CLOSED;
  const margin = band(camera.t, REVEAL.margin[0], REVEAL.margin[1]);
  const narrow = band(camera.t, REVEAL.narrow[0], REVEAL.narrow[1]);
  const shell = band(camera.t, REVEAL.shell[0], REVEAL.shell[1]);
  const proof =
    camera.t < REVEAL.up[0]
      ? 0
      : camera.t < REVEAL.hold[1]
        ? band(camera.t, REVEAL.up[0], REVEAL.up[1])
        : 1 - band(camera.t, REVEAL.down[0], REVEAL.down[1]);

  const width = channelWidth(viewport);
  const room = shellFor(viewport);
  const left = room.panelLeft;
  const right = Math.max(SHELL.gap, viewport.width - left - width);
  const top = SHELL.rail + SHELL.gap;
  const bottom = SHELL.dock + SHELL.gap;

  /* The first inset is symmetric and small: enough to see an edge, not enough
     to relocate anything. Panel geometry only takes over as `narrow` rises. */
  const hint = Math.min(viewport.width, viewport.height) * 0.055 * margin;
  return {
    left: hint + (left - hint) * narrow,
    right: hint + (right - hint) * narrow,
    top: hint + (top - hint) * narrow,
    bottom: hint + (bottom - hint) * narrow,
    open: margin,
    shell,
    proof,
  };
}

/** Where the shell's furniture sits at this window size. */
export function shellFor(viewport: Viewport): {
  sidebar: number;
  panelLeft: number;
  panelRight: number;
} {
  const width = channelWidth(viewport);
  /* On a narrow window the sidebar is the first thing the real product hides,
     so the panel takes the room rather than being crushed by furniture that
     would not be there. */
  const spare = viewport.width - width - SHELL.gap * 2;
  const sidebar = spare >= SHELL.sidebar ? SHELL.sidebar : 0;
  const panelLeft = sidebar + SHELL.gap;
  return { sidebar, panelLeft, panelRight: panelLeft + width };
}
