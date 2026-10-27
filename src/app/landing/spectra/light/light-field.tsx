"use client";

import { useEffect, useRef } from "react";
import { frame, onLight, type Drawn } from "./light";

/*
 * Draws the page's light as soft washes of colour. Two layers share one
 * picture: the back one lies on the paper, under everything; the front one is
 * cut to the headings and blends lighten, so where light passes under a
 * heading its ink takes the colour while the paper around it stays paper.
 * Both sleep when there is no light. Without WebGL (or with less motion asked
 * for) the page is plain paper, which it always reads well on.
 */

const MAX_SOURCES = 12;
const MAX_TEXT = 8;

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_time;
uniform int u_count;
uniform vec4 u_src[${MAX_SOURCES}];
uniform vec4 u_hue[${MAX_SOURCES}];
uniform int u_front;
uniform int u_rects;
uniform vec4 u_rect[${MAX_TEXT}];
uniform vec3 u_ramp[7];

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}

vec3 ramp(float h) {
  h = mod(h, 6.0);
  float i = floor(h);
  float f = smoothstep(0.0, 1.0, fract(h));
  vec3 a = u_ramp[0];
  vec3 b = u_ramp[1];
  for (int k = 0; k < 6; k++) {
    if (float(k) == i) { a = u_ramp[k]; b = u_ramp[k + 1]; }
  }
  return mix(a, b, f);
}

void main() {
  // CSS pixels, top-left origin.
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;

  if (u_front == 1) {
    bool inside = false;
    for (int r = 0; r < ${MAX_TEXT}; r++) {
      if (r >= u_rects) break;
      vec4 b = u_rect[r];
      if (px.x >= b.x && px.y >= b.y && px.x <= b.x + b.z && px.y <= b.y + b.w) inside = true;
    }
    if (!inside) { gl_FragColor = vec4(0.0); return; }
  }

  float t = u_time;
  // The light drifts: every pool is pushed about by one slow current.
  vec2 warp = vec2(fbm(px * 0.0042 + vec2(t * 0.05, -t * 0.03)), fbm(px * 0.0042 + vec2(5.2 - t * 0.04, 1.3 + t * 0.05))) - 0.5;
  vec2 q = px + warp * 120.0;

  float total = 0.0;
  vec3 colour = vec3(0.0);
  float weight = 0.0;
  float solid = 0.0;
  for (int s = 0; s < ${MAX_SOURCES}; s++) {
    if (s >= u_count) break;
    vec4 src = u_src[s];
    vec4 hue = u_hue[s];
    // src: centre x, y, radius x, radius y (z,w packed as rx, ry); hue: h0, h1, strength, flow.
    // A negative flow marks a body (the sun): a disc with an edge and a halo, not a pool.
    bool disc = hue.w < 0.0;
    float flow = abs(hue.w);
    vec2 d = ((disc ? px : q) - src.xy) / vec2(src.z, src.w);
    float r2 = dot(d, d);
    float fall = disc ? (1.0 - smoothstep(0.86, 1.0, sqrt(r2))) * (0.74 - 0.25 * r2) + exp(-r2 * 0.55) * 0.3 : exp(-r2 * 1.6);
    if (fall < 0.002) continue;
    // Wisps: the pool is uneven, and its unevenness moves.
    float wisp = fbm(q * 0.009 + vec2(float(s) * 3.7, t * 0.18 * (0.4 + flow)));
    float body = fall * (disc ? 0.55 + 0.5 * wisp : 0.35 + 1.1 * wisp) * hue.z;
    total += body;
    if (disc) solid = max(solid, fall * hue.z);
    float along = disc ? clamp(sqrt(r2) * 0.75 + wisp * 0.3, 0.0, 1.0) : fbm(q * 0.0035 + vec2(t * 0.06 * flow, float(s)));
    vec3 c = ramp(mix(hue.x, hue.y, disc ? along : clamp(along * 1.6 - 0.3, 0.0, 1.0)));
    colour += c * body;
    weight += body;
  }
  if (weight <= 0.0001) { gl_FragColor = vec4(0.0); return; }
  colour /= weight;

  // The faint tail of a pool is cut, so light has a body instead of a haze everywhere.
  float density = smoothstep(0.05, 1.0, total);
  if (u_front == 1) {
    // Ink takes the light deep, not pale, so a lit heading still reads.
    vec3 deep = clamp(mix(vec3(dot(colour, vec3(0.3, 0.55, 0.15))), colour, 1.35) * 0.66, 0.0, 1.0);
    float a = smoothstep(0.04, 0.5, density) * 0.9;
    gl_FragColor = vec4(deep * a, a);
    return;
  }
  // Light lies on the paper as a soft wash, the way light falls through tinted glass; a body (the sun) is solid.
  float wash = smoothstep(0.0, 1.0, density) * 0.3;
  float alpha = clamp(max(wash, smoothstep(0.25, 0.9, solid) * 0.96), 0.0, 1.0);
  gl_FragColor = vec4(colour * alpha, alpha);
}
`;

// The prism's six wavelengths and the joint back to red (LANGUAGE.md).
const RAMP = ["#ff647f", "#ffab4a", "#f6d75d", "#48c997", "#4f9fe6", "#9176e8", "#d070b8"].flatMap((hex) => {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
});

type Layer = {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

function layer(canvas: HTMLCanvasElement): Layer | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const names = ["u_res", "u_scale", "u_time", "u_count", "u_src", "u_hue", "u_front", "u_rects", "u_rect", "u_ramp"];
  const uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  gl.uniform3fv(uniforms.u_ramp!, new Float32Array(RAMP));
  return { gl, canvas, uniforms };
}

function paint(target: Layer, drawn: Drawn[], time: number, rects: Float32Array, rectCount: number, front: boolean) {
  const { gl, canvas, uniforms } = target;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!drawn.length || (front && !rectCount)) return;
  const src = new Float32Array(MAX_SOURCES * 4);
  const hue = new Float32Array(MAX_SOURCES * 4);
  drawn.slice(0, MAX_SOURCES).forEach((source, index) => {
    src.set([source.x, source.y, source.rx, source.ry], index * 4);
    hue.set([source.h0, source.h1, source.strength, source.flow], index * 4);
  });
  gl.uniform2f(uniforms.u_res!, canvas.width, canvas.height);
  gl.uniform1f(uniforms.u_scale!, canvas.width / Math.max(1, canvas.clientWidth));
  gl.uniform1f(uniforms.u_time!, time);
  gl.uniform1i(uniforms.u_count!, Math.min(MAX_SOURCES, drawn.length));
  gl.uniform4fv(uniforms.u_src!, src);
  gl.uniform4fv(uniforms.u_hue!, hue);
  gl.uniform1i(uniforms.u_front!, front ? 1 : 0);
  gl.uniform1i(uniforms.u_rects!, rectCount);
  gl.uniform4fv(uniforms.u_rect!, rects);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function LightField() {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const back = backRef.current ? layer(backRef.current) : null;
    const front = frontRef.current ? layer(frontRef.current) : null;
    if (!back) return;
    document.documentElement.dataset.light = "on";

    let raf = 0;
    let last = performance.now();
    const started = last;
    const rects = new Float32Array(MAX_TEXT * 4);

    // Washes have no detail to lose: a third of the page's resolution, smoothed up, is enough and cheap.
    const size = () => {
      // The ink layer is cut to the headings' boxes, so it keeps a finer edge.
      for (const [target, ratio] of [[back, 0.34], [front, 0.6]] as const) {
        if (!target) continue;
        target.canvas.width = Math.round(window.innerWidth * ratio);
        target.canvas.height = Math.round(window.innerHeight * ratio);
      }
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(64, now - last);
      last = now;
      const view = { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY };
      const { drawn, moving } = frame(now, dt, view);
      const time = (now - started) / 1000;
      paint(back, drawn, time, rects, 0, false);
      if (front) {
        let count = 0;
        for (const element of document.querySelectorAll("[data-light-text]")) {
          if (count >= MAX_TEXT) break;
          const box = element.getBoundingClientRect();
          if (box.bottom < 0 || box.top > view.height) continue;
          rects.set([box.left, box.top, box.width, box.height], count * 4);
          count += 1;
        }
        paint(front, drawn, time, rects, count, true);
      }
      if (moving) raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    size();
    const stop = onLight(start);
    const onResize = () => {
      size();
      start();
    };
    const onScroll = () => start();
    const onVisible = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : start());
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    start();
    return () => {
      stop();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisible);
      delete document.documentElement.dataset.light;
    };
  }, []);

  return (
    <>
      <canvas ref={backRef} className="sp-light" data-layer="back" aria-hidden />
      <canvas ref={frontRef} className="sp-light" data-layer="front" aria-hidden />
    </>
  );
}
