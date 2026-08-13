import * as THREE from "three";
import type { Ctx } from "../engine/ticker";
import { damp, clamp } from "../engine/ticker";

/* ------------------------------------------------------------------
   Shared, mutable state written by scroll scenes, read by the loop.
   One WebGL scene for the whole site: the hero prism persists and is
   re-choreographed by each act; the dot field is a single reusable
   system whose parameters are re-tuned per scene.
------------------------------------------------------------------- */

export const prism = {
  /** target position in normalised screen coords (-1..1) */
  px: 0,
  py: 0,
  /** depth offset toward/away from camera */
  pz: 0,
  scale: 1,
  /** continuous spin speed multiplier */
  spin: 1,
  tilt: 0,
  roll: 0,
  /** 0..1 — work being absorbed: interior brightens, geometry breathes */
  intake: 0,
  /** 0..1 — sustained internal charge (active AI work) */
  charge: 0,
  opacity: 1,
  /** filled by the loop: on-screen position + radius in CSS px */
  screen: { x: 0, y: 0, r: 120 },
};

export const field = {
  intensity: 0.5,
  density: 1,
  cell: 11,
  wave: 1,
  speed: 1,
  /** 0 = parchment, 1 = amber, 2 = sea, 3 = rose (blended) */
  tint: 0,
  pulse: 0,
  /** clip clue: 0 = full bleed, 1 = clipped by an unseen parent surface */
  clip: 0,
  clipRect: [0.06, 0.04, 0.94, 0.96] as [number, number, number, number],
};

export let glReady = false;

const TINTS = [
  new THREE.Color("#d9d2c4"),
  new THREE.Color("#e0ad63"),
  new THREE.Color("#7cc9b4"),
  new THREE.Color("#e08d80"),
];

/* ---------------- environment (procedural, controlled) ---------------- */

function makeEnvTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const base = g.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, "#3a3a34");
  base.addColorStop(0.42, "#151814");
  base.addColorStop(1, "#080908");
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);

  const blob = (x: number, y: number, rx: number, ry: number, col: string, a: number) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = a;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.globalAlpha = 1;
  };

  // key softbox
  blob(150, 40, 190, 90, "#fff6e8", 0.95);
  // warm bounce
  blob(360, 96, 150, 110, "#e0ad63", 0.5);
  // cool rim
  blob(470, 170, 130, 100, "#7cc9b4", 0.32);
  // faint rose kick
  blob(40, 190, 90, 70, "#e08d80", 0.22);
  // horizon line for crisp edge reflections
  g.globalAlpha = 0.5;
  g.fillStyle = "#0a0b0a";
  g.fillRect(0, 150, 512, 4);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- dot field shader ---------------- */

const FIELD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uCell, uDensity, uIntensity, uSpeed, uWave, uPulse, uClip;
uniform vec2 uPointer;
uniform vec4 uPrism;      // xy = screen px, z = radius px, w = intensity
uniform vec4 uClipRect;   // x0 y0 x1 y1 in uv
uniform vec3 uTintA, uTintB;

void main() {
  vec2 p = vUv * uRes;
  float cell = uCell;
  float row = floor(p.y / cell);
  float offs = mod(row, 2.0) * 0.5;           // staggered halftone lattice
  float col = floor(p.x / cell - offs);
  vec2 center = vec2((col + offs + 0.5) * cell, (row + 0.5) * cell);

  float t = uTime * uSpeed;
  float w = sin(center.x * 0.0062 + t * 0.55)
          + sin(center.y * 0.0081 - t * 0.42)
          + 0.55 * sin((center.x + center.y) * 0.0037 + t * 0.9);

  vec2 disp = vec2(cos(w * 1.6), sin(w * 1.25)) * uWave * cell * 0.26;

  // cursor proximity — the surface notices you
  vec2 dp = center - uPointer;
  float dl = length(dp);
  float pf = exp(-dl / 150.0);
  disp += normalize(dp + 1e-4) * pf * cell * 0.5;

  // prism proximity — the object displaces the lattice, and casts through it
  vec2 dq = center - uPrism.xy;
  float dql = length(dq);
  float pr = smoothstep(uPrism.z * 1.45, 0.0, dql);
  disp += normalize(dq + 1e-4) * pr * cell * 0.85 * uPrism.w;

  vec2 c = center + disp;
  float d = length(p - c);

  float r = 0.85 + 0.55 * pf + 0.42 * pr * uPrism.w + 0.25 * uPulse;
  float a = smoothstep(r, r - 1.15, d);

  float vig = smoothstep(1.05, 0.22, length(vUv - 0.5));
  float b = uIntensity * (0.28 + 0.72 * vig);
  b *= 1.0 + 2.0 * pf + 1.5 * pr * uPrism.w + 1.2 * uPulse * pr;
  // dimensional shadowing directly beneath the object
  b *= mix(1.0, 0.18, smoothstep(uPrism.z * 0.62, 0.0, dql) * uPrism.w);
  // slow density breathing so the lattice never looks static
  b *= 0.75 + 0.25 * sin(w * 0.7 + t * 0.3);

  // clipped by an unseen parent surface (act 7 clue)
  vec2 e = vec2(0.012, 0.012);
  float m = smoothstep(uClipRect.x - e.x, uClipRect.x + e.x, vUv.x)
          * smoothstep(uClipRect.z + e.x, uClipRect.z - e.x, vUv.x)
          * smoothstep(uClipRect.y - e.y, uClipRect.y + e.y, vUv.y)
          * smoothstep(uClipRect.w + e.y, uClipRect.w - e.y, vUv.y);
  b *= mix(1.0, m, uClip);

  vec3 tint = mix(uTintA, uTintB, clamp(pf * 0.9 + pr * 0.75 + uPulse * 0.5, 0.0, 1.0));
  float alpha = a * b * uDensity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(tint, alpha);
}
`;

const FIELD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* ---------------- stage ---------------- */

export class Stage {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera!: THREE.PerspectiveCamera;
  mesh!: THREE.Mesh;
  mat!: THREE.MeshPhysicalMaterial;
  plane!: THREE.Mesh;
  uniforms!: Record<string, THREE.IUniform>;
  glow!: THREE.Sprite;
  keyLight!: THREE.PointLight;
  ok = false;
  private planeZ = -6;
  private pos = new THREE.Vector3(0, 0, 0);
  private cur = { scale: 1, intake: 0, charge: 0, opacity: 1, spinAcc: 0 };
  private tintA = new THREE.Color("#d9d2c4");
  private tintB = new THREE.Color("#e0ad63");
  private mobile = false;

  init(canvas: HTMLCanvasElement, mobile: boolean) {
    this.mobile = mobile;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !mobile,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      this.ok = false;
      return false;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 1.75));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.06;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const anyR = r as unknown as { transmissionResolutionScale?: number };
    if ("transmissionResolutionScale" in r) anyR.transmissionResolutionScale = mobile ? 0.4 : 0.55;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.camera.position.set(0, 0, 7);

    // environment
    const envTex = makeEnvTexture();
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromEquirectangular(envTex).texture;
    this.scene.environment = env;
    envTex.dispose();
    pmrem.dispose();

    // --- prism geometry: equilateral triangle, extruded with bevelled edges
    const shape = new THREE.Shape();
    const R = 1.0;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
      const x = Math.cos(a) * R;
      const y = Math.sin(a) * R;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.92,
      bevelEnabled: true,
      bevelThickness: 0.055,
      bevelSize: 0.05,
      bevelSegments: 3,
      curveSegments: 2,
    });
    geo.translate(0, 0.06, -0.46);
    geo.computeVertexNormals();

    this.mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#ffffff"),
      metalness: 0,
      roughness: 0.035,
      transmission: 1,
      thickness: 1.35,
      ior: 1.62,
      envMapIntensity: 1.35,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      attenuationColor: new THREE.Color("#8fb9ad"),
      attenuationDistance: 6.5,
      iridescence: 0.28,
      iridescenceIOR: 1.32,
      specularIntensity: 1,
      transparent: true,
    });
    const anyMat = this.mat as unknown as { dispersion?: number };
    if ("dispersion" in this.mat) anyMat.dispersion = mobile ? 2.0 : 3.6;

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.set(-0.22, 0.5, 0.06);
    this.scene.add(this.mesh);

    // restrained bloom substitute — a single soft sprite, never a lens flare
    const gc = document.createElement("canvas");
    gc.width = gc.height = 128;
    const gg = gc.getContext("2d")!;
    const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,238,210,0.5)");
    rg.addColorStop(0.35, "rgba(224,173,99,0.16)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    gg.fillStyle = rg;
    gg.fillRect(0, 0, 128, 128);
    const gTex = new THREE.CanvasTexture(gc);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: gTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
    );
    this.glow.scale.setScalar(5.5);
    this.glow.material.opacity = 0.22;
    this.scene.add(this.glow);

    // lights
    const key = new THREE.DirectionalLight(0xfff2e0, 1.5);
    key.position.set(3.2, 4, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fe0d0, 0.85);
    rim.position.set(-4, -1.5, -3);
    this.scene.add(rim);
    this.keyLight = new THREE.PointLight(0xffd9a0, 0, 9, 2);
    this.scene.add(this.keyLight);

    // dot field plane
    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCell: { value: 11 },
      uDensity: { value: 1 },
      uIntensity: { value: 0.5 },
      uSpeed: { value: 1 },
      uWave: { value: 1 },
      uPulse: { value: 0 },
      uClip: { value: 0 },
      uPointer: { value: new THREE.Vector2(-999, -999) },
      uPrism: { value: new THREE.Vector4(0, 0, 120, 1) },
      uClipRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uTintA: { value: this.tintA },
      uTintB: { value: this.tintB },
    };
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: FIELD_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
      })
    );
    this.plane.position.z = this.planeZ;
    this.scene.add(this.plane);

    this.ok = true;
    glReady = true;
    return true;
  }

  resize(w: number, h: number) {
    if (!this.ok) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dist = this.camera.position.z - this.planeZ;
    const ph = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    this.plane.scale.set(ph * this.camera.aspect * 1.02, ph * 1.02, 1);
    (this.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  /** convert normalised screen coords to world at z = 0 */
  private toWorld(nx: number, ny: number, z: number) {
    const dist = this.camera.position.z - z;
    const h = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    return new THREE.Vector3((nx * h * this.camera.aspect) / 2, (-ny * h) / 2, z);
  }

  frame(c: Ctx) {
    if (!this.ok) return;
    const dt = c.dt;
    const u = this.uniforms;

    // --- prism transform (damped: every move anticipates and settles)
    const target = this.toWorld(prism.px, prism.py, prism.pz);
    this.pos.x = damp(this.pos.x, target.x, 6.5, dt);
    this.pos.y = damp(this.pos.y, target.y, 6.5, dt);
    this.pos.z = damp(this.pos.z, target.z, 6.5, dt);
    this.mesh.position.copy(this.pos);
    this.glow.position.copy(this.pos);

    this.cur.scale = damp(this.cur.scale, prism.scale, 6, dt);
    this.cur.intake = damp(this.cur.intake, prism.intake, 5, dt);
    this.cur.charge = damp(this.cur.charge, prism.charge, 4, dt);
    this.cur.opacity = damp(this.cur.opacity, prism.opacity, 6, dt);

    const breathe = 1 + Math.sin(c.t * 0.62) * 0.012 + this.cur.intake * 0.085;
    this.mesh.scale.setScalar(this.cur.scale * breathe);

    this.cur.spinAcc += dt * (0.16 + prism.spin * 0.1 + this.cur.intake * 0.55);
    const px = c.reduced ? 0 : c.nx;
    const py = c.reduced ? 0 : c.ny;
    this.mesh.rotation.y = this.cur.spinAcc + px * 0.24 + prism.roll;
    this.mesh.rotation.x = -0.2 + py * 0.14 + Math.sin(c.t * 0.44) * 0.035 + prism.tilt;
    this.mesh.rotation.z = 0.05 + Math.sin(c.t * 0.31) * 0.025;

    // interior light: attenuation shifts from cool glass to charged amber
    const chargeMix = clamp(this.cur.charge + this.cur.intake * 0.9);
    this.mat.attenuationColor.setRGB(
      0.56 + chargeMix * 0.36,
      0.72 - chargeMix * 0.12,
      0.68 - chargeMix * 0.3
    );
    this.mat.attenuationDistance = 6.5 - chargeMix * 4.0;
    this.mat.thickness = 1.35 + this.cur.intake * 0.5;
    this.mat.opacity = this.cur.opacity;
    this.mat.envMapIntensity = 1.35 + chargeMix * 0.7;
    this.keyLight.position.copy(this.pos);
    this.keyLight.intensity = chargeMix * 5.5 * this.cur.opacity;
    this.glow.scale.setScalar(this.cur.scale * (4.6 + this.cur.intake * 2.4));
    this.glow.material.opacity = (0.16 + chargeMix * 0.3) * this.cur.opacity;
    this.mesh.visible = this.cur.opacity > 0.01;
    this.glow.visible = this.mesh.visible;

    // --- project prism to screen for DOM choreography + field interaction
    const v = this.pos.clone().project(this.camera);
    const sx = ((v.x + 1) / 2) * c.vw;
    const sy = ((1 - v.y) / 2) * c.vh;
    const worldR = this.cur.scale * 1.15;
    const edge = this.pos.clone().add(new THREE.Vector3(worldR, 0, 0)).project(this.camera);
    const rpx = Math.abs(((edge.x + 1) / 2) * c.vw - sx);
    prism.screen.x = sx;
    prism.screen.y = sy;
    prism.screen.r = rpx;

    // --- dot field
    u.uTime.value = c.t;
    u.uCell.value = damp(u.uCell.value as number, field.cell * (this.mobile ? 1.35 : 1), 4, dt);
    u.uIntensity.value = damp(u.uIntensity.value as number, field.intensity, 4, dt);
    u.uDensity.value = damp(u.uDensity.value as number, field.density, 4, dt);
    u.uWave.value = damp(u.uWave.value as number, field.wave, 3, dt);
    u.uSpeed.value = damp(u.uSpeed.value as number, field.speed, 3, dt);
    u.uPulse.value = damp(u.uPulse.value as number, field.pulse, 5, dt);
    if (c.reduced) {
      u.uSpeed.value = (u.uSpeed.value as number) * 0.22;
      u.uWave.value = (u.uWave.value as number) * 0.3;
    }
    u.uClip.value = damp(u.uClip.value as number, field.clip, 4, dt);
    (u.uPointer.value as THREE.Vector2).set(c.px, c.vh - c.py);
    (u.uPrism.value as THREE.Vector4).set(sx, c.vh - sy, Math.max(30, rpx), this.cur.opacity);
    (u.uClipRect.value as THREE.Vector4).set(
      field.clipRect[0],
      1 - field.clipRect[3],
      field.clipRect[2],
      1 - field.clipRect[1]
    );
    const ti = clamp(field.tint, 0, 3);
    const i0 = Math.floor(ti);
    const i1 = Math.min(3, i0 + 1);
    this.tintB.copy(TINTS[i0]).lerp(TINTS[i1], ti - i0);
    this.tintA.setRGB(0.62, 0.6, 0.55);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (!this.ok) return;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.ok = false;
  }
}

export const stage = new Stage();
