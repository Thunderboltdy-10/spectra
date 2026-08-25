/**
 * The tall canvas, and how the camera moves down it.
 *
 * The landing is one work surface roughly 1040 logical px wide and ten thousand
 * tall. Scenes are regions of that surface, not separate pages.
 *
 * The camera does exactly two things, and never both at once. It **travels**:
 * moving from the scene it was holding to the next one, which is the only time
 * the page appears to scroll. Then it **holds**: perfectly still, while that
 * scene's work plays out under continued scrolling. A scene therefore gets the
 * visitor's whole attention while it happens, and the movement between scenes
 * reads as a camera move rather than as a page being dragged.
 *
 * That split is also what keeps the choreography honest. Scene-local progress
 * (`t`) is zero for the entire travel and only starts advancing once the camera
 * has arrived, so nothing can reveal itself before the actor who is supposed to
 * reveal it is on screen doing so.
 *
 * Everything here is a pure function of one number: how far the visitor has
 * scrolled. That is what makes the whole story reversible.
 */

export const LANDING_WIDTH = 1040;

/**
 * Authored height of one scene, in canvas px.
 *
 * This is the contract between the timeline and the frame: the canvas is fitted
 * so that exactly this much of it is visible, which is what lets a held scene
 * fill the window at any window shape instead of being cropped on a laptop and
 * lost on a monitor.
 */
export const SCENE_FRAME = 640;

/**
 * Dead canvas between scenes.
 *
 * Two scenes are never in frame together. The gap is what the camera crosses
 * during a travel, so the transition reads as leaving one composition and
 * arriving at another rather than as two overlapping ones sliding past.
 */
export const SCENE_GAP = 128;

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

/** What a scene is authored as. Everything else about it is derived. */
type SceneSpec = {
  id: SceneId;
  /** Viewport heights spent travelling into this scene's composition. */
  travel: number;
  /** Viewport heights the camera holds still while the scene plays. */
  hold: number;
  /**
   * Camera scale while held. 1 means the frame is exactly one scene. Only the
   * last two scenes leave 1, because only they are pulling back.
   */
  zoom?: number;
};

export type Scene = SceneSpec & {
  /** Where this scene's content sits on the tall canvas. */
  top: number;
  height: number;
  /** Canvas Y held at the centre of the frame while this scene plays. */
  rest: number;
  /** Scroll this scene consumes in total, in viewport heights. */
  length: number;
  zoom: number;
};

/**
 * The scenes, in order.
 *
 * Budgets are in viewport heights, so the page costs the same number of
 * gestures on a laptop and on a tall monitor. A travel is around four tenths of
 * a screen — long enough to read as a move, short enough that nobody is waiting
 * on it. Holds are sized to the work each scene actually has to show.
 */
const AUTHORED: SceneSpec[] = [
  /* The first scene is already in frame, so there is nothing to travel. */
  { id: "wake", travel: 0, hold: 0.45 },
  { id: "hero", travel: 0.5, hold: 0.8 },
  { id: "prepare", travel: 0.4, hold: 0.7 },
  /* The transformation itself: three things in, one out, provenance attached.
     The longest hold before the reveal, because rushing it would make the
     payoff read as a trick. */
  { id: "transform", travel: 0.45, hold: 1.25 },
  { id: "living", travel: 0.4, hold: 0.9 },
  { id: "contention", travel: 0.4, hold: 0.8 },
  { id: "dock", travel: 0.4, hold: 0.75 },
  { id: "workbench", travel: 0.4, hold: 1.0 },
  { id: "references", travel: 0.4, hold: 0.85 },
  { id: "calendar", travel: 0.4, hold: 0.9 },
  { id: "foundry", travel: 0.4, hold: 0.95 },
  /* The camera starts to leave: the first scene that does not fill the frame,
     which is the visitor's warning that the surface has an edge. */
  { id: "scale", travel: 0.5, hold: 0.6, zoom: 0.78 },
  /* Four things happen here: the closing lines are written, the box contracts
     into a panel, the product resolves around it, and the page proves how tall
     it really is. The end zoom is nominal — `revealZoom` corrects it to whatever
     makes 1040 canvas px measure exactly one panel at this window size. */
  { id: "reveal", travel: 0.45, hold: 2.6, zoom: 0.42 },
];

/**
 * Positions, derived rather than authored.
 *
 * The old table carried `top`, `height` and a camera range per scene, and every
 * one of those had to be kept consistent with its neighbours by hand — a camera
 * that did not end where the next one started was a visible cut. There is
 * nothing left to get wrong here: scenes are a fixed pitch down the canvas and
 * the camera rests on their centres.
 */
export const SCENES: Scene[] = AUTHORED.map((spec, index) => {
  const top = index * (SCENE_FRAME + SCENE_GAP);
  return {
    ...spec,
    top,
    height: SCENE_FRAME,
    rest: top + SCENE_FRAME / 2,
    length: spec.travel + spec.hold,
    zoom: spec.zoom ?? 1,
  };
});

/** Total logical height of the authored surface. */
export const CANVAS_HEIGHT =
  SCENES[SCENES.length - 1]!.top + SCENE_FRAME + SCENE_GAP;

export const SCENE_BY_ID = new Map(SCENES.map((scene) => [scene.id, scene]));

/** Where the camera sits before the story has run a frame. */
export const FIRST_REST = SCENES[0]!.rest;

export type CameraState = {
  /** Canvas Y held at the centre of the frame. */
  y: number;
  /** Scale multiplier on top of the fit-to-frame scale. */
  zoom: number;
  scene: SceneId;
  /**
   * Progress through this scene's *action*, 0..1. Zero for the whole travel:
   * the scene has not started until the camera has arrived.
   */
  t: number;
  /** Progress through the travel into this scene, 0..1. One once held. */
  arrive: number;
  /** Progress through the scene's whole scroll budget, travel included. */
  span: number;
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
 * Every consumer reads these; none of them holds its own copy. The numbers are
 * fractions of the reveal's hold, so the whole sequence plays with the camera
 * already parked.
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
} as const;

/** Canvas Y the proof pass travels to. The hero, recognisably. */
const PROOF_TARGET = SCENE_BY_ID.get("hero")!.rest;

/**
 * The proof pass (§27, Stage I).
 *
 * A panel that claims to hold a tall page has to show it. Once the panel
 * exists, the camera runs back up the surface it just came down, pauses on the
 * hero long enough to be recognised, and returns. Nothing is faked and nothing
 * is replayed: it is the same camera reading the same canvas, and every scene
 * it passes is in the finished state the visitor left it in.
 *
 * This is the one place a held camera moves, because here the movement is the
 * scene's content rather than a transition between scenes.
 */
function proofPass(t: number, rest: number): number {
  if (t <= REVEAL.up[0] || t >= REVEAL.down[1]) return rest;
  if (t < REVEAL.hold[0]) {
    return rest + (PROOF_TARGET - rest) * band(t, REVEAL.up[0], REVEAL.up[1]);
  }
  if (t < REVEAL.down[0]) return PROOF_TARGET;
  return (
    PROOF_TARGET +
    (rest - PROOF_TARGET) * band(t, REVEAL.down[0], REVEAL.down[1])
  );
}

/**
 * Scroll length of the whole page, in px, for a given viewport height.
 */
export function totalScroll(viewportHeight: number): number {
  const units = SCENES.reduce((sum, scene) => sum + scene.length, 0);
  return Math.round(units * viewportHeight);
}

/**
 * Resolve scroll position into camera state.
 *
 * Pure, monotonic and exactly invertible in intent: scrolling up recomputes the
 * same values it produced on the way down, which is why no scene needs to
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
    if (clamped >= cursor + span && !last) {
      cursor += span;
      continue;
    }

    const into = clamped - cursor;
    const travel = scene.travel * viewportHeight;
    const previous = SCENES[index - 1];
    const fromY = previous?.rest ?? scene.rest;
    const fromZoom = previous?.zoom ?? scene.zoom;

    /* Travelling. The camera moves and the scene has not begun. */
    if (travel > 0 && into < travel) {
      const arrive = Math.max(0, Math.min(1, into / travel));
      const eased = easeInOut(arrive);
      return {
        y: fromY + (scene.rest - fromY) * eased,
        zoom: fromZoom + (scene.zoom - fromZoom) * eased,
        scene: scene.id,
        t: 0,
        arrive,
        span: span > 0 ? into / span : 0,
        index,
        overall: total > 0 ? clamped / total : 0,
      };
    }

    /* Held. The camera is still and the scene plays. */
    const hold = scene.hold * viewportHeight;
    const t = hold > 0 ? Math.max(0, Math.min(1, (into - travel) / hold)) : 1;
    return {
      y: scene.id === "reveal" ? proofPass(t, scene.rest) : scene.rest,
      zoom: scene.zoom,
      scene: scene.id,
      t,
      arrive: 1,
      span: span > 0 ? Math.min(1, into / span) : 1,
      index,
      overall: total > 0 ? clamped / total : 0,
    };
  }

  const scene = SCENES[0]!;
  return {
    y: scene.rest,
    zoom: scene.zoom,
    scene: scene.id,
    t: 0,
    arrive: 1,
    span: 0,
    index: 0,
    overall: 0,
  };
}

/**
 * The prism's optical progress at a point in the story.
 *
 * The glass has its own arc: dormant through the hero, charging as it is
 * prepared, igniting as work is fed into it, alive while the work is alive, and
 * resolving as the page completes. It reads `span` rather than `t`, because the
 * glass is the one thing that must keep changing during a travel — a prism that
 * froze every time the camera moved would read as a video that had buffered.
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
  const optics = OPTICS[camera.scene];
  return optics[0] + (optics[1] - optics[0]) * camera.span;
}

/* ------------------------------------------------------------------ *
 * The frame
 * ------------------------------------------------------------------ */

/** Breathing room between the canvas and the window, in viewport px. */
export const CANVAS_MARGIN = 28;

/**
 * The scale that makes one scene exactly one frame.
 *
 * Fitted to *both* axes and taking the smaller factor, so a held scene is the
 * frame rather than a crop of one. The result is capped at 1: the canvas never
 * renders larger than authored. Upscaling was what made every surface read as
 * zoomed in — a 640px composition blown up to fill a 900px window turns body
 * text into headline text. Big windows get margin around the scene instead,
 * which is where the environment field lives anyway.
 */
export function fitFor(viewport: Viewport): number {
  const byWidth = (viewport.width - CANVAS_MARGIN * 2) / LANDING_WIDTH;
  const byHeight = (viewport.height - CANVAS_MARGIN * 2) / SCENE_FRAME;
  return Math.max(0.2, Math.min(1, byWidth, byHeight));
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
 * Every scene but the last uses the authored value. The last one is aiming at a
 * measurement rather than a number, so its end point is replaced by the zoom
 * that makes the surface exactly one panel wide. The camera and the clip then
 * arrive together by construction rather than by tuning.
 */
export function zoomFor(
  camera: CameraState,
  viewport: Viewport,
  fit: number,
): number {
  if (camera.scene !== "reveal") return camera.zoom;
  const start = SCENE_BY_ID.get("scale")!.zoom;
  const end = revealZoom(viewport, fit);
  /* During the travel the zoom is already interpolating from the previous
     scene's value, so only the held portion is ours to drive. */
  if (camera.arrive < 1)
    return start + (end - start) * easeInOut(camera.arrive);
  return end;
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
