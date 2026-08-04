"use client";

/* The SceneDriver/CameraRig run inside R3F's frame loop and intentionally
   dereference refs per frame — never during React render. */
/* eslint-disable react-hooks/immutability */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { heroState, damp, phases, smoothstep } from "../scene/heroState";
import { Prism, type PrismQuality } from "./Prism";

/**
 * The real prism stage (Phase 15.2/15.4/15.7).
 *
 * One lazily-loaded R3F canvas hosts:
 *   - the bevelled transmission-glass optical core with its raymarched
 *     internal engine (dormant → ignition → routing → consolidation →
 *     alive → compression → release);
 *   - six wavelength currents arriving from the scattered environment and
 *     landing on the prism's live contact points;
 *   - one coherent warm-white output once the field resolves.
 *
 * Scroll writes a single progress number through a ref; everything renders
 * from damped state — no per-frame React work.
 */

function SceneDriver({
  progressRef,
  reduced,
}: {
  progressRef: { current: number };
  reduced: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    heroState.reducedMotion = reduced;
    if (reduced) {
      // One composed moment, frozen deterministically.
      heroState.fixedTime = 12.6;
      invalidate();
    } else {
      heroState.fixedTime = null;
    }
    return () => {
      heroState.fixedTime = null;
      heroState.reducedMotion = false;
    };
  }, [reduced, invalidate]);

  useEffect(() => {
    if (reduced) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  useFrame((_, dt) => {
    const target = progressRef.current;
    const d = Math.min(dt, 0.05);
    if (Math.abs(heroState.progress - target) > 0.0004) {
      heroState.progress = reduced
        ? target
        : damp(heroState.progress, target, 3.6, d);
      if (reduced) invalidate();
    }
    heroState.px = damp(heroState.px, pointer.current.x, 5, d);
    heroState.py = damp(heroState.py, pointer.current.y, 5, d);
  });

  return null;
}

/** A soft optical pool grounds the glass; it warms as the output resolves. */
function FloorPool({ reduced }: { reduced: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const pool = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const cool = useMemo(() => new THREE.Color("#a795ff"), []);
  const warm = useMemo(() => new THREE.Color("#ffe9c8"), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!mat.current) return;
    const ph = phases(heroState.progress);
    const glow =
      0.1 + heroState.charge * 0.16 + ph.release * 0.12 + heroState.pulse * 0.1;
    mat.current.opacity = reduced ? 0.16 : glow;
    tmp.copy(cool).lerp(warm, ph.compression * 0.5 + ph.release * 0.5);
    mat.current.color.copy(tmp);
  });

  return (
    <mesh
      position={[0, -1.52, 0]}
      rotation-x={-Math.PI / 2}
      scale={5.2}
      renderOrder={1}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={mat}
        map={pool}
        transparent
        opacity={0.12}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Camera gently breathes with charge and parallax — never a hard cut. */
function CameraRig({ reduced }: { reduced: boolean }) {
  const { camera } = useThree();
  useFrame(() => {
    /* As the scroll scenes hand the stage to real surfaces (progress past
       the fragments scene), the glass slides toward the right frame edge and
       pulls back slightly — present and glowing, never fighting the demo. */
    const aside = smoothstep(0.28, 0.48, heroState.progress);
    if (!reduced) {
      const charge = heroState.charge;
      camera.position.x = damp(
        camera.position.x,
        heroState.px * 0.12,
        3,
        0.016,
      );
      camera.position.y = damp(
        camera.position.y,
        0.05 - heroState.py * 0.08,
        3,
        0.016,
      );
      camera.position.z = damp(
        camera.position.z,
        7.4 - charge * 0.35 + aside * 1.15,
        2,
        0.016,
      );
    }
    camera.lookAt(-0.85 - aside * 1.9, -0.04 + aside * 0.14, 0);
  });
  return null;
}

export default function PrismCanvas({
  progressRef,
  quality,
  reduced,
  paused,
  onFirstFrame,
}: {
  progressRef: { current: number };
  quality: PrismQuality;
  reduced: boolean;
  /** Freeze rendering entirely while the stage is off-screen. */
  paused?: boolean;
  onFirstFrame?: () => void;
}) {
  const [painted, setPainted] = useState(false);
  const dpr = useMemo<[number, number]>(
    () =>
      quality === "high" ? [1, 2] : quality === "medium" ? [1, 1.5] : [0.75, 1],
    [quality],
  );
  const frameloop = reduced || paused ? "demand" : "always";

  return (
    <Canvas
      dpr={dpr}
      gl={{
        antialias: quality !== "low",
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: quality === "low" ? "low-power" : "high-performance",
        preserveDrawingBuffer: false,
      }}
      camera={{ position: [0, 0.05, 7.4], fov: 35, near: 0.1, far: 40 }}
      frameloop={frameloop}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        if (!painted) {
          setPainted(true);
          onFirstFrame?.();
        }
      }}
      style={{ background: "transparent" }}
      eventSource={undefined}
    >
      <SceneDriver progressRef={progressRef} reduced={reduced} />
      <CameraRig reduced={reduced} />

      {/* procedural environment for the transmission glass — no network HDR.
          Soft studio tones tuned for Spectra's light page. */}
      <Environment resolution={96} frames={1} background={false}>
        <mesh position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={11}>
          <planeGeometry />
          <meshBasicMaterial color="#f6f3ff" />
        </mesh>
        <mesh position={[-6, 1.4, -2]} rotation-y={Math.PI / 2} scale={7}>
          <planeGeometry />
          <meshBasicMaterial color="#c2b3f7" />
        </mesh>
        <mesh position={[6, -0.6, -1.5]} rotation-y={-Math.PI / 2} scale={6}>
          <planeGeometry />
          <meshBasicMaterial color="#bfe6d6" />
        </mesh>
        <mesh position={[0, -5, 1]} rotation-x={-Math.PI / 2} scale={8}>
          <planeGeometry />
          <meshBasicMaterial color="#efe7da" />
        </mesh>
      </Environment>

      <Suspense fallback={null}>
        <Prism quality={quality} />
        <FloorPool reduced={reduced} />
      </Suspense>
    </Canvas>
  );
}
