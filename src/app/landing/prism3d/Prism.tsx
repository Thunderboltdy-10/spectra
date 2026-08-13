"use client";

/* This component is an R3F render-loop: inside useFrame it deliberately
   mutates refs, shader uniforms and three objects every frame. That is the
   correct React Three Fiber idiom — the react-hooks/immutability and
   react-hooks/refs rules target React render code, not frame loops. */

import { useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import {
  heroState,
  damp,
  smoothstep,
  clamp01,
  phases,
  T,
} from "../scene/heroState";
import {
  CONTACT_ANCHORS_LOCAL,
  ENTRY_COLORS,
  OUTPUT_ANCHOR_LOCAL,
} from "./anchors";
import { PrismFx } from "./PrismFx";

export {
  CONTACT_ANCHORS_LOCAL,
  ENTRY_COLORS,
  OUTPUT_ANCHOR_LOCAL,
} from "./anchors";

/* ------------------------------------------------------------------ */
/* Geometry: a slightly asymmetric bevelled optical core.              */
/* Real thickness, real bevels — the asset the page is composed around */
/* ------------------------------------------------------------------ */
export function buildShellGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.04, 1.16);
  shape.lineTo(1.06, -0.63);
  shape.lineTo(-1.0, -0.72);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.86,
    bevelEnabled: true,
    bevelThickness: 0.075,
    bevelSize: 0.075,
    bevelOffset: 0,
    bevelSegments: 5,
    curveSegments: 6,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/* Contact anchors, wavelength colours and the output anchor live in
   ./anchors (re-exported above) — Prism and the effects layer share them. */

/* ------------------------------------------------------------------ */
/* PrismInternalEnergy — the optical engine, not a decorative glow.    */
/*                                                                     */
/*  A  ignition   energy enters at the live contact points             */
/*  B  routing    each wavelength travels a refracted internal path    */
/*  C  consolidate paths pool, swirl, and merge                        */
/*  D  alive      contained plasma field: buoyant, irregular, living   */
/*  E  compress   the field is pulled to the lower output channel      */
/* ------------------------------------------------------------------ */
const volVert = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vOrigin;
  uniform vec3 uCamLocal;
  void main(){
    vLocal = position;
    vOrigin = uCamLocal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const volFrag = /* glsl */ `
  precision highp float;
  varying vec3 vLocal;
  varying vec3 vOrigin;

  uniform float uTime;
  uniform float uDormant;
  uniform float uIgnite;
  uniform float uRoute;
  uniform float uConsolidate;
  uniform float uAlive;
  uniform float uCompress;
  uniform float uRelease;
  uniform float uPulse;
  uniform vec3  uEntry[6];
  uniform vec3  uEntryCol[6];
  uniform float uEntryW[6];
  uniform vec3  uOut;

  vec3 hash3(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
  }
  float noise(vec3 p){
    vec3 i = floor(p); vec3 f = fract(p);
    vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
  }
  float fbm(vec3 p){
    float a = 0.55, s = 0.0;
    for(int i=0;i<3;i++){ s += a*noise(p); p = p*2.07 + 3.1; a *= 0.5; }
    return s;
  }

  // distance from p to the refracted internal path of wavelength i
  float refractedPath(vec3 p, vec3 e, float bend, out float along){
    // entering ray bends toward the optical axis, then toward the output face
    vec3 inDir = normalize(-e);
    vec3 target = normalize(mix(inDir, normalize(uOut - e), bend));
    float t = clamp(dot(p - e, target), 0.0, 1.5);
    along = t / 1.5;
    vec3 c = e + target * t;
    // the path curves: displace it sideways as it travels
    vec3 side = normalize(cross(target, vec3(0.0,1.0,0.13)));
    c += side * sin(along * 2.4) * 0.16;
    return length(p - c);
  }

  float density(vec3 p, out vec3 col){
    float t = uTime;

    // buoyancy: the field is advected upward as it heats, then pulled to the
    // lower output channel as it compresses
    float lift = uAlive * 0.6 + uConsolidate * 0.3;
    vec3 q = p * 1.9;
    q.y -= t * (0.05 + 0.34 * lift);
    q += vec3(fbm(p*1.4 + t*0.07), 0.0, fbm(p*1.5 - t*0.06)) * (0.3 + 0.8*uAlive);

    float f = fbm(q);
    float f2 = fbm(q*2.1 + f);

    // --- B: refracted internal routing, wavelengths still separable --------
    float beams = 0.0;
    vec3 beamCol = vec3(0.0);
    // --- A/C: pools at the ingestion points, swirling into one another -----
    float pool = 0.0;
    vec3 poolCol = vec3(0.0);

    for (int i = 0; i < 6; i++){
      float w = uEntryW[i];
      if (w <= 0.001) continue;

      float along;
      float dl = refractedPath(p, uEntry[i], 0.35 + 0.55*uConsolidate, along);
      float beam = exp(-dl*dl*34.0) * (0.35 + 0.85*(1.0 - along)) * uRoute * w;
      beams += beam;
      beamCol += beam * uEntryCol[i];

      // pooled mass drifts from the entry toward the centre as it consolidates
      vec3 pc = mix(uEntry[i], uOut * 0.6, uConsolidate);
      // swirl: pools circulate around the optical axis before merging
      float a = t * (0.6 + 0.2*float(i)) ;
      pc.xz += vec2(cos(a), sin(a)) * 0.1 * uConsolidate;
      float d = length(p - pc);
      float pw = w * exp(-d*d*(6.0 - 2.0*uConsolidate));
      pool += pw;
      poolCol += pw * uEntryCol[i];
    }

    // --- D: living contained field ----------------------------------------
    float masses = smoothstep(0.05, 0.5, f*0.8 + f2*0.55 + pool*0.7);
    float alive = masses * (0.14 + 1.7*uAlive + 0.55*uConsolidate + 0.3*uDormant);

    // --- E: compression toward the lower output channel --------------------
    float channel = smoothstep(0.5, -0.9, p.y) * uCompress;
    float node = exp(-dot(p - uOut, p - uOut) * 9.0) * uCompress * (0.8 + 1.4*uRelease);

    float d0 = alive + beams * 1.5 + pool * 1.1 + channel * (0.45 + 0.9*uRelease) + node * 1.6;

    // colour: separate wavelengths first, then coherent white
    vec3 base = mix(vec3(0.34,0.24,0.86), vec3(0.22,0.48,0.95), clamp(f2*0.9+0.4,0.0,1.0));
    vec3 unified = mix(base, vec3(1.0,0.98,0.94),
      clamp(uAlive*0.5 + uCompress*0.7 + uRelease*0.9, 0.0, 1.0));

    vec3 spectral = (beamCol + poolCol) / max(0.0001, beams + pool);
    float spectralW = clamp((beams + pool) * 1.6, 0.0, 1.0) * (1.0 - uCompress*0.75);
    col = mix(unified, spectral, spectralW);
    col += vec3(1.0) * (channel * 0.45 + node * 0.9);
    col += vec3(1.0) * uIgnite * 0.12;

    return clamp(d0, 0.0, 1.8);
  }

  void main(){
    vec3 ro = vOrigin;
    vec3 rd = normalize(vLocal - ro);

    float b = dot(rd, -ro);
    float c = dot(ro, ro) - 0.86*0.86;
    float h = b*b - c;
    if (h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(b - h, 0.0);
    float t1 = b + h;

    vec3 acc = vec3(0.0);
    float alpha = 0.0;
    const int STEPS = 24;
    float dt = (t1 - t0) / float(STEPS);
    for (int i = 0; i < STEPS; i++){
      float t = t0 + dt * (float(i) + 0.5);
      vec3 p = ro + rd * t;
      vec3 col;
      float d = density(p, col) * dt * 1.5;
      d *= (1.0 - alpha);
      acc += col * d * (1.0 + uPulse*1.4);
      alpha += d;
      if (alpha > 0.98) break;
    }
    gl_FragColor = vec4(acc * 1.3, clamp(alpha, 0.0, 1.0));
  }
`;

/* Edge response layer: fresnel bevels plus localised ignition exactly where a
   wavelength is making contact. Same anchors as the currents use. */
const edgeVert = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main(){
    vNormal = normalize(normalMatrix * normal);
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const edgeFrag = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  uniform float uHover;
  uniform float uCharge;
  uniform float uPulse;
  uniform float uCaustic;
  uniform vec3 uColor;
  uniform vec3 uEntry[6];
  uniform vec3 uEntryCol[6];
  uniform float uEntryW[6];
  uniform vec3 uOut;
  uniform float uCompress;
  uniform float uRelease;
  void main(){
    float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 3.2);

    // localised edge ignition at each live contact
    float ig = 0.0;
    vec3 igc = vec3(0.0);
    for (int i = 0; i < 6; i++){
      float d = length(vLocal - uEntry[i]);
      float w = uEntryW[i] * exp(-d*d*5.0);
      ig += w;
      igc += w * uEntryCol[i];
    }

    // the lower output edge brightens before the current is released
    float od = length(vLocal - uOut);
    float outEdge = exp(-od*od*4.5) * (uCompress*0.8 + uRelease*1.2);

    float a = fres * (0.13 + 0.4*uCharge + 0.28*uHover + 0.65*uPulse + 0.5*uCaustic)
            + ig * (0.55 + 0.6*fres)
            + outEdge * (0.5 + 0.5*fres);

    vec3 col = uColor * (1.0 + 1.4*uCharge + uPulse + 1.6*uCaustic)
             + igc * 2.2
             + vec3(1.0) * outEdge * 1.8;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

export type PrismQuality = "high" | "medium" | "low";

type Props = { quality: PrismQuality };

export function Prism({ quality }: Props) {
  const group = useRef<THREE.Group>(null!);
  const { gl } = useThree();

  const shell = useMemo(() => buildShellGeometry(), []);
  const volumeGeo = useMemo(() => new THREE.BoxGeometry(1.9, 1.9, 1.9), []);

  const entryLocal = useMemo(
    () => CONTACT_ANCHORS_LOCAL.map((v) => v.clone().multiplyScalar(0.78)),
    [],
  );

  const volUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCamLocal: { value: new THREE.Vector3(0, 0, 5) },
      uDormant: { value: 1 },
      uIgnite: { value: 0 },
      uRoute: { value: 0 },
      uConsolidate: { value: 0 },
      uAlive: { value: 0 },
      uCompress: { value: 0 },
      uRelease: { value: 0 },
      uPulse: { value: 0 },
      uEntry: { value: entryLocal },
      uEntryCol: {
        value: ENTRY_COLORS.map((c) => new THREE.Vector3(c.r, c.g, c.b)),
      },
      uEntryW: { value: new Array(6).fill(0) },
      uOut: { value: OUTPUT_ANCHOR_LOCAL.clone() },
    }),
    [entryLocal],
  );
  const edgeUniforms = useMemo(
    () => ({
      uHover: { value: 0 },
      uCharge: { value: 0 },
      uPulse: { value: 0 },
      uCaustic: { value: 0 },
      uColor: { value: new THREE.Color("#c9b8ff") },
      uEntry: { value: CONTACT_ANCHORS_LOCAL },
      uEntryCol: {
        value: ENTRY_COLORS.map((c) => new THREE.Vector3(c.r, c.g, c.b)),
      },
      uEntryW: { value: new Array(6).fill(0) },
      uOut: { value: OUTPUT_ANCHOR_LOCAL.clone() },
      uCompress: { value: 0 },
      uRelease: { value: 0 },
    }),
    [],
  );

  /* --- orientation: layered procedural idle + arcball drag + press spin --- */
  const drag = useRef(new THREE.Quaternion());
  const drift = useRef(new THREE.Quaternion());
  const spinVel = useRef(new THREE.Vector3());
  const momentum = useRef(new THREE.Vector3());
  const last = useRef({ x: 0, y: 0, moved: 0, down: false });
  const hoverT = useRef(0);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const axis = useMemo(() => new THREE.Vector3(), []);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const poseQ = useMemo(() => new THREE.Quaternion(), []);
  const IDENTITY = useMemo(() => new THREE.Quaternion(), []);
  const invModel = useMemo(() => new THREE.Matrix4(), []);
  const yawV = useRef(0);
  const yawA = useRef(0);
  /** smoothed ingestion weights, so pools do not pop on the contact frame */
  const wSmooth = useRef<number[]>([0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    const el = gl.domElement;
    const onUp = () => {
      if (!last.current.down) return;
      last.current.down = false;
      heroState.dragging = false;
      if (last.current.moved < 6) {
        spinVel.current.set(1.9, 4.4, 1.2);
        heroState.pulse = 1;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!last.current.down) return;
      if (heroState.owned) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current.x = e.clientX;
      last.current.y = e.clientY;
      last.current.moved += Math.abs(dx) + Math.abs(dy);
      axis.set(dy, dx, 0);
      const len = axis.length();
      if (len < 1e-4) return;
      axis.divideScalar(len);
      tmpQ.setFromAxisAngle(axis, len * 0.0075);
      drag.current.premultiply(tmpQ);
      momentum.current.set(dy, dx, 0).multiplyScalar(0.05);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      el.style.cursor = "";
    };
  }, [gl, axis, tmpQ]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = heroState.fixedTime ?? state.clock.elapsedTime;
    const p = heroState.progress;
    const ph = phases(p);

    heroState.hover = damp(heroState.hover, hoverT.current, 6, d);
    heroState.pulse = damp(heroState.pulse, 0, 2.6, d);

    volUniforms.uTime.value = t;
    // camera position in prism-local space (no GLSL inverse(): WebGL1-safe)
    (volUniforms.uCamLocal.value as THREE.Vector3)
      .copy(state.camera.position)
      .applyMatrix4(invModel.copy(group.current.matrixWorld).invert());
    volUniforms.uDormant.value = ph.dormant;
    volUniforms.uIgnite.value = ph.ignition;
    volUniforms.uRoute.value = ph.routing;
    volUniforms.uConsolidate.value = ph.consolidate;
    volUniforms.uAlive.value = ph.alive;
    volUniforms.uCompress.value = ph.compression;
    volUniforms.uRelease.value = ph.release;
    volUniforms.uPulse.value = heroState.pulse;

    /* ingestion schedule: wavelengths make contact in staggered order as the
       narrative ignites, remain held through the living field, and hand back
       once the output channel has resolved. While the story is authoring an
       ingestion (a real card carried into the glass) its weights take over,
       so what the glass holds is exactly what an actor put there. */
    const authored = heroState.authored;
    for (let i = 0; i < 6; i++) {
      const landing = smoothstep(
        T.contact * 0.7 + i * 0.02,
        T.ignite * 0.9 + i * 0.018,
        p,
      );
      const handoff = 1 - smoothstep(T.output - 0.04, 0.995, p) * 0.8;
      const scrolled = clamp01(landing * handoff);
      heroState.entryPower[i] =
        authored > 0
          ? scrolled * (1 - authored) +
            clamp01(heroState.authoredEntry[i] ?? 0) * authored
          : scrolled;
    }

    /* ingestion weights persist through routing/consolidation so the
       interior remembers where the energy arrived */
    const vw = volUniforms.uEntryW.value as number[];
    const ew = edgeUniforms.uEntryW.value as number[];
    const persist = Math.max(ph.routing, ph.consolidate * 0.85);
    for (let i = 0; i < 6; i++) {
      const live = heroState.entryPower[i] ?? 0;
      const target = Math.max(live, persist * 0.9);
      wSmooth.current[i] = damp(wSmooth.current[i] ?? 0, target, 7, d);
      vw[i] = wSmooth.current[i]! * (0.85 + 0.15 * Math.sin(t * 2.3 + i * 1.7));
      ew[i] = live * 1.15;
    }

    heroState.charge = damp(
      heroState.charge,
      clamp01(
        0.05 +
          ph.ignition * 0.5 +
          ph.routing * 0.4 +
          ph.alive * 0.7 +
          ph.release * 0.4,
      ),
      4,
      d,
    );
    heroState.compression = ph.compression;
    heroState.emission = ph.release;

    edgeUniforms.uHover.value = heroState.hover;
    edgeUniforms.uCharge.value = heroState.charge;
    edgeUniforms.uPulse.value = heroState.pulse;
    edgeUniforms.uCaustic.value = ph.ignition;
    edgeUniforms.uCompress.value = ph.compression;
    edgeUniforms.uRelease.value = ph.release;

    /* -------- idle: layered, non-uniform, never a turntable --------- */
    if (!heroState.reducedMotion) {
      const targetYaw =
        Math.sin(t * 0.19) * 0.62 +
        Math.sin(t * 0.067 + 1.3) * 0.42 +
        t * 0.055;
      yawA.current = damp(yawA.current, (targetYaw - yawV.current) * 2.2, 3, d);
      yawV.current += yawA.current * d;

      const pitch =
        Math.sin(t * 0.131 + 2.1) * 0.17 +
        Math.sin(t * 0.047) * 0.09 +
        heroState.py * 0.09;
      const roll = Math.sin(t * 0.083 + 0.7) * 0.1 + heroState.px * 0.04;
      euler.set(pitch, yawV.current + heroState.px * 0.12, roll);
      drift.current.setFromEuler(euler);

      group.current.position.y =
        Math.sin(t * 0.21) * 0.04 + Math.sin(t * 0.11) * 0.024;
      group.current.position.x = Math.sin(t * 0.14 + 1.9) * 0.03;
    } else {
      // Reduced motion: one composed angle, no drift — same narrative pose.
      euler.set(0.06, 0.32, 0.04);
      drift.current.setFromEuler(euler);
    }

    /* Authored pose: an actor rotates the object into a readable working
       orientation. The idle drift bends toward it and any rotation the
       visitor applied relaxes at the same rate, so a takeover reads as the
       object settling under someone's hand — never as a snap. */
    const poseWeight = clamp01(heroState.pose.weight);
    if (poseWeight > 0.001) {
      poseQ.setFromEuler(heroState.pose.euler);
      /* Frame-rate independent approach. At full weight the object reaches
         the authored angle over roughly a second — long enough to read as a
         hand turning it, short enough that the next beat lands composed. */
      const settle = 1 - Math.exp(-poseWeight * 3.1 * d);
      drift.current.slerp(poseQ, settle);
      drag.current.slerp(IDENTITY, 1 - Math.exp(-poseWeight * 4.2 * d));
      const bleed = 1 - poseWeight * 1.6 * d;
      spinVel.current.multiplyScalar(bleed);
      momentum.current.multiplyScalar(bleed);
    }

    if (
      spinVel.current.lengthSq() > 1e-5 ||
      momentum.current.lengthSq() > 1e-5
    ) {
      axis.copy(spinVel.current).add(momentum.current);
      const len = axis.length();
      if (len > 1e-5) {
        tmpQ.setFromAxisAngle(axis.clone().normalize(), len * d);
        drag.current.premultiply(tmpQ);
      }
      spinVel.current.multiplyScalar(Math.exp(-4.2 * d));
      momentum.current.multiplyScalar(Math.exp(-3.4 * d));
    }

    // the prism resists the load, then yields as the energy consolidates
    const resist =
      smoothstep(T.contact, T.ignite, p) *
      (1 - smoothstep(T.route, T.alive, p));
    const yield_ = smoothstep(T.alive - 0.04, T.output, p);
    group.current.quaternion.copy(drag.current).multiply(drift.current);
    group.current.rotateZ(-resist * 0.09 + yield_ * 0.2);
    heroState.quat.copy(group.current.quaternion);
    group.current.getWorldPosition(heroState.center);

    const s =
      1 +
      heroState.pulse * 0.03 +
      heroState.charge * 0.018 -
      resist * 0.014 +
      yield_ * 0.022;
    group.current.scale.setScalar(s);
  });

  const samples = quality === "high" ? 6 : quality === "medium" ? 3 : 1;
  const resolution =
    quality === "high" ? 384 : quality === "medium" ? 256 : 128;
  const volumeVisible = quality !== "low";

  return (
    <group ref={group}>
      {/* outer glass shell — premium optical transmission material */}
      <mesh
        geometry={shell}
        onPointerOver={() => {
          hoverT.current = 1;
          /* While a story actor holds the object the visitor is shown that it
             is claimed, not that it is broken — the same scoped, temporary
             ownership any contended control uses. */
          gl.domElement.style.cursor = heroState.owned ? "default" : "grab";
        }}
        onPointerOut={() => {
          hoverT.current = 0;
          gl.domElement.style.cursor = "";
        }}
        onPointerDown={(e) => {
          if (heroState.owned) return;
          last.current = { x: e.clientX, y: e.clientY, moved: 0, down: true };
          heroState.dragging = true;
          gl.domElement.style.cursor = "grabbing";
        }}
      >
        <MeshTransmissionMaterial
          samples={samples}
          resolution={resolution}
          transmission={1}
          thickness={0.72}
          roughness={0.02}
          ior={1.58}
          chromaticAberration={0.62}
          anisotropicBlur={0.12}
          distortion={0.12}
          distortionScale={0.22}
          temporalDistortion={0.06}
          attenuationDistance={6.5}
          attenuationColor={"#d9d0ff" as unknown as THREE.Color}
          color={"#ffffff" as unknown as THREE.Color}
          clearcoat={1}
          clearcoatRoughness={0.08}
          backside
          backsideThickness={0.35}
        />
      </mesh>

      {/* bevel / ignition / output-face response — normal blending so the
          response stays truthful on Spectra's light page background */}
      <mesh geometry={shell} scale={1.012} renderOrder={2}>
        <shaderMaterial
          args={[
            {
              vertexShader: edgeVert,
              fragmentShader: edgeFrag,
              uniforms: edgeUniforms,
              transparent: true,
              depthWrite: false,
              blending: THREE.NormalBlending,
            },
          ]}
        />
      </mesh>

      {/* surface + exit effects: contact sparkles, output beam, flash */}
      <PrismFx quality={quality} />

      {/* contained plasma volume — raymarched inside the body. Normal
          blending: the gathered energy must stay visible against cream. */}
      <mesh geometry={volumeGeo} renderOrder={2} visible={volumeVisible}>
        <shaderMaterial
          args={[
            {
              vertexShader: volVert,
              fragmentShader: volFrag,
              uniforms: volUniforms,
              transparent: true,
              depthWrite: false,
              side: THREE.BackSide,
              blending: THREE.NormalBlending,
            },
          ]}
        />
      </mesh>
    </group>
  );
}
