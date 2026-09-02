/**
 * The grain field renderer.
 *
 * Spectra's field is a dot field. At card scale a masked CSS lattice is the
 * honest way to draw it: a few hundred dots, no context, no loop. At
 * environment scale that stops being true — the field wants a fine lattice a
 * few pixels across, flowing, displaced by what is happening near it, and CSS
 * cannot draw that at any price.
 *
 * So the large field is one fullscreen fragment program. Every pixel resolves
 * which lattice cell it belongs to, where that cell has drifted to, and how
 * bright it is; there is no vertex work, no geometry to rebuild when the grain
 * changes, and no cost that scales with dot count. Making the grain twice as
 * fine is a uniform, not a new buffer.
 *
 * The lattice is staggered row to row, which is what makes it read as a
 * halftone screen — a material — rather than as graph paper. Cells flow along a
 * slow three-term wave, so the whole field moves as one surface instead of each
 * dot twinkling independently. Live influences push cells away, brighten them,
 * and take their colour; the prism additionally casts a shadow directly beneath
 * it, so the object sits *in* the field rather than on top of it.
 *
 * The renderer owns no clock. Whoever creates it calls `frame()` from the
 * host's existing heartbeat, which is what keeps the page down to one loop.
 */

/** One live disturbance in the field, in CSS pixels relative to the canvas. */
export type GrainInfluence = {
  x: number;
  y: number;
  /** Reach in CSS px. At or below 0.5 the influence is skipped entirely. */
  radius: number;
  /** 0..1. */
  strength: number;
  /** Linear rgb, each channel 0..1. */
  color: readonly [number, number, number];
  /**
   * Casts a shadow into the lattice beneath it. For solid objects — the prism —
   * rather than for an actor's attention, which has no body to block light.
   */
  occludes?: boolean;
};

/** The field's current emotional setting. Changed at scene boundaries. */
export type GrainMood = {
  /** Resting dot opacity. The useful band is 0.1..0.5. */
  rest: number;
  /** CSS px between dots. The useful band is 6..14. */
  spacing: number;
  /** Where the material gathers: x, y in 0..1, then spread. */
  bias: readonly [number, number, number];
  /** Dot colour at rest, linear rgb. */
  ink: readonly [number, number, number];
  /** Colour the field takes where it is gathered or disturbed. */
  tint: readonly [number, number, number];
  /** How far cells travel along the flow. 0 is a static screen, 1 is liquid. */
  wave: number;
  /** Flow rate multiplier. */
  speed: number;
  /** Whole-field swell, 0..1. Used for a beat, never held. */
  pulse: number;
  /** Atmospheric wash under the lattice, 0..1. Keep it under ~0.15. */
  wash: number;
  /**
   * How strongly the field is clipped by `clipRect`, 0..1. The reveal uses this
   * to show that the surface was inside something all along.
   */
  clip: number;
  /** x0, y0, x1, y1 in 0..1 of the canvas. */
  clipRect: readonly [number, number, number, number];
};

const MAX_INFLUENCES = 4;

const FIELD_VERT = `
precision highp float;
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const FIELD_FRAG = `
precision highp float;
#define MAX_INF ${MAX_INFLUENCES}
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uCell;
uniform float uRest;
uniform float uWave;
uniform float uSpeed;
uniform float uPulse;
uniform float uWash;
uniform float uClip;
uniform vec3 uBias;
uniform vec3 uInk;
uniform vec3 uTint;
uniform vec4 uClipRect;
/* xy = centre in device px, z = radius, w = strength. */
uniform vec4 uInfPos[MAX_INF];
/* rgb = identity colour, a = 1 when the influence casts a shadow. */
uniform vec4 uInfColor[MAX_INF];

void main() {
  vec2 p = vUv * uRes;

  /* Which cell this pixel belongs to. Odd rows are offset by half a cell, so
     the lattice reads as a halftone screen rather than as squared paper. */
  float cell = uCell;
  float row = floor(p.y / cell);
  float stagger = mod(row, 2.0) * 0.5;
  float col = floor(p.x / cell - stagger);
  vec2 center = vec2((col + stagger + 0.5) * cell, (row + 0.5) * cell);

  /* One slow three-term wave for the whole field. Three frequencies rather
     than one is what stops it reading as a repeating pattern; using the same
     wave for displacement and for brightness is what makes it read as one
     surface flowing rather than as dots blinking. */
  float t = uTime * uSpeed;
  float w =
    sin(center.x * 0.0062 + t * 0.55) +
    sin(center.y * 0.0081 - t * 0.42) +
    0.55 * sin((center.x + center.y) * 0.0037 + t * 0.9);
  vec2 flow = vec2(cos(w * 1.6), sin(w * 1.25)) * uWave * cell * 0.26;

  vec2 offset = flow;
  float lit = 0.0;
  float shade = 1.0;
  vec3 ink = uInk;

  for (int i = 0; i < MAX_INF; i++) {
    float radius = uInfPos[i].z;
    float strength = uInfPos[i].w;
    if (radius <= 0.5 || strength <= 0.004) continue;
    vec2 delta = center - uInfPos[i].xy;
    float distance = length(delta);
    float near = smoothstep(radius * 1.45, 0.0, distance) * strength;
    /* The lattice is pushed away from whatever is disturbing it and relaxes
       behind — displacement is what makes this material rather than a light
       switched on over one. */
    offset += normalize(delta + 1e-4) * near * cell * 0.85;
    lit += near;
    ink = mix(ink, uInfColor[i].rgb, clamp(near * 1.35, 0.0, 0.92));
    /* Rim dispersion: the ring around an influence splits toward the
       spectrum's edges — cyan on one side, warm on the other — the same
       chromatic fringe the CSS field draws at a wake's rim. */
    float ring =
      smoothstep(radius * 0.35, radius * 0.7, distance) *
      (1.0 - smoothstep(radius * 0.85, radius * 1.3, distance)) *
      strength;
    vec3 fringe =
      delta.x > 0.0
        ? mix(uInfColor[i].rgb, vec3(0.18, 0.56, 0.83), 0.55)
        : mix(uInfColor[i].rgb, vec3(1.0, 0.79, 0.54), 0.55);
    ink = mix(ink, fringe, clamp(ring * 1.2, 0.0, 0.6));
    /* A solid object shades the lattice directly under it. Without this the
       prism reads as a decal; with it, the field is behind the glass. */
    shade *= mix(
      1.0,
      0.2,
      smoothstep(radius * 0.62, 0.0, distance) * strength * uInfColor[i].a
    );
  }

  /* The dot itself: distance from this pixel to its cell's drifted centre. */
  vec2 at = center + offset;
  float d = length(p - at);
  float r = 0.86 + 0.5 * lit + 0.24 * uPulse;
  float dot = smoothstep(r, r - 1.15, d);

  /* Where the material gathers. Aspect-corrected, so the pool is round on a
     wide window instead of a stretched smear. */
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  float reach = distance(vUv * aspect, uBias.xy * aspect) / max(uBias.z, 0.001);
  float gather = exp(-reach * reach * 1.2);

  float brightness = uRest * (0.14 + 0.86 * gather);
  brightness *= 1.0 + 2.2 * lit + 1.1 * uPulse * gather;
  brightness *= shade;
  /* Slow density breathing, so a still page is never a still image. */
  brightness *= 0.76 + 0.24 * sin(w * 0.7 + t * 0.3);

  /* Clipped by a surface the visitor has not been shown yet. */
  vec2 feather = vec2(0.012);
  float inside =
    smoothstep(uClipRect.x - feather.x, uClipRect.x + feather.x, vUv.x) *
    smoothstep(uClipRect.z + feather.x, uClipRect.z - feather.x, vUv.x) *
    smoothstep(uClipRect.y - feather.y, uClipRect.y + feather.y, vUv.y) *
    smoothstep(uClipRect.w + feather.y, uClipRect.w - feather.y, vUv.y);
  brightness *= mix(1.0, inside, uClip);

  /* Colour is a gradient through the gathered region rather than a flat ink:
     the heart of the pool carries the accent, the edges fade to the page's own
     text colour. This is the field's signature. */
  vec3 color = mix(ink, uTint, clamp(gather * 0.72 + lit * 0.5, 0.0, 0.86));

  float alpha = clamp(dot * brightness, 0.0, 0.92);

  /* The wash is the ground the lattice sits on: one soft pool of the accent,
     brightened wherever something is happening. It is drawn in the same pass
     because it is the same gradient, and a second pass for it would double the
     fill cost of the most expensive layer on the page. */
  float wash = uWash * gather * mix(1.0, 2.1, clamp(lit, 0.0, 1.0));
  wash *= mix(1.0, inside, uClip);
  vec3 washColor = mix(uTint, ink, 0.18);

  vec3 premultiplied = color * alpha + washColor * wash;
  float out_a = alpha + wash;
  if (out_a < 0.0025) discard;
  gl_FragColor = vec4(premultiplied, out_a);
}
`;

/* ------------------------------------------------------------------ *
 * The renderer
 * ------------------------------------------------------------------ */

function compile(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram | null {
  const build = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (process.env.NODE_ENV !== "production") {
        console.error(gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = build(gl.VERTEX_SHADER, vertex);
  const fs = build(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  /* The shaders belong to the program now; the driver keeps them alive as long
     as it needs them. */
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.error(gl.getProgramInfoLog(program));
    }
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export type GrainRenderer = {
  /** Draw one frame. Cheap to call when nothing changed. */
  frame(
    mood: GrainMood,
    influences: readonly GrainInfluence[],
    time: number,
  ): void;
  /** Match a new canvas box, in CSS px. */
  resize(width: number, height: number): void;
  dispose(): void;
};

/**
 * Create the field renderer on a canvas, or return null if this machine cannot
 * run it. A null here is not a failure: the caller keeps its CSS lattice, and
 * the page is quieter but still correct.
 */
export function createGrainRenderer(
  canvas: HTMLCanvasElement,
  options: { maxDpr?: number } = {},
): GrainRenderer | null {
  const context = (canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    /* The field is redrawn every frame it is visible, so the browser never
       needs to keep the last one around. */
    preserveDrawingBuffer: false,
  }) ??
    canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  if (!context) return null;
  /* Bound to a const the closures below can see as non-null: narrowing a
     `let` does not survive into a callback, and every one of these is one. */
  const gl = context;

  const program = compile(gl, FIELD_VERT, FIELD_FRAG);
  if (!program) return null;

  const quad = gl.createBuffer();
  if (!quad) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  /* One oversized triangle rather than two: same coverage, no diagonal seam,
     one fewer vertex to transform. */
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  /**
   * Uniform arrays are addressed by their first element. Most drivers accept
   * the bare array name for that, but not all of them do, so ask for the
   * element explicitly and fall back to the name.
   */
  const at = (name: string) => gl.getUniformLocation(program, name);
  const atArray = (name: string) =>
    gl.getUniformLocation(program, `${name}[0]`) ??
    gl.getUniformLocation(program, name);

  const u = {
    res: at("uRes"),
    time: at("uTime"),
    cell: at("uCell"),
    rest: at("uRest"),
    wave: at("uWave"),
    speed: at("uSpeed"),
    pulse: at("uPulse"),
    wash: at("uWash"),
    clip: at("uClip"),
    bias: at("uBias"),
    ink: at("uInk"),
    tint: at("uTint"),
    clipRect: at("uClipRect"),
    infPos: atArray("uInfPos"),
    infColor: atArray("uInfColor"),
  };
  const corner = gl.getAttribLocation(program, "aCorner");

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  /* Premultiplied source-over: the shader emits its own alpha, and stacking the
     dots over the wash must not brighten the page underneath. */
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const maxDpr = options.maxDpr ?? 2;
  const infPos = new Float32Array(MAX_INFLUENCES * 4);
  const infColor = new Float32Array(MAX_INFLUENCES * 4);

  let width = 0;
  let height = 0;
  let dpr = 1;
  let disposed = false;

  function resize(nextWidth: number, nextHeight: number) {
    if (disposed) return;
    const nextDpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    if (
      Math.abs(nextWidth - width) < 1 &&
      Math.abs(nextHeight - height) < 1 &&
      nextDpr === dpr
    )
      return;
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function frame(
    mood: GrainMood,
    influences: readonly GrainInfluence[],
    time: number,
  ) {
    if (disposed || width < 2 || height < 2) return;

    infPos.fill(0);
    infColor.fill(0);
    const live = Math.min(MAX_INFLUENCES, influences.length);
    for (let i = 0; i < live; i++) {
      const one = influences[i]!;
      if (one.strength <= 0.004 || one.radius <= 0.5) continue;
      /* The shader works in device pixels, because that is the space its cell
         lattice is laid out in; callers work in CSS pixels, because that is the
         space the DOM they are tracking lives in. */
      infPos[i * 4] = one.x * dpr;
      infPos[i * 4 + 1] = one.y * dpr;
      infPos[i * 4 + 2] = one.radius * dpr;
      infPos[i * 4 + 3] = one.strength;
      infColor[i * 4] = one.color[0];
      infColor[i * 4 + 1] = one.color[1];
      infColor[i * 4 + 2] = one.color[2];
      infColor[i * 4 + 3] = one.occludes ? 1 : 0;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.cell, Math.max(2, mood.spacing * dpr));
    gl.uniform1f(u.rest, mood.rest);
    gl.uniform1f(u.wave, mood.wave);
    gl.uniform1f(u.speed, mood.speed);
    gl.uniform1f(u.pulse, mood.pulse);
    gl.uniform1f(u.wash, mood.wash);
    gl.uniform1f(u.clip, mood.clip);
    gl.uniform3f(u.bias, mood.bias[0], mood.bias[1], mood.bias[2]);
    gl.uniform3f(u.ink, mood.ink[0], mood.ink[1], mood.ink[2]);
    gl.uniform3f(u.tint, mood.tint[0], mood.tint[1], mood.tint[2]);
    gl.uniform4f(
      u.clipRect,
      mood.clipRect[0],
      mood.clipRect[1],
      mood.clipRect[2],
      mood.clipRect[3],
    );
    gl.uniform4fv(u.infPos, infPos);
    gl.uniform4fv(u.infColor, infColor);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(corner);
  }

  return {
    frame,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      /* Hand the context back rather than waiting for the GC: a page that
         mounts and unmounts fields would otherwise walk into the browser's
         hard limit on live contexts. */
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

/**
 * Resolve a CSS colour to linear rgb by asking the browser.
 *
 * The product's colours are custom properties, `color-mix` results and oklab
 * values; nothing here should try to parse those by hand. One 1×1 canvas does
 * it correctly for every notation the browser supports, including the ones
 * that do not exist yet.
 */
let probe: CanvasRenderingContext2D | null | undefined;

export function resolveColor(
  css: string,
  fallback: readonly [number, number, number] = [0.5, 0.5, 0.5],
): [number, number, number] {
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return [...fallback];
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255];
  } catch {
    return [...fallback];
  }
}

/** Read a custom property off an element and resolve it. */
export function resolveVar(
  element: Element,
  name: string,
  fallback?: readonly [number, number, number],
): [number, number, number] {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return resolveColor(value || "#888", fallback);
}
