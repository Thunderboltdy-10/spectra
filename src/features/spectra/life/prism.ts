import { spectrumAt, type Rgb } from "./spectrum";

/*
 * The prism: Spectra's mark and the AI's presence.
 *
 * A real solid: an equilateral triangle with crisp, slightly softened corners,
 * extruded thin, with a narrow bevel on both caps. The body is a dark, deep
 * indigo you can partly see through; the bevels are its defined edges, and
 * they are where the spectrum lives, as glints that slide along them as the
 * solid turns. No light passes through it and nothing glows around it.
 *
 * Drawing goes through one display list, so the same prism renders on a
 * canvas every frame and as a static SVG (favicon, tray, app icons).
 *
 * The solid is convex, so it needs no sorting: back faces first, then front
 * faces, then lines.
 *
 * Motion lives in `PrismBody`: a quaternion orientation with angular velocity,
 * pulled by springs toward the nearest symmetric copy of its target pose. A
 * spin of any size settles on whichever copy it reaches, so it never unwinds.
 */

type Vec2 = [number, number];
type Vec3 = [number, number, number];
/** A unit quaternion: w, x, y, z. */
export type Quat = [number, number, number, number];

/* ---------------------------------------------------------------- maths */

const TAU = Math.PI * 2;

export function axisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / l;
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

export function qmul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

const conj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];
const qdot = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

function qnorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The rotation a quaternion makes, as axis times angle (shortest way). */
function rotationVector(q: Quat): Vec3 {
  const s = q[0] < 0 ? -1 : 1;
  const w = Math.min(1, q[0] * s);
  const angle = 2 * Math.acos(w);
  const sin = Math.sqrt(Math.max(0, 1 - w * w));
  const k = sin < 1e-6 ? 2 * s : (angle / sin) * s;
  return [q[1] * k, q[2] * k, q[3] * k];
}

/** Turns `q` by a world-space angular velocity over `dt`. */
function integrate(q: Quat, w: Vec3, dt: number): Quat {
  const angle = Math.hypot(w[0], w[1], w[2]) * dt;
  if (angle < 1e-9) return q;
  return qnorm(qmul(axisAngle(w, angle), q));
}

/** Roll about the prism's axis, then yaw about the vertical, then pitch about the horizontal. */
export function orientation(yaw: number, pitch: number, roll = 0): Quat {
  return qmul(axisAngle([1, 0, 0], pitch), qmul(axisAngle([0, 1, 0], yaw), axisAngle([0, 0, 1], roll)));
}

/* ---------------------------------------------------------------- the solid */

type FaceKind = "cap" | "bevel" | "side";

type Face = {
  kind: FaceKind;
  /** Vertex indices, outline order. */
  indices: number[];
  /** Outward normal in model space (for strips around a corner, the middle one). */
  normal: Vec3;
  /** Strips only: the vertex pairs along the length, for gradients. */
  rails?: [number, number][];
  /** Position around the outline, 0..1, so the spectrum can run around the edges. */
  around: number;
  /** Which cap a bevel belongs to: 1 front, -1 back, 0 for caps and sides. */
  cap: number;
};

type Mesh = { vertices: Vec3[]; faces: Face[] };

type MeshSpec = { corner: number; bevel: number; halfDepth: number };

/** An equilateral triangle, apex up, centred on its bounding box (y up). */
const CORNERS: Vec2[] = [
  [0, 0.75],
  [-Math.sqrt(3) / 2, -0.75],
  [Math.sqrt(3) / 2, -0.75],
];
const CENTROID: Vec3 = [0, -0.25, 0];
const INRADIUS = 0.5;
const CORNER_SEGMENTS = 4;

/** Full detail: a thin solid with a narrow bevel. Marks get wider bevels so the edge still reads at 16 px. */
const MESHES: Record<"full" | "mark", MeshSpec> = {
  full: { corner: 0.075, bevel: 0.042, halfDepth: 0.19 },
  mark: { corner: 0.1, bevel: 0.1, halfDepth: 0.19 },
};

function profile(radius: number) {
  const points: Vec2[] = [];
  const corners: number[][] = [];
  for (let i = 0; i < 3; i += 1) {
    const c = CORNERS[i];
    const prev = CORNERS[(i + 2) % 3];
    const next = CORNERS[(i + 1) % 3];
    const ul = Math.hypot(prev[0] - c[0], prev[1] - c[1]);
    const ux = (prev[0] - c[0]) / ul;
    const uy = (prev[1] - c[1]) / ul;
    const wl = Math.hypot(next[0] - c[0], next[1] - c[1]);
    const wx = (next[0] - c[0]) / wl;
    const wy = (next[1] - c[1]) / wl;
    const bl = Math.hypot(ux + wx, uy + wy);
    // Every angle is 60°: the arc's centre sits 2r along the bisector.
    const cx = c[0] + ((ux + wx) / bl) * radius * 2;
    const cy = c[1] + ((uy + wy) / bl) * radius * 2;
    const tangent = radius * Math.sqrt(3);
    const a0 = Math.atan2(c[1] + uy * tangent - cy, c[0] + ux * tangent - cx);
    let a1 = Math.atan2(c[1] + wy * tangent - cy, c[0] + wx * tangent - cx);
    while (a1 - a0 > Math.PI) a1 -= TAU;
    while (a0 - a1 > Math.PI) a1 += TAU;
    const arc: number[] = [];
    for (let s = 0; s <= CORNER_SEGMENTS; s += 1) {
      const a = a0 + ((a1 - a0) * s) / CORNER_SEGMENTS;
      arc.push(points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]) - 1);
    }
    corners.push(arc);
  }
  const sides = [0, 1, 2].map((i) => [corners[i][CORNER_SEGMENTS], corners[(i + 1) % 3][0]]);
  return { points, corners, sides };
}

function newell(vertices: Vec3[], indices: number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const a = vertices[indices[i]];
    const b = vertices[indices[(i + 1) % indices.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function buildMesh(spec: MeshSpec): Mesh {
  const { points, corners, sides } = profile(spec.corner);
  const inset = 1 - spec.bevel / INRADIUS;
  const vertices: Vec3[] = [];
  const ring = (z: number, scale: number) =>
    points.map(
      (p) =>
        vertices.push([CENTROID[0] + (p[0] - CENTROID[0]) * scale, CENTROID[1] + (p[1] - CENTROID[1]) * scale, z]) - 1,
    );
  const h = spec.halfDepth;
  const rings = [ring(h, inset), ring(h - spec.bevel, 1), ring(-h + spec.bevel, 1), ring(-h, inset)];
  const faces: Face[] = [];

  const outward = (indices: number[], normal: Vec3): Vec3 => {
    const c: Vec3 = [0, 0, 0];
    for (const i of indices) for (let k = 0; k < 3; k += 1) c[k] += vertices[i][k] / indices.length;
    const d = (c[0] - CENTROID[0]) * normal[0] + (c[1] - CENTROID[1]) * normal[1] + c[2] * normal[2];
    return d < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
  };

  faces.push({ kind: "cap", indices: [...rings[0]], normal: [0, 0, 1], around: 0, cap: 0 });
  faces.push({ kind: "cap", indices: [...rings[3]].reverse(), normal: [0, 0, -1], around: 0, cap: 0 });

  // Strips between two rings, one per straight side and one per corner, so
  // each draws as a single shape with a gradient along it and no seams.
  const strip = (kind: FaceKind, a: number[], b: number[], run: number[], around: number, cap: number) => {
    const indices = [...run.map((k) => a[k]), ...[...run].reverse().map((k) => b[k])];
    const k0 = run[Math.floor((run.length - 1) / 2)];
    const k1 = run[Math.floor((run.length - 1) / 2) + 1];
    const normal = outward(indices, newell(vertices, [a[k0], a[k1], b[k1], b[k0]]));
    faces.push({ kind, indices, normal, rails: run.map((k) => [a[k], b[k]]), around, cap });
  };
  for (let i = 0; i < 3; i += 1) {
    const runs: [number[], number][] = [
      [corners[i], i / 3],
      [sides[i], (i + 0.5) / 3],
    ];
    for (const [run, around] of runs) {
      strip("bevel", rings[0], rings[1], run, around, 1);
      strip("side", rings[1], rings[2], run, around, 0);
      strip("bevel", rings[3], rings[2], run, around, -1);
    }
  }
  return { vertices, faces };
}

const meshCache = new Map<string, Mesh>();
function meshFor(kind: "full" | "mark") {
  let mesh = meshCache.get(kind);
  if (!mesh) {
    mesh = buildMesh(MESHES[kind]);
    meshCache.set(kind, mesh);
  }
  return mesh;
}

/* ---------------------------------------------------------------- look */

export type PrismPalette = {
  /** The cap's body, lit side to shaded side. */
  bodyLit: Rgb;
  bodyDeep: Rgb;
  /** The thin side faces. */
  side: Rgb;
  /** Opacity of a cap facing you; the rest of the page shows through. */
  capAlpha: number;
  sideAlpha: number;
  /** The bevel's own colour before light and the spectrum. */
  edge: Rgb;
  edgeAlpha: number;
  /** The outer line. */
  line: Rgb;
  lineAlpha: number;
  /** The light hairline where cap meets bevel, and the far edges seen through the body. */
  hair: Rgb;
  hairAlpha: number;
};

export const PRISM_PALETTES: Record<"light" | "dark", PrismPalette> = {
  light: {
    bodyLit: [96, 84, 166],
    bodyDeep: [30, 25, 64],
    side: [50, 42, 98],
    capAlpha: 0.7,
    sideAlpha: 0.84,
    edge: [156, 146, 214],
    edgeAlpha: 0.95,
    line: [36, 30, 74],
    lineAlpha: 0.55,
    hair: [226, 222, 252],
    hairAlpha: 0.85,
  },
  dark: {
    bodyLit: [112, 100, 186],
    bodyDeep: [38, 33, 78],
    side: [70, 62, 132],
    capAlpha: 0.58,
    sideAlpha: 0.8,
    edge: [168, 160, 222],
    edgeAlpha: 0.96,
    line: [200, 194, 244],
    lineAlpha: 0.42,
    hair: [228, 224, 255],
    hairAlpha: 0.7,
  },
};

const WARM: Rgb = [255, 150, 96];
const WHITE: Rgb = [255, 255, 255];
const GREY: Rgb = [128, 126, 140];

export type PrismPose = {
  orientation: Quat;
  scale: number;
  /** Offset of the spectrum around the edges, in loops. */
  hue: number;
  /** How much the edges carry the spectrum, 0..1. */
  spectrum: number;
  /** Needs-you warmth, 0..1. */
  warm: number;
  /** A problem drains colour, 0..1. */
  muted: number;
  /** A brief brightening of every edge, 0..1. */
  glint: number;
  /**
   * The status dot beside the prism's top-right corner, so the state stays
   * readable after its animation: its colour, its size (0 hidden, 1 full,
   * springs past 1 as it pops) and how far it still is from its seat (1 is
   * at the corner it comes out of).
   */
  status?: { rgb: Rgb; size: number; from: number };
};

/** The resting pose: turned a little so one side and the upper face show. */
export const REST_ORIENTATION = orientation(-0.46, 0.2, 0);

export const REST_POSE: PrismPose = {
  orientation: REST_ORIENTATION,
  scale: 1,
  hue: 0.08,
  spectrum: 0.75,
  warm: 0,
  muted: 0,
  glint: 0,
};

/** The static mark (favicon, rail, tray) is the resting pose. */
export const MARK_POSE = REST_POSE;

export type PrismDrawOptions = {
  /** Centre, in canvas pixels. */
  x: number;
  y: number;
  /** The box the mark fills, in canvas pixels. */
  size: number;
  palette: PrismPalette;
  /** Canvas pixels per CSS pixel, for line widths. */
  pixelRatio?: number;
  /** "mark" is the small static icon: wider bevel, fewer lines. */
  detail?: "mark" | "live" | "hero";
};

/* ---------------------------------------------------------------- display list */

type Stop = [number, Rgb, number];
type Fill = { rgb: Rgb; a: number } | { from: Vec2; to: Vec2; stops: Stop[] };

export type PrismOp =
  | { kind: "fill"; points: Vec2[]; fill: Fill }
  | { kind: "stroke"; points: Vec2[]; closed: boolean; paint: Fill; width: number }
  | { kind: "dot"; points: [Vec2]; radius: number; rgb: Rgb; a: number };

const PERSPECTIVE = 7;
const LIGHT: Vec3 = [-2.6, 3.4, 4.2];
const CAMERA: Vec3 = [0, 0, PERSPECTIVE];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function hull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

type Light = { diffuse: number; nh: number; nv: number };

function lightAt(p: Vec3, n: Vec3): Light {
  const l = normalize3([LIGHT[0] - p[0], LIGHT[1] - p[1], LIGHT[2] - p[2]]);
  const v = normalize3([CAMERA[0] - p[0], CAMERA[1] - p[1], CAMERA[2] - p[2]]);
  const h = normalize3([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
  return {
    diffuse: Math.max(0, n[0] * l[0] + n[1] * l[1] + n[2] * l[2]),
    nh: Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]),
    nv: Math.max(0, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]),
  };
}

/** One point of a bevel: its own colour, the spectrum where light catches it, white at the peak. */
function edgeColour(p: Vec3, n: Vec3, around: number, pose: PrismPose, palette: PrismPalette, back: boolean): Rgb {
  const { diffuse, nh } = lightAt(p, n);
  const spec = nh ** 18;
  const sheen = nh ** 3;
  // The spectrum runs around the outline and shifts with the edge's angle to
  // the view, so turning the solid moves colour along its edges.
  const t = around + pose.hue + n[0] * 0.18 - n[1] * 0.1;
  let c = mix(palette.edge, spectrumAt(t), clamp01((0.3 + 0.7 * sheen) * pose.spectrum) * (1 - pose.muted));
  c = mix(c, WARM, pose.warm * (0.35 + 0.4 * sheen));
  c = mix(c, GREY, pose.muted * 0.6);
  const shade = 0.62 + 0.38 * diffuse;
  c = [c[0] * shade, c[1] * shade, c[2] * shade];
  c = mix(c, WHITE, clamp01(spec * 0.75 + pose.glint * 0.45));
  return back ? mix(c, palette.bodyDeep, 0.55) : c;
}

/** One point of a thin side face: body colour, lighter at glancing angles, a faint spectral sheen. */
function sideColour(p: Vec3, n: Vec3, around: number, pose: PrismPose, palette: PrismPalette, back: boolean): Rgb {
  const { diffuse, nh, nv } = lightAt(p, n);
  let c = mix(palette.side, palette.bodyLit, 0.15 + 0.55 * diffuse);
  c = mix(c, palette.edge, (1 - nv) ** 3 * 0.45);
  c = mix(c, spectrumAt(around + pose.hue + 0.5 + n[0] * 0.2), clamp01(nh ** 10 * 0.55 * pose.spectrum) * (1 - pose.muted));
  c = mix(c, WARM, pose.warm * 0.12);
  c = mix(c, WHITE, nh ** 40 * 0.35);
  return back ? mix(c, palette.bodyDeep, 0.5) : c;
}

/**
 * A cap's gradient: lit to deep, crossed by one soft band of reflected
 * light. The band's place follows the cap's normal, so as the solid turns
 * the reflection sweeps across the glass.
 */
function capStops(lit: Rgb, deep: Rgb, alpha: number, normal: Vec3, pose: PrismPose): Stop[] {
  const band = clamp01(0.42 - normal[0] * 0.55 + normal[1] * 0.35);
  const width = 0.16;
  const at = (t: number) => mix(lit, deep, t ** 0.85);
  const glow = mix(mix(at(band), WHITE, 0.16 + pose.glint * 0.2), spectrumAt(pose.hue + band * 0.4 + 0.55), 0.08 * pose.spectrum);
  const stops: Stop[] = [[0, at(0), alpha]];
  const before = band - width;
  const after = band + width;
  if (before > 0.02) stops.push([before, at(before), alpha]);
  stops.push([clamp01(band), glow, alpha * 0.94]);
  if (after < 0.98) stops.push([after, at(after), alpha]);
  stops.push([1, at(1), Math.min(1, alpha * 1.06)]);
  return stops;
}

/** The prism as a list of shapes to paint, in order. Pure: no canvas needed. */
export function prismOps(pose: PrismPose, options: PrismDrawOptions): PrismOp[] {
  const { palette } = options;
  const detail = options.detail ?? "live";
  const ratio = options.pixelRatio ?? 1;
  const mesh = meshFor(detail === "mark" ? "mark" : "full");
  const q = pose.orientation;
  const scale = (options.size / 1.82) * pose.scale;
  const world = mesh.vertices.map((v) => rotate(q, v));
  const screen: Vec2[] = world.map((p) => {
    const s = PERSPECTIVE / (PERSPECTIVE - p[2]);
    return [options.x + p[0] * s * scale, options.y - p[1] * s * scale];
  });
  const centre = rotate(q, CENTROID);
  const ops: PrismOp[] = [];

  const faces = mesh.faces.map((face) => {
    const normal = rotate(q, face.normal);
    const c = world[face.indices[0]];
    const front = normal[0] * (CAMERA[0] - c[0]) + normal[1] * (CAMERA[1] - c[1]) + normal[2] * (CAMERA[2] - c[2]) > 0;
    return { face, normal, front };
  });

  const capOp = (face: Face, normal: Vec3, back: boolean): PrismOp => {
    // Lit at the corner nearest the light, deep at the far one, and more
    // opaque as it turns away from you, like a pane of tinted glass.
    const nv = Math.abs(normal[2]);
    const light = normalize3([LIGHT[0], LIGHT[1], 0]);
    const reach = scale * 0.8;
    const from: Vec2 = [options.x + light[0] * reach, options.y - light[1] * reach];
    const to: Vec2 = [options.x - light[0] * reach, options.y + light[1] * reach];
    const diffuse = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * 0.6);
    let lit = mix(palette.bodyDeep, palette.bodyLit, 0.6 + 0.4 * diffuse);
    let deep = palette.bodyDeep;
    lit = mix(lit, WARM, pose.warm * 0.1);
    lit = mix(lit, GREY, pose.muted * 0.35);
    deep = mix(deep, GREY, pose.muted * 0.2);
    if (back) lit = mix(lit, palette.bodyDeep, 0.5);
    const alpha = back ? palette.capAlpha * 0.7 : palette.capAlpha + (1 - nv) * (1 - palette.capAlpha) * 0.8;
    return {
      kind: "fill",
      points: face.indices.map((i) => screen[i]),
      fill: {
        from,
        to,
        stops: back
          ? [
              [0, lit, alpha],
              [1, deep, alpha],
            ]
          : capStops(lit, deep, alpha, normal, pose),
      },
    };
  };

  const stripOp = (face: Face, normal: Vec3, back: boolean): PrismOp => {
    const rails = face.rails!;
    const first = rails[0];
    const last = rails[rails.length - 1];
    const mid = (r: [number, number]): Vec2 => [
      (screen[r[0]][0] + screen[r[1]][0]) / 2,
      (screen[r[0]][1] + screen[r[1]][1]) / 2,
    ];
    const straight = rails.length === 2;
    const samples = straight ? 5 : rails.length;
    const alpha = (face.kind === "bevel" ? palette.edgeAlpha : palette.sideAlpha) * (back ? 0.75 : 1);
    const colourAt = face.kind === "bevel" ? edgeColour : sideColour;
    const stops: Stop[] = [];
    for (let s = 0; s < samples; s += 1) {
      const t = s / (samples - 1);
      let p: Vec3;
      let n = normal;
      if (straight) {
        const a = world[first[0]];
        const b = world[last[0]];
        p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      } else {
        // Around a corner the normal turns with the arc: blend the strip's
        // normal with the direction out from the axis at this point.
        p = world[rails[s][0]];
        const out = normalize3([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]);
        n = normalize3([out[0] * 0.55 + normal[0] * 0.45, out[1] * 0.55 + normal[1] * 0.45, out[2] * 0.55 + normal[2] * 0.45]);
      }
      stops.push([t, colourAt(p, n, face.around + (t - 0.5) * 0.12, pose, palette, back), alpha]);
    }
    return { kind: "fill", points: face.indices.map((i) => screen[i]), fill: { from: mid(first), to: mid(last), stops } };
  };

  // Back faces, seen through the body, then front faces.
  for (const front of [false, true]) {
    for (const kind of ["cap", "side", "bevel"] as FaceKind[]) {
      for (const f of faces) {
        if (f.front !== front || f.face.kind !== kind) continue;
        ops.push(kind === "cap" ? capOp(f.face, f.normal, !front) : stripOp(f.face, f.normal, !front));
      }
    }
  }

  const unit = (detail === "mark" ? options.size / 20 : Math.max(1, options.size / 48)) * (detail === "mark" ? 1 : ratio);
  const width = (w: number) => Math.max(0.6 * ratio, w * unit);
  const backCap = faces.find((f) => f.face.kind === "cap" && !f.front);
  if (backCap && detail !== "mark") {
    // The far cap's edge, faintly, through the body.
    ops.push({
      kind: "stroke",
      points: backCap.face.indices.map((i) => screen[i]),
      closed: true,
      paint: { rgb: palette.hair, a: palette.hairAlpha * 0.2 },
      width: width(0.5),
    });
  }
  const frontCap = faces.find((f) => f.face.kind === "cap" && f.front);
  if (frontCap) {
    // Where the near cap meets its bevel: a fine line split into the
    // spectrum, like the fringe a real prism's edge throws.
    const nv = Math.abs(frontCap.normal[2]);
    const capSign = frontCap.face.normal[2] > 0 ? 1 : -1;
    const alpha = palette.hairAlpha * (0.3 + 0.7 * nv) * (detail === "mark" ? 0.8 : 1);
    for (const f of faces) {
      if (f.face.kind !== "bevel" || f.face.cap !== capSign) continue;
      const rails = f.face.rails!;
      const op = stripOp(f.face, f.normal, false);
      const fill = op.kind === "fill" && !("rgb" in op.fill) ? op.fill : null;
      if (!fill) continue;
      const points = rails.map((r) => screen[r[0]]);
      ops.push({
        kind: "stroke",
        points,
        closed: false,
        paint: {
          from: points[0],
          to: points[points.length - 1],
          stops: fill.stops.map(([t, rgb]): Stop => [t, mix(mix(rgb, palette.hair, 0.25), WHITE, 0.2), alpha]),
        },
        width: width(detail === "mark" ? 0.6 : 0.55),
      });
    }
  }
  // The outline: the hull of the whole solid.
  ops.push({
    kind: "stroke",
    points: hull(screen),
    closed: true,
    paint: { rgb: palette.line, a: palette.lineAlpha },
    width: width(detail === "mark" ? 0.7 : 0.5),
  });
  const status = pose.status;
  if (status && status.size > 0.01) {
    // Seated in the free space right of the apex, never touching the solid.
    const seat: Vec2 = [options.x + options.size * 0.37, options.y - options.size * 0.33];
    let corner = screen[0];
    for (const p of screen) if (p[0] - p[1] > corner[0] - corner[1]) corner = p;
    const t = clamp01(status.from);
    const radius = options.size * (detail === "mark" ? 0.13 : 0.085) * Math.max(0, status.size);
    ops.push({
      kind: "dot",
      points: [[seat[0] + (corner[0] - seat[0]) * t, seat[1] + (corner[1] - seat[1]) * t]],
      radius,
      rgb: status.rgb,
      a: Math.min(1, status.size * 1.4),
    });
  }
  return ops;
}

const css = (rgb: Rgb, a: number) =>
  `rgb(${Math.round(rgb[0])} ${Math.round(rgb[1])} ${Math.round(rgb[2])} / ${clamp01(a).toFixed(3)})`;

export function drawPrism(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  pose: PrismPose,
  options: PrismDrawOptions,
) {
  ctx.save();
  ctx.lineJoin = "round";
  for (const op of prismOps(pose, options)) {
    if (op.kind === "dot") {
      ctx.beginPath();
      ctx.arc(op.points[0][0], op.points[0][1], op.radius, 0, Math.PI * 2);
      ctx.fillStyle = css(op.rgb, op.a);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.moveTo(op.points[0][0], op.points[0][1]);
    for (let i = 1; i < op.points.length; i += 1) ctx.lineTo(op.points[i][0], op.points[i][1]);
    const paint = op.kind === "fill" ? op.fill : op.paint;
    let style: string | CanvasGradient;
    if ("rgb" in paint) style = css(paint.rgb, paint.a);
    else {
      style = ctx.createLinearGradient(paint.from[0], paint.from[1], paint.to[0], paint.to[1]);
      for (const [t, rgb, a] of paint.stops) style.addColorStop(t, css(rgb, a));
    }
    if (op.kind === "fill") {
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    } else {
      if (op.closed) ctx.closePath();
      ctx.strokeStyle = style;
      ctx.lineWidth = op.width;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The prism as a standalone SVG, for the favicon, the tray and app icons. */
export function prismSvg(pose: PrismPose, options: Omit<PrismDrawOptions, "x" | "y">): string {
  const box = options.size;
  const ops = prismOps(pose, { ...options, x: box / 2, y: box / 2 });
  const n = (v: number) => Number(v.toFixed(2));
  const rgb = (c: Rgb) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  const pts = (points: Vec2[]) => points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ");
  const defs: string[] = [];
  const body: string[] = [];
  ops.forEach((op, index) => {
    if (op.kind === "dot") {
      body.push(`<circle cx="${n(op.points[0][0])}" cy="${n(op.points[0][1])}" r="${n(op.radius)}" fill="${rgb(op.rgb)}" fill-opacity="${n(op.a)}"/>`);
      return;
    }
    const paint = op.kind === "fill" ? op.fill : op.paint;
    let colour: string;
    let opacity = "";
    if ("rgb" in paint) {
      colour = rgb(paint.rgb);
      opacity = ` ${op.kind}-opacity="${n(paint.a)}"`;
    } else {
      const id = `p${index}`;
      const stops = paint.stops.map(([t, c, a]) => `<stop offset="${n(t)}" stop-color="${rgb(c)}" stop-opacity="${n(a)}"/>`);
      defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(paint.from[0])}" y1="${n(paint.from[1])}" x2="${n(paint.to[0])}" y2="${n(paint.to[1])}">${stops.join("")}</linearGradient>`,
      );
      colour = `url(#${id})`;
    }
    if (op.kind === "fill") body.push(`<polygon points="${pts(op.points)}" fill="${colour}"${opacity}/>`);
    else {
      const tag = op.closed ? "polygon" : "polyline";
      body.push(
        `<${tag} points="${pts(op.points)}" fill="none" stroke="${colour}"${opacity} stroke-width="${n(op.width)}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
}

/* ---------------------------------------------------------------- motion */

export type PrismMode = "rest" | "thinking" | "working" | "needs" | "done" | "problem";

/** What the status dot says. Modes set it; hosts can also set it directly. */
export type PrismStatus = "working" | "needs" | "warning" | "done" | "problem" | "info" | "offline";

export const STATUS_COLOURS: Record<Exclude<PrismStatus, "working">, Rgb> = {
  needs: [246, 190, 64],
  warning: [246, 190, 64],
  done: [64, 196, 142],
  problem: [240, 84, 104],
  info: [79, 159, 230],
  offline: [148, 146, 160],
};

const STATUS_FOR_MODE: Partial<Record<PrismMode, PrismStatus>> = {
  thinking: "working",
  working: "working",
  needs: "needs",
  done: "done",
  problem: "problem",
};

/** The prism's rotational symmetries: three turns about its axis, each with or without a half-turn flip. */
const SYMMETRIES: Quat[] = [0, 1, 2].flatMap((k) => {
  const turn = axisAngle([0, 0, 1], (k * TAU) / 3);
  return [turn, qmul(turn, axisAngle([0, 1, 0], Math.PI))];
});

/** The copy of `target`, under the prism's symmetries, closest to `q`. */
function nearestCopy(target: Quat, q: Quat): Quat {
  let best = target;
  let bestDot = -1;
  for (const s of SYMMETRIES) {
    const copy = qmul(target, s);
    const d = qdot(copy, q);
    if (Math.abs(d) > bestDot) {
      bestDot = Math.abs(d);
      best = d < 0 ? [-copy[0], -copy[1], -copy[2], -copy[3]] : copy;
    }
  }
  return best;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const DETENT = 52;

/**
 * The prism's body: where it points, how fast it turns, how big it is, and
 * the colour state of its edges. Hosts call the verbs on input and `step`
 * every frame while `isLively()`; once settled it needs no frames at all.
 */
export class PrismBody {
  private q: Quat = REST_ORIENTATION;
  private w: Vec3 = [0, 0, 0];
  private size = 1;
  private sizeV = 0;
  private sizeTarget = 1;
  private mode: PrismMode = "rest";
  private modeTime = 0;
  private hovering = false;
  private holding = false;
  private dragged = false;
  private leanTarget: Vec2 = [0, 0];
  private lean: Vec2 = [0, 0];
  private hue = REST_POSE.hue;
  private spectrum = REST_POSE.spectrum;
  private warm = 0;
  private muted = 0;
  private glint = 0;
  private nextNod = 0;
  private settled = true;
  private status: PrismStatus | null = null;
  private statusSize = 0;
  private statusV = 0;
  private statusFrom = 0;
  private statusRgb: Rgb = [0, 0, 0];
  /** Reduced motion: no spins or springs; colour still changes. */
  still = false;

  setMode(mode: PrismMode) {
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    this.modeTime = 0;
    this.settled = false;
    const status = STATUS_FOR_MODE[mode] ?? null;
    // Done and needs-you stay marked until seen; other states clear with the mode.
    if (status || this.status === "working") this.setStatus(status);
    if (this.still) return;
    if (mode === "done") {
      // Two quick turns and a flash along the edges.
      this.spin(2);
      this.glint = 1;
    } else if (mode === "needs") {
      this.nextNod = 0.3;
    } else if (mode === "problem") {
      this.w[2] += 3.2;
    } else if (mode === "rest" && (previous === "thinking" || previous === "working")) {
      this.glint = Math.max(this.glint, 0.4);
    }
  }

  getMode() {
    return this.mode;
  }

  /** The user saw the done or needs-you state. */
  markSeen() {
    if (this.mode === "done" || this.mode === "needs") this.setMode("rest");
    if (this.status === "done" || this.status === "needs" || this.status === "info") this.setStatus(null);
  }

  /** Sets the status dot. It comes out of the nearest corner and pops into place. */
  setStatus(status: PrismStatus | null) {
    if (status === this.status) return;
    const appearing = this.status === null && status !== null;
    this.status = status;
    this.settled = false;
    if (status && status !== "working") {
      if (appearing) this.statusRgb = STATUS_COLOURS[status];
    } else if (status === "working" && appearing) this.statusRgb = spectrumAt(this.hue * 2);
    if (appearing) {
      this.statusFrom = 1;
      this.statusSize = Math.max(this.statusSize, 0.05);
    }
  }

  getStatus() {
    return this.status;
  }

  /** Where the pointer is relative to the prism, in prism radii (about -1..1). */
  setLean(dx: number, dy: number) {
    this.leanTarget = [Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy))];
    this.settled = false;
  }

  /** The pointer enters or leaves. Entering turns it round once, away from the pointer. */
  hover(on: boolean) {
    if (on === this.hovering) return;
    this.hovering = on;
    this.settled = false;
    if (on && Math.abs(this.w[1]) < 4) this.spin(1, this.leanTarget[0] < 0 ? -1 : 1);
    if (!on) this.leanTarget = [0, 0];
  }

  /** Adds roughly `turns` turns about the vertical axis. */
  spin(turns: number, direction = 1) {
    if (this.still) return;
    this.w[1] += direction * (3.2 + turns * 5.4);
    this.settled = false;
  }

  press() {
    this.sizeTarget = 0.88;
    this.dragged = false;
    this.holding = true;
    this.settled = false;
    if (!this.still) this.w[0] += 1.2;
  }

  release() {
    this.holding = false;
    this.sizeTarget = 1;
    this.settled = false;
    if (this.still) return;
    this.sizeV += 2.6;
    if (!this.dragged) this.spin(0.5, this.leanTarget[0] < 0 ? -1 : 1);
    const speed = Math.hypot(this.w[0], this.w[1], this.w[2]);
    if (speed > 22) this.w = [(this.w[0] / speed) * 22, (this.w[1] / speed) * 22, (this.w[2] / speed) * 22];
  }

  /** Turns the prism with the pointer: dx, dy in prism radii, moved over dt seconds. */
  drag(dx: number, dy: number, dt: number) {
    if (this.still || !this.holding) return;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-5) return;
    const angle = distance * 1.1;
    this.dragged = true;
    this.q = qnorm(qmul(axisAngle([dy, dx, 0], angle), this.q));
    const speed = angle / Math.max(1 / 240, dt);
    const target: Vec3 = [(dy / distance) * speed, (dx / distance) * speed, 0];
    // Smooth the release velocity over the last few moves.
    for (let k = 0; k < 3; k += 1) this.w[k] += (target[k] - this.w[k]) * 0.5;
    this.settled = false;
  }

  /** False once the prism has come to rest and needs no frames. */
  isLively() {
    return !this.settled;
  }

  private target(): Quat {
    const [lx, ly] = this.lean;
    let q = REST_ORIENTATION;
    if (this.mode === "needs") q = orientation(-0.14 + Math.sin(this.modeTime * 1.3) * 0.05, 0.1, 0);
    else if (this.mode === "problem") q = orientation(-0.3, 0.32, -0.06);
    return qmul(qmul(axisAngle([1, 0, 0], ly * 0.32), axisAngle([0, 1, 0], lx * 0.42)), q);
  }

  step(dt: number) {
    if (this.settled) return;
    const total = Math.min(dt, 0.06);
    const steps = Math.max(1, Math.ceil(total * 120));
    for (let s = 0; s < steps; s += 1) this.substep(total / steps);
  }

  private substep(dt: number) {
    this.modeTime += dt;
    const mode = this.mode;
    const ease = (rate: number) => Math.min(1, rate * dt);
    this.lean[0] += (this.leanTarget[0] - this.lean[0]) * ease(7);
    this.lean[1] += (this.leanTarget[1] - this.lean[1]) * ease(7);

    // Colour.
    const hueSpeed = mode === "working" ? 0.32 : mode === "thinking" ? 0.11 : 0;
    this.hue += hueSpeed * dt;
    const spectrumGoal = mode === "working" || mode === "done" ? 1 : mode === "thinking" ? 0.85 : REST_POSE.spectrum;
    const warmGoal = mode === "needs" ? 1 : 0;
    const mutedGoal = mode === "problem" ? 1 : 0;
    this.spectrum += (spectrumGoal - this.spectrum) * ease(3);
    this.warm += (warmGoal - this.warm) * ease(4);
    this.muted += (mutedGoal - this.muted) * ease(4);
    this.glint *= Math.exp(-2.4 * dt);
    // The status dot: colour eases, size springs (a pop), it slides out from the corner.
    const statusGoal = this.status ? (this.status === "needs" ? 1 + Math.sin(this.modeTime * 3.4) * 0.12 : 1) : 0;
    const goalRgb: Rgb = this.status
      ? this.status === "working"
        ? spectrumAt(this.hue * 2 + this.modeTime * 0.25)
        : STATUS_COLOURS[this.status]
      : this.statusRgb;
    this.statusRgb = mix(this.statusRgb, goalRgb, ease(8));
    if (this.still) {
      this.statusSize = statusGoal;
      this.statusFrom = 0;
    } else {
      this.statusV += ((statusGoal - this.statusSize) * 260 - this.statusV * 2 * 0.42 * Math.sqrt(260)) * dt;
      this.statusSize = Math.max(0, this.statusSize + this.statusV * dt);
      this.statusFrom += (0 - this.statusFrom) * ease(9);
    }
    const statusSettled =
      (this.status === null || this.status !== "working") &&
      this.status !== "needs" &&
      Math.abs(this.statusSize - statusGoal) < 0.002 &&
      Math.abs(this.statusV) < 0.01 &&
      this.statusFrom < 0.002;
    const colourSettled =
      statusSettled &&
      hueSpeed === 0 &&
      Math.abs(this.spectrum - spectrumGoal) < 0.005 &&
      Math.abs(this.warm - warmGoal) < 0.005 &&
      Math.abs(this.muted - mutedGoal) < 0.005 &&
      this.glint < 0.01;

    if (this.still) {
      this.q = this.target();
      this.w = [0, 0, 0];
      this.size = this.sizeTarget;
      this.sizeV = 0;
      this.settled = colourSettled;
      return;
    }

    // Size: a soft spring that overshoots a little on release.
    const breath = mode === "needs" ? 1 + Math.sin(this.modeTime * 3.4) * 0.025 : 1;
    const sizeGoal = this.sizeTarget * (this.hovering ? 1.06 : 1) * breath;
    this.sizeV += ((sizeGoal - this.size) * 340 - this.sizeV * 2 * 0.42 * Math.sqrt(340)) * dt;
    this.size += this.sizeV * dt;

    if (this.holding) {
      // Held: it turns only with the pointer, and stops when the pointer stops.
      for (let i = 0; i < 3; i += 1) this.w[i] *= Math.exp(-10 * dt);
      return;
    }

    const speed = Math.hypot(this.w[0], this.w[1], this.w[2]);
    if (mode === "thinking" || mode === "working") {
      // A steady turn about a slightly tilted axis; the detent takes over when the mode ends.
      const rate = mode === "working" ? TAU / 2.6 : TAU / 7;
      const drive: Vec3 = [Math.sin(this.modeTime * 0.7) * 0.25, rate, 0.12 * rate];
      for (let k = 0; k < 3; k += 1) this.w[k] += (drive[k] - this.w[k]) * ease(2.2);
    } else {
      // Spinning freely with a little air drag; as it slows, a detent pulls
      // it to the symmetric copy of its pose it is about to reach.
      const free = smoothstep(3.5, 9, speed);
      const goal = nearestCopy(this.target(), integrate(this.q, this.w, 0.28));
      const error = rotationVector(qmul(goal, conj(this.q)));
      const k = DETENT * (1 - free);
      const damping = 2 * 0.6 * Math.sqrt(DETENT) * (1 - free) + 1.1 * free;
      for (let i = 0; i < 3; i += 1) this.w[i] += (error[i] * k - this.w[i] * damping) * dt;
      if (mode === "needs") {
        this.nextNod -= dt;
        if (this.nextNod <= 0) {
          // A small nod now and then, so it reads as waiting for you.
          this.w[0] += 2.4;
          this.nextNod = 2.6;
        }
      }
      this.settled =
        mode !== "needs" &&
        colourSettled &&
        Math.hypot(error[0], error[1], error[2]) < 0.0015 &&
        speed < 0.01 &&
        Math.abs(this.size - sizeGoal) < 0.001 &&
        Math.abs(this.sizeV) < 0.01 &&
        Math.abs(this.lean[0] - this.leanTarget[0]) + Math.abs(this.lean[1] - this.leanTarget[1]) < 0.002;
      if (this.settled) {
        this.q = goal;
        this.w = [0, 0, 0];
        this.size = sizeGoal;
        this.sizeV = 0;
        return;
      }
    }
    this.q = integrate(this.q, this.w, dt);
  }

  pose(): PrismPose {
    return {
      orientation: this.q,
      scale: this.size,
      hue: this.hue,
      spectrum: this.spectrum,
      warm: this.warm,
      muted: this.muted,
      glint: this.glint,
      status: this.statusSize > 0.01 ? { rgb: this.statusRgb, size: this.statusSize, from: this.statusFrom } : undefined,
    };
  }
}
